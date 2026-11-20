"""Time from direct navigation to a rendered lead or pipeline and count same-origin HTTP requests."""
import json
import logging
import os
import re
from pathlib import Path
import statistics
import sys
import time
import unittest
from urllib.parse import urlparse
from connection_cut import ChromeBrowser, HttpCase, ConnectionCut, base, database, notes, requests

class Measure(unittest.TestCase):
    start_server = ConnectionCut.start_server
    stop_server = ConnectionCut.stop_server

    def test_render(self):
        server_log = notes / os.environ.get('BENCHMARK_LOG', 'benchmark-server.log')
        self.log = self.enterContext(server_log.open('a'))
        self.start_server()
        session = requests.Session()
        auth = session.post(base + '/web/session/authenticate', json={'jsonrpc':'2.0', 'method':'call', 'params':{'db':database, 'login':'admin', 'password':'admin'}, 'id':1}, timeout=30)
        self.assertTrue(auth.json().get('result', {}).get('uid'), 'Demo user login failed')
        case = HttpCase()
        case._logger = logging.getLogger('measure')
        browser = ChromeBrowser(case)
        self.addCleanup(browser.stop)
        browser.set_cookie('session_id', session.cookies['session_id'], '/', '127.0.0.1')
        reqs = []
        def handle_request(**event):
            reqs.append((event['request']['method'], event['request']['url']))
        browser._handlers['Network.requestWillBeSent'] = handle_request
        browser._websocket_request('Network.enable')
        def evaluate(expression):
            r = browser._websocket_request('Runtime.evaluate', params={'expression':expression, 'returnByValue':True})
            return r['result'].get('value')
        def render(path, selector):
            log_offset = server_log.stat().st_size
            reqs.clear()
            start = time.monotonic()
            browser.navigate_to(base + path)
            expression = '!!document.querySelector(' + json.dumps(selector) + ') && location.pathname === ' + json.dumps(path)
            while not evaluate(expression):
                if time.monotonic() - start > 150:
                    self.fail(f'{path} failed to render {selector}: ' + str(evaluate('document.body.innerText.slice(0,400)')))
                time.sleep(0.025)
            elapsed = (time.monotonic() - start) * 1000
            last_size = len(reqs)
            stable_since = time.monotonic()
            wait_start = stable_since
            while time.monotonic() - stable_since < 1.5:
                time.sleep(0.1)
                if len(reqs) != last_size:
                    last_size = len(reqs)
                    stable_since = time.monotonic()
                if time.monotonic() - wait_start > 30:
                    self.fail('Page requests did not settle')
            with server_log.open('rb') as log:
                log.seek(log_offset)
                served = re.findall(r'odoo.http.server: .*?"(GET|POST|HEAD) (\S+) HTTP/', log.read().decode())
            calls = [(verb, urlparse(url).path) for verb,url in reqs if url.startswith(base + '/')]
            timings = evaluate('''(() => {
                const navigation = performance.getEntriesByType('navigation')[0];
                return {
                    responseStart: navigation.responseStart, responseEnd: navigation.responseEnd,
                    domInteractive: navigation.domInteractive,
                    loadEventEnd: navigation.loadEventEnd,
                    requests: performance.getEntriesByType('resource')
                        .filter(r => r.name.includes('/web/dataset/') || r.name.includes('/web/action/') || r.name.includes('assets_web.min.js'))
                        .map(r => [new URL(r.name).pathname, Math.round(r.startTime), Math.round(r.responseEnd)])
                };
            })()''')
            return {'navigation': timings, 'duration_ms': round(elapsed), 'same_origin_requests': len(calls), 'server_requests': len(served), 'server_posts': sum(verb == 'POST' for verb,_ in served), 'served': served, 'requests': calls}
        pipeline = '/odoo/crm'
        card = '.o_kanban_record:not(.o_kanban_ghost)'
        render(pipeline, card)
        evaluate('document.querySelector(' + json.dumps(card) + ').click()')
        for _ in range(400):
            if evaluate('!!document.querySelector(".o_form_view .o_field_widget[name=name]")'):
                break
            time.sleep(0.1)
        form = evaluate('location.pathname')
        self.assertNotEqual(pipeline, form)
        samples = {'pipeline': [], 'lead': []}
        for index in range(int(os.environ.get("MEASURE_SAMPLES", "5"))):
            for kind,path,selector in [('pipeline',pipeline,card),('lead',form,'.o_form_view .o_field_widget[name=name]')]:
                if sync_name := os.environ.get('MEASURE_SYNC_NAME'):
                    prefix = Path(os.environ['MEASURE_SYNC_DIR']) / f'{index}-{kind}-{sync_name}'
                    prefix.with_suffix('.ready').touch()
                    deadline = time.monotonic() + 120
                    while not prefix.with_suffix('.go').exists() and time.monotonic()<deadline:
                        time.sleep(.03)
                    self.assertTrue(prefix.with_suffix('.go').exists(), 'timing coordinator did not release sample')
                sample = render(path, selector)
                if sync_name:
                    prefix.with_suffix('.done').touch()
                samples[kind].append(sample)
                print(kind, sample['duration_ms'], sample['same_origin_requests'], sample['server_requests'],flush=True)
        output = notes / ('measure-' + os.environ['MEASUREMENT'] + '.json')
        output.write_text(json.dumps(samples,indent=2)+'\n')

if __name__ == '__main__':
    unittest.main(defaultTest='Measure', verbosity=2)
