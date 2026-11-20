# Part of Odoo. See LICENSE file for full copyright and licensing details.
from uuid import uuid4

from odoo.exceptions import AccessDenied, UserError
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestOfflineReceipt(TransactionCase):

    def apply(self, operation, ids, name):
        def web_save(args, kwargs):
            return self.env['crm.lead'].browse(args[0]).web_save(args[1], **kwargs)

        return self.env['crm.offline.receipt']._apply(
            operation, 'web_save', [ids, {'name': name}], {'specification': {'name': {}}}, web_save,
        )

    def test_repeated_create_and_edit(self):
        operation = {'key': str(uuid4()), 'uid': self.env.uid, 'db': self.env.cr.dbname}
        result = self.apply(operation, [], 'New site')
        self.assertEqual(self.apply(operation, [], 'New site'), result)
        lead = self.env['crm.lead'].browse(result[0]['id'])
        self.assertEqual(self.env['crm.lead'].search_count([('name', '=', 'New site')]), 1)
        lead.name = 'Office edit'
        edit = dict(operation, key=str(uuid4()), parent=operation['key'])
        self.apply(edit, [], 'Visit confirmed')
        self.assertEqual(lead.name, 'Visit confirmed')
        lead.name = 'Later edit'
        self.apply(edit, [], 'Visit confirmed')
        self.assertEqual(lead.name, 'Later edit')
        with self.assertRaises(UserError):
            self.apply(edit, [], 'Different payload')
        with self.assertRaises(AccessDenied):
            self.apply(dict(operation, db='another database'), [], 'New site')
