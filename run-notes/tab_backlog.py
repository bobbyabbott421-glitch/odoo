import itertools
import websocket
import psycopg2
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
        other = browser._websocket_request('Target.createTarget',params={'url':base+path})['targetId']
        target = next(t for t in browser._json_command('list') if t['id'] == other)
        ws = websocket.create_connection(target['webSocketDebuggerUrl'],suppress_origin=True,timeout=60)
        self.addCleanup(ws.close)
        ids=itertools.count(1)
        def second(expression):
            seq=next(ids)
            ws.send(json.dumps({'id':seq,'method':'Runtime.evaluate','params':{'expression':expression,'awaitPromise':True,'returnByValue':True}}))
            while True:
                response=json.loads(ws.recv())
                if response.get('id')==seq:break
            self.assertNotIn('exceptionDetails',response['result'],str(response)[:500])
            return response['result']['result'].get('value')
        deadline=time.monotonic()+90
        while not second("!!document.querySelector('.o-mail-Chatter-logNote:not(:disabled)')"):
            if time.monotonic()>deadline:self.fail(str(second('document.body?.innerText.slice(0,400)')))
            time.sleep(.1)
        lead = int(path.rsplit('/',1)[1])
        prefix = 'Backlog ' + str(time.time_ns()) + ' '
        messages = [prefix+str(i) for i in range(16)]
        new_name = prefix+'late save'
        self.stop_server(server)
        conn = psycopg2.connect(host='/workspace/odoo-env/run', user='odoo', dbname=database)
        self.addCleanup(conn.close)
        cursor = conn.cursor()
        self.addCleanup(cursor.close)
        cursor.execute('LOCK TABLE crm_offline_receipt IN ACCESS EXCLUSIVE MODE')
        with browser.offline():
            wait_until("odoo.__WOWL_DEBUG__.root.env.services.offline.offline")
            js("""
                (async () => {
                    const services = odoo.__WOWL_DEBUG__.root.env.services;
                    for (const msg of %s) {
                        const method = 'offline_log_note';
                        const model = 'crm.lead';
                        const args = [[%d], msg];
                        const operation = services.orm.offlineWriteToken(model, method);
                        const kwargs = {offline_operation: operation};
                        await services.offline.scheduleORM(model, method, args, kwargs, {
                            request: {id:operation.key,model,method,args,kwargs},
                            extras: {displayName:msg,timeStamp:Date.now()}
                        });
                    }
                    return true;
                })()
            """ % (json.dumps(messages), lead))
            self.start_server()
        deadline = time.monotonic()+60
        while time.monotonic()<deadline:
            cursor.execute("SELECT pg_stat_clear_snapshot()")
            cursor.execute("SELECT COUNT(*) FROM pg_stat_activity WHERE datname = %s AND pid <> pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%%INSERT INTO crm_offline_receipt%%'",(database,))
            if cursor.fetchone()[0]: break
            time.sleep(.1)
        else:
            self.fail('No pending operation was being sent')
        started = time.monotonic()
        pending = second("""
            (async () => {
                const services=odoo.__WOWL_DEBUG__.root.env.services;
                try {
                    await services.orm.call('crm.lead','web_save',[[%d],{name:%s}],{specification:{}});
                } catch(e) {
                    return !!e.offlineWrite?.id && !!services.offline.scheduledORM[e.offlineWrite.id];
                }
                return false;
            })()
        """ % (lead,json.dumps(new_name)))
        self.assertTrue(pending)
        elapsed=time.monotonic()-started
        self.assertLess(elapsed,9, 'Foreground save waited for a network timeout')
        conn.commit()
        deadline=time.monotonic()+120
        while time.monotonic()<deadline:
            cursor.execute('SELECT name FROM crm_lead WHERE id=%s',(lead,))
            if cursor.fetchone()[0]==new_name:break
            time.sleep(.2)
        else:self.fail('Later save did not reach Odoo')
        cursor.execute("SELECT body FROM mail_message WHERE model='crm.lead' AND res_id=%s AND body LIKE %s ORDER BY id",(lead,'%'+prefix+'%'))
        actual=[row[0] for row in cursor]
        self.assertEqual(len(actual),len(messages))
        self.assertTrue(all(msg in body for msg,body in zip(messages,actual)))
        print('TWO_TABS_ORDERED_ONCE',len(actual),'foreground_seconds',round(elapsed,3),flush=True)
if __name__=='__main__':
    unittest.main(defaultTest='OfflineLead',verbosity=2)
