"""Run the repository's phone scenario against a separately stoppable Odoo process."""
from contextlib import contextmanager, nullcontext
import logging
import unittest
from unittest.mock import patch

from connection_cut import ChromeBrowser, HttpCase, ConnectionCut, database, notes, requests, base
from odoo.addons.crm.tests import test_crm_offline as scenario


class PhoneProcess(unittest.TestCase):
    start_server = ConnectionCut.start_server
    stop_server = ConnectionCut.stop_server
    evaluate = scenario.CrmOfflineBrowserCase.evaluate
    cr = None

    def allow_requests(self, **kw):
        return nullcontext()

    def test_phone(self):
        self.log = self.enterContext((notes / 'p4-process-http.log').open('a'))
        @contextmanager
        def endpoint():
            server = self.start_server()
            try:
                login = requests.post(base + '/web/session/authenticate',
                    json={'jsonrpc': '2.0', 'method': 'call', 'id': 1, 'params': {
                        'db': database, 'login': 'admin', 'password': 'admin'}}, timeout=60)
                self.assertTrue(login.json()['result']['uid'])
                self.browser.set_cookie('session_id', login.cookies['session_id'], '/', '127.0.0.1')
                yield 8074
            finally:
                self.stop_server(server)
                self.assertIsNotNone(server.poll())

        case = HttpCase()
        case._logger = logging.getLogger('phone')
        case.browser_size = '390x844'
        case.touch_enabled = True
        self.browser = ChromeBrowser(case)
        self.addCleanup(self.browser.stop)
        with patch.object(scenario, 'flushing_cursor', side_effect=lambda cr: nullcontext()), patch.object(scenario, 'serve_odoo', endpoint):
            scenario.TestCrmOfflinePhone.test_cold_launch(self)


if __name__ == '__main__':
    unittest.main(defaultTest='PhoneProcess', verbosity=2)
