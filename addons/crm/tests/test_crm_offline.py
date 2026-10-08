# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
import mimetypes

from odoo import _
from odoo.addons.crm.controllers.webmanifest import WebManifest as CrmWebManifest
from odoo.addons.crm.tests.common import TestCrmCommon
from odoo.addons.http_routing.tests.common import MockRequest
from odoo.addons.web.controllers.webmanifest import WebManifest as WebWebManifest
from odoo.service.model import call_kw
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

    # ------------------------------------------------------------------
    # Spec 06 — Offline data coverage: replay the queued offline calls
    # through the real ORM to prove server-side correctness, tying the JS
    # "what is queued" assertions (3a/3b) to the Python "what the server does".
    # ------------------------------------------------------------------

    def test_offline_activity_schedule_replay(self):
        """Req 3.3 / 10.1 (Property 1, 7): applying the exact queued
        `activity_schedule` call on a lead through the ORM yields a `mail.activity`
        linked to that lead carrying the queued arguments (type, summary, deadline,
        assignee, res_model/res_id)."""
        lead = self.env['crm.lead'].create({
            'name': 'Schedule Replay Lead',
            'type': 'opportunity',
            'team_id': self.sales_team_1.id,
        })
        call_type = self.env.ref('mail.mail_activity_data_call')
        user = self.env.user

        # Replay the queued kwargs verbatim (the JS sheet queues exactly these:
        # activity_type_id, summary, date_deadline, user_id).
        activities = self.env['crm.lead'].browse(lead.id).activity_schedule(
            activity_type_id=call_type.id,
            summary='Call the lead',
            date_deadline='2026-01-15',
            user_id=user.id,
        )

        self.assertEqual(len(activities), 1, "exactly one activity is created")
        activity = activities
        self.assertEqual(activity.res_model, 'crm.lead')
        self.assertEqual(activity.res_id, lead.id)
        self.assertEqual(activity.activity_type_id, call_type)
        self.assertEqual(activity.summary, 'Call the lead')
        self.assertEqual(str(activity.date_deadline), '2026-01-15')
        self.assertEqual(activity.user_id, user)
        # The activity is linked back onto the lead's activities.
        self.assertIn(activity, lead.activity_ids)

    def test_offline_action_feedback_replay(self):
        """Req 5.4 / 10.3 (Property 1, 7): applying the queued mark-done
        `action_feedback` on [[activityId]] marks the activity done — it is removed
        from the lead's pending activities and a mail.message is posted on the
        lead, exactly as the online Done path produces."""
        lead = self.env['crm.lead'].create({
            'name': 'Mark Done Replay Lead',
            'type': 'opportunity',
            'team_id': self.sales_team_1.id,
        })
        call_type = self.env.ref('mail.mail_activity_data_call')
        activity = self.env['mail.activity'].create({
            'res_model_id': self.env['ir.model']._get_id('crm.lead'),
            'res_id': lead.id,
            'activity_type_id': call_type.id,
            'summary': 'Call to close',
            'user_id': self.env.user.id,
        })
        self.assertIn(activity, lead.activity_ids)
        messages_before = len(lead.message_ids)

        # Replay the queued call exactly: action_feedback on [[activityId]].
        self.env['mail.activity'].browse(activity.id).action_feedback()

        # The activity is consumed (deleted/archived — no longer in activity_ids)...
        self.assertNotIn(activity.id, lead.activity_ids.ids)
        self.assertFalse(activity.exists() and activity.active)
        # ...and a message was posted on the lead recording the done activity.
        self.assertGreater(
            len(lead.message_ids), messages_before,
            "marking the activity done posts a message on the lead",
        )

    def test_offline_websave_create_replay(self):
        """Req 1.2 / 1.3 (Property 7): applying the queued offline `web_save`
        CREATE for a lead through the ORM yields a server lead carrying the entered
        values. Distinct from the existing edit-sync test (that one writes an
        existing lead; this one creates a new one from an empty id list)."""
        # The queued create is web_save with an empty id list and a values dict
        # (what the framework enqueues for a brand-new record's save).
        leads = self.env['crm.lead'].web_save(
            {'name': 'Created Offline', 'type': 'opportunity'}, {}
        )
        # web_save returns the saved record(s) specification; fetch the record.
        self.assertTrue(leads, "web_save create returns the new record")
        created = self.env['crm.lead'].search([('name', '=', 'Created Offline')])
        self.assertEqual(len(created), 1, "exactly one lead was created")
        self.assertEqual(created.type, 'opportunity')

    # ------------------------------------------------------------------
    # Spec 07 — Quick-create queued create replay (Req 11 / Fact 4)
    #
    # Replays the quick-create's queued offline `web_save` CREATE the way the
    # framework does — through `odoo.service.model.call_kw` with the EXACT queued
    # args `[[], VALUES]` and kwargs `{context, specification: {}}` (Fact 4 shape,
    # identical to what the JS lane asserts is queued). In a call_kw, args[0] (the
    # id list) becomes the recordset `self`, so VALUES is `web_save`'s `vals`
    # argument on an empty recordset — NOT a positional web_save([], VALUES).
    # Runs for BOTH a lead pipeline and an opportunity pipeline (Req 11.1 / 11.2),
    # asserting the created lead carries the entered values, the chosen stage, and
    # the correct type from the pipeline context. Distinct from the pre-existing
    # `test_offline_websave_create_replay`, which is NOT modified.
    # ------------------------------------------------------------------

    def test_spec07_quick_create_replay(self):
        """Req 11.1 / 11.2 (Fact 4): replaying the quick-create's queued offline
        `web_save` create via `call_kw(crm.lead, 'web_save', [[], VALUES],
        {context, specification: {}})` yields a server lead carrying the entered
        values and the chosen generic stage, with the type taken from the pipeline
        context — `lead` for a lead pipeline and `opportunity` for an opportunity
        pipeline."""
        # stage_gen_1 has no team_ids (usable by any team), matching the generic
        # stage a quick-create picks from root.groups.
        stage = self.stage_gen_1

        def replay_create(ctx, values):
            # Exact queued shape: args [[], VALUES], kwargs {context, specification}.
            result = call_kw(
                self.env['crm.lead'].with_context(**ctx),
                'web_save',
                [[], values],
                {'context': ctx, 'specification': {}},
            )
            # web_save returns a list of record-data dicts; with an empty
            # specification this is minimal data, typically [{'id': <id>}]. Prefer
            # the returned id; fall back to a name search only if it is unavailable.
            if result and isinstance(result[0], dict) and 'id' in result[0]:
                created_id = result[0]['id']
                lead = self.env['crm.lead'].browse(created_id)
            else:
                lead = self.env['crm.lead'].search(
                    [('name', '=', values['name'])], limit=1,
                )
            self.assertTrue(lead, "the replayed web_save created exactly one lead")
            return lead

        # Lead pipeline: context default_type='lead'. FULL payload — every
        # optional field filled, mirroring a quick-create with all fields entered.
        ctx_lead = {'default_type': 'lead'}
        lead = replay_create(ctx_lead, {
            'name': 'QC Lead',
            'contact_name': 'QC Contact',
            'phone': '+1 555 0100',
            'email_from': 'qc@test.example.com',
            'expected_revenue': 1234,
            'stage_id': stage.id,
        })
        self.assertEqual(lead.name, 'QC Lead')
        self.assertEqual(lead.contact_name, 'QC Contact')
        self.assertEqual(lead.phone, '+1 555 0100')
        self.assertEqual(lead.email_from, 'qc@test.example.com')
        self.assertEqual(lead.expected_revenue, 1234)
        self.assertEqual(lead.stage_id, stage)
        self.assertEqual(lead.type, 'lead')

        # Opportunity pipeline: context default_type='opportunity'. MINIMAL payload
        # — name + stage_id only, mirroring the sheet's omit-empty behaviour when
        # the optional fields are left blank. The minimal (omit-empty) payload must
        # replay just as cleanly.
        ctx_opp = {'default_type': 'opportunity'}
        opp = replay_create(ctx_opp, {
            'name': 'QC Opp',
            'stage_id': stage.id,
        })
        self.assertEqual(opp.name, 'QC Opp')
        self.assertEqual(opp.stage_id, stage)
        self.assertEqual(opp.type, 'opportunity')
        # Omitted optional fields stay falsy/empty on the created lead.
        self.assertFalse(opp.contact_name)
        self.assertFalse(opp.phone)
        self.assertFalse(opp.email_from)


