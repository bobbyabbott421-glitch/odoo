# Part of Odoo. See LICENSE file for full copyright and licensing details.

import socket
import threading

from odoo.fields import Command
from odoo.http.session import session_store
from odoo.addons.web.tests.test_offline import serve_odoo
from odoo.tests import HttpCase, tagged
from odoo.tests.common import HOST, ChromeBrowser, flushing_cursor


class CrmOfflineBrowserCase(HttpCase):
    def evaluate(self, expression):
        result = self.browser._websocket_request('Runtime.evaluate', params={
            'expression': expression, 'awaitPromise': True, 'returnByValue': True,
        }, timeout=65)
        self.assertNotIn('exceptionDetails', result, str(result)[:500])
        return result['result'].get('value')

    def setUp(self):
        super().setUp()
        self.browser = ChromeBrowser(self)
        self.addCleanup(self.browser.stop)
        self.authenticate('admin', 'admin', browser=self.browser)


@tagged('post_install', '-at_install')
class TestCrmOfflineRead(CrmOfflineBrowserCase):
    def test_visited_lead(self):
        lead = self.env['crm.lead'].create({'name': 'Warehouse visit', 'type': 'opportunity'})
        lead.message_post(body='Use the loading entrance', subtype_xmlid='mail.mt_note')
        lead.activity_schedule('mail.mail_activity_data_todo', summary='Confirm delivery date')

        browser = self.browser
        evaluate = self.evaluate

        def wait_for_chatter(offline=False):
            # Observe what the rep sees. Keep the assertion independent of component
            # state so an empty chatter or a form left on screen cannot pass.
            self.assertTrue(evaluate("""
                new Promise(resolve => {
                    const deadline = performance.now() + 55000;
                    function check() {
                        const chatter = document.querySelector('.o-mail-Chatter');
                        const text = chatter?.innerText || '';
                        if (text.includes('Use the loading entrance') &&
                            text.includes('Confirm delivery date') &&
                            (!%s || (!window.oldLeadDocument && text.includes('Lead history saved on') &&
                                text.includes('Lead details last checked on')))) {
                            resolve(true);
                        } else if (performance.now() > deadline) {
                            resolve(false);
                        } else {
                            setTimeout(check, 50);
                        }
                    }
                    check();
                })
            """ % ('true' if offline else 'false')))

        with self.allow_requests(browser=browser), flushing_cursor(self.cr):
            with serve_odoo() as port:
                url = f'http://{HOST}:{port}/odoo/crm/{lead.id}'
                browser.navigate_to(url)
                wait_for_chatter()
                evaluate('navigator.serviceWorker.ready.then(() => true)')
                browser.navigate_to(url, wait_stop=True)
                wait_for_chatter()
                self.assertTrue(evaluate('!!navigator.serviceWorker.controller'))
                evaluate('window.oldLeadDocument = true')
            with browser.offline():
                browser.navigate_to(url)
                wait_for_chatter(offline=True)
                lead.unlink()
                self.env.flush_all()
            with serve_odoo(port):
                # Reconnection checks the stored ids through the rep's own record
                # rules. The deleted lead must leave both the screen and the cache.
                self.assertTrue(browser._wait_ready(
                    "location.pathname === '/odoo/crm' && !!document.querySelector('.o_kanban_view')",
                    timeout=55,
                ), "The revoked lead was still open after reconnecting")

    def test_signed_out_device(self):
        browser = self.browser
        with self.allow_requests(browser=browser), flushing_cursor(self.cr):
            with serve_odoo() as port:
                url = f'http://{HOST}:{port}/odoo/crm'
                browser.navigate_to(url, wait_stop=True)
                self.evaluate('navigator.serviceWorker.ready.then(() => true)')
                browser.navigate_to(url, wait_stop=True)
                self.assertTrue(self.evaluate('!!navigator.serviceWorker.controller'))
                # A stale tab's protected preload must never log out the current
                # account. The next live read still belongs to the signed-in rep.
                self.assertEqual(self.evaluate("""
                    fetch('/web/webclient/load_menus', { headers: { 'X-Odoo-Account': 'stale' } })
                        .then(r => r.status)
                """), 403)
                self.assertTrue(self.evaluate("""
                    fetch('/web/webclient/load_menus').then(async r => r.ok && !!(await r.json()).root)
                """))
                # Direct logout also occurs when an identity verification dialog is
                # dismissed. It must invalidate the shell without a menu callback.
                self.assertEqual(self.evaluate("""
                    fetch('/web/session/logout', {
                        method: 'POST',
                        body: new URLSearchParams({csrf_token: odoo.csrf_token}),
                    }).then(r => new URL(r.url).pathname)
                """), '/web/login')
            with browser.offline():
                browser.navigate_to(url, wait_stop=True)
                self.assertIn('You are offline', self.evaluate('document.body.innerText'))
                self.assertFalse(self.evaluate('!!window.odoo?.__session_info__'))

    def test_offline_form_edit(self):
        lead = self.env['crm.lead'].create({'name': 'Morning visit', 'type': 'opportunity'})
        browser = self.browser
        with self.allow_requests(browser=browser), flushing_cursor(self.cr):
            with serve_odoo() as port:
                url = f'http://{HOST}:{port}/odoo/crm/{lead.id}'
                browser.navigate_to(url, wait_stop=True)
                self.assertTrue(browser._wait_ready("!!document.querySelector('[name=name] textarea, [name=name] input')"))
                self.evaluate('navigator.serviceWorker.ready.then(() => true)')
            with browser.offline():
                self.evaluate("""
                    (() => {
                        const field = document.querySelector('[name=name] textarea, [name=name] input');
                        field.focus();
                        field.value = 'Evening visit';
                        field.dispatchEvent(new InputEvent('input', {bubbles: true}));
                        field.dispatchEvent(new Event('change', {bubbles: true}));
                        field.blur();
                    })()
                """)
                self.assertTrue(browser._wait_ready("!!document.querySelector('.o_form_button_save:not([disabled])')"))
                self.evaluate("document.querySelector('.o_form_button_save').click()")
                self.assertTrue(browser._wait_ready("""
                    [...document.querySelectorAll('.o_offline_systray')].some(el =>
                        el.innerText.includes('Working offline') && el.querySelector('[data-icon=arrow_drop_down]'))
                """))
                self.assertEqual(lead.name, 'Morning visit')
                lead.name = 'Concurrent change'
                self.env.flush_all()
            with serve_odoo(port):
                self.assertTrue(browser._wait_ready("!document.querySelector('.o_offline_systray')", timeout=60))
                self.env.invalidate_all()
                self.assertEqual(lead.name, 'Evening visit')
                self.assertEqual(self.env['crm.offline.receipt'].search_count([
                    ('user_id', '=', self.env.ref('base.user_admin').id),
                ]), 1)

    def test_offline_followup(self):
        lead = self.env['crm.lead'].create({'name': 'Return visit', 'type': 'opportunity'})
        removed = self.env['crm.lead'].create({'name': 'Canceled visit', 'type': 'opportunity'})
        browser = self.browser

        def button(label):
            return f"[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '{label}')"

        def queue(kind, text):
            self.assertTrue(browser._wait_ready(f'!!({button(kind)})'))
            self.evaluate(f'{button(kind)}.click()')
            self.assertTrue(browser._wait_ready("!!document.querySelector('.o-mail-Chatter textarea.form-control')"))
            self.evaluate(f"""
                (() => {{
                    const input = document.querySelector('.o-mail-Chatter textarea.form-control');
                    input.value = '{text}';
                    input.dispatchEvent(new Event('input', {{bubbles: true}}));
                }})()
            """)
            save = button('Save on this device')
            self.assertTrue(browser._wait_ready(f'!!({save} && !{save}.disabled)'))
            self.evaluate(f'{save}.click()')
            self.assertTrue(browser._wait_ready(f'!!({button(kind)})'))

        with self.allow_requests(browser=browser), flushing_cursor(self.cr):
            with serve_odoo() as port:
                url = f'http://{HOST}:{port}/odoo/crm/{lead.id}'
                browser.navigate_to(url, wait_stop=True)
                self.assertTrue(browser._wait_ready("!!document.querySelector('.o-mail-Chatter-logNote:not(:disabled)')"))
                self.evaluate('navigator.serviceWorker.ready.then(() => true)')
                deleted_url = f'http://{HOST}:{port}/odoo/crm/{removed.id}'
                browser.navigate_to(deleted_url, wait_stop=True)
                self.assertTrue(browser._wait_ready("!!document.querySelector('.o-mail-Chatter-logNote:not(:disabled)')"))
            with browser.offline():
                queue('Log an offline note', 'Note for canceled visit')
                removed.unlink()
                self.env.flush_all()
                browser.navigate_to(url, wait_stop=True)

                queue('Log an offline note', 'Bring safety boots')
                queue('Schedule my to-do', 'Confirm the delivery window')
                self.assertTrue(browser._wait_ready("document.body.innerText.includes('Your activity is waiting to be sent')"))
            with serve_odoo(port):
                self.assertTrue(browser._wait_ready("document.body.innerText.includes('Sync issues')", timeout=60))
                self.evaluate("document.querySelector('.o_offline_systray').click()")
                self.assertTrue(browser._wait_ready("document.body.innerText.includes('Note for canceled visit') && document.body.innerText.includes('deleted')"))
                self.env.invalidate_all()
                self.assertEqual(lead.message_ids.filtered(lambda m: 'Bring safety boots' in (m.body or '')).author_id,
                                 self.env.ref('base.user_admin').partner_id)
                activity = lead.activity_ids.filtered(lambda a: a.summary == 'Confirm the delivery window')
                self.assertEqual(activity.user_id, self.env.ref('base.user_admin'))

    def test_lost_create_acknowledgement(self):
        browser = self.browser
        name = 'Warehouse visit with a lost reply'
        held = threading.Event()
        response_ids = []
        handle_request = browser._handlers['Fetch.requestPaused']

        def hold_reply(**event):
            if (not response_ids and event.get('responseStatusCode') == 200
                    and '/crm.lead/web_save' in event['request']['url']):
                response_ids.append(event['requestId'])
                held.set()
            else:
                handle_request(**event)

        with self.allow_requests(browser=browser), flushing_cursor(self.cr):
            with serve_odoo() as port:
                browser.navigate_to(f'http://{HOST}:{port}/odoo/crm/new', wait_stop=True)
                self.assertTrue(browser._wait_ready("!!document.querySelector('[name=name] textarea')"))
                browser._handlers['Fetch.requestPaused'] = hold_reply
                browser._websocket_request('Fetch.enable', params={'patterns': [
                    {'urlPattern': '*', 'requestStage': 'Request'},
                    {'urlPattern': '*/crm.lead/web_save*', 'requestStage': 'Response'},
                ]})
                self.evaluate(f"""
                    (() => {{
                        const input = document.querySelector('[name=name] textarea');
                        input.value = '{name}';
                        input.dispatchEvent(new InputEvent('input', {{ bubbles: true }}));
                        input.dispatchEvent(new Event('change', {{ bubbles: true }}));
                        input.blur();
                    }})()
                """)
                self.assertTrue(browser._wait_ready("!!document.querySelector('.o_form_button_save:not(:disabled)')"))
                self.evaluate("document.querySelector('.o_form_button_save').click()")
                self.assertTrue(held.wait(25), 'The server must complete the create before the link drops')
                leads = self.env['crm.lead'].search([('name', '=', name)])
                self.assertEqual(len(leads), 1)
            with browser.offline():
                browser._websocket_send('Fetch.failRequest', params={
                    'requestId': response_ids[0], 'errorReason': 'ConnectionReset',
                })
                self.assertTrue(browser._wait_ready("!!document.querySelector('.o_offline_systray [data-icon=arrow_drop_down]')"))
            with serve_odoo(port):
                self.assertTrue(browser._wait_ready("!document.querySelector('.o_offline_systray')"))
                self.assertEqual(self.env['crm.lead'].search([('name', '=', name)]), leads)
                self.assertEqual(self.env['crm.offline.receipt'].search_count([('created_lead_id', '=', leads.id)]), 1)

    def test_create_offline(self):
        browser = self.browser
        name = 'New warehouse opportunity'
        with self.allow_requests(browser=browser), flushing_cursor(self.cr):
            with serve_odoo() as port:
                url = f'http://{HOST}:{port}/odoo/crm/new'
                browser.navigate_to(url, wait_stop=True)
                self.assertTrue(browser._wait_ready("!!document.querySelector('[name=name] textarea')"))
                self.evaluate('navigator.serviceWorker.ready.then(() => true)')
            with browser.offline():
                self.evaluate(f"""
                    (() => {{
                        const field = document.querySelector('[name=name] textarea');
                        field.value = '{name}';
                        field.dispatchEvent(new InputEvent('input', {{bubbles: true}}));
                        field.dispatchEvent(new Event('change', {{bubbles: true}}));
                        field.blur();
                    }})()
                """)
                self.assertTrue(browser._wait_ready("!!document.querySelector('.o_form_button_save:not(:disabled)')"))
                self.evaluate("document.querySelector('.o_form_button_save').click()")
                self.assertTrue(browser._wait_ready("!!document.querySelector('.o_offline_systray [data-icon=arrow_drop_down]')"))
            with serve_odoo(port):
                self.assertTrue(browser._wait_ready("!document.querySelector('.o_offline_systray')"))
                self.env.invalidate_all()
                leads = self.env['crm.lead'].search([('name', '=', name)])
                self.assertEqual(len(leads), 1)
                self.assertEqual(leads.create_uid, self.env.ref('base.user_admin'))


