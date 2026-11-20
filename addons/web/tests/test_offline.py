# Part of Odoo. See LICENSE file for full copyright and licensing details.

import socketserver
import threading
from contextlib import contextmanager

from odoo.http.server import HTTPSocket
from odoo.tests import HttpCase, tagged
from odoo.tests.common import HOST, ChromeBrowser, flushing_cursor


class _OdooRequestHandler(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.settimeout(5)
        HTTPSocket(self.request, self.client_address).process_request()


@contextmanager
def serve_odoo(port=0):
    """Serve the test transaction on a dedicated Odoo HTTP listener that tests can stop."""
    class Server(socketserver.ThreadingTCPServer):
        allow_reuse_address = True

    with Server((HOST, port), _OdooRequestHandler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield server.server_address[1]
        finally:
            server.shutdown()
            thread.join()


@tagged('post_install', '-at_install')
class TestOfflineConnection(HttpCase):
    def test_disconnect_and_reconnect(self):
        browser = ChromeBrowser(self)
        self.addCleanup(browser.stop)

        def health_check():
            response = browser._websocket_request('Runtime.evaluate', params={
                'expression': """fetch('/web/health', { cache: 'no-store' })
                    .then(async response => response.ok ? (await response.json()).status : response.status,
                          () => 'unreachable')""",
                'awaitPromise': True,
                'returnByValue': True,
            })
            return response['result']['value']

        with self.allow_requests(browser=browser), flushing_cursor(self.cr):
            with serve_odoo() as port:
                browser.navigate_to(f'http://{HOST}:{port}/web/health', wait_stop=True)
                self.assertEqual(health_check(), 'pass')
                with browser.offline():
                    self.assertEqual(health_check(), 'unreachable')
                self.assertEqual(health_check(), 'pass')
            self.assertEqual(health_check(), 'unreachable')
            with serve_odoo(port):
                self.assertEqual(health_check(), 'pass')
