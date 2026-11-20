# Part of Odoo. See LICENSE file for full copyright and licensing details.

from odoo.addons.web.tests.test_offline import serve_odoo
from odoo.tests import HttpCase, tagged
from odoo.tests.common import HOST, ChromeBrowser, flushing_cursor


@tagged('post_install', '-at_install')
class TestCrmOfflineRead(HttpCase):
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