@tagged('post_install', '-at_install')
class TestCrmOfflinePhone(CrmOfflineBrowserCase):
    browser_size = '390x844'
    touch_enabled = True

    def test_cold_launch(self):
        browser = self.browser
        browser._websocket_request('Emulation.setDeviceMetricsOverride', params={
            'mobile': True, 'width': 390, 'height': 844, 'deviceScaleFactor': 2,
        })
        with self.allow_requests(browser=browser), flushing_cursor(self.cr):
            with serve_odoo() as port:
                url = f'http://{HOST}:{port}/odoo/crm'
                browser.navigate_to(url, wait_stop=True)
                self.assertTrue(browser._wait_ready("!!document.querySelector('.o_kanban_record')"))
                self.evaluate('navigator.serviceWorker.ready.then(() => true)')
                browser.navigate_to(url, wait_stop=True)
                self.assertTrue(browser._wait_ready("!!document.querySelector('.o_kanban_record') && !!navigator.serviceWorker.controller"))
                browser._websocket_request('Emulation.setTouchEmulationEnabled', params={'enabled': True, 'maxTouchPoints': 5})
                self.assertTrue(self.evaluate("navigator.maxTouchPoints > 0"))
                title = self.evaluate("document.querySelector('.o_kanban_record').innerText.trim().split('\\n')[0]")
                self.assertTrue(title)
                self.evaluate("document.querySelector('.o_kanban_record').click()")
                self.assertTrue(browser._wait_ready("!!document.querySelector('.o-mail-Chatter-logNote:not(:disabled)')"))
                lead_url = self.evaluate("location.href")
                self.assertRegex(lead_url, r'/odoo/crm/\d+$')
                browser.navigate_to(url, wait_stop=True)
                self.assertTrue(browser._wait_ready("!!document.querySelector('.o_kanban_record')"))
                self.evaluate("document.querySelector('.o_mobile_menu_toggle').click()")
                item = "[...document.querySelectorAll('button,a,span')].find(e => e.textContent.trim() === 'CRM offline access')"
                self.assertTrue(browser._wait_ready(f'!!({item})'))
                self.evaluate(f'{item}.click()')
                self.assertTrue(browser._wait_ready("!!document.querySelector('input[name=confirmation]')"))
                manifest = self.evaluate("""
                    (async () => {
                        const href = document.querySelector('a[href*="scoped_app?app_id=crm"]').href;
                        const page = new DOMParser().parseFromString(await (await fetch(href)).text(), 'text/html');
                        const src = page.querySelector('link[rel=manifest]').getAttribute('href');
                        return (await fetch(src)).json();
                    })()
                """)
                self.assertEqual(manifest['start_url'], '/odoo/crm')
                self.assertEqual(manifest['display'], 'standalone')
                self.evaluate("""
                    const form = document.querySelector('input[name=confirmation]').form;
                    form.passphrase.value = form.confirmation.value = 'A test device passphrase';
                    form.requestSubmit();
                """)
                self.assertTrue(browser._wait_ready("document.body.innerText.includes('Offline access is ready')"))
                browser.set_cookie('color_scheme', 'dark', '/', HOST)
                browser._websocket_request('ServiceWorker.enable')
            # A TCP listener which accepts the connection but sends no response
            # reproduces a stalled link while Chromium still considers it online.
            with socket.create_server((HOST, port)):
                browser._websocket_request('ServiceWorker.stopAllWorkers')
                browser.navigate_to(lead_url, wait_stop=True)
                self.assertTrue(browser._wait_ready("!!document.querySelector('#offline_unlock:not([hidden])')", timeout=15))
                self.assertNotIn(title, self.evaluate('document.body.innerText'))
            with browser.offline():
                browser._websocket_request('ServiceWorker.stopAllWorkers')
                browser.navigate_to(url, wait_stop=True)
                self.assertTrue(browser._wait_ready("!!document.querySelector('#offline_unlock:not([hidden])')"))
                self.assertNotIn(title, self.evaluate('document.body.innerText'))
                self.assertLessEqual(self.evaluate('window.innerWidth'), 391)
                self.assertFalse(self.evaluate("!!document.getElementById('web.layout.odooscript')"))
                self.assertEqual(self.evaluate("getComputedStyle(document.body).backgroundColor"), 'rgb(37, 38, 43)')
                self.evaluate("document.documentElement.dir = 'rtl'")
                self.assertTrue(self.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
                self.assertGreaterEqual(self.evaluate("document.querySelector('#offline_unlock button').offsetHeight"), 44)
                ax_nodes = browser._websocket_request('Accessibility.getFullAXTree')['nodes']
                self.assertIn(('textbox', 'Offline passphrase'), {
                    (node['role']['value'], node.get('name', {}).get('value')) for node in ax_nodes
                })
                self.assertTrue(self.evaluate("!!document.querySelector('label input[name=passphrase]')"))
                self.evaluate("""
                    let form = document.querySelector('#offline_unlock');
                    form.passphrase.value = 'Incorrect offline passphrase';
                    form.requestSubmit();
                """)
                self.assertTrue(browser._wait_ready("!document.getElementById('offline_unlock_error').hidden"))
                self.assertFalse(self.evaluate("!!document.querySelector('.o_kanban_record')"))
                self.evaluate("""
                    document.querySelector('#offline_unlock').passphrase.value = 'A test device passphrase';
                    document.querySelector('#offline_unlock').requestSubmit();
                """)
                self.assertTrue(browser._wait_ready("!!document.querySelector('.o_kanban_record')"))
                self.assertIn(title, self.evaluate('document.body.innerText'))
                self.assertTrue(self.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))

                browser._websocket_request('ServiceWorker.stopAllWorkers')
                browser.navigate_to(lead_url, wait_stop=True)
                self.assertTrue(browser._wait_ready("!!document.querySelector('#offline_unlock:not([hidden])')"))
                self.evaluate("""
                    document.querySelector('#offline_unlock').passphrase.value = 'A test device passphrase';
                    document.querySelector('#offline_unlock').requestSubmit();
                """)
                self.assertTrue(browser._wait_ready("!!document.querySelector('.o_form_view [name=name]')"))
                self.assertEqual(self.evaluate("location.href"), lead_url)


@tagged('post_install', '-at_install')
class TestOfflineSession(HttpCase):
    def test_enrollment_survives_soft_rotation_and_ends_after_access_change(self):
        self.authenticate('demo', 'demo')
        user = self.env.ref('base.user_demo')
        group = self.env['res.groups'].create({'name': 'Temporary CRM access'})

        def stamp():
            response = self.url_open('/odoo/crm')
            self.assertEqual(response.status_code, 200)
            self.assertIn('odoo_offline_session', response.cookies)
            return response.cookies['odoo_offline_session']

        original = stamp()
        session = session_store().get(self.session.sid)
        session_store().rotate(session, self.env(user=user), soft=True)
        self.opener.cookies.set('session_id', session.sid, domain=HOST)
        self.assertEqual(stamp(), original)
        user.group_ids = [Command.link(group.id)]
        self.assertNotEqual(stamp(), original)