# ----------------------------------------------------------------------------
# Spec 08 — Browser tour (testing lane 3; acceptance row 6)
#
# A DEDICATED HttpCase class with a 375x667 touch viewport so the tour runs in
# MOBILE mode (isSmall() true → the mobile pipeline is active). The viewport is
# set as CLASS attributes here so it does NOT bleed onto the other
# `TestCrmOffline` methods (which must keep the default desktop viewport) — this
# is why the tour lives in its own class rather than a method on TestCrmOffline.
#
# The tour (crm_mobile_offline): loads the pipeline online, opens a cached lead,
# goes offline, edits + saves the lead (queued web_save), MARKS THE LEAD WON
# (queued action_set_won, shown won optimistically), creates a lead through the
# mobile quick-create bottom sheet (queued web_save create), then reconnects.
# After the tour this test asserts the edit, the mark-won, and the quick-create
# all reached the server.
#
# Deviation (recorded in the PR): the ACTIVITY-SCHEDULE leg of acceptance row 6 is
# NOT in the tour. The offline schedule control is gated on the online
# activity-type prefetch having cached non-meeting types into the many2x cache
# (KL-C: a session-scoped allow-list); that caching is not reliably ready within
# the single-run tour's timing, so after 3 runs the schedule step could not be
# made stable. It was dropped rather than weaken the rest of the tour (per the
# review's rule). Offline activity scheduling is proven by the existing Python
# replay test (test_offline_activity_schedule_replay) and the spec-06 JS lane; the
# end-to-end schedule-on-device is a Step-10 manual-check item. The edit,
# mark-won, and quick-create legs ARE exercised end to end here.
# ----------------------------------------------------------------------------


