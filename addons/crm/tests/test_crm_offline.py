# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
import mimetypes

from odoo import _
from odoo.addons.crm.controllers.webmanifest import WebManifest as CrmWebManifest
from odoo.addons.crm.tests.common import TestCrmCommon
from odoo.addons.http_routing.tests.common import MockRequest
from odoo.addons.web.controllers.webmanifest import WebManifest as WebWebManifest
from odoo.tests import HttpCase
from odoo.tests.common import tagged
from odoo.tools import file_open


@tagged('post_install', '-at_install')
class TestCrmOffline(HttpCase, TestCrmCommon):
    # Spec 03 seeds this module with the CRM PWA packaging tests.
    # Specs 04-08 append their offline Python tests to this same file.

    def test_shortcuts_extend_parent(self):
        """The CRM override returns the parent shortcuts plus exactly the two CRM
        deep-link shortcuts (My Pipeline, New Lead), in the parent's shape."""
        with MockRequest(self.env):
            # Capture the parent result dynamically rather than hardcoding it, so a
            # future change to the parent's shortcuts cannot silently pass this test.
            parent_result = WebWebManifest()._get_shortcuts()
            crm_result = CrmWebManifest()._get_shortcuts()

        # The CRM list begins with the parent's entries, in order, unchanged...
        self.assertEqual(
            crm_result[:len(parent_result)], parent_result,
            "CRM _get_shortcuts must preserve the parent's shortcuts in order",
        )
        # ...and adds exactly two more entries.
        self.assertEqual(
            len(crm_result), len(parent_result) + 2,
            "CRM _get_shortcuts must append exactly two shortcuts",
        )

        pipeline, new_lead = crm_result[-2], crm_result[-1]

        # Both new shortcuts carry exactly the parent's shortcut keys.
        expected_keys = {'name', 'url', 'description', 'icons'}
        self.assertEqual(set(pipeline), expected_keys)
        self.assertEqual(set(new_lead), expected_keys)
        if parent_result:
            self.assertEqual(
                set(pipeline), set(parent_result[0]),
                "New shortcuts must match the parent entry's key shape",
            )

        # Each icons entry has the parent's sub-shape and the crm icon value.
        for shortcut in (pipeline, new_lead):
            self.assertEqual(len(shortcut['icons']), 1)
            icon = shortcut['icons'][0]
            self.assertEqual(set(icon), {'sizes', 'src', 'type'})
            self.assertEqual(icon['sizes'], '100x100')
            self.assertEqual(icon['src'], '/crm/static/description/icon.png')
            self.assertEqual(
                icon['type'],
                mimetypes.guess_type(icon['src'])[0] or 'image/png',
            )
            self.assertTrue(icon['type'])
            # The icon path is openable (de-slash the leading '/').
            with file_open(icon['src'].removeprefix('/')):
                pass

        # Names are the translatable CRM strings (en_US => literal English).
        self.assertEqual(pipeline['name'], _("My Pipeline"))
        self.assertEqual(new_lead['name'], _("New Lead"))

        # Descriptions are present and distinct.
        self.assertTrue(pipeline['description'])
        self.assertTrue(new_lead['description'])
        self.assertNotEqual(pipeline['description'], new_lead['description'])

        # Pipeline url targets the pipeline menu, resolved through ir.model.data.
        menu_id = self.env['ir.model.data']._xmlid_to_res_id(
            'crm.menu_crm_opportunities'
        )
        self.assertEqual(pipeline['url'], '/odoo?menu_id=%s' % menu_id)
        # New Lead url targets the lead-creation path.
        self.assertEqual(new_lead['url'], '/odoo/crm/new')

        # The share target stays enabled on the CRM manifest.
        controller = CrmWebManifest()
        self.assertIs(controller._has_share_target(), True)
        with MockRequest(self.env):
            manifest = controller._get_webmanifest()
        self.assertIn('share_target', manifest)

    def test_manifest_http_salesman(self):
        """A plain salesman (no admin rights) receives both CRM shortcuts from the
        served manifest route, proving the override is wired, not just correct in
        isolation."""
        self.env['res.users'].create({
            'name': 'Spec03 Salesman',
            'login': 'spec03_salesman',
            'password': 'spec03_salesman',
            'group_ids': [(6, 0, [
                self.ref('base.group_user'),
                self.ref('sales_team.group_sale_salesman'),
            ])],
        })
        self.authenticate('spec03_salesman', 'spec03_salesman')
        res = self.url_open('/web/manifest.webmanifest')
        res.raise_for_status()
        manifest = json.loads(res.content)

        names = [shortcut['name'] for shortcut in manifest['shortcuts']]
        self.assertIn(_("My Pipeline"), names)
        self.assertIn(_("New Lead"), names)

    # ------------------------------------------------------------------
    # Spec 04 — Form-save offline correctness (integration)
    #
    # These replay the queued offline calls through the real ORM to prove
    # server-side correctness, tying the JS "what is queued" assertions
    # (AC-J4 / AC-J6) to the Python "what the server does with it".
    # ------------------------------------------------------------------

    def test_offline_websave_syncs_partner_email_phone(self):
        """AC-P1 (Req 2.3): applying the exact queued offline `web_save` for a
        lead with the partner-sync flags set yields the same lead + partner
        email/phone state as the online write path. The call shape mirrors what
        the JS AC-J4 test asserts is queued: web_save([[resId], {name, email_from,
        phone}]) with an empty specification."""
        partner = self.env['res.partner'].create({
            'name': 'Offline Sync Partner',
            'email': 'old.partner@test.example.com',
            'phone': '+1 111 000 0000',
        })
        # A lead linked to that partner; the lead's email/phone will be written
        # offline and must sync onto the partner (partner_*_update is truthy
        # because the lead value differs from the partner value).
        lead = self.env['crm.lead'].create({
            'name': 'Offline Lead',
            'type': 'opportunity',
            'partner_id': partner.id,
            'email_from': 'old.partner@test.example.com',
            'phone': '+1 111 000 0000',
        })

        new_values = {
            'name': 'Offline Lead edited',
            'email_from': 'new.lead@test.example.com',
            'phone': '+1 222 333 4444',
        }

        # Apply the queued offline web_save verbatim (same shape as AC-J4 queues).
        lead.web_save(dict(new_values), {})

        # The lead carries the new values, and the partner was synced through the
        # email_from / phone inverse methods.
        self.assertEqual(lead.name, 'Offline Lead edited')
        self.assertEqual(lead.email_from, 'new.lead@test.example.com')
        self.assertEqual(lead.phone, '+1 222 333 4444')
        self.assertEqual(partner.email, 'new.lead@test.example.com')
        self.assertEqual(partner.phone, '+1 222 333 4444')

        # The online write path (a plain write of the same values on an identical
        # lead/partner pair) produces the same lead + partner state — proving the
        # queued offline write is behaviorally identical to the online write.
        partner_online = self.env['res.partner'].create({
            'name': 'Online Sync Partner',
            'email': 'old.partner@test.example.com',
            'phone': '+1 111 000 0000',
        })
        lead_online = self.env['crm.lead'].create({
            'name': 'Online Lead',
            'type': 'opportunity',
            'partner_id': partner_online.id,
            'email_from': 'old.partner@test.example.com',
            'phone': '+1 111 000 0000',
        })
        lead_online.write({
            'email_from': 'new.lead@test.example.com',
            'phone': '+1 222 333 4444',
        })
        self.assertEqual(lead_online.email_from, lead.email_from)
        self.assertEqual(lead_online.phone, lead.phone)
        self.assertEqual(partner_online.email, partner.email)
        self.assertEqual(partner_online.phone, partner.phone)

    def test_offline_action_set_won_marks_lead_won(self):
        """AC-P2 (Req 2.8): applying the queued `action_set_won` call (on
        [[resId]]) through the ORM leaves the lead won — won_status 'won', in a
        won stage, probability 100 — matching the optimistic display the offline
        Won path showed."""
        lead = self.env['crm.lead'].create({
            'name': 'Lead To Win Offline',
            'type': 'opportunity',
            'team_id': self.sales_team_1.id,
            'stage_id': self.stage_team1_1.id,
            'probability': 20,
        })
        self.assertNotEqual(lead.won_status, 'won')

        # Replay the queued call exactly: action_set_won on [[resId]].
        self.env['crm.lead'].browse(lead.id).action_set_won()

        self.assertEqual(lead.won_status, 'won')
        self.assertTrue(lead.stage_id.is_won, "the lead must land in a won stage")
        self.assertEqual(lead.probability, 100)
