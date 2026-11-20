import json
import logging
import time
import threading
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
        name = 'Opportunity with lost acknowledgement ' + str(time.time_ns())
        def count():
            return session.post(base + '/web/dataset/call_kw/crm.lead/search_count', json={
                'jsonrpc': '2.0', 'id': 1, 'method': 'call', 'params': {
                    'model':'crm.lead','method':'search_count','args':[[['name','=',name]]],'kwargs':{}}}, timeout=15).json()['result']
        browser.navigate_to(base + '/odoo/crm/new')
        wait_until("!!document.querySelector('[name=name] textarea')")
        js('navigator.serviceWorker.ready.then(() => true)')
        ready = threading.Event()
        held = []
        default = browser._handlers['Fetch.requestPaused']
        def intercept(**event):
            if not held and event.get('responseStatusCode') == 200 and '/crm.lead/web_save' in event['request']['url']:
                held.append(event['requestId'])
                ready.set()
            else:
                default(**event)
        browser._handlers['Fetch.requestPaused'] = intercept
        browser._websocket_request('Fetch.enable', params={'patterns': [
            {'urlPattern':'*','requestStage':'Request'},
            {'urlPattern':'*/crm.lead/web_save*','requestStage':'Response'}]})
        js("(()=>{const e=document.querySelector('[name=name] textarea');e.value="+json.dumps(name)+";e.dispatchEvent(new InputEvent('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.blur()})()")
        wait_until("!!document.querySelector('.o_form_button_save:not(:disabled)')")
        js("document.querySelector('.o_form_button_save').click()")
        self.assertTrue(ready.wait(20), 'The live create reply was not intercepted')
        self.assertEqual(count(), 1, 'The create must already be committed')
        self.stop_server(server)
        with browser.offline():
            browser._websocket_send('Fetch.failRequest',params={'requestId':held[0],'errorReason':'ConnectionReset'})
            wait_until("!!document.querySelector('.o_offline_systray [data-icon=arrow_drop_down]')")
            self.assertFalse(js("fetch('/web/health',{cache:'no-store'}).then(r=>r.ok,()=>false)"))
            self.start_server()
        wait_until("!document.querySelector('.o_offline_systray')",120)
        self.assertEqual(count(),1)
        print("COMMITTED_BEFORE_LOST_REPLY_AND_EXACTLY_ONE_AFTER_REPLAY",flush=True)
if __name__ == '__main__':
    unittest.main(defaultTest='OfflineLead',verbosity=2)
