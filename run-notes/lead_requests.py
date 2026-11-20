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
        def requests_seen(**event):
            request = event['request']
            if request['url'].endswith('/mail/store'):
                params=json.loads(request['postData'])['params']['fetch_params']
                print('STORE', params, flush=True)
        browser._handlers['Network.requestWillBeSent']=requests_seen
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

if __name__ == '__main__':
    unittest.main(defaultTest='OfflineLead',verbosity=2)
