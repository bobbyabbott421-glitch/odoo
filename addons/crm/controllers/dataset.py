# Part of Odoo. See LICENSE file for full copyright and licensing details.

from odoo import http
from odoo.http import request
from odoo.addons.web.controllers.dataset import DataSet


class CrmDataSet(DataSet):

    @http.route()
    def call_kw(self, model, method, args, kwargs, path=None):
        operation = kwargs.get('offline_operation')
        if operation and model == 'crm.lead' and method in (
            'web_save', 'web_save_multi', 'web_unlink', 'action_archive', 'action_unarchive',
            'offline_log_note', 'offline_schedule_todo',
        ):
            kwargs = dict(kwargs)
            del kwargs['offline_operation']
            call = super().call_kw
            return request.env['crm.offline.receipt']._apply(
                operation, method, args, kwargs,
                lambda ids_and_values, options: call(model, method, ids_and_values, options, path),
            )
        return super().call_kw(model, method, args, kwargs, path)
