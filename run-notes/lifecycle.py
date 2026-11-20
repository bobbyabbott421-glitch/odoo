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

        def call(method, args):
            response = session.post(base+'/web/dataset/call_kw/crm.lead/'+method, json={
                'jsonrpc': '2.0', 'id': 1, 'method': 'call', 'params': {
                    'model': 'crm.lead', 'method': method, 'args': args, 'kwargs': {'context': {'active_test': False}}}}, timeout=15).json()
            self.assertNotIn('error', response, response)
            return response['result']
        ids = call('create', [[{'name': 'Stopped-server '+action+' '+str(time.time_ns()),'type':'opportunity',
                                'active': action != 'Unarchive'} for action in ('Archive','Unarchive','Delete')]])
        def button(label, selector):
            return "[...document.querySelectorAll("+json.dumps(selector)+")].find(b=>b.innerText.trim()==="+json.dumps(label)+" && b.getClientRects().length)"
        for action,res_id in zip(('Archive','Unarchive','Delete'),ids):
            path = '/odoo/crm/'+str(res_id)
            browser.navigate_to(base+path)
            wait_until("!!document.querySelector('.o_form_view .o_field_widget[name=name]') && location.pathname === "+json.dumps(path))
            js("navigator.serviceWorker.ready.then(()=>true)")
            self.stop_server(server)
            with browser.offline():
                wait_until("document.body.innerText.includes('Working offline')")
                self.assertFalse(js("fetch('/web/health',{cache:'no-store'}).then(r=>r.ok,()=>false)"))
                js("document.querySelector('.o_cp_action_menus button:has([data-icon=more_vert])').click()")
                option = button(action,'.dropdown-item')
                wait_until('!!('+option+')',15)
                js(option+'.click()')
                if action != 'Unarchive':
                    confirm = button(action,'.modal button')
                    wait_until('!!('+confirm+')',15)
                    js(confirm+'.click()')
                wait_until("!!document.querySelector('.o_offline_systray [data-icon=arrow_drop_down]')",30)
                server = self.start_server()
            wait_until("!document.querySelector('.o_offline_systray')",90)
            result=call('search_read',[[['id','=',res_id]],['id','active']])
            self.assertEqual(result, [] if action=='Delete' else [{'id':res_id,'active':action=='Unarchive'}])
            print(action, 'replayed and verified on the server',flush=True)
if __name__ == '__main__':
    unittest.main(defaultTest='OfflineLead',verbosity=2)