@tagged('post_install', '-at_install')
class TestCrmMobileOfflineTour(HttpCase, TestCrmCommon):

    browser_size = '375x667'
    touch_enabled = True

    def test_crm_mobile_offline_tour(self):
        """Run the mobile offline tour on a phone-sized touch viewport, then
        assert the queued offline edit, mark-won, and quick-create all reached the
        server after reconnect."""
        # A pipeline opportunity the tour opens, edits, and (after the tour)
        # we assert was renamed. Assigned to admin so the admin login sees it.
        lead = self.env['crm.lead'].create({
            'name': 'Tour Lead',
            'type': 'opportunity',
            'team_id': self.sales_team_1.id,
            'stage_id': self.stage_team1_1.id,
            'user_id': self.env.ref('base.user_admin').id,
        })

        self.start_tour('/odoo/crm', 'crm_mobile_offline', login='admin')

        # The offline EDIT replayed: the lead was renamed on the server.
        lead.invalidate_recordset()
        self.assertEqual(
            lead.name, 'Tour Lead edited',
            "the offline lead edit must replay to the server on reconnect",
        )
        # The offline QUICK-CREATE replayed: a new lead exists on the server.
        created = self.env['crm.lead'].search([('name', '=', 'Tour QuickCreate')])
        self.assertEqual(
            len(created), 1,
            "the offline mobile quick-create must replay exactly one lead",
        )
        # The offline MARK-WON replayed: the lead is won on the server.
        self.assertEqual(
            lead.won_status, 'won',
            "the offline action_set_won must replay and leave the lead won",
        )
        self.assertEqual(lead.probability, 100)
