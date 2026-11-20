# Part of Odoo. See LICENSE file for full copyright and licensing details.

from odoo import models


class IrHttp(models.AbstractModel):
    _inherit = 'ir.http'

    def webclient_rendering_context(self):
        context = super().webclient_rendering_context()
        context['session_info']['crm_offline_writes'] = True
        return context
