# Part of Odoo. See LICENSE file for full copyright and licensing details.

import hashlib
import json
from uuid import UUID

from odoo import fields, models
from odoo.exceptions import AccessDenied, UserError


class CrmOfflineReceipt(models.Model):
    _name = 'crm.offline.receipt'
    _description = 'Acknowledged CRM change'
    _log_access = False

    user_id = fields.Many2one('res.users', required=True, ondelete='cascade')
    operation_key = fields.Char(required=True)
    digest = fields.Char(required=True)
    lead_ids = fields.Json()
    created_lead_id = fields.Integer()
    _operation_unique = models.Constraint('UNIQUE(user_id, operation_key)', 'This change has already been received.')

    def _apply(self, operation, method, args, kwargs, apply):
        """Commit the receipt and the normal CRM operation in the same transaction."""
        uid = self.env.uid
        if operation.get('uid') != uid or operation.get('db') != self.env.cr.dbname:
            raise AccessDenied(self.env._('Sign in with the account that saved this change.'))
        try:
            key = str(UUID(operation['key']))
        except (KeyError, TypeError, ValueError, AttributeError):
            raise UserError(self.env._('The saved change has an invalid identifier.')) from None
        digest = hashlib.sha256(json.dumps(
            [method, args, kwargs, operation.get('parent')], sort_keys=True,
        ).encode()).hexdigest()
        # A concurrent request for this key waits for the winner, or PostgreSQL
        # raises a serialization failure and Odoo retries in a fresh transaction.
        self.env.cr.execute("""
            INSERT INTO crm_offline_receipt (user_id, operation_key, digest)
                 VALUES (%s, %s, %s)
            ON CONFLICT (user_id, operation_key) DO NOTHING RETURNING id
        """, (uid, key, digest))
        created = self.env.cr.fetchone()
        # sudo: this internal ledger has no user ACL. Scope every lookup to uid,
        # and perform all business reads and writes with the real environment.
        receipts = self.sudo()
        if not created:
            receipt = receipts.search([('user_id', '=', uid), ('operation_key', '=', key)], limit=1)
            if receipt.digest != digest:
                raise UserError(self.env._('This change was already sent with different values.'))
            if method in ('web_save', 'web_save_multi'):
                return self.env['crm.lead'].with_context(**kwargs.get('context', {})).browse(
                    receipt.lead_ids,
                ).web_read(kwargs.get('specification', {}))
            return True
        is_creation = method == 'web_save' and not args[0]
        if parent := operation.get('parent'):
            receipt = receipts.search([('user_id', '=', uid), ('operation_key', '=', parent)], limit=1)
            if not receipt.created_lead_id or not is_creation:
                raise UserError(self.env._('The earlier offline creation must be sent before this edit.'))
            args = [[receipt.created_lead_id], *args[1:]]
        if args[0] and set(self.env['crm.lead'].browse(args[0]).exists().ids) != set(args[0]):
            raise UserError(self.env._('This opportunity was deleted. Your change is still on this device.'))
        next_id = kwargs.get('next_id') if is_creation else None
        if next_id:
            # Keep the created record identity even when the caller asks to
            # display a different lead after saving.
            saved = apply(args, {**kwargs, 'next_id': None, 'specification': {}})
            result = self.env['crm.lead'].with_context(**kwargs.get('context', {})).browse(next_id).web_read(
                kwargs.get('specification', {}),
            )
        else:
            saved = result = apply(args, kwargs)
        if method in ('web_save', 'web_save_multi'):
            result_ids = [record['id'] for record in result]
            receipts.browse(created[0]).write({
                'lead_ids': result_ids,
                'created_lead_id': saved[0]['id'] if is_creation else False,
            })
        return result
