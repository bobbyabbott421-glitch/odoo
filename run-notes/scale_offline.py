import json
import logging
import time
import unittest
from connection_cut import ChromeBrowser, HttpCase, ConnectionCut, base, database, notes, requests

class OfflinePipeline(unittest.TestCase):
    start_server = ConnectionCut.start_server
    stop_server = ConnectionCut.stop_server

    def test_large_team(self):
        self.log = self.enterContext((notes / 'scale-http.log').open('a'))
        server = self.start_server()
        session = requests.Session()
        auth = session.post(base + '/web/session/authenticate', json={'jsonrpc':'2.0','method':'call','params':{'db':database,'login':'admin','password':'admin'},'id':1},timeout=60)
        self.assertTrue(auth.json()['result']['uid'])
        case = HttpCase()
        case._logger = logging.getLogger('scale')
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
        browser.navigate_to(base + '/web/health',wait_stop=True)
        js("localStorage.setItem('crm.switcher_team_id','1')")
        browser.navigate_to(base + '/odoo/crm')
        sentinel = "[...document.querySelectorAll('.o_kanban_record')].some(c=>c.innerText.includes('Offline volume opportunity'))"
        wait_until(sentinel,150)
        js('navigator.serviceWorker.ready.then(() => true)')
        if not js('!!navigator.serviceWorker.controller'):
            browser.navigate_to(base + '/odoo/crm')
            wait_until('!!navigator.serviceWorker.controller && (' + sentinel + ')')
        self.stop_server(server)
        browser._websocket_request('Fetch.disable')
        browser._websocket_request('Network.emulateNetworkConditions',params={'offline':True,'latency':0,'downloadThroughput':-1,'uploadThroughput':-1})
        self.assertFalse(js("fetch('/web/health',{cache:'no-store'}).then(r=>r.ok).catch(()=>false)"))
        js('window.__oldScaleDocument = true')
        start=time.monotonic()
        browser.navigate_to(base + '/odoo/crm')
        wait_until('!window.__oldScaleDocument && ('+sentinel+')')
        print('OFFLINE_10000_RENDER_MS',round((time.monotonic()-start)*1000),flush=True)
        print('VISIBLE_CARD_COUNT',js("document.querySelectorAll('.o_kanban_record:not(.o_kanban_ghost)').length"),flush=True)

if __name__ == '__main__':
    unittest.main(defaultTest='OfflinePipeline',verbosity=2)
