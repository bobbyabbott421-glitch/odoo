"""Exercise both physical server loss and Chromium offline mode with Odoo's browser driver."""
import logging
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest

notes = Path(__file__).resolve().parent
sys.path.insert(0, '/workspace/odoo')
os.environ.update(XDG_CONFIG_HOME=str(notes / 'browser-config'), XDG_CACHE_HOME=str(notes / 'browser-cache'), NO_PROXY='localhost,127.0.0.1', no_proxy='localhost,127.0.0.1')
import requests
import odoo
from odoo.tests.common import ChromeBrowser, HttpCase
from odoo.tools import config

database = os.environ.get('TEST_DATABASE', 'odoo_dev')
config.parse_config(['-c', '/workspace/odoo-env/odoo.conf', '-d', database], setup_logging=True)
base = 'http://127.0.0.1:8074'

class ConnectionCut(unittest.TestCase):
    def start_server(self):
        server = subprocess.Popen([sys.executable, '/workspace/odoo/odoo-bin', '-c', '/workspace/odoo-env/odoo.conf', '-d', database, '--db-filter=^' + database + '$', '--http-interface=127.0.0.1', '--http-port=8074', '--max-cron-threads=0'], stdout=self.log, stderr=subprocess.STDOUT)
        self.addCleanup(self.stop_server, server)
        for _ in range(300):
            if server.poll() is not None:
                self.fail('Odoo server exited before becoming ready')
            try:
                if requests.get(base + '/web/health', timeout=1).ok:
                    return server
            except (requests.ConnectionError, requests.Timeout):
                pass
            time.sleep(0.2)
        self.fail('Odoo did not answer its health check')

    def stop_server(self, server):
        if server.poll() is None:
            server.terminate()
            server.wait(timeout=30)

    def test_disconnect_and_reconnect(self):
        self.log = self.enterContext((notes / 'cut-server.log').open('a'))
        server = self.start_server()
        case = HttpCase()
        case._logger = logging.getLogger('cut')
        browser = ChromeBrowser(case)
        self.addCleanup(browser.stop)
        browser._websocket_request('Network.enable')
        browser.navigate_to(base + '/web/health', wait_stop=True)
        def reachable():
            reply = browser._websocket_request('Runtime.evaluate', params={
                'expression': "fetch('/web/health?t=' + Date.now(), {cache: 'no-store'}).then(r=>r.ok).catch(()=>false)",
                'awaitPromise': True, 'returnByValue': True,
            })
            return reply['result']['value']
        def offline(enabled):
            browser._websocket_request('Network.emulateNetworkConditions', params={'offline': enabled, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1})
        self.assertIs(reachable(), True)
        offline(True)
        self.assertIs(reachable(), False)
        self.assertEqual(requests.get(base + '/web/health', timeout=2).status_code, 200)
        offline(False)
        self.assertIs(reachable(), True)
        self.stop_server(server)
        self.assertIs(reachable(), False)
        self.start_server()
        self.assertIs(reachable(), True)

if __name__ == '__main__':
    unittest.main(verbosity=2)
