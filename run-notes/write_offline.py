import json
import logging
import time
import unittest
from connection_cut import ChromeBrowser, HttpCase, ConnectionCut, base, database, notes, requests

class OfflineLead(unittest.TestCase):
    start_server = ConnectionCut.start_server
    stop_server = ConnectionCut.stop_server

    def test_visited_lead(self):
        self.log = self.enterContext((notes / 'lead-http.log').open('a'))
        server = self.start_server()
        session = requests.Session()
        auth = session.post(base + '/web/session/authenticate', json={'jsonrpc':'2.0','method':'call','params':{'db':database,'login':'admin','password':'admin'},'id':1},timeout=60)
        self.assertTrue(auth.json()['result']['uid'])
        case = HttpCase()
        case._logger = logging.getLogger('lead')
        browser = ChromeBrowser(case)
        self.addCleanup(browser.stop)
        browser.set_cookie('session_id', session.cookies['session_id'], '/', '127.0.0.1')
        browser._websocket_request('Network.enable')
        def js(expression):
            r=browser._websocket_request('Runtime.evaluate',params={'expression':expression,'returnByValue':True, 'awaitPromise':True},timeout=60)
            self.assertNotIn('exceptionDetails', r, str(r)[:600])
            return r['result'].get('value')
        def wait_until(expression, seconds=90):
            deadline=time.monotonic()+seconds
            while time.monotonic()<deadline:
                if js(expression):
                    return
                time.sleep(0.05)
            self.fail('Timed out waiting for '+expression+'; screen: '+str(js('document.body?.innerText.slice(0,400)')))
        path = '/odoo/crm/' + (notes / 'flow-lead-id').read_text().strip()
        browser.navigate_to(base + path)
        expected = ['Client prefers an afternoon visit.', 'Confirm site visit']
        shown = 'document.body && ' + json.dumps(expected) + '.every(s => document.body.innerText.includes(s))'
        wait_until(shown, 150)
        js('navigator.serviceWorker.ready.then(() => true)')
        if not js('!!navigator.serviceWorker.controller'):
            browser.navigate_to(base + path)
            wait_until('!!navigator.serviceWorker.controller && (' + shown + ')')
        self.stop_server(server)
        with browser.offline():
            self.assertFalse(js("fetch('/web/health',{cache:'no-store'}).then(r=>r.ok,()=>false)"))
            button = lambda label: "[...document.querySelectorAll('button')].find(b => b.innerText.trim() === " + json.dumps(label) + ")"
            note = 'Visit confirmed while Odoo was stopped ' + str(time.time_ns())
            wait_until("!!("+button('Log an offline note')+")")
            js(button('Log an offline note') + ".click()")
            wait_until("!!document.querySelector('.o-mail-Chatter textarea.form-control')")
            js("(()=>{const e=document.querySelector('.o-mail-Chatter textarea.form-control');e.value="+json.dumps(note)+";e.dispatchEvent(new Event('input',{bubbles:true}))})()")
            save = button('Save on this device')
            wait_until("!!("+save+" && !"+save+".disabled)")
            js(save+".click()")
            wait_until("document.body.innerText.includes('Your note is waiting to be sent')")
        self.start_server()
        def count():
            return session.post(base + '/web/dataset/call_kw/mail.message/search_count',json={
                'jsonrpc':'2.0','method':'call','params':{'model':'mail.message','method':'search_count',
                'args':[[['body','ilike',note],['model','=','crm.lead']]],'kwargs':{}},'id':1},timeout=10).json()['result']
        deadline=time.monotonic()+90
        while count()!=1 and time.monotonic()<deadline:
            time.sleep(0.3)
        self.assertEqual(count(),1)
        wait_until("!document.querySelector('.o_offline_systray')")
        browser.navigate_to(base+path)
        wait_until("document.body.innerText.includes("+json.dumps(note)+")")
        self.assertEqual(count(),1)
        print("OFFLINE_NOTE_APPLIED_ONCE",flush=True)
if __name__ == '__main__':
    unittest.main(defaultTest='OfflineLead',verbosity=2)
