# Part of Odoo. See LICENSE file for full copyright and licensing details.
import mimetypes

from odoo import _
from odoo.addons.web.controllers import webmanifest
from odoo.http import request


class WebManifest(webmanifest.WebManifest):

    def _get_shortcuts(self):
        shortcuts = super()._get_shortcuts()

        # Resolve the pipeline menu id the same way the parent resolves menus:
        # sudo on ir.model.data only (no extra elevation).
        pipeline_menu_id = request.env['ir.model.data'].sudo()._xmlid_to_res_id(
            'crm.menu_crm_opportunities'
        )

        # Use the crm module's standard icon path directly. The crm manifest declares no
        # icon key, so the ir.module.module record's icon field defaults to this exact
        # path; hardcoding it avoids a second (access-controlled) module read while
        # producing the identical value. Type is derived like the parent.
        icon_src = '/crm/static/description/icon.png'
        icons = [{
            'sizes': '100x100',
            'src': icon_src,
            'type': mimetypes.guess_type(icon_src)[0] or 'image/png',
        }]

        shortcuts.append({
            'name': _("My Pipeline"),
            'url': '/odoo?menu_id=%s' % pipeline_menu_id,
            'description': _("Open your sales pipeline"),
            'icons': icons,
        })
        shortcuts.append({
            'name': _("New Lead"),
            'url': '/odoo/crm/new',
            'description': _("Create a new lead"),
            'icons': icons,
        })
        return shortcuts

    def _has_share_target(self):
        return True
