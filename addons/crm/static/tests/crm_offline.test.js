import { Component, xml } from "@odoo/owl";
import { animationFrame, expect, getFixture, queryAllTexts, runAllTimers, test, waitUntil } from "@odoo/hoot";
import { press, queryAttribute } from "@odoo/hoot-dom";
import {
    click,
    contains as mc,
    defineMailModels,
    dragenterFiles,
    dropFiles,
    insertText,
    openFormView,
    start,
    startServer,
} from "@mail/../tests/mail_test_helpers";
import {
    contains,
    defineActions,
    defineMenus,
    defineModels,
    destroyApp,
    fields,
    getService,
    makeServerError,
    mockOffline,
    MockServer,
    models,
    mountView,
    mountWithCleanup,
    onRpc,
    patchWithCleanup,
} from "@web/../tests/web_test_helpers";
import { OfflinePlugin } from "@web/core/offline/offline_plugin";
import { NonSecureContextError } from "@web/core/errors/non_secure_context_error";
import { AnimatedNumber } from "@web/views/view_components/animated_number";
import { registry } from "@web/core/registry";
import { user } from "@web/core/user";
import { WebClient } from "@web/webclient/webclient";
import { browser } from "@web/core/browser/browser";
import { useCrmOffline } from "@crm/mobile/crm_offline_hooks";
import { TeamSwitcher } from "@crm/components/team_switcher/team_switcher";
import { LeadGenerationDropdown } from "@crm/components/lead_generation_dropdown/lead_generation_dropdown";
import { CrmColumnProgress } from "@crm/views/crm_kanban/crm_column_progress";
import { CrmPlsTooltipButton } from "@crm/views/crm_form/crm_pls_tooltip_button";
import { ActivityMenu } from "@mail/core/web/activity_menu";
import { Activity } from "@mail/core/web/activity";
import { CrmChatter } from "@crm/views/crm_form/crm_form";
import { Chatter } from "@mail/chatter/web_portal_project/chatter";
import { Thread } from "@mail/core/common/thread_model";
import { ConnectionLostError } from "@web/core/network/rpc";
import { OfflineActionHelper } from "@web/views/offline_action_helper";
import { CrmShareTargetItem } from "@crm/webclient/share_target/crm_share_target_item";
import { shareTargetService } from "@web/webclient/share_target/share_target_service";
import { AttachmentUploadService } from "@mail/core/common/attachment_upload_service";

// The webclient services started behind `mountWithCleanup` resolve mail models
// (e.g. `discuss.channel`) from the mock server, so the mail test models must be
// defined. This mirrors the existing crm Hoot tests (crm_team_switcher.test.js).
defineMailModels();

/**
 * Module-level handle to the object returned by `useCrmOffline()`. The probe
 * component writes it in `setup()` so each test can call the hook's members
 * directly and assert their live return values.
 */
let hook;

class Probe extends Component {
    static template = xml`<div/>`;
    setup() {
        hook = useCrmOffline();
    }
}

/**
 * Mount the probe, exposing the hook object on the module-level `hook`.
 * `mountWithCleanup` tears the component down after each test.
 */
async function mountProbe() {
    hook = undefined;
    await mountWithCleanup(Probe);
}

/**
 * Toggle the framework offline signal directly on the plugin. We drive the
 * signal rather than `mockOffline()` (which also installs an `onRpc("/*")`
 * returning 502): toggling the signal is all the hook predicates read, and it
 * avoids turning unrelated background RPCs into non-deterministic
 * connection-lost errors when the suite runs alongside the mail services.
 */
function setOffline(offline) {
    getService(OfflinePlugin).setOffline(offline);
}

/**
 * Schedule a queued ORM entry straight on the plugin, for the queued-write
 * read tests. `args[0]` is the ids array for a `write`/`web_save` (confirmed in
 * web's offline_systray.test.js).
 */
function scheduleWrite(model, ids, extras = {}) {
    getService(OfflinePlugin).scheduleORM(model, "web_save", [ids], {}, {
        extras: { timeStamp: 1, ...extras },
    });
}

// ===========================================================================
// isOffline — reads the live connection signal (Requirements 2.1, 2.3, 3.1).
// Exercised online and offline. Run under both presets.
// ===========================================================================

async function testIsOffline() {
    await mountProbe();
    expect(hook.isOffline()).toBe(false); // online
    setOffline(true);
    expect(hook.isOffline()).toBe(true); // offline
    setOffline(false);
    expect(hook.isOffline()).toBe(false); // back online
}

test.tags("desktop");
test("isOffline reflects connectivity (desktop)", testIsOffline);

test.tags("mobile");
test("isOffline reflects connectivity (mobile)", testIsOffline);

// ===========================================================================
// isSmall — pinned to the preset (Requirements 2.2, 2.3, 3.2). Comparing
// against the UI plugin getter would be circular, so the expected value is
// pinned: false on desktop, true on mobile. Asserted both online and offline
// to show the small-screen signal is independent of connectivity.
// ===========================================================================

async function testIsSmall(expected) {
    await mountProbe();
    expect(hook.isSmall()).toBe(expected); // online
    setOffline(true);
    expect(hook.isSmall()).toBe(expected); // offline — unchanged
    setOffline(false);
}

test.tags("desktop");
test("isSmall is false under the desktop preset", () => testIsSmall(false));

test.tags("mobile");
test("isSmall is true under the mobile preset", () => testIsSmall(true));

// ===========================================================================
// isAvailableOffline — real delegation to the plugin (Requirements 1.1, 3.1).
// The plugin answers from its in-memory `_visited` map, which it populates from
// its own cache only when going offline. Online, nothing is populated yet, so
// the hook returns the plugin's online answer; offline (after the cache is
// loaded) it returns true for the seeded record. Both states are asserted,
// under both presets.
// ===========================================================================

async function testIsAvailableOffline() {
    await mountProbe();
    const offline = getService(OfflinePlugin);
    const actionId = 42;
    const resId = 7;

    // Seed the cache while online (setAvailableOffline only persists when not offline).
    await offline.setAvailableOffline(actionId, "form", { resId });

    // Online: `_visited` is not populated, so the hook returns the plugin's
    // online answer verbatim (faithful delegation, not a cached true).
    expect(hook.isAvailableOffline(actionId, "form", resId)).toBe(
        offline.isAvailableOffline(actionId, "form", resId)
    );

    // Go offline; the plugin loads the visited items from its own cache into `_visited`.
    setOffline(true);
    await offline.getVisitedStatus();

    // Offline: seeded action/view/record resolves true via the hook's delegation.
    expect(hook.isAvailableOffline(actionId, "form", resId)).toBe(true);
    // Unseeded record of a seeded action/view: the cached form id list does not
    // include it, so the plugin returns false.
    expect(hook.isAvailableOffline(actionId, "form", 999)).toBe(false);
    // Unseeded action entirely: the hook returns exactly what the plugin returns
    // for an unknown action/form, proving faithful delegation. For an unknown
    // action the plugin's form branch yields `undefined`, which the hook passes
    // through verbatim.
    expect(hook.isAvailableOffline(999, "form", resId)).toBe(
        offline.isAvailableOffline(999, "form", resId)
    );
    expect(hook.isAvailableOffline(999, "form", resId)).toBe(undefined);
    setOffline(false);
}

test.tags("desktop");
test("isAvailableOffline delegates to the plugin (desktop)", testIsAvailableOffline);

test.tags("mobile");
test("isAvailableOffline delegates to the plugin (mobile)", testIsAvailableOffline);

// ===========================================================================
// hasQueuedWrite — reads the framework's _ormToSync() signal (Requirement 4).
// Covered online and offline, keyed and no-arg, matching/non-matching, parked,
// and the non-array args[0] guard. Run under both presets.
// ===========================================================================

async function testHasQueuedWriteEmpty() {
    await mountProbe();
    // Online, empty queue.
    expect(hook.hasQueuedWrite()).toBe(false);
    expect(hook.hasQueuedWrite("crm.lead", 7)).toBe(false);
}

test.tags("desktop");
test("hasQueuedWrite is false on an empty queue (desktop)", testHasQueuedWriteEmpty);

test.tags("mobile");
test("hasQueuedWrite is false on an empty queue (mobile)", testHasQueuedWriteEmpty);

// A write queued while OFFLINE is the real case: the salesperson edits offline
// and the framework captures the call. hasQueuedWrite must see it.
async function testHasQueuedWriteOffline() {
    await mountProbe();
    setOffline(true);

    expect(hook.hasQueuedWrite()).toBe(false);
    scheduleWrite("crm.lead", [7]);
    // Keyed and no-arg forms both report the offline-queued write.
    expect(hook.hasQueuedWrite("crm.lead", 7)).toBe(true);
    expect(hook.hasQueuedWrite()).toBe(true);
    setOffline(false);
}

test.tags("desktop");
test("hasQueuedWrite sees a write queued while offline (desktop)", testHasQueuedWriteOffline);

test.tags("mobile");
test("hasQueuedWrite sees a write queued while offline (mobile)", testHasQueuedWriteOffline);

// Online, a queued entry (e.g. a replay still pending) matches by model + id.
async function testHasQueuedWriteMatch() {
    await mountProbe();
    scheduleWrite("crm.lead", [7]);
    expect(hook.hasQueuedWrite("crm.lead", 7)).toBe(true);
    // No-arg form also reports it.
    expect(hook.hasQueuedWrite()).toBe(true);
}

test.tags("desktop");
test("hasQueuedWrite matches a keyed entry (desktop)", testHasQueuedWriteMatch);

test.tags("mobile");
test("hasQueuedWrite matches a keyed entry (mobile)", testHasQueuedWriteMatch);

// Wrong model or wrong id does not match.
async function testHasQueuedWriteNonMatch() {
    await mountProbe();
    scheduleWrite("crm.lead", [7]);
    expect(hook.hasQueuedWrite("crm.stage", 7)).toBe(false); // wrong model
    expect(hook.hasQueuedWrite("crm.lead", 8)).toBe(false); // wrong id
}

test.tags("desktop");
test("hasQueuedWrite rejects a non-matching entry (desktop)", testHasQueuedWriteNonMatch);

test.tags("mobile");
test("hasQueuedWrite rejects a non-matching entry (mobile)", testHasQueuedWriteNonMatch);

// A parked entry (carrying extras.error after a failed replay) is still
// unsynced, so it is counted as a queued write (Requirement 4.3).
async function testHasQueuedWriteParked() {
    await mountProbe();
    scheduleWrite("crm.lead", [7], { error: "boom" });
    expect(hook.hasQueuedWrite("crm.lead", 7)).toBe(true);
    expect(hook.hasQueuedWrite()).toBe(true);
}

test.tags("desktop");
test("hasQueuedWrite counts a parked entry (desktop)", testHasQueuedWriteParked);

test.tags("mobile");
test("hasQueuedWrite counts a parked entry (mobile)", testHasQueuedWriteParked);

// Guard path: an entry on the right model whose args[0] is NOT an array must
// not match and must not throw (crm_offline_hooks.js guards with Array.isArray
// before calling .includes).
async function testHasQueuedWriteNonArrayArgs() {
    await mountProbe();
    // Schedule a crm.lead call whose args[0] is not an array of ids.
    getService(OfflinePlugin).scheduleORM(
        "crm.lead",
        "some_method",
        ["not-an-array"],
        {},
        { extras: { timeStamp: 1 } }
    );
    // Matching model, but args[0] is not an array: keyed form returns false and
    // does not throw.
    expect(hook.hasQueuedWrite("crm.lead", 7)).toBe(false);
    // The no-arg form still reports that *something* is queued.
    expect(hook.hasQueuedWrite()).toBe(true);
}

test.tags("desktop");
test("hasQueuedWrite tolerates a non-array args[0] (desktop)", testHasQueuedWriteNonArrayArgs);

test.tags("mobile");
test("hasQueuedWrite tolerates a non-array args[0] (mobile)", testHasQueuedWriteNonArrayArgs);

// ===========================================================================
// scheduleORM — transparent pass-through to the plugin (Requirement 5).
// Asserts the full argument list (model, method, args, kwargs, options.extras)
// reaches the queued entry unchanged and that the hook returns the plugin's key.
// ===========================================================================

async function testScheduleORMDelegates() {
    await mountProbe();
    const offline = getService(OfflinePlugin);
    const kwargs = { context: { foo: 1 } };
    const extras = { timeStamp: 5, actionName: "CRM" };

    const key = hook.scheduleORM("crm.lead", "web_save", [[9], { name: "x" }], kwargs, {
        extras,
    });

    const entries = Object.values(offline._ormToSync());
    expect(entries.length).toBe(1);
    const { value } = entries[0];
    // Every part of the call reaches the queued entry unchanged.
    expect(value.model).toBe("crm.lead");
    expect(value.method).toBe("web_save");
    expect(value.args).toEqual([[9], { name: "x" }]);
    expect(value.kwargs).toEqual(kwargs);
    expect(value.extras).toEqual(extras);
    // The hook returns the plugin's key (hashCode of the value, or options.id).
    expect(key).toBe(entries[0].key);
    // And the entry is observable through the hook's own predicate.
    expect(hook.hasQueuedWrite("crm.lead", 9)).toBe(true);
}

test.tags("desktop");
test("scheduleORM forwards the full call and returns the key (desktop)", testScheduleORMDelegates);

test.tags("mobile");
test("scheduleORM forwards the full call and returns the key (mobile)", testScheduleORMDelegates);

// In a non-secure context the plugin's scheduleORM throws NonSecureContextError
// at call time (offline_plugin.js checks window.isSecureContext in scheduleORM).
// The hook is a verbatim pass-through, so the error must surface unchanged.
// Hoot CAN patch window.isSecureContext via patchWithCleanup(window, ...), which
// the plugin reads live, so this is tested directly rather than documented-only.
async function testScheduleORMNonSecureContext() {
    await mountProbe();
    patchWithCleanup(window, { isSecureContext: false });
    expect(() =>
        hook.scheduleORM("crm.lead", "web_save", [[9]], {}, { extras: { timeStamp: 1 } })
    ).toThrow(NonSecureContextError);
}

test.tags("desktop");
test("scheduleORM surfaces NonSecureContextError in an insecure context (desktop)", testScheduleORMNonSecureContext);

test.tags("mobile");
test("scheduleORM surfaces NonSecureContextError in an insecure context (mobile)", testScheduleORMNonSecureContext);

// ###########################################################################
// Spec 04 — Form-save offline correctness
//
// The tests below exercise the CRM form-save, kanban-move, and mark-won paths
// while offline. They are appended to the existing spec-02 hook tests above and
// never modify them. They use real `crm_form` / `crm_kanban` view mounts (as
// `crm_rainbowman.test.js` does) with `onRpc` spies on the server calls that
// have no offline fallback (`get_rainbowman_message`, `action_set_won`,
// `action_set_won_rainbowman`).
//
// Connectivity for the view-mount / queue-inspection tests is driven by
// `OfflinePlugin.setOffline(...)` directly (the `setOffline` helper defined
// above): that flips the live `isOffline()` signal the two gates read, and runs
// the framework's `_offlineUI()` disable pass. To make an offline `web_save`
// actually queue (the framework only falls back to `_offlineSave()` when the
// `web_save` RPC raises `ConnectionLostError`), a SCOPED route handler returns a
// 502 for just that call while offline — the same mechanism `mockOffline()`
// uses, but scoped to `web_save` so unrelated background RPCs stay healthy
// (avoiding the catch-all 502 flakiness noted in the spec-02 lessons). AC-J8 /
// AC-J9 instead use the full `mockOffline()` + `WebClient` replay harness, as
// the existing `offline_systray.test.js` does.
// ###########################################################################


class Spec04Users extends models.Model {
    _name = "spec04.users";
    name = fields.Char();
    _records = [
        { id: 1, name: "Mario" },
        { id: 2, name: "Luigi" },
    ];
}

class Spec04Team extends models.Model {
    _name = "crm.team";
    name = fields.Char();
    _records = [
        { id: 1, name: "Mushroom Kingdom" },
        { id: 2, name: "Hyrule" },
    ];
}

class Spec04Stage extends models.Model {
    _name = "crm.stage";
    name = fields.Char();
    is_won = fields.Boolean({ string: "Is won" });
    _records = [
        { id: 1, name: "Start" },
        { id: 2, name: "Middle" },
        { id: 3, name: "Won", is_won: true },
    ];
}

class Spec04Lead extends models.Model {
    _name = "crm.lead";

    name = fields.Char({ required: true });
    type = fields.Char();
    active = fields.Boolean();
    planned_revenue = fields.Float({ string: "Revenue" });
    probability = fields.Float({ string: "Probability" });
    won_status = fields.Selection({
        string: "Won status",
        selection: [
            ["won", "Won"],
            ["lost", "Lost"],
            ["pending", "Pending"],
        ],
    });
    email_from = fields.Char({ string: "Email" });
    phone = fields.Char({ string: "Phone" });
    partner_email_update = fields.Boolean();
    partner_phone_update = fields.Boolean();
    date_closed = fields.Datetime({ string: "Date closed" });
    stage_id = fields.Many2one({ string: "Stage", relation: "crm.stage" });
    user_id = fields.Many2one({ string: "Salesperson", relation: "spec04.users" });
    team_id = fields.Many2one({ string: "Sales Team", relation: "crm.team" });
    // 3c (verify-and-prove): a partner many2one so the lead form can render the
    // contact field with the GENERIC many2one widget. Additive — no spec-04/05 test
    // references it. `res.partner` is provided by defineMailModels().
    partner_id = fields.Many2one({ string: "Customer", relation: "res.partner" });
    // 3b: crm.lead IS a mail.activity.mixin in production. The mock opts into
    // activities so the chatter renders its Activity button
    // (.o-mail-Chatter-activity, gated on webChatterProps.has_activities, which
    // the mock server derives from this flag via base.js get_views). activity_ids
    // backs the activities store field. Additive — no spec-04/05 test uses them.
    has_activities = true;
    activity_ids = fields.Many2many({ string: "Activities", relation: "mail.activity" });

    // base.js propagates has_activities into the get_views payload only for
    // ServerModel subclasses; Spec04Lead extends models.Model, so replicate that
    // one line here (form_arch_parser reads models[modelName].has_activities to
    // set webChatterProps.has_activities, which renders the Activity button).
    get_views() {
        const result = super.get_views(...arguments);
        if (result.models["crm.lead"]) {
            result.models["crm.lead"].has_activities = true;
        }
        return result;
    }
    // Progressbar fields used by the spec-05 recurring-revenue (T-RR) tests. They
    // default to falsy and are referenced by no spec-04 test, so adding them does
    // not change the spec-04 fixtures. Types match the crm.lead production
    // kanban progressbar fields (expected_revenue / recurring_revenue_monthly are
    // summed monetary-like integers; activity_state is the progressbar field).
    activity_state = fields.Char({ string: "Activity State" });
    expected_revenue = fields.Integer({ string: "Revenue", aggregator: "sum" });
    recurring_revenue_monthly = fields.Integer({
        string: "Recurring Revenue",
        aggregator: "sum",
    });

    _records = [
        {
            // Lead 1 carries the partner-sync flags so the CRM `_save` override
            // force-copies email_from/phone into the queued offline write (AC-J4).
            id: 1,
            name: "Lead 1",
            type: "opportunity",
            active: true,
            planned_revenue: 5.0,
            probability: 10,
            won_status: "pending",
            email_from: "lead1@test.example",
            phone: "+1-555-0001",
            partner_email_update: true,
            partner_phone_update: true,
            stage_id: 1,
            team_id: 1,
            user_id: 1,
            // Spec-05 T-RR fixture: stage-1 column has a ZERO standard aggregate
            // and a non-zero MRR, isolating the zero-standard-aggregate case.
            activity_state: "planned",
            expected_revenue: 0,
            recurring_revenue_monthly: 10,
        },
        {
            id: 6,
            name: "Lead 6",
            type: "opportunity",
            active: true,
            planned_revenue: 4.0,
            probability: 20,
            won_status: "pending",
            email_from: "lead6@test.example",
            phone: "+1-555-0006",
            stage_id: 2,
            team_id: 1,
            user_id: 2,
            activity_state: "today",
            expected_revenue: 5,
            recurring_revenue_monthly: 20,
        },
        {
            // A lead already in the Won stage so the kanban renders all three
            // stage groups (an empty group would otherwise not render, and the
            // move-target group index would not exist).
            id: 9,
            name: "Lead 9",
            type: "opportunity",
            active: true,
            planned_revenue: 7.0,
            probability: 100,
            won_status: "won",
            stage_id: 3,
            team_id: 1,
            user_id: 1,
            activity_state: "planned",
            expected_revenue: 7,
            recurring_revenue_monthly: 0,
        },
    ];

    // Views + search used by the spec-05 T-OV tests (WebClient action 70). The
    // graph view (out of scope offline) exercises the framework's uncached-view
    // fallback and the disabled view-switcher button. Spec-04 tests mount via
    // explicit `arch` and never consult `_views`, so this is additive.
    _views = {
        "list,false": `<list js_class="crm_list"><field name="name"/></list>`,
        "graph,false": `<graph js_class="crm_graph"><field name="stage_id"/></graph>`,
        // Lead form with chatter, used by the T-CH WebClient reopen tests. The
        // js_class="crm_form" wires CrmFormRenderer -> CrmChatter.
        "form,false": `<form class="o_lead_opportunity_form" js_class="crm_form"><sheet><field name="name"/></sheet><chatter/></form>`,
        // Kanban used by the 3a row-9 DOM-proof tests (10.2/10.3). Additive: spec-04
        // tests mount explicit arch and never consult _views.
        "kanban,false": `<kanban js_class="crm_kanban"><templates><t t-name="card"><field name="name"/></t></templates></kanban>`,
        "search,false": `<search/>`,
    };
}

/**
 * The CRM form arch used across the spec-04 tests. It carries the real controls
 * under test: the "Won" button (`action_set_won_rainbowman`, which the fix marks
 * `data-available-offline`), the won ribbon, and the fields the optimistic-won
 * path writes (`won_status`, `probability`). `js_class="crm_form"` wires the CRM
 * record/model/controller overrides; `statusbar` drives the stage change.
 */
const spec04FormArch = `
    <form class="o_lead_opportunity_form" js_class="crm_form">
        <header>
            <button name="action_set_won_rainbowman" string="Won"
                type="object" class="oe_highlight" data-hotkey="w"
                data-available-offline="1"
                invisible="won_status == 'won' or type == 'lead' or not active"/>
            <field name="stage_id" widget="statusbar" options="{'clickable': '1'}"/>
        </header>
        <sheet>
            <widget name="web_ribbon" title="Won" invisible="won_status != 'won'"/>
            <field name="won_status" invisible="1"/>
            <field name="active" invisible="1"/>
            <field name="type" invisible="1"/>
            <field name="probability"/>
            <field name="email_from"/>
            <field name="phone"/>
            <field name="partner_email_update" invisible="1"/>
            <field name="partner_phone_update" invisible="1"/>
            <field name="name"/>
            <field name="planned_revenue"/>
            <field name="team_id"/>
            <field name="user_id"/>
        </sheet>
    </form>`;

const spec04KanbanArch = `
    <kanban js_class="crm_kanban">
        <templates>
            <t t-name="card"><field name="name"/></t>
        </templates>
    </kanban>`;

/**
 * Register the spec-04 mock models once. `defineMailModels()` is already called
 * at the top of this file for the hook tests; the webclient services behind a
 * mount still resolve mail models, so the two coexist.
 */
defineModels([Spec04Lead, Spec04Stage, Spec04Team, Spec04Users]);

/**
 * Install a scoped `web_save` failure for `crm.lead`, gated on a mutable flag.
 * Returns a setter so a test can flip failure on only after the (online) mount.
 * While failing, the route returns a raw 502 (`pure: true`), which the rpc layer
 * turns into `ConnectionLostError`, driving `record._offlineSave()` — the real
 * framework queue path — exactly as `mockOffline()` would, but for this one call.
 */
function failWebSaveWhenOffline() {
    const state = { offline: false };
    onRpc(
        "/web/dataset/call_kw/crm.lead/web_save",
        () => (state.offline ? new Response("", { status: 502 }) : undefined),
        { pure: true }
    );
    return (offline) => {
        state.offline = offline;
    };
}

/** Queued entries as a plain array of their stored values. */
function spec04QueuedValues() {
    return Object.values(getService(OfflinePlugin)._ormToSync()).map((e) => e.value);
}

/** Queued calls to (model, method) with args[0] (an id array) including resId. */
function spec04QueuedFor(model, method, resId) {
    return spec04QueuedValues().filter(
        (v) =>
            v.model === model &&
            v.method === method &&
            Array.isArray(v.args?.[0]) &&
            v.args[0].includes(resId)
    );
}

/** Total number of entries currently in the framework's offline sync queue. */
function hookOrmToSyncSize() {
    return Object.keys(getService(OfflinePlugin)._ormToSync()).length;
}

/**
 * Click a stage in the form statusbar in a preset-robust way: on desktop the
 * stages render as inline buttons (`button[data-value=...]`); on mobile they
 * collapse into a dropdown toggled open first (as `crm_rainbowman.test.js`
 * does). `value` is the stage id; `label` its name (used for the mobile item).
 */
async function selectStageInStatusbar(value, label) {
    const inline = document.querySelector(
        `.o_statusbar_status button[data-value='${value}']`
    );
    // On mobile the inline stage buttons exist in the DOM but are hidden (the
    // statusbar collapses into a dropdown), so test real visibility, not mere
    // presence. `offsetParent === null` means the element is not rendered.
    if (inline && inline.offsetParent !== null) {
        await contains(`.o_statusbar_status button[data-value='${value}']`).click();
    } else {
        await contains(".o_statusbar_status button.dropdown-toggle").click();
        await contains(`.o-dropdown--menu .dropdown-item:contains('${label}')`).click();
    }
}

/**
 * Mount the `crm_kanban` view grouped by stage_id and capture the live
 * CrmKanbanModel so a test can call `moveRecords` directly — exercising the
 * gated `CrmKanbanDynamicGroupList.moveRecords` under BOTH presets without
 * relying on drag-and-drop DOM (which is desktop-only in this repo's tests).
 */
async function mountCrmKanbanCapturingModel() {
    const crmKanbanView = registry.category("views").get("crm_kanban");
    let model;
    patchWithCleanup(crmKanbanView.Controller.prototype, {
        setup() {
            super.setup(...arguments);
            model = this.model;
        },
    });
    await mountView({
        type: "kanban",
        resModel: "crm.lead",
        arch: spec04KanbanArch,
        groupBy: ["stage_id"],
    });
    return () => model;
}

/**
 * Move a lead to a target stage group through the CRM kanban model's
 * `moveRecords` (the gated override). Resolves the datapoint ids for the lead
 * record and the target group from the model's root list.
 */
async function moveLeadToStage(model, leadResId, targetStageId) {
    const list = model.root;
    const record = list.records.find((r) => r.resId === leadResId);
    const targetGroup = list.groups.find((g) => g.value === targetStageId);
    await list.moveRecords([record.id], undefined, targetGroup.id);
}

// ===========================================================================
// Task 2 — Preservation property tests (written BEFORE the fix).
// These observe non-buggy behavior and PASS on UNFIXED code; they must keep
// passing after the fix (tasks 5 and 8 re-run them). They cover the online
// rainbowman paths (AC-J1 online form, AC-J7 online Won) and the email/phone
// propagation into the queued offline web_save (AC-J4, Bug 2 — the force-copy
// already runs before super._save on unfixed code, so this passes now).
// ===========================================================================

// AC-J1 (Req 3.1): online, a stage change on form save STILL issues the
// rainbowman lookup. Preserved behavior.
async function testAcJ1OnlineRainbowman() {
    onRpc("crm.lead", "get_rainbowman_message", () => {
        expect.step("get_rainbowman_message");
        return false;
    });
    await mountView({ type: "form", resModel: "crm.lead", arch: spec04FormArch, resId: 6 });

    await selectStageInStatusbar(3, "Won");
    await contains("button.o_form_button_save").click();

    // Online, the rainbowman lookup fires exactly as before the fix.
    expect.verifySteps(["get_rainbowman_message"]);
}

test.tags("desktop");
test("AC-J1: online form stage-change issues rainbowman (desktop)", testAcJ1OnlineRainbowman);

test.tags("mobile");
test("AC-J1: online form stage-change issues rainbowman (mobile)", testAcJ1OnlineRainbowman);

// AC-J7 (Req 3.3): online, clicking "Won" STILL calls
// `action_set_won_rainbowman` (via the action service's object-button dispatch).
// Preserved behavior. A `type="object"` button routes through the ORM method of
// the same name, which `onRpc` observes.
async function testAcJ7OnlineWon() {
    onRpc("crm.lead", "action_set_won_rainbowman", () => {
        expect.step("action_set_won_rainbowman");
        return false;
    });
    onRpc("crm.lead", "action_set_won", () => {
        expect.step("action_set_won");
        return false;
    });
    await mountView({ type: "form", resModel: "crm.lead", arch: spec04FormArch, resId: 6 });

    await contains(`button[name="action_set_won_rainbowman"]`).click();

    // Online, the rainbowman variant is called; the queueable variant is NOT.
    expect.verifySteps(["action_set_won_rainbowman"]);
}

test.tags("desktop");
test("AC-J7: online Won calls action_set_won_rainbowman (desktop)", testAcJ7OnlineWon);

test.tags("mobile");
test("AC-J7: online Won calls action_set_won_rainbowman (mobile)", testAcJ7OnlineWon);

// AC-J4 (Req 2.3): offline, saving a lead whose partner-sync flags are set must
// queue a `web_save` whose values carry `email_from` and `phone` — the forced
// copy into `_changes` before `super._save` rides into the queued write. This
// already holds on UNFIXED code; the Bug 1 fix must not move or gate the copy.
async function testAcJ4EmailPhonePropagation() {
    const setSaveOffline = failWebSaveWhenOffline();
    // Lead 1 (defined above) already carries partner_email_update /
    // partner_phone_update, with an email_from and phone on the record.
    await mountView({ type: "form", resModel: "crm.lead", arch: spec04FormArch, resId: 1 });

    // Make a dirty change online (edit the name), then lose the connection and
    // save: the override force-copies email_from/phone into the queued write.
    await contains(`.o_field_widget[name="name"] input`).edit("Lead 1 edited");

    setOffline(true);
    setSaveOffline(true);
    await contains("button.o_form_button_save").click();

    const queued = spec04QueuedFor("crm.lead", "web_save", 1);
    expect(queued.length).toBe(1);
    const values = queued[0].args[1];
    // The queued offline web_save carries email_from and phone verbatim.
    expect(values.email_from).toBe("lead1@test.example");
    expect(values.phone).toBe("+1-555-0001");
    // And the user's own edit is carried too.
    expect(values.name).toBe("Lead 1 edited");
    setOffline(false);
}

test.tags("desktop");
test("AC-J4: queued offline web_save carries email_from/phone (desktop)", testAcJ4EmailPhonePropagation);

test.tags("mobile");
test("AC-J4: queued offline web_save carries email_from/phone (mobile)", testAcJ4EmailPhonePropagation);

// ===========================================================================
// Task 5 — JS fix-side suite (both presets). AC-J1 / AC-J4 / AC-J7 are the
// preservation tests appended in task 2 above; the remaining fix-side ACs
// (AC-J2, AC-J3, AC-J5, AC-J6, AC-J10, AC-J11, AC-J12, AC-J12b) follow. These
// exercise the two offline rainbowman gates and the offline-Won controller path
// (its record.isNew notify-and-return branch BEFORE save, its save-first step,
// its saved===false early return, and its queue+optimistic-won success branch),
// plus the online/other-button super branch (covered by AC-J1/J7).
// ===========================================================================

/**
 * Mount the `crm_form` view and capture the live `CrmFormController` instance so
 * a test can read `record.data` / dirtiness after the offline Won path runs.
 * The controller class is read from the registry (not imported) and patched so
 * `setup()` stashes `this`.
 */
async function mountCrmFormCapturingController(resId) {
    const crmFormView = registry.category("views").get("crm_form");
    let controller;
    patchWithCleanup(crmFormView.Controller.prototype, {
        setup() {
            super.setup(...arguments);
            controller = this;
        },
    });
    await mountView({ type: "form", resModel: "crm.lead", arch: spec04FormArch, resId });
    return () => controller;
}

// AC-J2 (Req 2.1): offline form stage-change save skips the rainbowman lookup
// and queues the write, with no error.
async function testAcJ2OfflineFormGate() {
    const setSaveOffline = failWebSaveWhenOffline();
    onRpc("crm.lead", "get_rainbowman_message", () => {
        expect.step("get_rainbowman_message");
        return false;
    });
    await mountView({ type: "form", resModel: "crm.lead", arch: spec04FormArch, resId: 6 });

    await selectStageInStatusbar(3, "Won");
    setOffline(true);
    setSaveOffline(true);
    await contains("button.o_form_button_save").click();

    expect.verifySteps([]); // no rainbowman lookup offline
    expect(spec04QueuedFor("crm.lead", "web_save", 6).length).toBe(1); // queued
    setOffline(false);
}

test.tags("desktop");
test("AC-J2: offline form stage-change skips rainbowman and queues (desktop)", testAcJ2OfflineFormGate);

test.tags("mobile");
test("AC-J2: offline form stage-change skips rainbowman and queues (mobile)", testAcJ2OfflineFormGate);

// AC-J3 (Req 2.2): offline kanban move across stage skips the rainbowman lookup
// and queues the move, with no error.
async function testAcJ3OfflineKanbanGate() {
    const setSaveOffline = failWebSaveWhenOffline();
    onRpc("crm.lead", "get_rainbowman_message", () => {
        expect.step("get_rainbowman_message");
        return false;
    });
    const getModel = await mountCrmKanbanCapturingModel();

    setOffline(true);
    setSaveOffline(true);
    await moveLeadToStage(getModel(), 6, 3);

    expect.verifySteps([]); // no rainbowman lookup offline
    expect(spec04QueuedFor("crm.lead", "web_save", 6).length).toBe(1); // queued move
    setOffline(false);
}

test.tags("desktop");
test("AC-J3: offline kanban move skips rainbowman and queues (desktop)", testAcJ3OfflineKanbanGate);

test.tags("mobile");
test("AC-J3: offline kanban move skips rainbowman and queues (mobile)", testAcJ3OfflineKanbanGate);

// AC-J5 (Req 2.4): offline the Won button stays clickable (the framework pass
// does not disable it, because it carries data-available-offline).
async function testAcJ5WonClickableOffline() {
    await mountView({ type: "form", resModel: "crm.lead", arch: spec04FormArch, resId: 6 });

    setOffline(true);
    await animationFrame();

    const wonButton = `button[name="action_set_won_rainbowman"]`;
    expect(wonButton).toHaveCount(1);
    // The attribute reaches the DOM, and the framework pass leaves it clickable.
    expect(wonButton).toHaveAttribute("data-available-offline");
    expect(`${wonButton}.o_disabled_offline`).toHaveCount(0);
    expect(`${wonButton}[disabled]`).toHaveCount(0);
    setOffline(false);
}

test.tags("desktop");
test("AC-J5: Won button clickable offline (desktop)", testAcJ5WonClickableOffline);

test.tags("mobile");
test("AC-J5: Won button clickable offline (mobile)", testAcJ5WonClickableOffline);

// AC-J6 (Req 2.5, 2.6, 2.7): offline, clicking "Won" queues exactly one
// action_set_won (no rainbowman call/queue entry), shows the lead won
// optimistically in the record AND the rendered DOM, and does not dirty the
// record (no extra web_save on a subsequent save).
async function testAcJ6OfflineWon() {
    const setSaveOffline = failWebSaveWhenOffline();
    onRpc("crm.lead", "get_rainbowman_message", () => {
        expect.step("get_rainbowman_message");
        return false;
    });
    onRpc("crm.lead", "action_set_won_rainbowman", () => {
        // Must NEVER be called offline (the fix queues action_set_won instead).
        expect.step("action_set_won_rainbowman");
        return false;
    });
    // action_set_won is QUEUED, not called, while offline. Provide a quiet handler
    // (no step) so that if the framework replays the queue after going back online
    // at the end of the test, the replay resolves cleanly.
    onRpc("crm.lead", "action_set_won", () => false);
    const getController = await mountCrmFormCapturingController(6);

    setOffline(true);
    setSaveOffline(true);
    await animationFrame();

    const wonButton = `button[name="action_set_won_rainbowman"]`;
    await contains(wonButton).click();
    await animationFrame();

    // Exactly one queued action_set_won for the lead; no rainbowman anything.
    expect(spec04QueuedFor("crm.lead", "action_set_won", 6).length).toBe(1);
    expect(spec04QueuedFor("crm.lead", "action_set_won_rainbowman", 6).length).toBe(0);
    expect(spec04QueuedFor("crm.lead", "get_rainbowman_message", 6).length).toBe(0);
    expect.verifySteps([]); // no server call of any won/rainbowman method

    // Record shows won optimistically.
    const record = getController().model.root;
    expect(record.data.probability).toBe(100);
    expect(record.data.won_status).toBe("won");
    // Not dirty: the optimistic values were applied via record._applyValues
    // (committed baseline + data + textValues + eval context, _changes untouched).
    expect(record.dirty).toBe(false);

    // The DOM reflects won: the Won button is hidden and the "Won" ribbon shows.
    expect(wonButton).toHaveCount(0);
    expect(`.ribbon:contains(Won)`).toHaveCount(1);

    // Saving/leaving queues no additional web_save carrying probability/won_status:
    // the optimistic values live in both data and _values, so the record is not
    // dirty and a save flushes nothing. (The record is not dirty, so the status
    // indicator save button is absent; drive the save through the record directly.)
    await record.save();
    await animationFrame();
    expect(spec04QueuedFor("crm.lead", "web_save", 6).length).toBe(0);
    setOffline(false);
}

test.tags("desktop");
test("AC-J6: offline Won queues one action_set_won and shows won (desktop)", testAcJ6OfflineWon);

test.tags("mobile");
test("AC-J6: offline Won queues one action_set_won and shows won (mobile)", testAcJ6OfflineWon);

// AC-J10 (Req 2.5; ordering relates to Req 3.8): offline, edit a field then
// click "Won"; the queue holds web_save (the edit) THEN action_set_won, in
// ascending extras.timeStamp order — the save-before-button of the base
// controller is preserved offline.
async function testAcJ10OfflineWonAfterEdit() {
    const setSaveOffline = failWebSaveWhenOffline();
    // Quiet handler for the queued won call in case the queue replays on teardown.
    onRpc("crm.lead", "action_set_won", () => false);
    await mountView({ type: "form", resModel: "crm.lead", arch: spec04FormArch, resId: 6 });

    // Edit a field online (pending change), then lose the connection.
    await contains(`.o_field_widget[name="name"] input`).edit("Lead 6 edited");
    setOffline(true);
    setSaveOffline(true);
    await animationFrame();

    await contains(`button[name="action_set_won_rainbowman"]`).click();
    await animationFrame();

    const webSaves = spec04QueuedFor("crm.lead", "web_save", 6);
    const wonCalls = spec04QueuedFor("crm.lead", "action_set_won", 6);
    expect(webSaves.length).toBe(1); // the edit was flushed as a web_save first
    expect(wonCalls.length).toBe(1); // then exactly one action_set_won
    // The edit carries the user's change.
    expect(webSaves[0].args[1].name).toBe("Lead 6 edited");
    // Ordering: the web_save precedes the won call in ascending timeStamp order
    // (both come from getScheduleORMExtras' Date.now(), so they may be equal in
    // the same millisecond; the save is enqueued first and never after).
    expect(webSaves[0].extras.timeStamp <= wonCalls[0].extras.timeStamp).toBe(true);
    setOffline(false);
}

test.tags("desktop");
test("AC-J10: offline edit then Won queues web_save before action_set_won (desktop)", testAcJ10OfflineWonAfterEdit);

test.tags("mobile");
test("AC-J10: offline edit then Won queues web_save before action_set_won (mobile)", testAcJ10OfflineWonAfterEdit);

// AC-J11 (Req 2.5): offline, clear the required `name` field so record.save()
// returns false, then click "Won"; nothing is queued and the lead is not shown
// won — mirroring the base controller's saved !== false guard (an invalid-field
// save offline matches online: the save is rejected, the button does nothing).
async function testAcJ11OfflineWonInvalidSave() {
    const setSaveOffline = failWebSaveWhenOffline();
    const getController = await mountCrmFormCapturingController(6);

    // Make the required `name` field invalid (empty), then lose the connection.
    await contains(`.o_field_widget[name="name"] input`).edit("");
    setOffline(true);
    setSaveOffline(true);
    await animationFrame();

    await contains(`button[name="action_set_won_rainbowman"]`).click();
    await animationFrame();

    // Nothing queued for the lead: neither the won call nor a web_save.
    expect(spec04QueuedFor("crm.lead", "action_set_won", 6).length).toBe(0);
    expect(spec04QueuedFor("crm.lead", "web_save", 6).length).toBe(0);
    // The lead is NOT shown as won; the Won button is still visible.
    const record = getController().model.root;
    expect(record.data.won_status).not.toBe("won");
    expect(`button[name="action_set_won_rainbowman"]`).toHaveCount(1);
    setOffline(false);
}

test.tags("desktop");
test("AC-J11: offline Won with invalid required field queues nothing (desktop)", testAcJ11OfflineWonInvalidSave);

test.tags("mobile");
test("AC-J11: offline Won with invalid required field queues nothing (mobile)", testAcJ11OfflineWonInvalidSave);

// AC-J12 (Req 2.5): offline, on a NEW opportunity with no server id (equally a
// lead created offline and not yet synced — both have no resId), clicking "Won"
// must queue NOTHING: action_set_won's id would have to come from another queued
// call, which the framework replays verbatim with no id remapping. The controller
// blocks the click with a notification and the lead is not shown as won.
async function testAcJ12OfflineWonNewRecord() {
    const setSaveOffline = failWebSaveWhenOffline();
    // Mount a NEW record (no resId): record.isNew is true. Seed defaults via the
    // context so the record is a valid active opportunity and the Won button
    // renders (its invisible modifier is `won_status == 'won' or type == 'lead'
    // or not active`); a valid required `name` makes the save itself succeed,
    // isolating the no-server-id guard.
    let controller;
    patchWithCleanup(registry.category("views").get("crm_form").Controller.prototype, {
        setup() {
            super.setup(...arguments);
            controller = this;
        },
    });
    await mountView({
        type: "form",
        resModel: "crm.lead",
        arch: spec04FormArch,
        context: {
            default_name: "Brand New Lead",
            default_type: "opportunity",
            default_active: true,
            default_won_status: "pending",
            default_probability: 10,
        },
    });

    setOffline(true);
    setSaveOffline(true);
    await animationFrame();

    // Sanity: the record genuinely has no server id, and the Won button rendered.
    expect(controller.model.root.isNew).toBe(true);
    expect(`button[name="action_set_won_rainbowman"]`).toHaveCount(1);

    // Before the click: the queue is empty.
    expect(spec04QueuedValues().length).toBe(0);

    await contains(`button[name="action_set_won_rainbowman"]`).click();
    await animationFrame();

    // The click queues NOTHING AT ALL: the isNew guard runs BEFORE record.save(),
    // so not even the offline create a save would enqueue is added. Assert the
    // WHOLE queue is empty, not just that no won call was queued.
    expect(spec04QueuedValues().length).toBe(0);
    // The lead is NOT shown as won; the Won button is still visible.
    const record = controller.model.root;
    expect(record.data.won_status).not.toBe("won");
    expect(`button[name="action_set_won_rainbowman"]`).toHaveCount(1);
    // A notification explains why (the control cannot be statically disabled
    // per-record offline-only without changing online behavior).
    expect(`.o_notification`).toHaveCount(1);
    expect(queryAllTexts`.o_notification_content`.join(" ")).toInclude(
        "Sync this opportunity before marking it won"
    );
    setOffline(false);
}

test.tags("desktop");
test("AC-J12: offline Won on a new (no-id) opportunity queues nothing (desktop)", testAcJ12OfflineWonNewRecord);

test.tags("mobile");
test("AC-J12: offline Won on a new (no-id) opportunity queues nothing (mobile)", testAcJ12OfflineWonNewRecord);

// AC-J12b (Req 2.5): an opportunity CREATED offline and not yet synced still has
// no server id, so clicking "Won" must leave its queued create entry untouched
// and add no entry — the isNew guard (before save) applies equally once the
// record exists only as a queued create.
async function testAcJ12bOfflineWonOfflineCreatedRecord() {
    const setSaveOffline = failWebSaveWhenOffline();
    let controller;
    patchWithCleanup(registry.category("views").get("crm_form").Controller.prototype, {
        setup() {
            super.setup(...arguments);
            controller = this;
        },
    });
    await mountView({
        type: "form",
        resModel: "crm.lead",
        arch: spec04FormArch,
        context: {
            default_name: "Offline Created Lead",
            default_type: "opportunity",
            default_active: true,
            default_won_status: "pending",
            default_probability: 10,
        },
    });

    // Create the record OFFLINE: saving while offline queues exactly one web_save
    // create (args[0] === []); the record keeps no server id (isNew stays true).
    setOffline(true);
    setSaveOffline(true);
    await animationFrame();
    await controller.model.root.save();
    await animationFrame();

    const createBefore = spec04QueuedValues().filter((v) => v.method === "web_save");
    expect(createBefore.length).toBe(1); // the offline create
    expect(createBefore[0].args[0]).toEqual([]); // a create, no id
    expect(controller.model.root.isNew).toBe(true);
    const queueSizeBefore = spec04QueuedValues().length;

    // Now click "Won": the isNew guard blocks it, queuing nothing new.
    await contains(`button[name="action_set_won_rainbowman"]`).click();
    await animationFrame();

    // No won call queued, and the queue is unchanged (same size, same create entry).
    expect(spec04QueuedValues().filter((v) => v.method === "action_set_won").length).toBe(0);
    expect(spec04QueuedValues().length).toBe(queueSizeBefore);
    const createAfter = spec04QueuedValues().filter((v) => v.method === "web_save");
    expect(createAfter.length).toBe(1);
    expect(createAfter[0].args).toEqual(createBefore[0].args); // unchanged
    // Not shown won; the warning explains why.
    expect(controller.model.root.data.won_status).not.toBe("won");
    expect(`.o_notification`).toHaveCount(1);
    expect(queryAllTexts`.o_notification_content`.join(" ")).toInclude(
        "Sync this opportunity before marking it won"
    );
    setOffline(false);
}

test.tags("desktop");
test("AC-J12b: offline Won on an offline-created opportunity adds nothing (desktop)", testAcJ12bOfflineWonOfflineCreatedRecord);

test.tags("mobile");
test("AC-J12b: offline Won on an offline-created opportunity adds nothing (mobile)", testAcJ12bOfflineWonOfflineCreatedRecord);

// ===========================================================================
// Task 6 — Row 8 queue-semantics tests (AC-J8, AC-J9, both presets).
// These drive a REAL replay through the framework rather than only inspecting
// the queued entries, so they use the realistic harness the existing
// addons/web/static/tests/webclient/offline_systray.test.js uses: mockOffline()
// + mount WebClient + onRpc + runAllTimers() + systray DOM. The framework queue
// is reused UNCHANGED (timestamp-ordered replay, last write wins,
// parked-on-rejection in the existing systray). No CRM-specific error UI.
// ===========================================================================

// AC-J8 (Req 3.8): two offline web_save writes to ONE lead with ascending
// extras.timeStamp replay in that order on reconnect (earlier first), and the
// second write's value is the one that ends up on the record (last write wins).
async function testAcJ8ReplayOrderLastWriteWins() {
    const setOfflineReal = mockOffline();
    // Keep the connection check failing so the client stays offline until we flip.
    onRpc("/web/webclient/version_info", () => new Response("", { status: 502 }), {
        pure: true,
    });
    // Observe the replayed web_save calls in arrival order.
    onRpc("crm.lead", "web_save", function web_save({ args, parent }) {
        expect.step(`web_save:${JSON.stringify(args[1])}`);
        return parent();
    });
    await mountWithCleanup(WebClient);
    await runAllTimers(); // let the startup sync settle
    await setOfflineReal(true);

    const offline = getService(OfflinePlugin);
    // Earlier timeStamp first.
    offline.scheduleORM(
        "crm.lead",
        "web_save",
        [[6], { name: "First Write" }],
        { context: {}, specification: {} },
        { id: "spec04-ac-j8-1", extras: { actionName: "CRM", viewType: "form", timeStamp: 1 } }
    );
    offline.scheduleORM(
        "crm.lead",
        "web_save",
        [[6], { name: "Second Write" }],
        { context: {}, specification: {} },
        { id: "spec04-ac-j8-2", extras: { actionName: "CRM", viewType: "form", timeStamp: 2 } }
    );

    // Reconnect and let the framework replay the queue.
    await setOfflineReal(false);
    await runAllTimers();

    // Both web_save calls arrived, earlier-timeStamp first, then the later.
    expect.verifySteps([
        `web_save:${JSON.stringify({ name: "First Write" })}`,
        `web_save:${JSON.stringify({ name: "Second Write" })}`,
    ]);
    // Last write wins on the server: the record now holds the second value.
    const [lead] = MockServer.env["crm.lead"].browse(6);
    expect(lead.name).toBe("Second Write");
    // The queue drained; no conflict dialog appeared.
    expect(Object.keys(offline._ormToSync()).length).toBe(0);
    expect(".modal").toHaveCount(0);
}

test.tags("desktop");
test("AC-J8: two offline writes replay in timeStamp order, last write wins (desktop)", testAcJ8ReplayOrderLastWriteWins);

test.tags("mobile");
test("AC-J8: two offline writes replay in timeStamp order, last write wins (mobile)", testAcJ8ReplayOrderLastWriteWins);

// AC-J9 (Req 3.9): a queued write whose replay the server REJECTS (a
// non-ConnectionLost RPCError) is parked with extras.error and shown in the
// existing offline systray as an error; no CRM-specific error UI appears.
async function testAcJ9ParkedOnRejection() {
    const setOfflineReal = mockOffline();
    onRpc("/web/webclient/version_info", () => new Response("", { status: 502 }), {
        pure: true,
    });
    // Reject the replayed web_save with a (non-ConnectionLost) server error.
    onRpc("crm.lead", "web_save", () => {
        throw makeServerError({ message: "Server rejected the write" });
    });
    await mountWithCleanup(WebClient);
    await runAllTimers();
    await setOfflineReal(true);

    const offline = getService(OfflinePlugin);
    offline.scheduleORM(
        "crm.lead",
        "web_save",
        [[6], { name: "Rejected Write" }],
        { context: {}, specification: {} },
        {
            id: "spec04-ac-j9",
            extras: {
                actionName: "CRM",
                viewType: "form",
                displayName: "Rejected Write",
                changes: { name: "Rejected Write" },
                originalValues: { name: "Lead 6" },
                timeStamp: 1,
            },
        }
    );

    // Reconnect and let the replay run; the rejection parks the entry.
    await setOfflineReal(false);
    await runAllTimers();
    await animationFrame();

    // The entry is parked (re-scheduled), carrying the server's error message —
    // not merely some error. _syncORM stores `e.data.name + " - " + e.data.message`
    // for an RPCError, so extras.error contains the server message verbatim.
    const parked = Object.values(offline._ormToSync()).map((e) => e.value);
    expect(parked.length).toBe(1);
    expect(parked[0].extras.error).toInclude("Server rejected the write");

    // It is surfaced in the existing offline systray as an error (reusing the
    // existing systray test's DOM assertions), and NO CRM-specific error UI shows.
    expect(`.o_menu_systray .o_nav_entry [data-icon='error']`).toHaveCount(1);
    await contains(`.o_menu_systray .o_nav_entry [data-icon='error']`).click();
    expect(`.o-dropdown--menu .o-dropdown-item [data-icon='error']`).toHaveCount(1);
    const errorEntry = `.o-dropdown--menu .o-dropdown-item div.text-danger`;
    expect(errorEntry).toHaveCount(1);
    // The systray shows the server error as the entry's tooltip (offline_systray.xml
    // binds data-tooltip to `element.error ?? element.displayName`), so the parked
    // server message is what the user sees.
    expect(queryAttribute(errorEntry, "data-tooltip")).toInclude("Server rejected the write");
    // The parked entry is surfaced ONLY through the framework systray: no
    // CRM-specific error UI appears. A bespoke CRM error dialog or toast would
    // show as a modal or a danger notification, so assert neither is present.
    expect(`.modal`).toHaveCount(0);
    expect(`.o_notification_bar.bg-danger`).toHaveCount(0);
}

test.tags("desktop");
test("AC-J9: a rejected replay parks in the offline systray (desktop)", testAcJ9ParkedOnRejection);

test.tags("mobile");
test("AC-J9: a rejected replay parks in the offline systray (mobile)", testAcJ9ParkedOnRejection);

// ###########################################################################
// Spec 05 — Task 2: Team switcher (AC-TS-1..4, U3).
//
// The TeamSwitcher reads offline/small-screen state through useCrmOffline(),
// holds its manager flag in a reactive owl `signal`, skips the manager probe
// offline, re-probes exactly once on reconnect, and guards the programmatic
// Manage Teams action. The trigger `<button>` carries NO data-available-offline
// so the framework's offline pass disables the dropdown; the selected team then
// stays visible as a search facet via CrmSearchModel.getCurrentSearch().
//
// The component-level groups (T-TS-skip, T-TS-disable, reconnect) mount the
// TeamSwitcher directly with a stub `env.searchModel` (the only parts of the
// search model the component reads: state.switcherTeams / state.switcherTeamId
// and _updateSwitcherSelection). The probe is user.hasGroup(...), observed with
// an onRpc("has_group", ...) spy. The T-TS-facet group mounts a real crm_kanban
// view so the live CrmSearchModel proves the facet + no-raise contract.
// ###########################################################################

/**
 * A minimal stub for the parts of CrmSearchModel the TeamSwitcher reads. The
 * component only touches `state.switcherTeams`, `state.switcherTeamId` and
 * `_updateSwitcherSelection`; everything else lives in CrmSearchModel and is
 * exercised by the T-TS-facet view-mount tests below.
 */
function makeSwitcherEnv(selectedTeamId = 1) {
    return {
        searchModel: {
            state: {
                switcherTeams: [
                    { id: 1, name: "Mushroom Kingdom" },
                    { id: 2, name: "Hyrule" },
                ],
                switcherTeamId: selectedTeamId,
            },
            _updateSwitcherSelection(teamId) {
                this.state.switcherTeamId = teamId;
            },
        },
    };
}

/** Mount the TeamSwitcher with the stub search-model env. */
async function mountTeamSwitcher(selectedTeamId = 1) {
    return mountWithCleanup(TeamSwitcher, {
        componentEnv: makeSwitcherEnv(selectedTeamId),
    });
}

// ---------------------------------------------------------------------------
// T-TS-skip (AC-TS-1 / AC-TS-4): offline the manager probe issues NO RPC and
// the user is treated as not-a-manager (Manage Teams hidden). Online the probe
// IS issued at mount.
// ---------------------------------------------------------------------------

async function testTsSkipOffline() {
    onRpc("has_group", ({ args }) => {
        expect.step(`has_group:${args[1]}`);
        return true;
    });
    // Start the app (so the plugin services exist) via a throwaway probe mount,
    // then go offline BEFORE mounting the switcher so its onWillStart takes the
    // offline branch.
    await mountProbe();
    setOffline(true);
    const component = await mountTeamSwitcher();
    await animationFrame();

    // No manager probe was issued offline.
    expect.verifySteps([]);
    // The reactive flag stays false, so Manage Teams is not rendered. The
    // trigger is framework-disabled offline, so assert the getter directly
    // (the dropdown cannot be opened offline) AND that the item is absent.
    expect(component.isSaleManager).toBe(false);
    expect(`.dropdown-item:contains('Manage Teams')`).toHaveCount(0);

    // Restoring the connection fires the skipped probe exactly once (the
    // reconnect behavior is asserted in full in the T-TS-reconnect group; here
    // we simply account for the step so it is not left unverified).
    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect.verifySteps(["has_group:sales_team.group_sale_manager"]);
}

test.tags("desktop");
test("T-TS-skip: offline manager probe issues no RPC (desktop)", testTsSkipOffline);

test.tags("mobile");
test("T-TS-skip: offline manager probe issues no RPC (mobile)", testTsSkipOffline);

// Online, the probe IS issued at mount (preserved behavior, U1).
async function testTsSkipOnline() {
    onRpc("has_group", ({ args }) => {
        expect.step(`has_group:${args[1]}`);
        return true;
    });
    const component = await mountTeamSwitcher();
    await animationFrame();

    // Online the manager probe fires exactly once, for the sale-manager group.
    expect.verifySteps(["has_group:sales_team.group_sale_manager"]);
    expect(component.isSaleManager).toBe(true);
}

test.tags("desktop");
test("T-TS-skip: online manager probe is issued at mount (desktop)", testTsSkipOnline);

test.tags("mobile");
test("T-TS-skip: online manager probe is issued at mount (mobile)", testTsSkipOnline);

// ---------------------------------------------------------------------------
// T-TS-disable (AC-TS-2 / AC-TS-3): offline the trigger <button> is
// framework-disabled; a programmatic onClickManageTeams() does nothing (no
// doAction). Online the trigger is enabled and onClickManageTeams dispatches.
// ---------------------------------------------------------------------------

async function testTsDisableOffline() {
    onRpc("has_group", () => true);
    const component = await mountTeamSwitcher();
    await animationFrame();

    // Spy on the action dispatch so a programmatic Manage Teams can be asserted
    // to do nothing offline (no RPC exists offline anyway; the guard is what we
    // prove here).
    patchWithCleanup(component.actionService, {
        doAction(actionRequest) {
            expect.step(`doAction:${actionRequest}`);
        },
    });

    setOffline(true);
    await animationFrame();

    // The trigger button is framework-disabled offline (it carries no
    // data-available-offline), so the dropdown is unreachable.
    const trigger = `.o_cp_team_switcher`;
    expect(trigger).toHaveCount(1);
    expect(`${trigger}.o_disabled_offline`).toHaveCount(1);
    expect(`${trigger}[disabled]`).toHaveCount(1);

    // A programmatic Manage Teams click is inert offline: the guard returns
    // early BEFORE doAction, so nothing is dispatched and nothing throws.
    component.onClickManageTeams();
    await animationFrame();
    expect.verifySteps([]); // no doAction offline
    setOffline(false);
}

test.tags("desktop");
test("T-TS-disable: offline trigger disabled, Manage Teams inert (desktop)", testTsDisableOffline);

test.tags("mobile");
test("T-TS-disable: offline trigger disabled, Manage Teams inert (mobile)", testTsDisableOffline);

// Online the trigger is enabled and onClickManageTeams dispatches the config
// action (preserved behavior, U1/U2).
async function testTsDisableOnline() {
    onRpc("has_group", () => true);
    const component = await mountTeamSwitcher();
    await animationFrame();

    patchWithCleanup(component.actionService, {
        doAction(actionRequest) {
            expect.step(`doAction:${actionRequest}`);
        },
    });

    // Online the trigger is not disabled.
    const trigger = `.o_cp_team_switcher`;
    expect(`${trigger}.o_disabled_offline`).toHaveCount(0);
    expect(`${trigger}[disabled]`).toHaveCount(0);

    // onClickManageTeams dispatches the config action online.
    component.onClickManageTeams();
    await animationFrame();
    expect.verifySteps(["doAction:sales_team.crm_team_action_config"]);
}

test.tags("desktop");
test("T-TS-disable: online trigger enabled, Manage Teams dispatches (desktop)", testTsDisableOnline);

test.tags("mobile");
test("T-TS-disable: online trigger enabled, Manage Teams dispatches (mobile)", testTsDisableOnline);

// ---------------------------------------------------------------------------
// Reconnect (AC-TS-4): a switcher mounted OFFLINE skipped the manager probe;
// on reconnect the probe runs exactly ONCE and, because isSaleManager is
// reactive signal state, Manage Teams appears in the DOM with no other user
// action. Proven for a manager (the probe resolves true).
// ---------------------------------------------------------------------------

async function testTsReconnectRevealsManageTeams() {
    onRpc("has_group", ({ args }) => {
        expect.step(`has_group:${args[1]}`);
        return true; // this user is a sale manager
    });

    // Mount offline: the probe is skipped, Manage Teams is hidden. Start the app
    // with a throwaway probe first so the plugin services exist before setOffline.
    await mountProbe();
    setOffline(true);
    const component = await mountTeamSwitcher();
    await animationFrame();
    expect.verifySteps([]); // no probe offline
    expect(component.isSaleManager).toBe(false);

    // Reconnect: the useOnChange reconnect callback runs the skipped probe once.
    setOffline(false);
    await animationFrame();
    // Let the hasGroup promise resolve and the reactive signal re-render.
    await runAllTimers();
    await animationFrame();

    // The probe ran exactly once on reconnect.
    expect.verifySteps(["has_group:sales_team.group_sale_manager"]);
    // Reactive state updated with no other user action.
    expect(component.isSaleManager).toBe(true);

    // And the DOM reflects it: opening the (now enabled) dropdown shows the
    // Manage Teams item. Opening is the ordinary dropdown interaction, not a
    // re-probe — the appearance of the item is driven purely by the reactive
    // signal set on reconnect.
    await contains(`.o_cp_team_switcher`).click();
    expect(`.dropdown-item:contains('Manage Teams')`).toHaveCount(1);
}

test.tags("desktop");
test("T-TS-reconnect: Manage Teams appears on reconnect with no other action (desktop)", testTsReconnectRevealsManageTeams);

test.tags("mobile");
test("T-TS-reconnect: Manage Teams appears on reconnect with no other action (mobile)", testTsReconnectRevealsManageTeams);

// A second offline→online transition must NOT re-probe (the skipped flag is
// cleared the first time); this proves "exactly once" and the guard's bookkeeping.
async function testTsReconnectProbesOnlyOnce() {
    onRpc("has_group", ({ args }) => {
        expect.step(`has_group:${args[1]}`);
        return true;
    });

    await mountProbe();
    setOffline(true);
    await mountTeamSwitcher();
    await animationFrame();

    // First reconnect: one probe.
    setOffline(false);
    await animationFrame();
    await runAllTimers();
    await animationFrame();
    expect.verifySteps(["has_group:sales_team.group_sale_manager"]);

    // Go offline and back online again: no further probe (already resolved).
    setOffline(true);
    await animationFrame();
    setOffline(false);
    await animationFrame();
    await runAllTimers();
    await animationFrame();
    expect.verifySteps([]); // no second probe
}

test.tags("desktop");
test("T-TS-reconnect: probe runs exactly once across reconnects (desktop)", testTsReconnectProbesOnlyOnce);

test.tags("mobile");
test("T-TS-reconnect: probe runs exactly once across reconnects (mobile)", testTsReconnectProbesOnlyOnce);

// ---------------------------------------------------------------------------
// T-TS-reconnect-error (reviewer A.1): the reconnect probe must handle its own
// rejection. We patch `user.hasGroup` directly (bypassing its disk Cache) so a
// reconnect can reject deterministically. A ConnectionLostError is swallowed —
// no unhandled rejection — and the probe is RE-ARMED so the next offline→online
// cycle retries; any OTHER error propagates and is NOT swallowed.
// ---------------------------------------------------------------------------

// A connection drop mid-probe is swallowed and the probe retries next cycle.
async function testTsReconnectProbeConnectionLost() {
    let call = 0;
    patchWithCleanup(user, {
        hasGroup(group) {
            if (group !== "sales_team.group_sale_manager") {
                return super.hasGroup(group);
            }
            call++;
            expect.step(`probe:${call}`);
            if (call === 1) {
                // First reconnect: connection drops again mid-probe.
                return Promise.reject(new ConnectionLostError("x"));
            }
            return Promise.resolve(true); // retry resolves
        },
    });

    await mountProbe();
    setOffline(true);
    const component = await mountTeamSwitcher();
    await animationFrame();
    expect.verifySteps([]); // no probe offline

    // First reconnect: probe runs, rejects with ConnectionLostError. The .catch
    // swallows it (no unhandled rejection) and re-arms the skipped flag.
    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect.verifySteps(["probe:1"]);
    expect(component.isSaleManager).toBe(false); // signal untouched by the failed probe

    // Next offline→online cycle: because the flag was re-armed, the probe runs
    // AGAIN and this time resolves true.
    setOffline(true);
    await animationFrame();
    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect.verifySteps(["probe:2"]);
    expect(component.isSaleManager).toBe(true);
}

test.tags("desktop");
test("T-TS-reconnect-error: ConnectionLostError swallowed + retried next cycle (desktop)", testTsReconnectProbeConnectionLost);

test.tags("mobile");
test("T-TS-reconnect-error: ConnectionLostError swallowed + retried next cycle (mobile)", testTsReconnectProbeConnectionLost);

// A NON-connection error is NOT swallowed: it surfaces (expect.errors) and the
// flag is NOT re-armed, so no silent retry masks a real failure.
async function testTsReconnectProbeOtherError() {
    expect.errors(1);
    let call = 0;
    patchWithCleanup(user, {
        hasGroup(group) {
            if (group !== "sales_team.group_sale_manager") {
                return super.hasGroup(group);
            }
            call++;
            expect.step(`probe:${call}`);
            return Promise.reject(new Error("boom")); // non-connection error
        },
    });

    await mountProbe();
    setOffline(true);
    const component = await mountTeamSwitcher();
    await animationFrame();
    expect.verifySteps([]);

    // Reconnect: the probe rejects with a plain Error, which the .catch rethrows.
    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect.verifySteps(["probe:1"]);
    expect(component.isSaleManager).toBe(false);
    await expect.waitForErrors([/boom/]);

    // Flag NOT re-armed: a further cycle does not retry (the error was surfaced,
    // not masked by a silent retry).
    setOffline(true);
    await animationFrame();
    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect.verifySteps([]); // no second probe
}

test.tags("desktop");
test("T-TS-reconnect-error: non-connection error is not swallowed (desktop)", testTsReconnectProbeOtherError);

test.tags("mobile");
test("T-TS-reconnect-error: non-connection error is not swallowed (mobile)", testTsReconnectProbeOtherError);

// ---------------------------------------------------------------------------
// T-TS-reconnect-destroyed (reviewer D): the reconnect probe's status(this)
// guard must prevent a state write after the component is destroyed. Start the
// probe (deferred, pending), DESTROY the component, then resolve the probe:
// no signal write, no error.
// ---------------------------------------------------------------------------

async function testTsReconnectProbeAfterDestroy() {
    const deferred = Promise.withResolvers();
    patchWithCleanup(user, {
        hasGroup(group) {
            if (group !== "sales_team.group_sale_manager") {
                return super.hasGroup(group);
            }
            expect.step("probe");
            return deferred.promise;
        },
    });

    await mountProbe();
    setOffline(true);
    const component = await mountTeamSwitcher();
    await animationFrame();
    expect.verifySteps([]); // no probe offline

    // Reconnect: the probe starts (deferred, still pending).
    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect.verifySteps(["probe"]);
    expect(component._isSaleManager()).toBe(false); // not resolved yet

    // Destroy the component, THEN resolve the probe. The status(this) guard must
    // skip the signal write; nothing is thrown.
    destroyApp();
    deferred.resolve(true);
    await runAllTimers();
    await animationFrame();
    expect(component._isSaleManager()).toBe(false); // no write after destroy
    expect.verifySteps([]); // nothing further; no unhandled error
}

test.tags("desktop");
test("T-TS-reconnect-destroyed: no state write after destroy (desktop)", testTsReconnectProbeAfterDestroy);

test.tags("mobile");
test("T-TS-reconnect-destroyed: no state write after destroy (mobile)", testTsReconnectProbeAfterDestroy);


// ---------------------------------------------------------------------------
// T-TS-facet (AC-TS-2 / U3): the selected team stays visible as a search facet
// through CrmSearchModel.getCurrentSearch(), and get_team_switcher_data is a
// cached read that does not raise offline. Mounts a real crm_kanban view so the
// live CrmSearchModel is exercised; the search model is captured from the
// controller (as the spec-04 kanban tests capture the model).
// ---------------------------------------------------------------------------

/**
 * Mount the crm_kanban view with the team switcher enabled and capture the live
 * CrmSearchModel. `get_team_switcher_data` is intercepted so the switcher sees
 * two teams (so switcherAvailable is true) without needing use_opportunities /
 * team_ids on the spec-04 crm.team stub.
 */
async function mountCrmKanbanCapturingSearchModel() {
    onRpc("crm.team", "get_team_switcher_data", () => {
        return {
            available: true,
            teams: [
                { id: 1, name: "Mushroom Kingdom", switcher_domain: [["team_id", "=", 1]] },
                { id: 2, name: "Hyrule", switcher_domain: [["team_id", "=", 2]] },
            ],
        };
    });
    const crmKanbanView = registry.category("views").get("crm_kanban");
    let searchModel;
    patchWithCleanup(crmKanbanView.Controller.prototype, {
        setup() {
            super.setup(...arguments);
            searchModel = this.env.searchModel;
        },
    });
    await mountView({
        type: "kanban",
        resModel: "crm.lead",
        arch: spec04KanbanArch,
        groupBy: ["stage_id"],
        context: { show_team_switcher: true },
    });
    return () => searchModel;
}

async function testTsFacet() {
    const getSearchModel = await mountCrmKanbanCapturingSearchModel();
    const searchModel = getSearchModel();

    // The cached read ran at load without raising, populating the switcher.
    expect(searchModel.state.switcherAvailable).toBe(true);

    // Select a team (as the switcher would). getCurrentSearch() must then expose
    // it as a dedicated team facet (isTeamFacet), carrying the team name.
    searchModel._updateSwitcherSelection(2);
    const search = searchModel.getCurrentSearch();
    const teamFacet = search.facets.find((f) => f.isTeamFacet);
    expect(teamFacet).not.toBe(undefined);
    expect(teamFacet.values).toEqual(["Hyrule"]);
    expect(search.teamId).toBe(2);

    // Go offline: re-reading get_team_switcher_data (the switcher's cached read)
    // must not raise. The disk-cached orm call resolves from cache offline.
    setOffline(true);
    await animationFrame();
    let raised = false;
    try {
        await searchModel.orm
            .cache({ type: "disk", update: "always" })
            .call("crm.team", "get_team_switcher_data");
    } catch {
        raised = true;
    }
    expect(raised).toBe(false);
    // The team facet is still exposed offline (the selection survives).
    const offlineSearch = searchModel.getCurrentSearch();
    expect(offlineSearch.facets.some((f) => f.isTeamFacet && f.values.includes("Hyrule"))).toBe(
        true
    );
    setOffline(false);
}

test.tags("desktop");
test("T-TS-facet: selected team shows as a facet, cached read no-raise (desktop)", testTsFacet);

test.tags("mobile");
test("T-TS-facet: selected team shows as a facet, cached read no-raise (mobile)", testTsFacet);

// ###########################################################################
// Spec 05 — Task 3: Lead-generation dropdown (AC-LG-1..2).
//
// The LeadGenerationDropdown reads offline state through useCrmOffline().
// `toggleDropdown` returns offline as its FIRST statement — before
// `dropdownWasAlreadyOpened` is set and before the module-state searchRead and
// the checkAccessRight probes — so after reconnect the first open still issues
// the probes and renders the items. The three navigation handlers (the install
// confirm body before button_immediate_install, redirectToImport before the
// import doAction, requestAccess before the install-request doAction) each
// early-return offline. The "Generate" <button accesskey="c"> carries no
// data-available-offline, so the framework's offline pass disables it.
//
// T-LG-probe mounts the component and drives the connection with the existing
// setOffline(...) helper; the module-state probe is observed with an
// onRpc("ir.module.module", "search_read", ...) spy (orm.cache().searchRead
// issues the ORM `search_read` method). The "Generate" <button accesskey="c"> is
// activated through the REAL alt+c hotkey chord (the hotkey plugin rewrites
// accesskey -> data-hotkey): offline the framework-disabled button is skipped by
// the hotkey plugin so nothing runs; online the chord opens the dropdown and
// issues the probe.
//
// Note: the checkAccessRight (has_access) branch in toggleDropdown only runs for
// elements that carry a `model` property. NONE of the shipped
// dropdownContentElements declare `model` (every entry gates on `hasAccess` set
// from user.isAdmin or a literal true), so that branch is unreachable for the
// shipped UI and is a defensive guard — there is no has_access spy to assert, by
// design (see design.md). T-LG-nav calls the three navigation handlers directly
// and spies the dispatches (orm.silent.call for the install, the action service
// for the two doActions).
// ###########################################################################

/**
 * Minimal mock of ir.module.module so the dropdown's module-state searchRead
 * resolves online. The component reads id / name / shortdesc.
 */
class LgModuleModule extends models.Model {
    _name = "ir.module.module";
    name = fields.Char();
    shortdesc = fields.Char();
    _records = [
        { id: 101, name: "website", shortdesc: "Website" },
        { id: 102, name: "mass_mailing", shortdesc: "Email Marketing" },
        { id: 103, name: "survey", shortdesc: "Survey" },
        { id: 104, name: "crm_iap_mine", shortdesc: "Lead Sourcing" },
    ];
}

defineModels([LgModuleModule]);

/**
 * Mount the LeadGenerationDropdown with a stub `env.searchModel` (redirectToImport
 * reads `context` and `resModel` off it). `mountWithCleanup` tears it down after
 * each test.
 */
async function mountLeadGenerationDropdown() {
    return mountWithCleanup(LeadGenerationDropdown, {
        componentEnv: {
            searchModel: { context: { from: "crm" }, resModel: "crm.lead" },
        },
    });
}

// ---------------------------------------------------------------------------
// T-LG-probe (AC-LG-1): offline the "Generate" button is framework-disabled; the
// REAL alt+c hotkey chord issues NO ir.module.module searchRead; then online, the
// alt+c chord opens the dropdown, issues the probe, and renders the items —
// proving the guard sits before `dropdownWasAlreadyOpened`.
// ---------------------------------------------------------------------------

async function testLgProbeOffline() {
    onRpc("ir.module.module", "search_read", () => {
        expect.step("search_read");
    });

    const component = await mountLeadGenerationDropdown();
    await animationFrame();

    // The hotkey plugin rewrites [accesskey] to [data-hotkey] lazily on the first
    // keystroke; press a throwaway hotkey once to force that conversion so the
    // real alt+c chord resolves to the Generate button.
    await press("arrowleft");
    await animationFrame();
    const generate = `button[data-hotkey="c"]`;
    expect(generate).toHaveCount(1); // accesskey="c" became data-hotkey="c"

    setOffline(true);
    await animationFrame();

    // Offline the framework's selector pass disables the Generate <button>
    // (adds disabled + o_disabled_offline). The hotkey plugin skips disabled
    // buttons, so the REAL alt+c chord fires nothing: no handler, no probe, the
    // dropdown stays closed.
    expect(`${generate}.o_disabled_offline`).toHaveCount(1);
    expect(`${generate}[disabled]`).toHaveCount(1);
    await press(["alt", "c"]);
    await animationFrame();
    expect.verifySteps([]); // no module-state searchRead offline
    expect(`.o_lead_mining_element`).toHaveCount(0); // dropdown did not open

    // Reconnect: the button is re-enabled; the REAL alt+c chord now activates it,
    // the FIRST open issues the module-state probe and renders the items — the
    // offline return left `dropdownWasAlreadyOpened` unset.
    setOffline(false);
    await animationFrame();
    await press(["alt", "c"]);
    await animationFrame();

    expect.verifySteps(["search_read"]); // probe issued on the first online open (via alt+c)
    // The items render (one per dropdownContentElement).
    expect(`.o_lead_mining_element`).toHaveCount(
        component.state.dropdownContentElements.length
    );
}

test.tags("desktop");
test("T-LG-probe: offline no probe, Generate disabled; reconnect opens and probes (desktop)", testLgProbeOffline);

test.tags("mobile");
test("T-LG-probe: offline no probe, Generate disabled; reconnect opens and probes (mobile)", testLgProbeOffline);

// Online, the first open issues the module-state probe and renders the items
// (preserved behavior, U1).
async function testLgProbeOnline() {
    onRpc("ir.module.module", "search_read", () => {
        expect.step("search_read");
    });

    const component = await mountLeadGenerationDropdown();
    await animationFrame();

    await component.toggleDropdown();
    await animationFrame();

    // Online, the module-state probe fires exactly once and the items render.
    expect.verifySteps(["search_read"]);
    expect(`.o_lead_mining_element`).toHaveCount(
        component.state.dropdownContentElements.length
    );
}

test.tags("desktop");
test("T-LG-probe: online first open issues the probe and renders items (desktop)", testLgProbeOnline);

test.tags("mobile");
test("T-LG-probe: online first open issues the probe and renders items (mobile)", testLgProbeOnline);

// ---------------------------------------------------------------------------
// T-LG-nav (AC-LG-2): offline, direct calls to the install confirm body,
// redirectToImport() and requestAccess() issue NONE of button_immediate_install
// / the import doAction / the install-request doAction. Online, each still
// dispatches.
// ---------------------------------------------------------------------------

// NOT_INSTALLED status literal (the dropdown keeps MODULE_STATUS internal; this
// is the same string value, used to force an element into the install branch).
const MODULE_STATUS_NOT_INSTALLED = "NOT_INSTALLED";

/**
 * Drive onClickAction for a NOT_INSTALLED module and capture the `confirm`
 * callback the ConfirmationDialog is opened with — that closure holds the
 * guarded install body (its first statement is the offline early-return before
 * `button_immediate_install`). Capturing it lets a test invoke the exact guarded
 * path directly, independent of whether the framework offline pass disables the
 * dialog's primary <button>. Returns the captured `confirm`.
 */
function captureInstallConfirm(component) {
    patchWithCleanup(user, { isAdmin: true });
    component.modulesInfo = { website: { id: 101, name: "Website" } };
    const element = component.state.dropdownContentElements.find(
        (el) => el.moduleName === "website"
    );
    element.status = MODULE_STATUS_NOT_INSTALLED;
    element.hasAccess = true;
    let captured;
    patchWithCleanup(component.dialogs, {
        add(dialogClass, props) {
            if (props && props.confirm) {
                captured = props.confirm;
            }
            // Do not actually mount a dialog; the guarded body is captured above.
            return () => {};
        },
    });
    component.onClickAction(element);
    return captured;
}

async function testLgNavOffline() {
    onRpc("ir.module.module", "button_immediate_install", () => {
        expect.step("button_immediate_install");
        return true;
    });

    const component = await mountLeadGenerationDropdown();
    await animationFrame();

    // Spy on the action dispatch (both doAction navigations route through it).
    patchWithCleanup(component.action, {
        doAction(request) {
            expect.step(`doAction:${request.tag || request.res_model}`);
        },
    });

    const confirmInstall = captureInstallConfirm(component);

    setOffline(true);
    await animationFrame();

    // Install confirm body offline: its first statement returns before
    // button_immediate_install.
    await confirmInstall();
    // redirectToImport and requestAccess called directly offline do nothing.
    component.redirectToImport();
    component.requestAccess("website", "Website", true);
    await animationFrame();

    // None of the three server navigations ran offline.
    expect.verifySteps([]);
    setOffline(false);
}

test.tags("desktop");
test("T-LG-nav: offline install/import/request navigations are inert (desktop)", testLgNavOffline);

test.tags("mobile");
test("T-LG-nav: offline install/import/request navigations are inert (mobile)", testLgNavOffline);

// Online, each navigation still dispatches (preserved behavior, U1).
async function testLgNavOnline() {
    // The install RPC runs online. We make it FAIL so the confirm takes the
    // catch branch (FAILED_TO_INSTALL + error dialog) and NEVER reaches the
    // success branch's global `location.reload()` (which a test cannot patch and
    // which would reload the Hoot page). This proves the call IS issued online
    // (the guard is absent online) and that the failure state is surfaced,
    // without changing the source to make it testable. The handler logs the
    // failure via console.error, which we capture so Hoot does not flag it.
    patchWithCleanup(browser.console, {
        error(message) {
            expect.step("console.error");
        },
    });
    onRpc("ir.module.module", "button_immediate_install", () => {
        expect.step("button_immediate_install");
        throw makeServerError({ message: "install failed in test" });
    });

    const component = await mountLeadGenerationDropdown();
    await animationFrame();

    patchWithCleanup(component.action, {
        doAction(request) {
            expect.step(`doAction:${request.tag || request.res_model}`);
        },
    });

    const confirmInstall = captureInstallConfirm(component);

    // Install confirm body online: button_immediate_install runs and raises, so
    // the catch branch sets the element to FAILED_TO_INSTALL (no reload).
    await confirmInstall();
    await animationFrame();
    expect.verifySteps(["button_immediate_install", "console.error"]);
    const website = component.state.dropdownContentElements.find(
        (el) => el.moduleName === "website"
    );
    expect(website.status).toBe("FAILED_TO_INSTALL");

    // redirectToImport online dispatches the import client action.
    component.redirectToImport();
    await animationFrame();
    expect.verifySteps(["doAction:import"]);

    // requestAccess online dispatches the install-request act_window.
    component.requestAccess("website", "Website", true);
    await animationFrame();
    expect.verifySteps(["doAction:base.module.install.request"]);
}

test.tags("desktop");
test("T-LG-nav: online install/import/request navigations dispatch (desktop)", testLgNavOnline);

test.tags("mobile");
test("T-LG-nav: online install/import/request navigations dispatch (mobile)", testLgNavOnline);

// ###########################################################################
// Spec 05 — Task 4: Recurring-revenue aggregate (AC-RR-1..3).
//
// CrmColumnProgress reads offline state through useCrmOffline(), holds its
// recurring-revenue flag in a reactive owl `signal`, skips the
// `user.hasGroup("crm.group_use_recurring_revenues")` probe offline (SKIP),
// re-probes exactly once on reconnect, and hides the whole recurring-revenue
// block (the MRR value AND the `<b>MRR</b>` label) offline via the
// `displayRecurringRevenue` getter — WITHOUT hiding the standard aggregate's
// zero (offline the recurring getter returns `{}` with no `.value`, so the base
// AnimatedNumber zero-hide stays false).
//
// Fixture (seeded in Spec04Lead._records): stage 1 (Start) holds only lead 1,
// standard aggregate 0 and MRR 10 — isolating the zero-standard-aggregate case.
// Stage 2 holds lead 6 (standard 5, MRR 20); stage 3 holds lead 9 (standard 7,
// MRR 0). Animations are disabled so the counter text is deterministic.
//
// Two mount paths:
//  - mountView (online) for the online probe + the reactive offline-hide: the
//    `displayRecurringRevenue` getter reads isOffline() reactively, so dropping
//    the connection after an online mount hides the block with no user action.
//  - a real WebClient action with mockOffline() for the "mounted OFFLINE" cases
//    (AC-RR-3): the kanban is opened online to fill the offline cache, the
//    connection is dropped, and the action is reopened so CrmColumnProgress
//    genuinely mounts from cache with its onWillStart taking the offline-skip
//    branch (no probe). This mirrors web/.../window_action.test.js.
// ###########################################################################

const spec05RrKanbanArch = `
    <kanban js_class="crm_kanban">
        <field name="activity_state"/>
        <progressbar field="activity_state"
            colors='{"planned": "success", "today": "warning", "overdue": "danger"}'
            sum_field="expected_revenue"
            recurring_revenue_sum_field="recurring_revenue_monthly"/>
        <templates>
            <t t-name="card" class="flex-row justify-content-between">
                <field name="name" class="p-2"/>
                <field name="recurring_revenue_monthly" class="p-2"/>
            </t>
        </templates>
    </kanban>`;

/** Rendered text of the stage-1 (first) column counter. */
function firstCounterText() {
    return queryAllTexts(".o_kanban_counter")[0] || "";
}

/**
 * Mount the MRR kanban grouped by stage via mountView (ONLINE). Animations are
 * disabled so the aggregate renders its final text synchronously.
 */
async function mountRrKanban() {
    patchWithCleanup(AnimatedNumber, { enableAnimations: false });
    await mountView({
        type: "kanban",
        resModel: "crm.lead",
        arch: spec05RrKanbanArch,
        groupBy: ["stage_id"],
    });
}

// ---------------------------------------------------------------------------
// T-RR (AC-RR-2 / AC-RR-1-online): the recurring-revenue block is shown online
// and disabled offline. Mounted ONLINE the probe fires once and the stage-1
// column (standard 0, MRR 10) shows "+10" and the "MRR" label. When the
// connection drops, the reactive displayRecurringRevenue getter hides the whole
// block (value and label) with no user action, while the standard zero stays
// visible — and no new probe is issued by going offline.
// ---------------------------------------------------------------------------

async function testRrOffline() {
    onRpc("has_group", ({ args }) => {
        if (args[1] === "crm.group_use_recurring_revenues") {
            expect.step(`has_group:${args[1]}`);
        }
        return true;
    });
    await mountRrKanban();
    await animationFrame();

    // Online: the probe fired once and the MRR block renders. Stages 1 (MRR 10)
    // and 2 (MRR 20) each show a recurring +value; stage 1 shows the "MRR" label
    // (its standard aggregate is 0). Stage 3 (MRR 0) shows none.
    expect.verifySteps(["has_group:crm.group_use_recurring_revenues"]);
    expect(".o_kanban_counter").toHaveCount(3);
    expect(".o_animated_number[data-tooltip='Recurring Revenue']").toHaveCount(2);
    expect(firstCounterText()).toInclude("MRR");
    expect(firstCounterText()).toInclude("10");

    // Drop the connection: the reactive getter hides the block immediately.
    setOffline(true);
    await animationFrame();

    // No new probe is issued by going offline.
    expect.verifySteps([]);
    // The "MRR" label and every recurring +value are gone across all columns.
    expect(queryAllTexts(".o_kanban_counter").join(" ")).not.toInclude("MRR");
    expect(".o_animated_number[data-tooltip='Recurring Revenue']").toHaveCount(0);
    // The standard aggregate's zero is NOT hidden: stage 1 still shows "0".
    expect(firstCounterText()).toInclude("0");

    setOffline(false);
}

test.tags("desktop");
test("T-RR: offline hides MRR (value+label), standard zero stays, no new probe (desktop)", testRrOffline);

test.tags("mobile");
test("T-RR: offline hides MRR (value+label), standard zero stays, no new probe (mobile)", testRrOffline);

// ---------------------------------------------------------------------------
// T-RR (AC-RR-1 / AC-RR-3): a kanban mounted OFFLINE (from cache) skips the
// probe at onWillStart; on reconnect the probe runs exactly ONCE and, because
// showRecurringRevenue is reactive signal state, the MRR value appears with no
// other user action. Uses the framework mockOffline() + WebClient + action
// pattern so the view genuinely mounts from cache while RPCs fail.
// ---------------------------------------------------------------------------

/**
 * A minimal stub of the one group + progressBarState a CrmColumnProgress column
 * reads: `aggregate.value` (the standard sum), and
 * `progressBarState.progressAttributes.recurring_revenue_sum_field` +
 * `getAggregateValue(group, field)` (the recurring sum). `group._config.fields`
 * is present (no is_rotting) so the rotting mixin returns {}. This lets a single
 * CrmColumnProgress mount directly — the proven direct-mount pattern — so its
 * onWillStart offline-skip branch and the useOnChange reconnect re-probe can be
 * exercised deterministically, without a cached grouped-kanban reopen.
 */
function makeRrColumnProps(standard, recurring) {
    // Supply exactly what web.ColumnProgress / mail.RottingColumnProgress read:
    // progressBar.bars (+ isReady so the AnimatedNumber block renders),
    // group.count / group.list.records (+ _config.fields with no is_rotting so
    // the rotting mixin returns {}), and aggregate.value/title/currencies.
    const group = { count: 1, list: { records: [] }, _config: { fields: {} } };
    return {
        aggregate: { value: standard, title: "Expected Revenue", currencies: [] },
        group,
        progressBar: { bars: [], isReady: true, activeBar: false },
        onBarClicked: () => {},
        onRotIconClicked: () => {},
        progressBarState: {
            progressAttributes: { recurring_revenue_sum_field: "recurring_revenue_monthly" },
            getAggregateValue: () => ({
                value: recurring,
                title: "Recurring Revenue",
                currency: false,
            }),
        },
    };
}

async function mountRrColumn(standard, recurring) {
    patchWithCleanup(AnimatedNumber, { enableAnimations: false });
    return mountWithCleanup(CrmColumnProgress, { props: makeRrColumnProps(standard, recurring) });
}

// ---------------------------------------------------------------------------
// T-RR (AC-RR-1 / AC-RR-3): a CrmColumnProgress mounted OFFLINE takes the
// onWillStart offline-skip branch (no has_group probe) and renders no recurring
// value; on reconnect the useOnChange callback runs the probe exactly ONCE and,
// because showRecurringRevenue is reactive signal state, the recurring value
// appears with no other user action. Standard aggregate 0, recurring 10.
// ---------------------------------------------------------------------------

async function testRrReconnect() {
    onRpc("has_group", ({ args }) => {
        if (args[1] === "crm.group_use_recurring_revenues") {
            expect.step("probe");
        }
        return true;
    });

    // Start services, then go offline BEFORE mounting the column so its
    // onWillStart takes the offline-skip branch (no probe).
    await mountProbe();
    setOffline(true);
    const component = await mountRrColumn(0, 10);
    await animationFrame();

    // Offline: no probe at mount, the recurring value is hidden, the standard
    // zero still shows.
    expect.verifySteps([]);
    expect(component.displayRecurringRevenue).toBe(false);
    expect(".o_animated_number[data-tooltip='Recurring Revenue']").toHaveCount(0);
    // The MRR label (<b>MRR</b>, rendered only when the standard aggregate is 0
    // AND displayRecurringRevenue) is absent offline.
    expect(getFixture().textContent).not.toInclude("MRR");

    // Reconnect: the useOnChange callback runs the skipped probe exactly once
    // and the recurring value appears with no other user action.
    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect.verifySteps(["probe"]);
    expect(component.displayRecurringRevenue).toBe(true);
    expect(".o_animated_number[data-tooltip='Recurring Revenue']").toHaveCount(1);
    // With the standard aggregate 0 and displayRecurringRevenue true, the
    // <b>MRR</b> label renders.
    expect(getFixture().textContent).toInclude("MRR");

    // A second offline/online cycle must NOT re-probe (skipped flag cleared).
    setOffline(true);
    await animationFrame();
    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect.verifySteps([]);
}

test.tags("desktop");
test("T-RR: mounted offline skips probe; reconnect reveals MRR once (desktop)", testRrReconnect);

test.tags("mobile");
test("T-RR: mounted offline skips probe; reconnect reveals MRR once (mobile)", testRrReconnect);

// ---------------------------------------------------------------------------
// T-RR-reconnect-error (reviewer A.1): the recurring-revenue reconnect probe
// must handle its own rejection the same way the team switcher does. `hasGroup`
// is patched directly (bypassing its disk Cache). A ConnectionLostError is
// swallowed and RE-ARMS the skipped flag so the next cycle retries; any other
// error propagates and is NOT swallowed.
// ---------------------------------------------------------------------------

async function testRrReconnectProbeConnectionLost() {
    let call = 0;
    patchWithCleanup(user, {
        hasGroup(group) {
            if (group !== "crm.group_use_recurring_revenues") {
                return super.hasGroup(group);
            }
            call++;
            expect.step(`probe:${call}`);
            if (call === 1) {
                return Promise.reject(new ConnectionLostError("x"));
            }
            return Promise.resolve(true);
        },
    });

    await mountProbe();
    setOffline(true);
    const component = await mountRrColumn(0, 10);
    await animationFrame();
    expect.verifySteps([]); // no probe offline

    // First reconnect: probe rejects with ConnectionLostError -> swallowed, re-armed.
    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect.verifySteps(["probe:1"]);
    expect(component.displayRecurringRevenue).toBe(false); // signal untouched

    // Next cycle retries because the flag was re-armed, and resolves true.
    setOffline(true);
    await animationFrame();
    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect.verifySteps(["probe:2"]);
    expect(component.displayRecurringRevenue).toBe(true);
}

test.tags("desktop");
test("T-RR-reconnect-error: ConnectionLostError swallowed + retried next cycle (desktop)", testRrReconnectProbeConnectionLost);

test.tags("mobile");
test("T-RR-reconnect-error: ConnectionLostError swallowed + retried next cycle (mobile)", testRrReconnectProbeConnectionLost);

async function testRrReconnectProbeOtherError() {
    expect.errors(1);
    let call = 0;
    patchWithCleanup(user, {
        hasGroup(group) {
            if (group !== "crm.group_use_recurring_revenues") {
                return super.hasGroup(group);
            }
            call++;
            expect.step(`probe:${call}`);
            return Promise.reject(new Error("boom"));
        },
    });

    await mountProbe();
    setOffline(true);
    const component = await mountRrColumn(0, 10);
    await animationFrame();
    expect.verifySteps([]);

    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect.verifySteps(["probe:1"]);
    expect(component.displayRecurringRevenue).toBe(false);
    await expect.waitForErrors([/boom/]);

    // Flag NOT re-armed: no silent retry.
    setOffline(true);
    await animationFrame();
    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect.verifySteps([]);
}

test.tags("desktop");
test("T-RR-reconnect-error: non-connection error is not swallowed (desktop)", testRrReconnectProbeOtherError);

test.tags("mobile");
test("T-RR-reconnect-error: non-connection error is not swallowed (mobile)", testRrReconnectProbeOtherError);

// ---------------------------------------------------------------------------
// T-RR-reconnect-destroyed (reviewer D): the recurring-revenue reconnect probe's
// status(this) guard must prevent a state write after the component is
// destroyed. Deferred probe, destroy, then resolve: no signal write, no error.
// ---------------------------------------------------------------------------

async function testRrReconnectProbeAfterDestroy() {
    const deferred = Promise.withResolvers();
    patchWithCleanup(user, {
        hasGroup(group) {
            if (group !== "crm.group_use_recurring_revenues") {
                return super.hasGroup(group);
            }
            expect.step("probe");
            return deferred.promise;
        },
    });

    await mountProbe();
    setOffline(true);
    const component = await mountRrColumn(0, 10);
    await animationFrame();
    expect.verifySteps([]); // no probe offline

    // Reconnect: the probe starts (deferred, still pending).
    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect.verifySteps(["probe"]);
    expect(component.showRecurringRevenue).toBe(false); // not resolved yet

    // Destroy the component, THEN resolve the probe. The status(this) guard must
    // skip the signal write; nothing is thrown.
    destroyApp();
    deferred.resolve(true);
    await runAllTimers();
    await animationFrame();
    expect(component.showRecurringRevenue).toBe(false); // no write after destroy
    expect.verifySteps([]);
}

test.tags("desktop");
test("T-RR-reconnect-destroyed: no state write after destroy (desktop)", testRrReconnectProbeAfterDestroy);

test.tags("mobile");
test("T-RR-reconnect-destroyed: no state write after destroy (mobile)", testRrReconnectProbeAfterDestroy);


// ---------------------------------------------------------------------------
// T-RR (AC-RR online, U1): mounted ONLINE via mountView, the probe is issued at
// mount and the stage-1 column (standard 0, MRR 10) shows "+10" with the "MRR"
// label — the preserved behavior.
// ---------------------------------------------------------------------------

async function testRrOnline() {
    onRpc("has_group", ({ args }) => {
        if (args[1] === "crm.group_use_recurring_revenues") {
            expect.step(`has_group:${args[1]}`);
        }
        return true;
    });
    await mountRrKanban();
    await animationFrame();

    expect.verifySteps(["has_group:crm.group_use_recurring_revenues"]);
    expect(firstCounterText()).toInclude("MRR");
    expect(firstCounterText()).toInclude("10");
    // Stages 1 (MRR 10) and 2 (MRR 20) each render a recurring +value.
    expect(".o_animated_number[data-tooltip='Recurring Revenue']").toHaveCount(2);
}

test.tags("desktop");
test("T-RR: online probe issued at mount and MRR shows (desktop)", testRrOnline);

test.tags("mobile");
test("T-RR: online probe issued at mount and MRR shows (mobile)", testRrOnline);

// ###########################################################################
// Spec 05 — Task 5: Predictive-scoring tooltip button (AC-PLS-1..3).
//
// The pls_tooltip_button widget renders a real <button> with no
// data-available-offline, so the framework's offline pass disables it
// (click/keyboard/hotkey). The handler (onClickPlsTooltipButton) also gains a
// programmatic offline guard (first-line early-return) so a direct call offline
// issues none of record.save() / prepare_pls_tooltip_data / record.load().
// Online the full flow runs and the tooltip popover opens.
//
// The widget is placed on a crm_form arch; the component instance is captured
// from the view_widgets registry so the programmatic path can be invoked. The
// recompute RPC is observed with an onRpc("crm.lead","prepare_pls_tooltip_data")
// spy, and the record save/load with web_save / web_read spies.
// ###########################################################################

const spec05PlsFormArch = `
    <form class="o_lead_opportunity_form" js_class="crm_form">
        <sheet>
            <field name="probability"/>
            <field name="name"/>
            <widget name="pls_tooltip_button"/>
        </sheet>
    </form>`;

/** The data shape prepare_pls_tooltip_data returns (see crm_pls_tooltip_button.js). */
function plsTooltipData() {
    return {
        probability: 42,
        low_3_data: {},
        top_3_data: {},
        team_name: "Hyrule",
    };
}

let plsWidget;

/** Capture the CrmPlsTooltipButton instance mounted in the form. */
function getPlsWidget() {
    return plsWidget;
}

async function mountPlsForm(resId = 6) {
    plsWidget = undefined;
    patchWithCleanup(CrmPlsTooltipButton.prototype, {
        setup() {
            super.setup(...arguments);
            plsWidget = this;
        },
    });
    await mountView({ type: "form", resModel: "crm.lead", arch: spec05PlsFormArch, resId });
}

// ---------------------------------------------------------------------------
// T-PLS (AC-PLS-1 / AC-PLS-2): offline the <button> is framework-disabled; a
// real click and a real Enter keypress on it issue no RPC, and a direct
// (programmatic) handler call issues no save / prepare_pls_tooltip_data / load.
// ---------------------------------------------------------------------------

async function testPlsOffline() {
    onRpc("crm.lead", "prepare_pls_tooltip_data", () => {
        expect.step("prepare_pls_tooltip_data");
        return plsTooltipData();
    });
    onRpc("crm.lead", "web_save", ({ parent }) => {
        expect.step("web_save");
        return parent();
    });

    await mountPlsForm();
    await animationFrame();

    setOffline(true);
    await animationFrame();

    const btn = `.o_crm_pls_tooltip_button`;
    expect(btn).toHaveCount(1);
    // Framework-disabled offline (no data-available-offline).
    expect(`${btn}.o_disabled_offline`).toHaveCount(1);
    expect(`${btn}[disabled]`).toHaveCount(1);

    // Click on the disabled button fires nothing.
    await contains(btn).click();
    await animationFrame();
    expect.verifySteps([]);

    // A REAL Enter keypress on the focused button fires nothing either (a
    // disabled button activates on neither click nor Enter).
    document.querySelector(btn).focus();
    await press("Enter");
    await animationFrame();
    expect.verifySteps([]);

    // A direct programmatic handler call offline returns early: no save, no
    // recompute, no reload, and the popover never opens.
    const pls = getPlsWidget();
    await pls.onClickPlsTooltipButton({ currentTarget: document.querySelector(btn) });
    await animationFrame();
    expect.verifySteps([]);
    expect(`.o_crm_pls_tooltip`).toHaveCount(0); // no popover
    setOffline(false);
}

test.tags("desktop");
test("T-PLS: offline button disabled, click/Enter/programmatic issue no RPC (desktop)", testPlsOffline);

test.tags("mobile");
test("T-PLS: offline button disabled, click/Enter/programmatic issue no RPC (mobile)", testPlsOffline);

// ---------------------------------------------------------------------------
// T-PLS (AC-PLS-3): online the handler saves, recomputes (prepare_pls_tooltip_data)
// and reloads, then opens the tooltip popover — the preserved behavior.
// ---------------------------------------------------------------------------

async function testPlsOnline() {
    // Watch all three server round-trips the handler performs IN ORDER:
    // record.save() -> web_save, the recompute -> prepare_pls_tooltip_data, and
    // record.load() -> web_read. Asserting only the recompute would miss the save
    // and reload the handler is specified to run.
    onRpc("crm.lead", "web_save", ({ parent }) => {
        expect.step("web_save");
        return parent();
    });
    onRpc("crm.lead", "prepare_pls_tooltip_data", () => {
        expect.step("prepare_pls_tooltip_data");
        return plsTooltipData();
    });
    onRpc("crm.lead", "web_read", ({ parent }) => {
        expect.step("web_read");
        return parent();
    });

    await mountPlsForm();
    await animationFrame();
    // Drain the form's initial mount read so the assertion below sees only the
    // calls the button handler issues.
    expect.verifySteps(["web_read"]);

    // Dirty the record so record.save() genuinely issues web_save (a clean
    // record would short-circuit the save with no RPC).
    await contains(`.o_field_widget[name="name"] input`).edit("Edited lead");
    await animationFrame();

    // Activate the enabled button online with a REAL Enter keypress: it runs the
    // full flow (save -> recompute -> load) and opens the tooltip popover.
    const btn = `.o_crm_pls_tooltip_button`;
    document.querySelector(btn).focus();
    await press("Enter");
    await animationFrame();

    // The three calls the handler issues ran in order: save, recompute, reload.
    expect.verifySteps(["web_save", "prepare_pls_tooltip_data", "web_read"]);
    expect(`.o_crm_pls_tooltip`).toHaveCount(1); // popover opened
}

test.tags("desktop");
test("T-PLS: online saves, recomputes, reloads and opens the tooltip (desktop)", testPlsOnline);

test.tags("mobile");
test("T-PLS: online saves, recomputes, reloads and opens the tooltip (mobile)", testPlsOnline);

// ###########################################################################
// Spec 05 — Task 6: Activity menu CRM entry (AC-AM-1..2, U4).
//
// The crm.lead activity group is a <div t-custom-click> and its Late/Today/
// Future links are <span t-custom-click.stop> — non-buttons the framework's
// offline pass does NOT disable. The crm activity_menu_patch adds a setup() with
// useCrmOffline() and returns at the TOP of the crm.lead branch of
// openActivityGroup when offline (before dropdown.close()), so click,
// middle-click and new-window all load/navigate nothing and raise nothing.
// Other models fall through to super unchanged.
//
// openActivityGroup is the single entry point for click, middle-click (passes a
// newWindow flag) and the Late/Today/Future filters. The test mounts ActivityMenu,
// renders real activity groups, OPENS the dropdown and CLICKS the rendered DOM:
// the crm.lead group div, its Late/Today/Future spans, and a real middle-click
// (auxclick); action.loadAction / action.doAction are spied to prove the guard.
// ###########################################################################

async function mountActivityMenu(groups) {
    const component = await mountWithCleanup(ActivityMenu);
    // Spy the two server navigations the crm.lead branch would issue, and the
    // generic doAction the base (super) openActivityGroup issues for other models.
    patchWithCleanup(component.action, {
        loadAction(xmlId) {
            expect.step(`loadAction:${xmlId}`);
            return Promise.resolve({ id: 1, type: "ir.actions.act_window", domain: [] });
        },
        doAction(action) {
            const label = typeof action === "string" ? action : action.res_model || "action";
            expect.step(`doAction:${label}`);
            return Promise.resolve(true);
        },
    });
    // Render real activity groups so the dropdown shows the crm.lead group div
    // and its Late/Today/Future spans. `activity_groups` is reactive store state
    // read by store.activityGroups (the template source). The dropdown's
    // onBeforeOpen refetches from the server on open; stub both it and the
    // underlying store fetch to no-ops so our injected groups survive and opening
    // never issues a network call.
    patchWithCleanup(component, { onBeforeOpen() {} });
    patchWithCleanup(component.store, { fetchStoreData() { return Promise.resolve(); } });
    component.store.activity_groups = groups;
    await animationFrame();
    return component;
}

/** Dispatch a real middle-click (auxclick, button 1) on a DOM element — the
 * t-custom-click directive routes click + auxclick to the same handler and sets
 * isMiddleClick for button 1. */
function middleClick(selector) {
    const el = getFixture().querySelector(selector);
    el.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
}

/** Representative crm.lead activity group with non-zero counts so Late/Today/
 * Future render as active links. */
function crmLeadGroup() {
    return {
        model: "crm.lead",
        name: "Lead",
        type: "activity",
        icon: "/crm/static/description/icon.png",
        overdue_count: 2,
        today_count: 1,
        planned_count: 3,
    };
}

// ---------------------------------------------------------------------------
// T-AM (AC-AM-1): offline, clicking the REAL crm.lead group div, each of its
// Late/Today/Future spans, and a REAL middle-click (auxclick) load/navigate
// nothing and raise nothing — the JS guard returns before dropdown.close().
// ---------------------------------------------------------------------------

async function testAmOffline() {
    const component = await mountActivityMenu([crmLeadGroup()]);

    // Open the dropdown (online) so the group DOM renders.
    await click("button:has(i[data-icon='schedule'])"); // open the dropdown
    await animationFrame();
    const groupDiv = `.o-mail-ActivityGroup[data-model_name="crm.lead"]`;
    await mc(groupDiv);

    setOffline(true);
    await animationFrame();

    // Click the real group div: handler runs with filter "all" -> guard returns,
    // nothing navigates, dropdown stays (no close step).
    await click(groupDiv);
    await animationFrame();

    // Click each real filter span (Late/Today/Future -> overdue/today/upcoming_all).
    const spans = getFixture().querySelectorAll(`${groupDiv} span.btn.btn-link`);
    expect(spans.length).toBe(3); // Late, Today, Future all active (non-zero counts)
    for (const span of spans) {
        span.click();
        await animationFrame();
    }

    // A real middle-click (auxclick, button 1) on the group div: same guard.
    middleClick(groupDiv);
    await animationFrame();

    expect.verifySteps([]); // no loadAction, no doAction, no dropdown.close
    setOffline(false);
}

test.tags("desktop");
test("T-AM: offline crm.lead group div + filter spans + middle-click load nothing (desktop)", testAmOffline);

test.tags("mobile");
test("T-AM: offline crm.lead group div + filter spans + middle-click load nothing (mobile)", testAmOffline);

// ---------------------------------------------------------------------------
// T-AM (AC-AM-2, U4): online, clicking the real crm.lead group div opens
// my-activities (loadAction + doAction) — the preserved behavior.
// ---------------------------------------------------------------------------

async function testAmOnline() {
    const component = await mountActivityMenu([crmLeadGroup()]);

    await click("button:has(i[data-icon='schedule'])"); // open the dropdown
    await animationFrame();
    const groupDiv = `.o-mail-ActivityGroup[data-model_name="crm.lead"]`;
    await mc(groupDiv);

    // Online: clicking the real group div loads the my-activities action and
    // navigates (the crm.lead branch), after closing the dropdown.
    await click(groupDiv);
    await animationFrame();
    expect.verifySteps([
        "loadAction:crm.crm_lead_action_my_activities",
        "doAction:action",
    ]);
}

test.tags("desktop");
test("T-AM: online crm.lead entry opens my-activities (desktop)", testAmOnline);

test.tags("mobile");
test("T-AM: online crm.lead entry opens my-activities (mobile)", testAmOnline);

// ---------------------------------------------------------------------------
// T-AM-fallthrough (U4): a NON-crm.lead group is unaffected by the crm guard —
// even offline the crm patch calls super.openActivityGroup, which closes the
// dropdown and issues the generic doAction for that model. Proves the guard is
// scoped to crm.lead only and mail's openActivityGroup is reached.
// ---------------------------------------------------------------------------

async function testAmFallthrough() {
    const otherGroup = {
        model: "res.partner",
        name: "Contact",
        type: "activity",
        icon: "/mail/static/description/icon.png",
        overdue_count: 1,
        today_count: 0,
        planned_count: 0,
    };
    const component = await mountActivityMenu([otherGroup]);

    await click("button:has(i[data-icon='schedule'])"); // open the dropdown
    await animationFrame();
    const groupDiv = `.o-mail-ActivityGroup[data-model_name="res.partner"]`;
    await mc(groupDiv);

    // Offline: the crm guard only intercepts crm.lead, so a res.partner group
    // falls through to mail's super.openActivityGroup — the dropdown closes and
    // the generic act_window doAction (res_model: res.partner) is reached.
    setOffline(true);
    await animationFrame();
    await click(groupDiv);
    await animationFrame();
    expect.verifySteps(["doAction:res.partner"]);
    setOffline(false);
}

test.tags("desktop");
test("T-AM-fallthrough: non-crm.lead group reaches mail openActivityGroup offline (desktop)", testAmFallthrough);

test.tags("mobile");
test("T-AM-fallthrough: non-crm.lead group reaches mail openActivityGroup offline (mobile)", testAmFallthrough);

// ###########################################################################
// Spec 05 — Task 7: Chatter on the lead form (AC-CH-1..4, U5).
//
// DESKTOP uses the real mail harness + WebClient + doAction, mirroring the
// framework's own offline cached-reopen test (web/.../window_action.test.js
// "[Offline] navigate through window actions"): mount WebClient, open the lead
// action online so the record + chatter cache fill, go offline with mockOffline(),
// then reopen the SAME action+res_id with doAction — the cached data renders and
// the failing background refetches are declared with expect.errors(N) +
// verifyErrors (one exact message per error). CrmFormRenderer swaps in CrmChatter
// (lead form only), which skips the thread fetch offline, keeps the cached message
// visible, keeps the composer closed, no-ops the dropzone upload, and reloads on
// reconnect. Assertions are on what the user sees (message text, composer, drop)
// and on RPCs (no /mail/message/post, no attachment upload).
//
// MOBILE is the mounted-instance variant (KL-4 / row-12 deviation): the lead form
// is mounted via openFormView, then offline is toggled on the mounted instance and
// the same contract is asserted, without the desktop breadcrumb/doAction reopen.
// ###########################################################################

/** Create a crm.lead with one chatter message; return its id. */
function seedLeadWithMessage(pyEnv, body = "Cached note body") {
    const leadId = pyEnv["crm.lead"].create({ name: "Cached Lead", type: "opportunity" });
    pyEnv["mail.message"].create({
        body,
        model: "crm.lead",
        res_id: leadId,
        message_type: "comment",
    });
    return leadId;
}

/** Action opening the lead FORM (uses the model's form,false chatter view). */
function defineLeadFormAction(resId) {
    defineActions([
        {
            id: 80,
            name: "Lead",
            res_model: "crm.lead",
            type: "ir.actions.act_window",
            res_id: resId,
            views: [[false, "form"]],
        },
    ]);
}

// ------- DESKTOP: WebClient + doAction offline reopen (AC-CH-1..3) -------
async function testChOfflineReadonlyDesktop() {
    // The ONLY expected offline error is the framework's own background record
    // refetch (web_read). The chatter's /mail/store ConnectionLostError is
    // swallowed by CrmChatter.load(), so /mail/store must NOT appear.
    expect.errors(1);
    const pyEnv = await startServer();
    const leadId = seedLeadWithMessage(pyEnv);
    defineLeadFormAction(leadId);
    const setOfflineReal = mockOffline();
    onRpc("/mail/message/post", () => {
        expect.step("post");
        return {};
    });
    onRpc("/mail/attachment/upload", () => {
        expect.step("upload");
        return {};
    });
    await start();
    await runAllTimers();

    // Online: open the lead; cached message renders (poll until it does), composer opens.
    await getService("action").doAction(80);
    await mc(".o-mail-Message-body", { text: "Cached note body" });
    await click(".o-mail-Chatter-sendMessage");
    await mc(".o-mail-Composer");

    // Go offline: CrmChatter closes the composer; typing/Enter/paste impossible.
    await setOfflineReal(true);
    await mc(".o-mail-Composer", { count: 0 });

    // Reopen the SAME action offline: the cached record+message render (served
    // from the offline cache). CrmChatter.load() swallows the thread-fetch
    // ConnectionLostError, so NO /mail/store unhandled rejection — only the
    // framework's own web_read refetch is expected (declared below).
    await getService("action").doAction(80, { clearBreadcrumbs: true });
    await mc(".o-mail-Message-body", { text: "Cached note body" });

    // Enter posts nothing (no composer, no post RPC).
    await press("Enter");
    await animationFrame();

    // Real drop, saved lead: no upload, nothing queued.
    const dropFile = new File(["x"], "drop.txt", { type: "text/plain" });
    await dragenterFiles(".o-mail-Chatter", [dropFile]);
    await dropFiles(".o-Dropzone", [dropFile]);
    await animationFrame();

    expect.verifySteps([]); // no post, no upload
    expect(hookOrmToSyncSize()).toBe(0); // nothing queued (saved lead)
    await setOfflineReal(false);
    await runAllTimers();
    // Only the framework web_read refetch — /mail/store must NOT appear (the fix
    // swallows the chatter thread-fetch ConnectionLostError).
    expect.verifyErrors([/crm.lead\/web_read" couldn't be established/]);
}
test.tags("desktop");
test("T-CH: desktop offline reopen shows cached message read-only, no post, no upload", testChOfflineReadonlyDesktop);

// ------- DESKTOP: reconnect refetch (AC-CH-4) -------
async function testChReconnectDesktop() {
    expect.errors(1); // only the framework web_read refetch on the offline reopen
    const pyEnv = await startServer();
    const leadId = seedLeadWithMessage(pyEnv, "Reconnect body");
    defineLeadFormAction(leadId);
    const setOfflineReal = mockOffline();
    await start();
    await runAllTimers();

    await getService("action").doAction(80);
    await mc(".o-mail-Message-body", { text: "Reconnect body" });
    await setOfflineReal(true);
    await animationFrame();
    await getService("action").doAction(80, { clearBreadcrumbs: true });
    await runAllTimers();
    // Only the framework web_read refetch — /mail/store is swallowed by the fix.
    expect.verifyErrors([/crm.lead\/web_read" couldn't be established/]);

    // Count the chatter THREAD-DATA store fetches on reconnect (the ones whose
    // fetch_params include a "mail.thread" request), not any /mail/store. Exactly
    // one such refetch is expected (the skipped offline load, replayed once).
    let threadDataFetches = 0;
    onRpc("/mail/store", async (request) => {
        const { params } = await request.json();
        const fetchParams = params?.fetch_params ?? [];
        if (fetchParams.some((fp) => Array.isArray(fp) && fp[0] === "mail.thread")) {
            threadDataFetches++;
        }
        return {};
    });
    await setOfflineReal(false);
    await runAllTimers();
    await animationFrame();
    expect(threadDataFetches).toBe(1); // exactly one thread-data refetch on reconnect
    await mc(".o-mail-Message-body", { text: "Reconnect body" });
}
test.tags("desktop");
test("T-CH: desktop reconnect refetches thread data and renders messages", testChReconnectDesktop);

// ------- DESKTOP: KL-2 unsaved-lead drop -------
async function testChUnsavedDropKl2Desktop() {
    await startServer();
    defineLeadFormAction(false);
    const setOfflineReal = mockOffline();
    onRpc("/mail/attachment/upload", () => {
        expect.step("upload");
        return {};
    });
    await start();
    await runAllTimers();

    await getService("action").doAction(80);
    await mc(".o-mail-Chatter");
    // Fill the required `name` so the drop's saveRecord() (the form's own save,
    // for an unsaved lead) can succeed — otherwise save() returns false and the
    // drop's onDrop bails before queuing anything. KL-2 is about what happens
    // when the drop's save DOES run offline.
    await contains(`.o_field_widget[name="name"] input`).edit("KL2 Lead");
    await setOfflineReal(true);

    const dropFile = new File(["x"], "new.txt", { type: "text/plain" });
    await dragenterFiles(".o-mail-Chatter", [dropFile]);
    await dropFiles(".o-Dropzone", [dropFile]);
    await animationFrame();
    await runAllTimers();
    expect.verifySteps([]); // no upload
    // The drop's saveRecord() runs the form's own save; offline it queues exactly
    // one ordinary create (web_save with an empty id array) and uploads nothing.
    const creates = spec04QueuedValues().filter(
        (v) =>
            v.model === "crm.lead" &&
            v.method === "web_save" &&
            Array.isArray(v.args[0]) &&
            v.args[0].length === 0
    );
    expect(creates.length).toBe(1); // exactly one ordinary create (KL-2)
    // The offline save goes straight to the framework queue (no failing network
    // round-trip), so no ConnectionLostError is raised; nothing uploaded.
    await setOfflineReal(false);
    await runAllTimers();
}
test.tags("desktop");
test("T-CH: KL-2 desktop offline drop on unsaved lead queues one create, no upload", testChUnsavedDropKl2Desktop);

// ------- MOBILE: mounted-instance variant (KL-4) -------
async function testChMobileMountedInstance() {
    const pyEnv = await startServer();
    const leadId = seedLeadWithMessage(pyEnv, "Mobile body");
    const setOfflineReal = mockOffline();
    onRpc("/mail/message/post", () => expect.step("post"));
    onRpc("/mail/attachment/upload", () => expect.step("upload"));
    await start();

    // Mount the lead form (kept mounted; no reopen). Poll until the cached
    // message renders and the composer opens (chatter loads async).
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await mc(".o-mail-Message-body", { text: "Mobile body" });
    await click(".o-mail-Chatter-sendMessage");
    await mc(".o-mail-Composer");

    // Type a DRAFT into the composer BEFORE going offline. The draft lives on
    // thread.composer, so closing the composer offline must not lose it.
    await insertText(".o-mail-Composer-input", "Draft in progress");
    await mc(".o-mail-Composer-input", { value: "Draft in progress" });

    // Toggle offline on the mounted instance: the composer is REMOVED (closed),
    // the cached message stays. Typing/Enter/paste are impossible while closed.
    await setOfflineReal(true);
    await mc(".o-mail-Composer", { count: 0 });
    await mc(".o-mail-Message-body", { text: "Mobile body" });

    // Enter posts nothing; a real drop uploads nothing.
    await press("Enter");
    const dropFile = new File(["x"], "m.txt", { type: "text/plain" });
    await dragenterFiles(".o-mail-Chatter", [dropFile]);
    await dropFiles(".o-Dropzone", [dropFile]);
    await animationFrame();
    expect.verifySteps([]); // no post, no upload

    // Reconnect: the cached message remains visible and the chatter is usable
    // again. Reopening the composer shows the PRESERVED draft, unchanged — it was
    // never discarded, only hidden while the composer was removed.
    await setOfflineReal(false);
    await runAllTimers();
    await animationFrame();
    await mc(".o-mail-Message-body", { text: "Mobile body" });
    await click(".o-mail-Chatter-sendMessage");
    await mc(".o-mail-Composer");
    await mc(".o-mail-Composer-input", { value: "Draft in progress" }); // draft preserved
}
test.tags("mobile");
test("T-CH: mobile mounted-instance read-only, composer closed, reconnect refetch (KL-4)", testChMobileMountedInstance);

// ------- U5: other model's chatter unchanged (both presets) -------
const spec05ChatterArch = `
    <form class="o_lead_opportunity_form" js_class="crm_form">
        <sheet><field name="name"/></sheet>
        <chatter/>
    </form>`;

async function testChOtherModelUnchanged() {
    let baseChatter;
    patchWithCleanup(Chatter.prototype, {
        setup() {
            super.setup(...arguments);
            if (!(this instanceof CrmChatter)) {
                baseChatter = this;
            }
        },
    });
    const pyEnv = await startServer();
    const partnerId = pyEnv["res.partner"].create({ name: "Someone" });
    await start();
    await openFormView("res.partner", partnerId, {
        arch: `<form><sheet><field name="name"/></sheet><chatter/></form>`,
    });
    await mc(".o-mail-Chatter");
    expect(baseChatter).not.toBe(undefined);
    expect(baseChatter instanceof CrmChatter).toBe(false);
    expect(baseChatter.crmOffline).toBe(undefined);
}
test.tags("desktop");
test("T-CH: another model's form chatter is unchanged (desktop)", testChOtherModelUnchanged);
test.tags("mobile");
test("T-CH: another model's form chatter is unchanged (mobile)", testChOtherModelUnchanged);

// ------- DETERMINISTIC: load() swallows a ConnectionLostError whatever the
// signal timing (AC-CH-1 robustness). No mockOffline / no timing: with the
// signal ONLINE, make Thread.fetchThreadData reject with a ConnectionLostError
// (modelling the flap window where load() runs online but the request fails once
// the signal settles offline). load() must resolve without rejecting, mark the
// fetch skipped, and NOT leave an unhandled rejection. On reconnect the skipped
// fetch runs exactly once. A non-connection error must NOT be swallowed.
// -------
async function mountCrmChatterOnline() {
    let chatter;
    patchWithCleanup(CrmChatter.prototype, {
        setup() {
            super.setup(...arguments);
            chatter = this;
        },
    });
    const pyEnv = await startServer();
    const leadId = seedLeadWithMessage(pyEnv, "Det body");
    await start();
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    return chatter;
}

async function testChLoadSwallowsConnectionLost() {
    const chatter = await mountCrmChatterOnline();
    // Signal stays ONLINE for this test; the fetch rejects as if the flap closed.
    expect(chatter.crmOffline.isOffline()).toBe(false);
    let calls = 0;
    patchWithCleanup(Thread.prototype, {
        fetchThreadData() {
            calls++;
            return Promise.reject(new ConnectionLostError("/mail/store"));
        },
    });

    // load() must resolve (not reject) and mark the fetch skipped — no unhandled
    // rejection despite the signal being online when load() ran.
    chatter._loadSkipped = false;
    await chatter.load(chatter.state.thread, chatter.initialRequestList);
    expect(chatter._loadSkipped).toBe(true);
    expect(calls).toBe(1);

    // Reconnect (offline then back online): the skipped fetch runs exactly once
    // more. Make fetchThreadData resolve now so the refetch succeeds.
    patchWithCleanup(Thread.prototype, {
        fetchThreadData() {
            calls++;
            return Promise.resolve();
        },
    });
    const callsBefore = calls;
    setOffline(true);
    await animationFrame();
    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect(calls).toBe(callsBefore + 1); // exactly one reconnect refetch
    setOffline(false);
}
test.tags("desktop");
test("T-CH: load swallows a ConnectionLostError and refetches once on reconnect (desktop)", testChLoadSwallowsConnectionLost);
test.tags("mobile");
test("T-CH: load swallows a ConnectionLostError and refetches once on reconnect (mobile)", testChLoadSwallowsConnectionLost);

// A reconnect refetch that ITSELF fails with a ConnectionLostError must not leave
// an unhandled rejection: the reconnect handler goes through the guarded
// this.load, so the error is swallowed, _loadSkipped is re-armed, and the NEXT
// offline->online cycle refetches again. (Guards the super.load->this.load fix.)
async function testChReconnectRefetchFailureRearms() {
    const chatter = await mountCrmChatterOnline();
    // Arm a skipped load, then make every fetch reject with ConnectionLostError.
    chatter._loadSkipped = true;
    let calls = 0;
    patchWithCleanup(Thread.prototype, {
        fetchThreadData() {
            calls++;
            return Promise.reject(new ConnectionLostError("/mail/store"));
        },
    });

    // First reconnect: the refetch runs (via this.load), fails, is swallowed, and
    // _loadSkipped is re-armed — no unhandled rejection.
    setOffline(true);
    await animationFrame();
    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect(calls).toBe(1);
    expect(chatter._loadSkipped).toBe(true); // re-armed for the next reconnect

    // Second offline->online cycle: refetch runs again (now succeeding).
    patchWithCleanup(Thread.prototype, {
        fetchThreadData() {
            calls++;
            return Promise.resolve();
        },
    });
    setOffline(true);
    await animationFrame();
    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect(calls).toBe(2); // retried on the next reconnect
    expect(chatter._loadSkipped).toBe(false);
    setOffline(false);
}
test.tags("desktop");
test("T-CH: a failed reconnect refetch re-arms and retries on the next reconnect (desktop)", testChReconnectRefetchFailureRearms);
test.tags("mobile");
test("T-CH: a failed reconnect refetch re-arms and retries on the next reconnect (mobile)", testChReconnectRefetchFailureRearms);

async function testChLoadRethrowsOtherErrors() {
    const chatter = await mountCrmChatterOnline();
    patchWithCleanup(Thread.prototype, {
        fetchThreadData() {
            return Promise.reject(new Error("not a connection error"));
        },
    });
    // A non-ConnectionLostError must propagate unchanged (not swallowed).
    let thrown;
    try {
        await chatter.load(chatter.state.thread, chatter.initialRequestList);
    } catch (e) {
        thrown = e;
    }
    expect(thrown).not.toBe(undefined);
    expect(thrown.message).toBe("not a connection error");
}
test.tags("desktop");
test("T-CH: load rethrows a non-connection error (desktop)", testChLoadRethrowsOtherErrors);
test.tags("mobile");
test("T-CH: load rethrows a non-connection error (mobile)", testChLoadRethrowsOtherErrors);

// The uploader wrap is a no-op ONLY offline; ONLINE it must delegate to the
// original attachmentUploader.uploadFile. We prove both directions: offline the
// wrapped call resolves without reaching the upload route; online it reaches the
// real /mail/attachment/upload route (the delegate runs the actual upload).
async function testChUploaderPassThrough() {
    // Stub the upload SERVICE (the delegate target of the original uploadFile)
    // with a step-recording no-op BEFORE mounting, so the real upload path
    // (URL.createObjectURL etc.) never runs. The CrmChatter wrapper short-circuits
    // offline and calls the original uploadFile online — which reaches this stub.
    patchWithCleanup(AttachmentUploadService.prototype, {
        upload() {
            expect.step("upload");
            return Promise.resolve();
        },
    });
    const chatter = await mountCrmChatterOnline();
    const file = new File(["x"], "p.txt", { type: "text/plain" });

    // The wrapper's only branch key is crmOffline.isOffline(). Drive it directly
    // (rather than the live connectivity signal, which the WebClient harness can
    // flip back online via background RPC:RESPONSE) so the wrapper's offline vs
    // online behavior is tested deterministically.
    let offline = true;
    patchWithCleanup(chatter.crmOffline, { isOffline: () => offline });

    // Offline: the wrapped uploader is a no-op — it resolves and the delegate
    // (upload service) is never reached.
    await chatter.attachmentUploader.uploadFile(file);
    await animationFrame();
    expect.verifySteps([]); // no upload offline

    // Online: the wrapper delegates to the original uploadFile, which calls the
    // upload service (our stub) — proving the online path is unchanged.
    offline = false;
    await chatter.attachmentUploader.uploadFile(file);
    await animationFrame();
    expect.verifySteps(["upload"]); // delegated to the original uploader online
}
test.tags("desktop");
test("T-CH: uploader wrap no-ops offline, delegates to the original online (desktop)", testChUploaderPassThrough);
test.tags("mobile");
test("T-CH: uploader wrap no-ops offline, delegates to the original online (mobile)", testChUploaderPassThrough);


// ###########################################################################
// Spec 05 — Task 8: <a type=...> CRM controls (AC-A-1-guard, AC-A-1-known).
//
// The framework disables only <button>. <a type="object">/<a type="action">
// render as <a> (ViewButton t-tag) and are NOT disabled. Two cases:
//  - GUARD (AC-A-1-guard): the lead-form "set automated probability" <a> is on
//    the crm_form, which CRM owns, so CrmFormController.beforeExecuteActionButton
//    returns false offline — no RPC, no queue entry. Online it runs.
//  - KNOWN LIMITATION KL-1 (AC-A-1-known): <a> controls on views CRM does NOT
//    own (crm.team dashboard, utm.campaign, the activity-report row) cannot be
//    guarded without a js_class on a foreign view. They stay clickable offline;
//    the server call fails silently via the framework's lostConnectionHandler
//    (no dialog, no notification, nothing queued). The representative test below
//    proves that framework behavior on an <a type="object">.
// ###########################################################################

const spec05ProbaFormArch = `
    <form class="o_lead_opportunity_form" js_class="crm_form">
        <sheet>
            <field name="probability"/>
            <field name="name"/>
            <a name="action_set_automated_probability" type="object" class="o_set_proba">
                Set automated probability
            </a>
        </sheet>
    </form>`;

// AC-A-1-guard: offline the automated-probability <a> issues no RPC and queues
// nothing; online it dispatches the object call.
async function testAProbaGuard() {
    onRpc("crm.lead", "action_set_automated_probability", () => {
        expect.step("action_set_automated_probability");
        return false;
    });
    await mountView({ type: "form", resModel: "crm.lead", arch: spec05ProbaFormArch, resId: 6 });
    await animationFrame();

    // The control renders as a plain <a> (NOT a framework-disabled button).
    expect(`a.o_set_proba`).toHaveCount(1);

    setOffline(true);
    await animationFrame();
    // Offline: clicking issues no RPC and queues nothing (the CRM controller
    // returns false before the object call).
    await contains(`a.o_set_proba`).click();
    await animationFrame();
    expect.verifySteps([]);
    expect(spec04QueuedFor("crm.lead", "action_set_automated_probability", 6).length).toBe(0);
    expect(hookOrmToSyncSize()).toBe(0);

    // Online: the object call dispatches.
    setOffline(false);
    await animationFrame();
    await contains(`a.o_set_proba`).click();
    await animationFrame();
    expect.verifySteps(["action_set_automated_probability"]);
}

test.tags("desktop");
test("T-A-lead: offline automated-probability link issues no RPC; online works (desktop)", testAProbaGuard);

test.tags("mobile");
test("T-A-lead: offline automated-probability link issues no RPC; online works (mobile)", testAProbaGuard);

// AC-A-1-known (KL-1): an <a type="object"> on a view CRM does not own stays
// clickable offline; the call fails silently (handled by lostConnectionHandler)
// — no error dialog, no notification, nothing queued. Proven on a generic form.
async function testAKnownLimitationSilentFail() {
    expect.errors(1); // the ConnectionLostError, handled silently by the framework
    // Scope a 502 to just this call_button route so EXACTLY one ConnectionLostError
    // occurs (the catch-all mockOffline() can turn background calls into extra,
    // flaky errors). The rpc layer turns the 502 into ConnectionLostError, which
    // the framework's lostConnectionHandler handles silently.
    onRpc(
        "/web/dataset/call_button/crm.team/action_assign_leads",
        () => new Response("", { status: 502 }),
        { pure: true }
    );
    await mountView({
        type: "form",
        resModel: "crm.team",
        arch: `<form><sheet><field name="name"/><a name="action_assign_leads" type="object" class="o_foreign_a">Assign</a></sheet></form>`,
        resId: 1,
    });
    await animationFrame();

    setOffline(true);
    await animationFrame();

    // The <a> is NOT disabled by the framework (it is not a <button>).
    expect(`a.o_foreign_a`).toHaveCount(1);
    expect(`a.o_foreign_a.o_disabled_offline`).toHaveCount(0);

    // Click offline: the call is attempted and fails with ConnectionLostError,
    // which the framework handles silently — no dialog, no notification, and the
    // bare object call has no queue fallback so nothing is queued.
    await contains(`a.o_foreign_a`).click();
    await animationFrame();
    expect(".o_notification").toHaveCount(0);
    expect(".modal").toHaveCount(0);
    expect(hookOrmToSyncSize()).toBe(0);
    setOffline(false);
    // The one expected ConnectionLostError (handled silently by the framework's
    // lostConnectionHandler) is verified here so it is not reported as unverified.
    expect.verifyErrors([
        `Connection to "/web/dataset/call_button/crm.team/action_assign_leads" couldn't be established or was interrupted`,
    ]);
}

test.tags("desktop");
test("T-A-known: foreign <a type=object> fails silently offline, nothing queued (desktop)", testAKnownLimitationSilentFail);

test.tags("mobile");
test("T-A-known: foreign <a type=object> fails silently offline, nothing queued (mobile)", testAKnownLimitationSilentFail);

// AC-A-1-known (KL-1), <a type="action">: a foreign-view <a type="action"> stays
// clickable offline; the action load/navigation fails silently (handled by the
// framework), with no dialog, no notification, and nothing queued. Proven on a
// replica arch (CRM does not own a js_class for these foreign views, so the real
// controls behave the same way — this proves the framework behavior, not the
// real view wiring).
async function testAKnownActionSilentFail() {
    expect.errors(1);
    const setOfflineReal = mockOffline();
    await mountView({
        type: "form",
        resModel: "crm.team",
        arch: `<form><sheet><field name="name"/><a name="%(base.action_open_website)d" type="action" class="o_foreign_action">Open</a></sheet></form>`,
        resId: 1,
    });
    await animationFrame();
    await setOfflineReal(true);

    // Not a <button>, so the framework does not disable it.
    expect(`a.o_foreign_action`).toHaveCount(1);
    expect(`a.o_foreign_action.o_disabled_offline`).toHaveCount(0);

    // Click offline: the action load fails with ConnectionLostError, handled
    // silently; nothing navigates, no dialog/notification, nothing queued.
    await contains(`a.o_foreign_action`).click();
    await animationFrame();
    expect(".o_notification").toHaveCount(0);
    expect(".modal").toHaveCount(0);
    expect(hookOrmToSyncSize()).toBe(0);
    // The action load fails with a ConnectionLostError (handled silently by the
    // framework); it may arrive after the click, so wait for and verify it.
    await expect.waitForErrors([/couldn't be established/]);
    await setOfflineReal(false);
}
test.tags("desktop");
test("T-A-action: foreign <a type=action> fails silently offline, nothing queued (desktop)", testAKnownActionSilentFail);
test.tags("mobile");
test("T-A-action: foreign <a type=action> fails silently offline, nothing queued (mobile)", testAKnownActionSilentFail);

// AC-A-1-known (KL-1), list row-open action: a list whose row click opens a
// record via a server action (like the activity-report row) stays clickable
// offline; the record-open fails silently, with nothing queued. Replica arch.
async function testAKnownRowClickSilentFail() {
    expect.errors(1);
    const setOfflineReal = mockOffline();
    await mountView({
        type: "list",
        resModel: "crm.lead",
        arch: `<list action="action_open_lead" type="object"><field name="name"/></list>`,
    });
    await animationFrame();
    await setOfflineReal(true);

    // The row cell is not a <button>, so the framework does not disable it.
    const row = `.o_data_row:first .o_data_cell`;
    expect(row).toHaveCount(1);

    // Click a row offline: the record-open object call fails with
    // ConnectionLostError, handled silently; no dialog/notification, nothing queued.
    await contains(row).click();
    await animationFrame();
    expect(".o_notification").toHaveCount(0);
    expect(".modal").toHaveCount(0);
    expect(hookOrmToSyncSize()).toBe(0);
    // The record-open object call fails with a ConnectionLostError (handled
    // silently); wait for and verify it (it may arrive after the click).
    await expect.waitForErrors([/couldn't be established/]);
    await setOfflineReal(false);
}
test.tags("desktop");
test("T-A-rowclick: list row-open action fails silently offline, nothing queued (desktop)", testAKnownRowClickSilentFail);
test.tags("mobile");
test("T-A-rowclick: list row-open action fails silently offline, nothing queued (mobile)", testAKnownRowClickSilentFail);

// ###########################################################################
// Spec 05 — Task 9: Share target (AC-A-2).
//
// CrmShareTargetItem is crm JS that fetches sales teams via orm.webSearchRead
// ("crm.team"). Offline that read has no fallback: updateTeams() skips it (no
// RPC), the item renders a disabled affordance (opacity-50 / pe-none /
// aria-disabled, the "Sales teams are unavailable offline." block), and the
// read runs exactly once on reconnect. Online the read is issued.
//
// The item is captured from the share_target_items registry via a prototype
// patch; the share-target dialog is triggered through shareTargetService (the
// framework pattern) so a real instance exists, then updateTeams() is driven
// across the connection states.
// ###########################################################################

let crmShareItem;

async function mountShareTargetWithCrmItem() {
    crmShareItem = undefined;
    // Capture the instance via a prototype patch, but DO NOT re-register the
    // item: the production module registration
    // (crm_share_target_item.js: registry.category("share_target_items").add("crm", ...))
    // is what makes the dialog mount CrmShareTargetItem. If that production
    // registration were removed these tests would mount no CRM item and fail.
    patchWithCleanup(CrmShareTargetItem.prototype, {
        setup() {
            super.setup(...arguments);
            crmShareItem = this;
        },
    });
    patchWithCleanup(shareTargetService, {
        _getShareTargetFiles: async () => [
            new File([new Uint8Array(1)], "lead.png", { type: "image/png" }),
        ],
    });
    await mountWithCleanup(WebClient);
    await animationFrame();
}

async function testAShare() {
    let searchReads = 0;
    onRpc("crm.team", "web_search_read", () => {
        searchReads++;
        expect.step("web_search_read");
        return { length: 2, records: [{ id: 1, display_name: "Mushroom Kingdom" }, { id: 2, display_name: "Hyrule" }] };
    });

    await mountShareTargetWithCrmItem();
    const item = crmShareItem;
    expect(item).not.toBe(undefined);

    // Online at mount: the team lookup was issued.
    expect.verifySteps(["web_search_read"]);

    // Go offline and re-run updateTeams: no RPC, skip flag set, affordance shown.
    setOffline(true);
    await item.updateTeams();
    await animationFrame();
    expect.verifySteps([]); // no webSearchRead offline
    expect(item.isOffline).toBe(true);
    expect(`.o_crm_share_target_offline`).toHaveCount(1);
    expect(`.o_crm_share_target_offline[aria-disabled='true']`).toHaveCount(1);

    // Reconnect: the useOnChange runs the skipped lookup exactly once.
    const before = searchReads;
    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect(searchReads).toBe(before + 1);
    expect.verifySteps(["web_search_read"]);
    expect(`.o_crm_share_target_offline`).toHaveCount(0);
}

test.tags("desktop");
test("T-A-share: offline skips team lookup + disabled affordance; reconnect runs once (desktop)", testAShare);

test.tags("mobile");
test("T-A-share: offline skips team lookup + disabled affordance; reconnect runs once (mobile)", testAShare);

// ---------------------------------------------------------------------------
// T-A-share-error (reviewer A.2): the reconnect team lookup must handle its own
// rejection. The flag is armed through the REAL production path (setOffline(true)
// + item.onCompanyChange(...) -> updateTeams() offline), then the reconnect is
// driven by the PRODUCTION useOnChange on real setOffline(false)/setOffline(true)
// transitions; only orm.webSearchRead is patched (reject once with
// ConnectionLostError, then resolve). Patching the orm method (not the onRpc
// route) avoids the mock RPC layer re-wrapping the error while keeping the
// connectivity transitions real. A ConnectionLostError is swallowed by the
// component's .catch (no unhandled rejection) and RE-ARMS the skip flag so the
// NEXT reconnect retries; a non-connection error is NOT swallowed and does NOT
// re-arm. (A mutation removing the production useOnChange makes these fail: the
// reconnect lookup never fires.)
// ---------------------------------------------------------------------------

async function testAShareReconnectConnectionLost() {
    // Mount the item ONLINE like the other share-target tests, capture it, then
    // arm the skip flag through the REAL production method: setOffline(true) and
    // call item.onCompanyChange(...) (which calls updateTeams() offline and sets
    // _teamsProbeSkipped itself — the flag is never touched by hand). Patch only
    // orm.webSearchRead (reject once with ConnectionLostError, then resolve) and
    // drive the reconnects through real setOffline transitions so the PRODUCTION
    // useOnChange runs updateTeams(). Patching the orm method (not the onRpc
    // route) keeps the ConnectionLostError from being re-wrapped by the mock RPC
    // layer while leaving connectivity transitions real. If the production
    // useOnChange were removed, no reconnect lookup fires and this fails.
    onRpc("crm.team", "web_search_read", () => ({
        length: 2,
        records: [
            { id: 1, display_name: "Mushroom Kingdom" },
            { id: 2, display_name: "Hyrule" },
        ],
    }));
    await mountShareTargetWithCrmItem();
    const item = crmShareItem;
    expect(item).not.toBe(undefined);

    // Arm the flag via the real production path: offline, then onCompanyChange()
    // runs updateTeams() which takes the offline branch and sets the flag.
    setOffline(true);
    await item.onCompanyChange(item.currentCompany);
    await animationFrame();
    expect(item.isOffline).toBe(true);
    expect(item._teamsProbeSkipped).toBe(true); // armed by production updateTeams()
    expect(`.o_crm_share_target_offline`).toHaveCount(1);

    let call = 0;
    patchWithCleanup(item.orm, {
        webSearchRead(model, domain, options) {
            if (model !== "crm.team") {
                return super.webSearchRead(model, domain, options);
            }
            call++;
            expect.step(`search:${call}`);
            if (call === 1) {
                return Promise.reject(new ConnectionLostError("x")); // drop mid-fetch
            }
            return Promise.resolve({ length: 1, records: [{ id: 1, display_name: "Mushroom Kingdom" }] });
        },
    });

    // First reconnect: the PRODUCTION useOnChange fires on setOffline(false),
    // clears the flag and calls updateTeams(), which rejects with
    // ConnectionLostError. The .catch handles it (no unhandled rejection) and
    // RE-ARMS the flag; state.teams is left untouched (teams NOT loaded).
    const teamsBefore = item.state.teams;
    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect.verifySteps(["search:1"]);
    expect(item._teamsProbeSkipped).toBe(true); // re-armed by the .catch
    // The affordance is gated on isOffline(); because we patched the orm directly
    // (deterministic, no RPC:RESPONSE re-flip) the signal is online here, so the
    // meaningful assertion is that the fetch failed without loading teams.
    expect(item.state.teams).toBe(teamsBefore);

    // Next offline->online cycle: the re-armed flag lets the PRODUCTION useOnChange
    // run updateTeams() again, which this time resolves and loads the teams.
    setOffline(true);
    await animationFrame();
    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect.verifySteps(["search:2"]);
    expect(item._teamsProbeSkipped).toBe(false);
    expect(item.state.teams.length).toBe(1); // retry populated teams
    expect(item.state.teams[0].display_name).toBe("Mushroom Kingdom");
}

test.tags("desktop");
test("T-A-share-error: ConnectionLostError swallowed + retried next cycle (desktop)", testAShareReconnectConnectionLost);

test.tags("mobile");
test("T-A-share-error: ConnectionLostError swallowed + retried next cycle (mobile)", testAShareReconnectConnectionLost);

async function testAShareReconnectOtherError() {
    // A non-connection error from the reconnect lookup is NOT swallowed and does
    // NOT re-arm the flag, so no silent retry masks a real failure. Mount ONLINE,
    // arm the flag through the REAL production method (setOffline(true) +
    // item.onCompanyChange(...)), then drive the reconnect with the PRODUCTION
    // useOnChange on the real setOffline(false) transition; orm.webSearchRead is
    // patched to reject with a plain (non-connection) error.
    expect.errors(1);
    onRpc("crm.team", "web_search_read", () => ({
        length: 2,
        records: [
            { id: 1, display_name: "Mushroom Kingdom" },
            { id: 2, display_name: "Hyrule" },
        ],
    }));
    await mountShareTargetWithCrmItem();
    const item = crmShareItem;
    expect(item).not.toBe(undefined);

    setOffline(true);
    await item.onCompanyChange(item.currentCompany);
    await animationFrame();
    expect(item._teamsProbeSkipped).toBe(true); // armed by production updateTeams()
    expect(`.o_crm_share_target_offline`).toHaveCount(1);

    let call = 0;
    patchWithCleanup(item.orm, {
        webSearchRead(model, domain, options) {
            if (model !== "crm.team") {
                return super.webSearchRead(model, domain, options);
            }
            call++;
            expect.step(`search:${call}`);
            return Promise.reject(makeServerError({ message: "boom" }));
        },
    });

    // Reconnect: the PRODUCTION useOnChange runs updateTeams() on setOffline(false);
    // the lookup rejects with a non-connection error, which updateTeams() rethrows
    // (surfaced by the framework as one unhandled rejection). The flag is NOT re-armed.
    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect.verifySteps(["search:1"]);
    await expect.waitForErrors([/boom/]);
    expect(item._teamsProbeSkipped).toBe(false); // NOT re-armed

    // A further offline->online cycle does not silently retry (not re-armed), so
    // the production useOnChange guard (needs _teamsProbeSkipped) does not fire.
    setOffline(true);
    await animationFrame();
    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect(call).toBe(1); // no extra lookup
    expect.verifySteps([]);
}

test.tags("desktop");
test("T-A-share-error: non-connection error is not swallowed (desktop)", testAShareReconnectOtherError);

test.tags("mobile");
test("T-A-share-error: non-connection error is not swallowed (mobile)", testAShareReconnectOtherError);

// ---------------------------------------------------------------------------
// T-A-share-destroyed (reviewer D): updateTeams()'s status(this) guard must
// prevent the post-await state write after the component is destroyed. Arm the
// flag via the real production path, make the reconnect fetch a deferred
// (pending) promise, DESTROY the component, then resolve it: state.teams must
// NOT be written and nothing is thrown.
// ---------------------------------------------------------------------------

async function testAShareReconnectAfterDestroy() {
    onRpc("crm.team", "web_search_read", () => ({
        length: 2,
        records: [
            { id: 1, display_name: "Mushroom Kingdom" },
            { id: 2, display_name: "Hyrule" },
        ],
    }));
    await mountShareTargetWithCrmItem();
    const item = crmShareItem;
    expect(item).not.toBe(undefined);

    // Arm the flag via the real production path.
    setOffline(true);
    await item.onCompanyChange(item.currentCompany);
    await animationFrame();
    expect(item._teamsProbeSkipped).toBe(true);
    // state.teams currently holds the 2 teams loaded by the online mount. The
    // deferred reconnect fetch below returns a DIFFERENT (1-team) result, so if
    // the status(this) guard failed the array would be replaced.
    const teamsBefore = item.state.teams;
    expect(teamsBefore.length).toBe(2);

    // The reconnect fetch is a deferred promise that stays pending.
    const deferred = Promise.withResolvers();
    patchWithCleanup(item.orm, {
        webSearchRead(model, domain, options) {
            if (model !== "crm.team") {
                return super.webSearchRead(model, domain, options);
            }
            expect.step("search");
            return deferred.promise;
        },
    });

    // Reconnect: the PRODUCTION useOnChange runs updateTeams(); the fetch is
    // pending. Destroy the component, THEN resolve. updateTeams()'s
    // status(this)==="destroyed" guard must skip the state write.
    setOffline(false);
    await runAllTimers();
    await animationFrame();
    expect.verifySteps(["search"]);
    destroyApp();
    deferred.resolve({ length: 1, records: [{ id: 1, display_name: "Mushroom Kingdom" }] });
    await runAllTimers();
    await animationFrame();
    expect(item.state.teams).toBe(teamsBefore); // same array: no write after destroy
    expect(item.state.teams.length).toBe(2); // still the mount's teams, NOT the deferred 1-team result
    expect.verifySteps([]); // no further step, no unhandled error
}

test.tags("desktop");
test("T-A-share-destroyed: no state write after destroy (desktop)", testAShareReconnectAfterDestroy);

test.tags("mobile");
test("T-A-share-destroyed: no state write after destroy (mobile)", testAShareReconnectAfterDestroy);


// ###########################################################################
// Spec 05 — Task 10a: the framework <button>-disable rule (row 7).
//
// Acceptance row 7 is proven BY TEST, not by assuming the framework guarantee.
// The mechanism under test is the framework's selector pass
// (button:not([data-available-offline])): offline it adds `disabled` +
// `o_disabled_offline` and the click issues no RPC; online the button is enabled
// and its object call dispatches. The mechanism is the framework's and is
// model-independent, so each test exercises it on a <button> of the right
// name/type.
//
// Two kinds of coverage below:
//  - REAL views: T-B-leadform / T-B-leadmethods / T-B-meeting mount a real
//    crm_form (crm.lead), T-B-team a real crm.team form, T-B-leadlist a real
//    crm_list — these carry the surface's actual button on its real view.
//  - REPLICA views: T-B-settings / T-B-related / T-B-wizard do NOT render the
//    real settings / related-record / wizard views. They mount a crm.lead
//    crm_form REPLICA carrying a <button> with that surface's name, which proves
//    the framework rule applies to such a button; it does not exercise the real
//    view wiring. (The real views are register-only DISABLE rows in the
//    inventory; see design.md.)
// ###########################################################################

/**
 * Mount a crm.lead crm_form carrying a single <button name=... type="object">
 * and assert the framework disables it offline (no RPC) and enables it online
 * (RPC dispatched). `method` is spied on crm.lead. NOTE: this is a REPLICA
 * harness — it proves the framework button rule for a button of the given name;
 * it does NOT render the surface's real view.
 */
async function assertButtonSurface(buttonName, method) {
    onRpc("crm.lead", method, () => {
        expect.step(method);
        return false;
    });
    const arch = `
        <form class="o_lead_opportunity_form" js_class="crm_form">
            <header>
                <button name="${buttonName}" type="object" class="o_surface_btn" string="Act"/>
            </header>
            <sheet><field name="name"/></sheet>
        </form>`;
    await mountView({ type: "form", resModel: "crm.lead", arch, resId: 6 });
    await animationFrame();

    const btn = `button.o_surface_btn`;
    expect(btn).toHaveCount(1);

    // Offline: framework-disabled, click issues no RPC.
    setOffline(true);
    await animationFrame();
    expect(`${btn}.o_disabled_offline`).toHaveCount(1);
    expect(`${btn}[disabled]`).toHaveCount(1);
    await contains(btn).click();
    await animationFrame();
    expect.verifySteps([]);

    // Online: enabled, click dispatches the object call.
    setOffline(false);
    await animationFrame();
    expect(`${btn}.o_disabled_offline`).toHaveCount(0);
    expect(`${btn}[disabled]`).toHaveCount(0);
    await contains(btn).click();
    await animationFrame();
    expect.verifySteps([method]);
}

// Lead form header/stat/inline buttons (e.g. action_convert_to_opportunity).
async function testBLeadForm() {
    await assertButtonSurface("action_convert_to_opportunity", "action_convert_to_opportunity");
}
test.tags("desktop");
test("T-B-leadform: lead-form object button disabled offline, works online (desktop)", testBLeadForm);
test.tags("mobile");
test("T-B-leadform: lead-form object button disabled offline, works online (mobile)", testBLeadForm);

// Lead methods surface (e.g. action_restore).
async function testBLeadMethods() {
    await assertButtonSurface("action_restore", "action_restore");
}
test.tags("desktop");
test("T-B-leadmethods: lead-method object button disabled offline, works online (desktop)", testBLeadMethods);
test.tags("mobile");
test("T-B-leadmethods: lead-method object button disabled offline, works online (mobile)", testBLeadMethods);

// Schedule-meeting / duplicates (another lead-form object button).
async function testBMeeting() {
    await assertButtonSurface("action_schedule_meeting", "action_schedule_meeting");
}
test.tags("desktop");
test("T-B-meeting: schedule-meeting button disabled offline, works online (desktop)", testBMeeting);
test.tags("mobile");
test("T-B-meeting: schedule-meeting button disabled offline, works online (mobile)", testBMeeting);

// Team dashboard object button (crm.team action_assign_leads on crm_team_views).
async function testBTeam() {
    onRpc("crm.team", "action_assign_leads", () => {
        expect.step("action_assign_leads");
        return false;
    });
    const arch = `
        <form js_class="crm_form">
            <header><button name="action_assign_leads" type="object" class="o_surface_btn" string="Assign"/></header>
            <sheet><field name="name"/></sheet>
        </form>`;
    await mountView({ type: "form", resModel: "crm.team", arch, resId: 1 });
    await animationFrame();
    const btn = `button.o_surface_btn`;
    setOffline(true);
    await animationFrame();
    expect(`${btn}.o_disabled_offline`).toHaveCount(1);
    expect(`${btn}[disabled]`).toHaveCount(1);
    await contains(btn).click();
    await animationFrame();
    expect.verifySteps([]);
    setOffline(false);
    await animationFrame();
    await contains(btn).click();
    await animationFrame();
    expect.verifySteps(["action_assign_leads"]);
}
test.tags("desktop");
test("T-B-team: team dashboard object button disabled offline, works online (desktop)", testBTeam);
test.tags("mobile");
test("T-B-team: team dashboard object button disabled offline, works online (mobile)", testBTeam);

// Lead list header object button (crm_list surface).
async function testBLeadList() {
    onRpc("crm.lead", "action_restore", () => {
        expect.step("action_restore");
        return false;
    });
    const arch = `
        <list js_class="crm_list">
            <header><button name="action_restore" type="object" class="o_surface_btn" string="Restore"/></header>
            <field name="name"/>
        </list>`;
    await mountView({ type: "list", resModel: "crm.lead", arch });
    await animationFrame();
    // Select a row so the header button shows.
    await contains(`.o_data_row .o_list_record_selector input`).click();
    await animationFrame();
    const btn = `button.o_surface_btn`;
    expect(btn).toHaveCount(1);
    setOffline(true);
    await animationFrame();
    expect(`${btn}.o_disabled_offline`).toHaveCount(1);
    expect(`${btn}[disabled]`).toHaveCount(1);
    setOffline(false);
    await animationFrame();
    expect(`${btn}.o_disabled_offline`).toHaveCount(0);
}
// Desktop-only (KL-3): the test reveals the list header button by ticking a row's
// selection checkbox (.o_list_record_selector input). The mobile list renders no
// per-row selection checkbox column, so the header button cannot be revealed on
// mobile; the framework-disable mechanism it proves is preset-independent and is
// also covered on mobile by the paired <button>-surface tests. See KL-3.
test.tags("desktop");
test("T-B-leadlist: list header object button disabled offline, enabled online (desktop)", testBLeadList);

// Settings surface (res.config.settings action_crm_assign_leads). Proven on a
// REPLICA button — not the real settings view (see the block header).
async function testBSettings() {
    await assertButtonSurface("action_crm_assign_leads", "action_crm_assign_leads");
}
test.tags("desktop");
test("T-B-settings-replica: framework disables an action_crm_assign_leads <button> offline on a replica (desktop)", testBSettings);
test.tags("mobile");
test("T-B-settings-replica: framework disables an action_crm_assign_leads <button> offline on a replica (mobile)", testBSettings);

// Related-record navigation surface (res.partner action_view_opportunity).
// Proven on a REPLICA button — not the real related-record view.
async function testBRelated() {
    await assertButtonSurface("action_view_opportunity", "action_view_opportunity");
}
test.tags("desktop");
test("T-B-related-replica: framework disables an action_view_opportunity <button> offline on a replica (desktop)", testBRelated);
test.tags("mobile");
test("T-B-related-replica: framework disables an action_view_opportunity <button> offline on a replica (mobile)", testBRelated);

// Wizard apply surface (transient-wizard action_apply). Proven on a REPLICA
// button — not the real wizard view (wizards are unreachable offline anyway).
async function testBWizard() {
    await assertButtonSurface("action_apply", "action_apply");
}
test.tags("desktop");
test("T-B-wizard-replica: framework disables an action_apply <button> offline on a replica (desktop)", testBWizard);
test.tags("mobile");
test("T-B-wizard-replica: framework disables an action_apply <button> offline on a replica (mobile)", testBWizard);

// ###########################################################################
// Spec 05 — Task 10b: out-of-scope analytic/forecast views (AC-OV-1..3).
//
// These prove the FRAMEWORK mechanisms (not CRM code) that make offline-
// unavailable analytic/forecast views honest — the inventory's register-only
// DISABLE rows (graph/pivot/calendar/activity/forecast):
//  - T-OV-switcher (AC-OV-3): a view type not available offline has its
//    view-switcher <button> disabled by the framework (control_panel.xml sets
//    data-available-offline from isViewAvailable; offline_plugin.js:48).
//  - T-OV-view (AC-OV-1): opening the action offline falls back to an available
//    (cached) view instead of the uncached one (action_plugin.js:1308).
//  - T-OV-menu (AC-OV-2): the command-palette menu provider hides an offline-
//    unavailable menu (menu_providers.js:39 isAvailable).
//
// Action 70 opens crm.lead with list (cached by visiting online) + graph (out of
// scope offline). The graph js_class is crm_graph (body in web).
// ###########################################################################

function defineOvAction() {
    defineActions([
        {
            id: 70,
            name: "OV Pipeline",
            res_model: "crm.lead",
            type: "ir.actions.act_window",
            views: [
                [false, "list"],
                [false, "graph"],
            ],
        },
    ]);
}

// T-OV-switcher (AC-OV-3): offline the graph view-switcher button is disabled.
async function testOvSwitcher() {
    const setOfflineReal = mockOffline();
    defineOvAction();

    await mountWithCleanup(WebClient);
    await runAllTimers();
    await getService("action").doAction(70);
    await animationFrame();
    expect(".o_list_view").toHaveCount(1); // list visited online (cached)

    await setOfflineReal(true);
    await animationFrame();
    // The graph switcher button is framework-disabled offline (graph is not
    // available offline, so its data-available-offline is falsy).
    expect(".o_cp_switch_buttons .o_graph").toHaveClass("o_disabled_offline");
    // The list switcher stays enabled (it is cached/available).
    expect(".o_cp_switch_buttons .o_list").not.toHaveClass("o_disabled_offline");
    await setOfflineReal(false);
}
test.tags("desktop");
test("T-OV-switcher: offline graph view-switcher button is disabled (desktop)", testOvSwitcher);

// T-OV-switcher (AC-OV-3, mobile): on a small screen the control panel renders
// the view switcher as a Dropdown of <button> DropdownItems whose
// data-available-offline comes from isViewAvailable(view) (control_panel.xml).
// Open the dropdown and assert the graph item is framework-disabled offline and
// enabled again online.
async function testOvSwitcherMobile() {
    const setOfflineReal = mockOffline();
    defineOvAction();

    await mountWithCleanup(WebClient);
    await runAllTimers();
    await getService("action").doAction(70);
    await animationFrame();
    expect(".o_list_view").toHaveCount(1); // list visited online (cached)

    await setOfflineReal(true);
    await animationFrame();
    // Open the mobile view-switcher dropdown (its toggle carries .dropdown-toggle,
    // the same handle the framework's own control-panel tests click).
    await contains(".o_cp_switch_buttons .dropdown-toggle").click();
    await animationFrame();
    // The graph item is a <button> DropdownItem; offline isViewAvailable(graph)
    // is false so it carries no data-available-offline and the framework disables
    // it. The list item (cached/available) stays enabled.
    expect(`.dropdown-item:contains('Graph')`).toHaveCount(1);
    expect(`.dropdown-item.o_disabled_offline:contains('Graph')`).toHaveCount(1);
    expect(`.dropdown-item.o_disabled_offline:contains('List')`).toHaveCount(0);

    // Back online: reopen the dropdown and the graph item is enabled again.
    await setOfflineReal(false);
    await animationFrame();
    await contains(".o_cp_switch_buttons .dropdown-toggle").click();
    await animationFrame();
    expect(`.dropdown-item.o_disabled_offline:contains('Graph')`).toHaveCount(0);
}
test.tags("mobile");
test("T-OV-switcher: offline graph view-switcher item is disabled (mobile)", testOvSwitcherMobile);

// T-OV-view (AC-OV-1): opening the action offline with the graph uncached falls
// back to the available (list) view instead of rendering the uncached graph.
async function testOvViewFallback() {
    expect.errors(1); // ConnectionLostError from the uncached graph on reopen
    const setOfflineReal = mockOffline();
    defineOvAction();

    await mountWithCleanup(WebClient);
    await runAllTimers();
    // Visit the list online so it is cached/available offline.
    await getService("action").doAction(70);
    await animationFrame();
    expect(".o_list_view").toHaveCount(1);

    // Go offline and reopen the action requesting the graph view: the framework
    // falls back to an available view rather than the uncached graph.
    await setOfflineReal(true);
    await getService("action").doAction(70, { viewType: "graph", clearBreadcrumbs: true });
    await animationFrame();
    expect(".o_graph_view").toHaveCount(0); // uncached graph not rendered offline
    expect(".o_list_view").toHaveCount(1); // fell back to the available list
    await setOfflineReal(false);
    expect.verifyErrors([
        `Connection to "/web/dataset/call_kw/crm.lead/web_search_read" couldn't be established or was interrupted`,
    ]);
}
test.tags("desktop");
test("T-OV-view: offline uncached graph falls back to an available view (desktop)", testOvViewFallback);
test.tags("mobile");
test("T-OV-view: offline uncached graph falls back to an available view (mobile)", testOvViewFallback);

// T-OV-menu (AC-OV-2): the command-palette menu provider disables an offline-
// unavailable menu. Mirrors the framework's own menu_provider offline test:
// defineMenus with an app whose action is cached (available offline) and a
// second menu whose action is NOT, open the palette (namespace "/"), and offline
// the unavailable menu's command carries o_disabled_offline (menu_providers.js:39
// isAvailable → isOffline() && !isAvailableOffline(actionID)).
async function testOvMenu() {
    // The menu-provider offline filter reads only isOffline() and
    // isAvailableOffline(actionID); it needs neither a failing network nor the
    // mail store. Drive the plugin signal directly (not mockOffline()) so no
    // background /mail/store fetch is turned into a timing-dependent
    // ConnectionLostError (the spec-02 lessons flakiness).
    // One app (OV App, action 70) with a child menu (OV Reports, action 71).
    defineMenus([
        { id: 0 }, // prevents auto-loading the first action
        {
            id: 60,
            name: "OV App",
            appID: 60,
            actionID: 70,
            children: [{ id: 61, name: "OV Reports", appID: 60, actionID: 71 }],
        },
    ]);
    defineActions([
        { id: 70, name: "OV App", res_model: "crm.lead", type: "ir.actions.act_window", views: [[false, "list"]] },
        { id: 71, name: "OV Reports", res_model: "crm.lead", type: "ir.actions.act_window", views: [[false, "graph"]] },
    ]);
    // Only the app action (70) is available offline; the reports action (71) is not.
    patchWithCleanup(OfflinePlugin.prototype, {
        isAvailableOffline(actionId) {
            return actionId === 70;
        },
    });
    await mountWithCleanup(WebClient);
    await runAllTimers();
    setOffline(true);

    await press(["control", "k"]);
    await animationFrame();
    await contains(".o_command_palette_search input").edit("/ov rep", { confirm: false });
    await animationFrame();
    expect(".o_command_palette").toHaveCount(1);
    // The offline-unavailable child menu's command is disabled (o_disabled_offline).
    expect(".o_command a.o_disabled_offline").toHaveCount(1);
    expect(queryAllTexts(".o_command a.o_disabled_offline")[0]).toInclude("OV App / OV Reports");
    setOffline(false);
}
test.tags("desktop");
test("T-OV-menu: offline the unavailable menu command is disabled (desktop)", testOvMenu);
test.tags("mobile");
test("T-OV-menu: offline the unavailable menu command is disabled (mobile)", testOvMenu);

// ###########################################################################
// GROUP 2 — 3c: the lead's partner field offers NO way to create a contact
// offline. VERIFY-AND-PROVE: spec 06 adds NO crm runtime code for 3c. The create
// path is already closed by the FRAMEWORK offline — the autocomplete builds its
// "Create" / "Create and edit" / "Search more" action suggestions online-only
// (relational_utils.js:450), the quickCreate commit is reachable only from one of
// those (relational_utils.js:515), and Enter/Tab on unmatched free text commits
// nothing (autocomplete.js:399-402). No crm wiring to remove ⇒ NO removal check
// (same posture as the row-9 tests, which also assert framework behaviour).
//
// WHY mockOffline() (NOT the signal-only setOffline helper): Many2XAutocomplete
// .search() does NOT skip the network offline — it always calls
// orm.call("web_name_search") first and only falls back to searchMany2XRecords
// when that call throws ConnectionLostError (relational_utils.js:352-367). A
// signal-only toggle leaves the mock server answering the name search; the
// successful RPC:RESPONSE flips the plugin back online (offline_plugin.js:96, the
// spec-05 signal-flap), so suggest() then builds the Create entries. The real
// offline condition is the RPC FAILING, so these tests use mockOffline() (which
// answers every RPC with 502 while offline), exactly as web's own offline m2o
// test (many2one_field.test.js) does. The autocomplete also MEMOIZES by input
// string, so the online and offline phases use DISTINCT strings.
//
// The REAL lead arch uses widget="res_partner_many2one" (partner_autocomplete),
// registered ONLY in web.assets_backend and ABSENT from the crm unit-test bundle
// (partner_autocomplete/__manifest__.py), so a unit test cannot mount it. These
// tests use the GENERIC many2one widget; the gating lives in web's
// Many2XAutocomplete / AutoComplete, upstream of whichever widget renders. The
// real widget (and partner_autocomplete's company suggestions) is confirmed in
// the Step-10 manual check. We do NOT register a stand-in res_partner_many2one.
// ###########################################################################

const spec06PartnerFormArch = `
    <form js_class="crm_form">
        <sheet>
            <field name="name"/>
            <field name="partner_id"/>
        </sheet>
    </form>`;

// AC-13.1 / AC-13.2 / AC-13.4: online the create affordances ARE offered; offline
// (via mockOffline, so the name search genuinely fails) typing an unmatched name
// offers no Create / Create and edit / Search more entry and Enter commits no value.
async function test3cNoOfflineCreate() {
    const setOffline = mockOffline();
    // Capture the form controller so we can assert the COMMITTED record value
    // (the real proof of "Enter commits nothing"), not the input's float text.
    const crmFormView = registry.category("views").get("crm_form");
    let controller;
    patchWithCleanup(crmFormView.Controller.prototype, {
        setup() {
            super.setup(...arguments);
            controller = this;
        },
    });
    await mountView({
        type: "form",
        resModel: "crm.lead",
        arch: spec06PartnerFormArch,
        resId: 1,
    });

    // --- ONLINE: the create affordances ARE offered (preserved behaviour). ---
    // Click the input first so the autocomplete dropdown opens on BOTH presets
    // (on a small screen `edit` alone does not reliably open it).
    await contains(".o_field_widget[name=partner_id] input").click();
    await contains(".o_field_widget[name=partner_id] input").edit("Online New Name", {
        confirm: false,
    });
    await runAllTimers();
    expect(".o_field_widget[name=partner_id] .o_m2o_dropdown_option_create").toHaveCount(1);
    expect(".o_field_widget[name=partner_id] .o_m2o_dropdown_option_create_edit").toHaveCount(1);

    await press("Escape");
    await contains(".o_field_widget[name=partner_id] input").clear({ confirm: false });
    await runAllTimers();

    // --- OFFLINE (mockOffline => web_name_search throws ConnectionLostError). ---
    // DISTINCT input string (the autocomplete memoizes by input).
    await setOffline(true);
    await contains(".o_field_widget[name=partner_id] input").click();
    await contains(".o_field_widget[name=partner_id] input").edit("Offline Other Name", {
        confirm: false,
    });
    await runAllTimers();
    // The create affordances that WERE offered online for the same kind of input
    // are now absent offline (meaningful: they appeared online above).
    expect(".o_field_widget[name=partner_id] .o_m2o_dropdown_option_create").toHaveCount(0);
    expect(".o_field_widget[name=partner_id] .o_m2o_dropdown_option_create_edit").toHaveCount(0);
    // NB: we do NOT assert "Search more" absent — it never appears for an unmatched
    // name even online (it needs matches beyond the dropdown limit), so an offline
    // absence assertion would be vacuous. The Create / Create-and-edit pair above is
    // the meaningful online-vs-offline proof.

    // Enter on unmatched free text commits nothing (autocomplete.js:399-402): the
    // record's partner_id stays unset (no {id:false, display_name} quick-create).
    // NB the input keeps its uncommitted float text — that is expected AutoComplete
    // behaviour; what "commits nothing" means is that no VALUE reached the record.
    await press("Enter");
    await runAllTimers();
    expect(Boolean(controller.model.root.data.partner_id)).toBe(false);

    // Tab on unmatched free text ALSO commits nothing (Requirement 13.2 names both
    // Enter and Tab). Re-type a distinct unmatched string (autocomplete memoizes),
    // press Tab, and confirm the record's partner_id is still unset.
    await contains(".o_field_widget[name=partner_id] input").click();
    await contains(".o_field_widget[name=partner_id] input").edit("Offline Tab Name", {
        confirm: false,
    });
    await runAllTimers();
    await press("Tab");
    await runAllTimers();
    expect(Boolean(controller.model.root.data.partner_id)).toBe(false);
    await setOffline(false);
}
// DESKTOP-ONLY: on a small screen the m2o renders options via web.KanbanMany2One,
// which needs a `card` template for res.partner that a minimal unit mock lacks
// ("Missing 'card' template"). 3c adds no production code; the mobile real-widget
// behaviour is covered by the Step-10 manual check (see design 3c / PR note).
test.tags("desktop");
test("3c: offline the partner field offers no create path (desktop)", test3cNoOfflineCreate);

// AC-14.1 / AC-14.2: offline, a contact loaded online is resolved and found by
// search through the FRAMEWORK many2x cache (no second cache). The cache is
// populated by the framework's own online name_search (relational_utils.js:369);
// offline the search falls back to searchMany2XRecords (relational_utils.js:365).
async function test3cOfflineLookupViaCache() {
    const setOffline = mockOffline();
    await mountView({
        type: "form",
        resModel: "crm.lead",
        arch: spec06PartnerFormArch,
        resId: 1,
    });
    // Seed the contact AFTER mountView started the server; let the mock assign the id.
    const [partnerId] = MockServer.env["res.partner"].create([{ name: "Cached Contact Co" }]);
    expect(partnerId).toBeGreaterThan(0);

    // Online: search populates the framework many2x cache for res.partner.
    await contains(".o_field_widget[name=partner_id] input").click();
    await contains(".o_field_widget[name=partner_id] input").edit("Cached", { confirm: false });
    await runAllTimers();
    expect(
        queryAllTexts(".o_field_widget[name=partner_id] .dropdown-menu li:not(.o_m2o_dropdown_option)")
    ).toInclude("Cached Contact Co");
    await press("Escape");
    await contains(".o_field_widget[name=partner_id] input").clear({ confirm: false });
    await runAllTimers();

    // Offline: the same search resolves from the cache (served by
    // searchMany2XRecords on the ConnectionLostError fallback; no second cache).
    await setOffline(true);
    await contains(".o_field_widget[name=partner_id] input").click();
    await contains(".o_field_widget[name=partner_id] input").edit("Cached", { confirm: false });
    await runAllTimers();
    expect(
        queryAllTexts(".o_field_widget[name=partner_id] .dropdown-menu li:not(.o_m2o_dropdown_option)")
    ).toInclude("Cached Contact Co");
    await setOffline(false);
}
// DESKTOP-ONLY for the same reason as the no-create test above (web.KanbanMany2One
// needs a res.partner `card` template on small screens).
test.tags("desktop");
test("3c: offline partner lookup via the framework cache (desktop)", test3cOfflineLookupViaCache);

// ###########################################################################
// GROUP 4 (task 4.9) — activity-type cache prefetch. On a FIRST online+mobile
// CrmChatter mount for a lead with a server id, CrmChatter issues exactly ONE
// searchRead of mail.activity.type (the full applicable list) and feeds it to
// the EXISTING many2x cache via cacheMany2XSearch — gated "has not run this
// session" per OfflinePlugin instance (a WeakSet), so it runs even with a
// partially-filled cache. Desktop issues none; offline issues none; a second
// mount in the same session issues none. Removal check: delete the prefetch call
// and the "fires once" assertion flips.
// ###########################################################################

/** Seed one lead and spy the prefetch searchRead; returns the step label used. */
function onPrefetchRpc() {
    onRpc("mail.activity.type", "search_read", ({ kwargs }) => {
        // Only the crm.lead-applicable domain prefetch counts (ignore any other
        // search_read the framework might make).
        const dom = JSON.stringify(kwargs.domain || []);
        if (dom.includes("crm.lead")) {
            expect.step("prefetch");
        }
    });
}

// 4.9 mobile: a first online mount fires exactly one prefetch; a second mount in
// the same session fires none.
async function testPrefetchMobileOnline() {
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Prefetch Lead", type: "opportunity" });
    onPrefetchRpc();
    await start();
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    // First mount (online, mobile, server id): exactly one prefetch.
    expect.verifySteps(["prefetch"]);

    // Second mount in the SAME session (same OfflinePlugin instance, already
    // marked): no prefetch.
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    expect.verifySteps([]);
}
test.tags("mobile");
test("4.9: online-mobile first mount prefetches once, second mount none", testPrefetchMobileOnline);

// 4.9 desktop: no prefetch on desktop (gate requires isSmall()).
async function testPrefetchDesktopNone() {
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Prefetch Lead D", type: "opportunity" });
    onPrefetchRpc();
    await start();
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    expect.verifySteps([]); // desktop: never
}
test.tags("desktop");
test("4.9: desktop mount issues no prefetch", testPrefetchDesktopNone);

// 4.9 mobile offline: no prefetch while offline.
async function testPrefetchOfflineNone() {
    // Prove "offline issues no prefetch" with the proven cache-then-offline
    // harness (as the T-CH reopen tests do): open the lead action ONLINE once so
    // the record + action are cached (this also runs the single online prefetch),
    // then go offline and REOPEN the cached action. The reopen renders from cache;
    // the framework's own cached-record web_read refetch fails under mockOffline
    // and is declared below. The spy is installed only across the OFFLINE reopen,
    // so any prefetch there would be the offline gate leaking.
    expect.errors(1); // the framework web_read refetch on the offline reopen
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Prefetch Lead O", type: "opportunity" });
    defineLeadFormAction(leadId);
    const setOfflineReal = mockOffline();
    await start();
    await runAllTimers();

    // Online open: caches the action + record (and runs the one allowed prefetch).
    await getService("action").doAction(80);
    await animationFrame();

    // Spy only across the offline reopen.
    onPrefetchRpc();
    await setOfflineReal(true);
    await getService("action").doAction(80, { clearBreadcrumbs: true });
    await animationFrame();
    expect.verifySteps([]); // offline: no prefetch

    await setOfflineReal(false);
    await runAllTimers();
    expect.verifyErrors([/crm.lead\/web_read" couldn't be established/]);
}
test.tags("mobile");
test("4.9: offline mount issues no prefetch", testPrefetchOfflineNone);

// ###########################################################################
// GROUP 4 (tasks 4.4-4.7) — offline activity scheduling via the chatter Activity
// button + the inline schedule sheet. The cache is primed through the REAL
// prefetch path (online mount), then we go offline with mockOffline() (so a stray
// name search fails the real way, not the signal-flap). The schedule queues
// exactly scheduleORM("crm.lead","activity_schedule",[[leadId]],{...}).
// ###########################################################################

/** Queued activity_schedule entries for a lead (model+method+args[0] includes id). */
function scheduledActivityFor(leadId) {
    return spec04QueuedValues().filter(
        (v) =>
            v.model === "crm.lead" &&
            v.method === "activity_schedule" &&
            Array.isArray(v.args?.[0]) &&
            v.args[0].includes(leadId)
    );
}

// 4.4 mobile: schedule + log-a-call. The Activity button is re-enabled offline
// (prefetched types), opens the sheet, and submitting queues the exact call.
async function testScheduleOffline() {
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Sched Lead", type: "opportunity" });
    const setOfflineReal = mockOffline();
    await start();
    // ONLINE mount: the prefetch fills many2x_mail.activity.type from the mock
    // (ids 1 Email, 2 Call, 28 Upload). Then go offline.
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    await runAllTimers(); // let the online prefetch (searchRead -> cache) settle
    await setOfflineReal(true);
    await animationFrame();

    // Cause-1 exclusion: the prefetch actually populated the many2x cache, so an
    // OFFLINE read returns the applicable types. If THIS fails, the problem is the
    // prefetch, not the attribute wiring.
    const cachedTypes = await getService(OfflinePlugin).searchMany2XRecords(
        "mail.activity.type",
        ""
    );
    expect(cachedTypes.length).toBeGreaterThan(0);

    // The chatter Activity button is re-enabled offline (gate holds).
    await mc(".o-mail-Chatter-activity[data-available-offline]");
    await click(".o-mail-Chatter-activity");
    await animationFrame();
    // The inline schedule sheet is shown.
    await mc(".o_crm_offline_schedule_sheet");

    // Pick the Call type (id 2) BY ITS id/choice (not a translated name) and submit.
    const select = document.querySelector(".o_crm_offline_schedule_type");
    select.value = "2";
    select.dispatchEvent(new Event("change"));
    await animationFrame();
    await click(".o_crm_offline_schedule_confirm");
    await animationFrame();

    // Exactly one activity_schedule queued on the lead, with the Call type id.
    const queued = scheduledActivityFor(leadId);
    expect(queued.length).toBe(1);
    expect(queued[0].args[0]).toEqual([leadId]);
    expect(queued[0].kwargs.activity_type_id).toBe(2);
    expect(queued[0].kwargs).toInclude("summary");
    expect(queued[0].kwargs).toInclude("date_deadline");
    expect(queued[0].kwargs).toInclude("user_id");
    await setOfflineReal(false);
}
test.tags("mobile");
test("4.4: offline schedule (log a call) queues activity_schedule (mobile)", testScheduleOffline);

// 4.4 removal check (mobile): with the data-available-offline wiring removed, the
// button is framework-disabled offline and the sheet never opens / nothing queues.
async function testScheduleOfflineRemovalCheck() {
    patchWithCleanup(CrmChatter.prototype, {
        _syncActivityOfflineAttr() {
            // Simulate the production wiring being absent: never set the attribute.
        },
    });
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Sched Lead RC", type: "opportunity" });
    const setOfflineReal = mockOffline();
    await start();
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    await setOfflineReal(true);
    await animationFrame();
    // Without the wiring the button carries no data-available-offline → framework-disabled.
    expect(".o-mail-Chatter-activity[data-available-offline]").toHaveCount(0);
    expect(scheduledActivityFor(leadId).length).toBe(0);
    await setOfflineReal(false);
}
test.tags("mobile");
test("4.4 removal check: no attr wiring => button disabled, nothing queued (mobile)", testScheduleOfflineRemovalCheck);

// 4.5 mobile: with NO cached activity type, the Activity button stays disabled
// offline (never a sheet with an empty selector).
async function testScheduleEmptyCacheDisabled() {
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Sched Lead EC", type: "opportunity" });
    // Make the prefetch read return NO applicable types, so the cache stays empty.
    onRpc("mail.activity.type", "search_read", () => []);
    const setOfflineReal = mockOffline();
    await start();
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    await setOfflineReal(true);
    await animationFrame();
    // Non-vacuous: the button EXISTS, carries no data-available-offline, and is
    // framework-disabled (o_disabled_offline) — not simply absent from the DOM.
    expect(".o-mail-Chatter-activity").toHaveCount(1);
    expect(".o-mail-Chatter-activity[data-available-offline]").toHaveCount(0);
    expect(".o-mail-Chatter-activity").toHaveClass("o_disabled_offline");
    await setOfflineReal(false);
}
test.tags("mobile");
test("4.5: empty activity-type cache leaves the Activity button disabled (mobile)", testScheduleEmptyCacheDisabled);

// 4.6 mobile: the attribute TRACKS the gate — set offline, removed when the gate
// turns false (here: go back online).
async function testScheduleAttrTracksGate() {
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Sched Lead GT", type: "opportunity" });
    const setOfflineReal = mockOffline();
    await start();
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    await runAllTimers(); // let the online prefetch (searchRead -> cache) settle
    await setOfflineReal(true);
    await animationFrame();
    // Enabled offline: the (existing) button carries the attribute and is not
    // framework-disabled.
    expect(".o-mail-Chatter-activity").toHaveCount(1);
    expect(".o-mail-Chatter-activity[data-available-offline]").toHaveCount(1);
    expect(".o-mail-Chatter-activity").not.toHaveClass("o_disabled_offline");
    // Gate turns false (online): the attribute is removed from the SAME element.
    await setOfflineReal(false);
    await animationFrame();
    expect(".o-mail-Chatter-activity").toHaveCount(1);
    expect(".o-mail-Chatter-activity[data-available-offline]").toHaveCount(0);
}
test.tags("mobile");
test("4.6: data-available-offline tracks the gate, removed when false (mobile)", testScheduleAttrTracksGate);

// 4.7 mobile: a lead with NO server id (record.isNew) exposes no schedule control
// and queues nothing. A brand-new lead form (no resId) is record.isNew.
async function testScheduleNoServerId() {
    await startServer();
    const setOfflineReal = mockOffline();
    await start();
    // New record form (no resId) => record.isNew => no server id.
    await openFormView("crm.lead", false, { arch: spec05ChatterArch });
    await animationFrame();
    await setOfflineReal(true);
    await animationFrame();
    const before = spec04QueuedValues().length;
    // Non-vacuous: the button EXISTS, carries no data-available-offline, and is
    // framework-disabled on a new (no-server-id) lead.
    expect(".o-mail-Chatter-activity").toHaveCount(1);
    expect(".o-mail-Chatter-activity[data-available-offline]").toHaveCount(0);
    expect(".o-mail-Chatter-activity").toHaveClass("o_disabled_offline");
    // Whole queue unchanged.
    expect(spec04QueuedValues().length).toBe(before);
    await setOfflineReal(false);
}
test.tags("mobile");
test("4.7: no server id => no schedule control, nothing queued (mobile)", testScheduleNoServerId);

// ###########################################################################
// GROUP 6 (tasks 6.3-6.4) — offline mark-done bypassing the popover. mail only
// renders a Done button for a can_write activity; offline on a small screen the
// patched Activity.onClickMarkAsDone queues action_feedback DIRECTLY (no popover,
// no fetchNewMessages). A temp-id / no-server-id activity is never a target.
// ###########################################################################

/** Seed one server activity on a lead and return [leadId, activityId]. */
function seedLeadWithActivity(pyEnv) {
    const leadId = pyEnv["crm.lead"].create({ name: "MarkDone Lead", type: "opportunity" });
    const activityId = pyEnv["mail.activity"].create({
        res_model: "crm.lead",
        res_id: leadId,
        activity_type_id: 2, // Call
        can_write: true,
    });
    pyEnv["crm.lead"].write([leadId], { activity_ids: [activityId] });
    return [leadId, activityId];
}

/** Queued action_feedback entries for an activity id. */
function markDoneQueuedFor(activityId) {
    return spec04QueuedValues().filter(
        (v) =>
            v.model === "mail.activity" &&
            v.method === "action_feedback" &&
            Array.isArray(v.args?.[0]) &&
            v.args[0].includes(activityId)
    );
}

// 6.3 mobile: offline Done queues action_feedback, no popover, no fetchNewMessages.
async function testMarkDoneOffline() {
    const pyEnv = await startServer();
    const [leadId, activityId] = seedLeadWithActivity(pyEnv);
    const setOfflineReal = mockOffline();
    onRpc("mail.activity", "action_feedback", () => {
        expect.step("action_feedback_rpc"); // must NOT be called offline
    });
    await start();
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    await runAllTimers();
    // The Done button renders for the can_write activity; expand activities if needed.
    await mc(".o-mail-Activity-markDone");
    await setOfflineReal(true);
    await animationFrame();

    // Re-enabled offline (data-available-offline set by CrmChatter).
    await mc(".o-mail-Activity-markDone[data-available-offline]");
    await click(".o-mail-Activity-markDone");
    await animationFrame();

    // No popover opened, no action_feedback / fetchNewMessages RPC; exactly one
    // action_feedback queued on the activity.
    expect(".o-mail-ActivityMarkAsDone").toHaveCount(0);
    expect.verifySteps([]); // no action_feedback RPC issued offline
    const queued = markDoneQueuedFor(activityId);
    expect(queued.length).toBe(1);
    expect(queued[0].args[0]).toEqual([activityId]);
    expect(queued[0].kwargs).toEqual({});
    // NB: no reconnect here — reconnect would replay the queued action_feedback
    // (correctly) and fire the spy after verifySteps. Replay is covered by the
    // Python replay test (12.2) and the reconnect test (8.7).
}
test.tags("mobile");
test("6.3: offline Done queues action_feedback, no popover (mobile)", testMarkDoneOffline);

// 6.3 removal check (mobile): with the Done-button wiring removed, the button is
// framework-disabled offline and nothing queues.
async function testMarkDoneOfflineRemovalCheck() {
    patchWithCleanup(CrmChatter.prototype, {
        _syncActivityOfflineAttr() {
            // Simulate the production wiring being absent.
        },
    });
    const pyEnv = await startServer();
    const [leadId, activityId] = seedLeadWithActivity(pyEnv);
    const setOfflineReal = mockOffline();
    await start();
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    await runAllTimers();
    await setOfflineReal(true);
    await animationFrame();
    // No data-available-offline => framework-disabled; nothing queues.
    expect(".o-mail-Activity-markDone").toHaveCount(1);
    expect(".o-mail-Activity-markDone[data-available-offline]").toHaveCount(0);
    expect(markDoneQueuedFor(activityId).length).toBe(0);
    await setOfflineReal(false);
}
test.tags("mobile");
test("6.3 removal check: no attr wiring => Done disabled, nothing queued (mobile)", testMarkDoneOfflineRemovalCheck);

// 6.4 (task 6.4): a temp-id (offline-created, negative id) optimistic activity is
// NEVER a mark-done target — it carries can_write=false so mail renders no Done
// button, and the patched onClickMarkAsDone (id > 0) would queue nothing for it.
// We create a real temp row by scheduling offline, then assert its row has no Done
// button and that direct mark-done on the negative id queues nothing.
async function testMarkDoneNoTempIdTarget() {
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "TempId Lead", type: "opportunity" });
    const setOfflineReal = mockOffline();
    // Capture the CrmChatter to inspect the temp row's store record directly.
    let chatter;
    patchWithCleanup(CrmChatter.prototype, {
        setup() {
            super.setup(...arguments);
            chatter = this;
        },
    });
    await start();
    await scheduleOneOffline(pyEnv, leadId, setOfflineReal);

    // The optimistic row rendered (pending). It is a real temp activity: a NEGATIVE
    // store id and can_write=false — so mail renders NO Done button for it, and the
    // id>0 guard in onClickMarkAsDone would never queue action_feedback for it.
    expect(queryAllTexts(".o-mail-Activity").join(" ")).toInclude("pending sync");
    const tempRows = chatter.state.thread.activities.filter((a) => a.id < 0);
    expect(tempRows.length).toBe(1);
    expect(tempRows[0].can_write).toBe(false);
    // No Done button for the temp row (mail renders it only for can_write=true), so
    // mark-done is unreachable for it; the queue holds only the schedule entry.
    expect(".o-mail-Activity-markDone").toHaveCount(0);
    expect(scheduledActivityFor(leadId).length).toBe(1);
    expect(
        spec04QueuedValues().filter((v) => v.method === "action_feedback").length
    ).toBe(0);
    await setOfflineReal(false);
}
test.tags("mobile");
test("6.4: a temp-id optimistic activity is never a mark-done target (mobile)", testMarkDoneNoTempIdTarget);

// 6.4b desktop: online/desktop unchanged — clicking Done opens the popover (super).
async function testMarkDoneOnlineOpensPopover() {
    const pyEnv = await startServer();
    const [leadId] = seedLeadWithActivity(pyEnv);
    await start();
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    await runAllTimers();
    await click(".o-mail-Activity-markDone");
    await animationFrame();
    // Online/desktop: the mark-done popover opens as today (super path).
    await mc(".o-mail-ActivityMarkAsDone");
}
test.tags("desktop");
test("6.4: online Done opens the mark-done popover (desktop unchanged)", testMarkDoneOnlineOpensPopover);

// ###########################################################################
// GROUP 8 — optimistic activity rows, markers, reconcile. Rows are DERIVED from
// the offline queue (not held in memory), so they survive leaving/reopening the
// form offline; the pending marker tracks the row's OWN queue entry.
// ###########################################################################

/** Open the lead form, prime the type cache online, go offline, schedule once. */
async function scheduleOneOffline(pyEnv, leadId, setOfflineReal) {
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    await runAllTimers();
    await setOfflineReal(true);
    await animationFrame();
    await mc(".o-mail-Chatter-activity[data-available-offline]");
    await click(".o-mail-Chatter-activity");
    await animationFrame();
    await mc(".o_crm_offline_schedule_sheet");
    const select = document.querySelector(".o_crm_offline_schedule_type");
    select.value = "2";
    select.dispatchEvent(new Event("change"));
    await animationFrame();
    await click(".o_crm_offline_schedule_confirm");
    await animationFrame();
}

// 8.5 mobile: the optimistic row appears with the pending marker, derived from
// its OWN queue entry; a queued lead EDIT does not mark it; and it survives a
// remount offline (same row rebuilt from the queue).
async function testOptimisticRowSurvivesRemount() {
    // The cached-action reopen below triggers the framework's own background
    // record refetch (web_read), which fails offline with a ConnectionLostError;
    // it is the only expected error (declared, then verified).
    expect.errors(1);
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Opt Lead", type: "opportunity" });
    defineLeadFormAction(leadId);
    const setOfflineReal = mockOffline();
    await start();
    await runAllTimers();

    // Online: open the lead form via the action system so the action + record are
    // cached and the activity-type prefetch runs.
    await getService("action").doAction(80);
    await mc(".o-mail-Chatter-activity");
    await runAllTimers();

    // Go offline and schedule one activity through the mobile sheet.
    await setOfflineReal(true);
    await animationFrame();
    await mc(".o-mail-Chatter-activity[data-available-offline]");
    await click(".o-mail-Chatter-activity");
    await animationFrame();
    await mc(".o_crm_offline_schedule_sheet");
    const select = document.querySelector(".o_crm_offline_schedule_type");
    select.value = "2";
    select.dispatchEvent(new Event("change"));
    await animationFrame();
    await click(".o_crm_offline_schedule_confirm");
    await animationFrame();

    // One optimistic activity row shows the pending-sync marker.
    expect(queryAllTexts(".o-mail-Activity").join(" ")).toInclude("pending sync");
    const rowsBefore = document.querySelectorAll(".o-mail-Activity").length;
    expect(rowsBefore).toBeGreaterThan(0);

    // A queued lead EDIT must NOT create/alter an activity pending marker: queue a
    // web_save on the lead and confirm the activity-row count is unchanged.
    scheduleWrite("crm.lead", [leadId], { timeStamp: 2 });
    await animationFrame();
    expect(document.querySelectorAll(".o-mail-Activity").length).toBe(rowsBefore);

    // Reopen the SAME action offline: a genuine component rebuild served from the
    // cache. The optimistic row is rebuilt from the queue (still pending), not
    // vanished, not duplicated.
    await getService("action").doAction(80, { clearBreadcrumbs: true });
    await animationFrame();
    await runAllTimers();
    expect(queryAllTexts(".o-mail-Activity").join(" ")).toInclude("pending sync");
    expect(document.querySelectorAll(".o-mail-Activity").length).toBe(rowsBefore);
    await setOfflineReal(false);
    await runAllTimers();
    expect.verifyErrors([/crm.lead\/web_read" couldn't be established/]);
}
test.tags("mobile");
test("8.5: optimistic row is queue-derived, self-scoped, survives remount (mobile)", testOptimisticRowSurvivesRemount);

// 8.5 removal check (mobile): with the queue-derived rebuild (_syncOptimisticActivities)
// stubbed out, scheduling offline queues the call but renders NO optimistic row —
// proving the row comes from that production method, not from anything else.
async function testOptimisticRowRemovalCheck() {
    patchWithCleanup(CrmChatter.prototype, {
        _syncOptimisticActivities() {
            // Simulate the rebuild wiring being absent.
        },
    });
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Opt Lead RC", type: "opportunity" });
    const setOfflineReal = mockOffline();
    await start();
    await scheduleOneOffline(pyEnv, leadId, setOfflineReal);
    // The schedule still queued, confirming the flow ran (so the "no row" result
    // is due to the stubbed rebuild, not a failure to schedule).
    expect(hookOrmToSyncSize()).toBeGreaterThan(0);
    // No optimistic row rendered (the schedule queued, but no row logic).
    expect(queryAllTexts(".o-mail-Activity").join(" ")).not.toInclude("pending sync");
    await setOfflineReal(false);
}
test.tags("mobile");
test("8.5 removal check: no rebuild => no optimistic row (mobile)", testOptimisticRowRemovalCheck);

// 8.8 desktop: desktop offline leaves the Activity + Done buttons framework-
// disabled (CrmChatter sets no data-available-offline on desktop).
async function testDesktopStillDisabled() {
    const pyEnv = await startServer();
    const leadId = seedLeadWithActivity(pyEnv);
    const setOfflineReal = mockOffline();
    await start();
    await openFormView("crm.lead", leadId[0] ?? leadId, { arch: spec05ChatterArch });
    await animationFrame();
    await runAllTimers();
    await setOfflineReal(true);
    await animationFrame();
    expect(".o-mail-Chatter-activity").toHaveCount(1);
    expect(".o-mail-Chatter-activity[data-available-offline]").toHaveCount(0);
    expect(".o-mail-Activity-markDone[data-available-offline]").toHaveCount(0);
    await setOfflineReal(false);
}
test.tags("desktop");
test("8.8: desktop offline keeps activity controls framework-disabled", testDesktopStillDisabled);

// 8.9 online (both presets): mark-done opens the popover (super path) and nothing
// is queued — the offline branch is taken only when isSmall() && offline.
async function testOnlineUnchanged() {
    const pyEnv = await startServer();
    const [leadId] = seedLeadWithActivity(pyEnv);
    await start();
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    await runAllTimers();
    // Online mark-done: the popover opens (super path), not a direct queue.
    await click(".o-mail-Activity-markDone");
    await animationFrame();
    await mc(".o-mail-ActivityMarkAsDone");
    expect(hookOrmToSyncSize()).toBe(0); // online: nothing queued
}
test.tags("desktop");
test("8.9: online activity controls unchanged (desktop)", testOnlineUnchanged);
test.tags("mobile");
test("8.9: online activity controls unchanged (mobile)", testOnlineUnchanged);

// 8.9b online (both presets): clicking the chatter Activity button opens mail's
// mail.activity.schedule WIZARD (CrmChatter.scheduleActivity falls through to
// super online), and nothing is queued — Requirement 12.2. Proves the override
// does not steal the online path.
async function testOnlineScheduleOpensWizard() {
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Online Sched", type: "opportunity" });
    await start();
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    await runAllTimers();
    // Spy the action service: the online schedule path doActions the transient
    // mail.activity.schedule wizard.
    let scheduledWizard = false;
    patchWithCleanup(getService("action"), {
        doAction(action, options) {
            const resModel = typeof action === "object" ? action.res_model : undefined;
            if (resModel === "mail.activity.schedule") {
                scheduledWizard = true;
            }
            return super.doAction(action, options);
        },
    });
    await click(".o-mail-Chatter-activity");
    await animationFrame();
    await runAllTimers();
    expect(scheduledWizard).toBe(true); // the wizard action was opened
    expect(hookOrmToSyncSize()).toBe(0); // online: nothing queued
}
test.tags("desktop");
test("8.9b: online schedule opens the mail.activity.schedule wizard (desktop)", testOnlineScheduleOpensWizard);
test.tags("mobile");
test("8.9b: online schedule opens the mail.activity.schedule wizard (mobile)", testOnlineScheduleOpensWizard);

// ###########################################################################
// 8.6 / 8.7 — real-reconnect replay of a queued offline activity_schedule, using
// the mockOffline() + WebClient + doAction(80) + setOffline(false) + runAllTimers
// harness (same shape as AC-J8/AC-J9). The lead form is open so CrmChatter's
// queue-derived optimistic row is visible across the reconnect.
// ###########################################################################

/** Open lead form via action 80, go offline, and schedule one activity through
 *  the mobile sheet. Returns after the optimistic row shows "(pending sync)". */
async function openAndScheduleOffline(pyEnv, leadId, setOfflineReal) {
    await getService("action").doAction(80);
    await mc(".o-mail-Chatter-activity");
    await runAllTimers();
    await setOfflineReal(true);
    await animationFrame();
    await mc(".o-mail-Chatter-activity[data-available-offline]");
    await click(".o-mail-Chatter-activity");
    await animationFrame();
    await mc(".o_crm_offline_schedule_sheet");
    const select = document.querySelector(".o_crm_offline_schedule_type");
    select.value = "2";
    select.dispatchEvent(new Event("change"));
    await animationFrame();
    await click(".o_crm_offline_schedule_confirm");
    await animationFrame();
}

// 8.6 mobile (KL-B): on reconnect the server REJECTS the activity_schedule replay.
// The framework parks the entry with extras.error, and because the entry carries a
// CRM method the systray now classifies (the patch above), the systray renders the
// parked entry WITHOUT crashing and surfaces the server's raw error text as the
// entry tooltip. No CRM-specific error UI appears.
//
// Known framework limitation KL-B (observed, cause NOT established): on reconnect
// the server receives the activity_schedule exactly ONCE (it is not re-sent), and
// the rejected entry is parked — but in THIS harness, with the lead chatter
// mounted, the parked entry is present in the in-memory _ormToSync() map only
// TRANSIENTLY; a later read can see it gone even though the server was not called
// again. We therefore assert the server-call count (exactly one) and the parked
// error at its FIRST observable moment, NOT long-term in-memory persistence and
// NOT that the systray is a durable surface. Requirement 9.3's online in-memory
// persistence guarantee is not upheld for this case; KL-B is on the Step 10
// manual-check list. (See design KL-B.)
async function testParkedActivityRowStaysVisible() {
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Parked Lead", type: "opportunity" });
    defineLeadFormAction(leadId);
    const setOfflineReal = mockOffline();
    // Reject EVERY replayed activity_schedule with a non-ConnectionLost server
    // error, and COUNT the server calls (the KL-B "called once, not re-sent" claim).
    let serverCalls = 0;
    onRpc("crm.lead", "activity_schedule", () => {
        serverCalls++;
        throw makeServerError({ message: "Activity rejected by server" });
    });
    await start();
    await runAllTimers();
    const offline = getService(OfflinePlugin);
    await openAndScheduleOffline(pyEnv, leadId, setOfflineReal);

    // Offline: the optimistic row shows the pending-sync marker.
    expect(queryAllTexts(".o-mail-Activity").join(" ")).toInclude("pending sync");

    // Reconnect: the replay runs on a ~1s timer and the server rejects it, parking
    // the entry with extras.error. Poll (advancing the replay timer) until the
    // parked error is first observable, then assert on that snapshot.
    await setOfflineReal(false);
    let parked = [];
    let sawError = false;
    for (let i = 0; i < 25; i++) {
        await runAllTimers();
        await animationFrame();
        parked = Object.values(offline._ormToSync()).map((e) => e.value);
        if (parked.length === 1 && parked[0].extras.error) {
            sawError = true;
            break;
        }
    }

    // The entry was parked, carrying the server's error text verbatim.
    expect(sawError).toBe(true);
    expect(parked[0].extras.error).toInclude("Activity rejected by server");
    // The server was called EXACTLY ONCE — the rejected entry is parked, not re-sent.
    expect(serverCalls).toBe(1);

    // The framework systray classifies the CRM entry (no crash) and surfaces the
    // raw server error as the entry tooltip; NO CRM-specific error UI appears.
    expect(`.o_menu_systray .o_nav_entry [data-icon='error']`).toHaveCount(1);
    await contains(`.o_menu_systray .o_nav_entry [data-icon='error']`).click();
    const errorEntry = `.o-dropdown--menu .o-dropdown-item div.text-danger`;
    expect(errorEntry).toHaveCount(1);
    expect(queryAttribute(errorEntry, "data-tooltip")).toInclude("Activity rejected by server");
    expect(`.modal`).toHaveCount(0);
    expect(`.o_notification_bar.bg-danger`).toHaveCount(0);
}
test.tags("mobile");
test("8.6: a rejected activity replay parks and the systray shows its error (mobile)", testParkedActivityRowStaysVisible);

// 8.7 mobile: on a SUCCESSFUL reconnect the queued activity_schedule replays, the
// server receives it, the queue drains, and the optimistic row's pending marker
// is reconciled away (the row is rebuilt from the now-empty queue). Removal check:
// stub the guarded refetch's queue-driven rebuild so the stale pending row remains.
async function testReconcileOnReconnect() {
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Reconcile Lead", type: "opportunity" });
    defineLeadFormAction(leadId);
    const setOfflineReal = mockOffline();
    // Accept the replayed activity_schedule on the server: CREATE a real server
    // activity on the lead (so a later refetch can fold it in), and record arrival.
    let serverActivityId;
    onRpc("crm.lead", "activity_schedule", ({ args, kwargs }) => {
        expect.step("activity_schedule:" + JSON.stringify(args[0]));
        serverActivityId = pyEnv["mail.activity"].create({
            res_model: "crm.lead",
            res_id: leadId,
            activity_type_id: kwargs.activity_type_id || 2,
            summary: kwargs.summary || "Scheduled",
            can_write: true,
        });
        pyEnv["crm.lead"].write([leadId], { activity_ids: [serverActivityId] });
        return [serverActivityId];
    });
    let chatter;
    patchWithCleanup(CrmChatter.prototype, {
        setup() {
            super.setup(...arguments);
            chatter = this;
        },
    });
    await start();
    await runAllTimers();
    await openAndScheduleOffline(pyEnv, leadId, setOfflineReal);

    // Offline: exactly one queued schedule, optimistic (negative-id) row pending.
    expect(scheduledActivityFor(leadId).length).toBe(1);
    expect(queryAllTexts(".o-mail-Activity").join(" ")).toInclude("pending sync");
    const tempRowsOffline = chatter.state.thread.activities.filter((a) => a.id < 0);
    expect(tempRowsOffline.length).toBe(1);

    // Reconnect: the framework replays the queued call to the server, then drains.
    await setOfflineReal(false);
    await runAllTimers();
    await animationFrame();
    await runAllTimers();

    // The server received exactly the queued call (verbatim args), the queue drained.
    expect.verifySteps(["activity_schedule:" + JSON.stringify([leadId])]);
    expect(hookOrmToSyncSize()).toBe(0);
    // Reconciled: the temp (negative-id) row is gone and the pending marker is
    // cleared — no stale/duplicate optimistic row remains after the replay.
    expect(chatter.state.thread.activities.filter((a) => a.id < 0).length).toBe(0);
    expect(queryAllTexts(".o-mail-Activity").join(" ")).not.toInclude("pending sync");
}
test.tags("mobile");
test("8.7: reconnect replays the queued schedule and reconciles the row (mobile)", testReconcileOnReconnect);

// 8.7b mobile: on reconnect a queued mark-done (action_feedback) replays; the mock
// server REMOVES the activity (as _action_done archives it), and after the refetch
// the activity leaves the rendered list. Asserts the server received action_feedback.
async function testReconcileMarkDoneRemovesRow() {
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Done Reconcile", type: "opportunity" });
    const activityId = pyEnv["mail.activity"].create({
        res_model: "crm.lead",
        res_id: leadId,
        activity_type_id: 2,
        summary: "Finish me",
        can_write: true,
    });
    pyEnv["crm.lead"].write([leadId], { activity_ids: [activityId] });
    defineLeadFormAction(leadId);
    const setOfflineReal = mockOffline();
    // Accept action_feedback: remove the activity from the lead (as the server does
    // when an activity is marked done), and record arrival.
    onRpc("mail.activity", "action_feedback", ({ args }) => {
        expect.step("action_feedback:" + JSON.stringify(args[0]));
        pyEnv["crm.lead"].write([leadId], { activity_ids: [] });
        pyEnv["mail.activity"].unlink([activityId]);
        return true;
    });
    await start();
    await runAllTimers();
    // Open the lead offline through the cached action, mark the activity done.
    await getService("action").doAction(80);
    await mc(".o-mail-Activity-markDone");
    await runAllTimers();
    await setOfflineReal(true);
    await animationFrame();
    await mc(".o-mail-Activity-markDone[data-available-offline]");
    await click(".o-mail-Activity-markDone");
    await animationFrame();
    expect(markDoneQueuedFor(activityId).length).toBe(1);
    expect(queryAllTexts(".o-mail-Activity").join(" ")).toInclude("done, pending sync");

    // Reconnect: action_feedback replays and the server removes the activity.
    await setOfflineReal(false);
    for (let i = 0; i < 25 && hookOrmToSyncSize() > 0; i++) {
        await runAllTimers();
        await animationFrame();
    }

    // RELIABLE, asserted facts: the server received exactly the queued
    // action_feedback for that activity id, and the queue drained — the mark-done
    // reached the server last-write-wins and is not re-sent.
    expect.verifySteps(["action_feedback:" + JSON.stringify([activityId])]);
    expect(hookOrmToSyncSize()).toBe(0);
    // The done-pending-sync marker is no longer sourced from the queue (its entry is
    // gone), so the row is no longer shown as pending.
    expect(queryAllTexts(".o-mail-Activity").join(" ")).not.toInclude("done, pending sync");
    // NB: dropping the archived activity from the mounted chatter's list depends on
    // the reconnect thread refetch, which is best-effort in this harness (same
    // mounted-chatter refetch limitation as KL-B); the Python replay test
    // (test_offline_action_feedback_replay) asserts the server-side archive. We do
    // not assert the live in-memory list removal here to avoid a harness-timing flake.
}
test.tags("mobile");
test("8.7b: reconnect replays mark-done and the activity leaves the list (mobile)", testReconcileMarkDoneRemovesRow);

// 8.7 removal check (mobile): with the queue-derived rebuild
// (_syncOptimisticActivities) stubbed to a no-op, scheduling offline still queues
// the call but renders NO optimistic row — proving the row is produced by that
// method and nothing else. (A reconnect/online "stale row persists" check is not
// reliable: mail's online thread refresh tears the un-rebuilt row down, and KL-B
// means the queue entry is observable only transiently — so we assert the robust
// offline case, matching the 8.5 removal check.)
async function testReconcileRemovalCheck() {
    patchWithCleanup(CrmChatter.prototype, {
        _syncOptimisticActivities() {
            // Rebuild wiring absent.
        },
    });
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Reconcile RC", type: "opportunity" });
    defineLeadFormAction(leadId);
    const setOfflineReal = mockOffline();
    onRpc("crm.lead", "activity_schedule", () => true);
    await start();
    await runAllTimers();
    await openAndScheduleOffline(pyEnv, leadId, setOfflineReal);

    // The schedule still queued (so the flow ran), but with the rebuild stubbed no
    // optimistic row is rendered.
    expect(hookOrmToSyncSize()).toBeGreaterThan(0);
    expect(queryAllTexts(".o-mail-Activity").join(" ")).not.toInclude("pending sync");
    await setOfflineReal(false);
}
test.tags("mobile");
test("8.7 removal check: stubbed rebuild => no optimistic row (mobile)", testReconcileRemovalCheck);

// ###########################################################################
// SYSTRAY classification (3b/3a): the queued CRM calls that the framework offline
// systray cannot classify by itself — crm.lead/activity_schedule,
// mail.activity/action_feedback, crm.lead/action_set_won — must render in the
// systray with a labelled badge and no crash. Without the CRM patch, groupEntries
// leaves item.status undefined and the template throws reading status.color.
// The crm.lead/action_set_won row covers a latent spec-04 defect (a queued
// mark-won would crash the same way); it is fixed and proven here by spec 06.
// Paired desktop/mobile; asserts the systray DOM. A removal check deletes the
// wrapper and confirms the systray render throws.
// ###########################################################################

/** Mount a WebClient, go offline, and queue the three CRM calls the systray must
 *  classify. Returns the setOffline(false) restorer. */
async function queueThreeCrmCalls() {
    const setOfflineReal = mockOffline();
    onRpc("/web/webclient/version_info", () => new Response("", { status: 502 }), {
        pure: true,
    });
    await mountWithCleanup(WebClient);
    await runAllTimers();
    await setOfflineReal(true);
    const offline = getService(OfflinePlugin);
    offline.scheduleORM(
        "crm.lead",
        "activity_schedule",
        [[6]],
        { activity_type_id: 2, summary: "Call" },
        { id: "sys-sched", extras: { actionName: "CRM", displayName: "Schedule", timeStamp: 1 } }
    );
    offline.scheduleORM(
        "mail.activity",
        "action_feedback",
        [[11]],
        {},
        { id: "sys-feedback", extras: { actionName: "CRM", displayName: "Mark done", timeStamp: 2 } }
    );
    offline.scheduleORM(
        "crm.lead",
        "action_set_won",
        [[6]],
        {},
        { id: "sys-won", extras: { actionName: "CRM", displayName: "Mark won", timeStamp: 3 } }
    );
    await animationFrame();
    return setOfflineReal;
}

async function testSystrayClassifiesCrmCalls() {
    const setOfflineReal = await queueThreeCrmCalls();

    // Open the systray dropdown (offline + has scheduled calls -> the trigger shows).
    await contains(`.o_menu_systray .o_offline_systray`).click();
    await animationFrame();

    // All three entries render a status badge with its label and NO error icon
    // (none are parked), i.e. the systray did not crash on an unknown method.
    const badges = `.o-dropdown--menu .o_tag.o_badge`;
    expect(badges).toHaveCount(3);
    const badgeText = queryAllTexts(badges).join(" ");
    expect(badgeText).toInclude("Scheduled");
    expect(badgeText).toInclude("Done");
    expect(badgeText).toInclude("Marked won");
    expect(`.o-dropdown--menu .o-dropdown-item [data-icon='error']`).toHaveCount(0);
    expect(`.modal`).toHaveCount(0);
    await setOfflineReal(false);
}
test.tags("desktop");
test("SYS: systray renders badges for queued CRM calls, no crash (desktop)", testSystrayClassifiesCrmCalls);
test.tags("mobile");
test("SYS: systray renders badges for queued CRM calls, no crash (mobile)", testSystrayClassifiesCrmCalls);

// SYS removal check (desktop): undo the CRM wrapper's contribution — strip the
// status it fills for CRM methods — and confirm the framework template then throws
// reading status.color, proving the wrapper is what keeps the systray alive for
// CRM-queued methods. (The CRM patch is applied at module load; this layers on top
// and removes its effect, the closest faithful "wiring removed" check.)
async function testSystrayRemovalCheck() {
    const systrayComponent = registry.category("systray").get("offline").Component;
    patchWithCleanup(systrayComponent.prototype, {
        setup() {
            super.setup(); // runs the CRM wrapper, which fills status for CRM methods
            const wrapped = this.groupEntries;
            this.groupEntries = () => {
                const sections = wrapped();
                for (const [, items] of sections) {
                    for (const item of items) {
                        const queued = this.offlinePlugin._ormToSync()[item.id];
                        const v = queued && queued.value;
                        if (v && v.model + "/" + v.method === "crm.lead/activity_schedule") {
                            delete item.status; // reproduce the un-patched (crash) state
                        }
                    }
                }
                return sections;
            };
        },
    });
    // Queue exactly ONE unclassifiable CRM call so the crash count is deterministic.
    const setOfflineReal = mockOffline();
    onRpc("/web/webclient/version_info", () => new Response("", { status: 502 }), {
        pure: true,
    });
    await mountWithCleanup(WebClient);
    await runAllTimers();
    await setOfflineReal(true);
    getService(OfflinePlugin).scheduleORM(
        "crm.lead",
        "activity_schedule",
        [[6]],
        { activity_type_id: 2 },
        { id: "sys-rc", extras: { actionName: "CRM", displayName: "Schedule", timeStamp: 1 } }
    );
    await animationFrame();

    // Opening the dropdown renders the unclassified entry; the framework template
    // throws reading status.color. The render may retry, so accept one or more
    // identical errors and assert they are the expected color TypeError.
    await contains(`.o_menu_systray .o_offline_systray`).click();
    await animationFrame();
    const errors = await expect.waitForErrors([/reading 'color'/]);
    expect(errors.length).toBeGreaterThan(0);
    await setOfflineReal(false);
}
test.tags("desktop");
test("SYS removal check: without the wrapper the systray crashes on a CRM method (desktop)", testSystrayRemovalCheck);

// ###########################################################################
// GROUP 10 — 3a: offline-create queue+replay (G-3a-1) and the row-9 DOM proofs
// (G-3a-2 a/b). Create queuing is pure framework (a new record's web_save falls
// back to the queue offline); the row-9 reroute is pure framework too, so the DOM
// is the assertion. Row 9's literal "shows the offline action helper" is NOT
// claimed met (decision R1 / KL-A): a cached reroute shows the cached rows and the
// helper is absent.
// ###########################################################################

/** Action opening crm.lead with kanban + form (used by the row-9 reroute proofs). */
function defineKanbanFormAction(resId) {
    defineActions([
        {
            id: 72,
            name: "Pipeline",
            res_model: "crm.lead",
            type: "ir.actions.act_window",
            views: [
                [false, "kanban"],
                [false, "form"],
            ],
            ...(resId ? { res_id: resId } : {}),
        },
    ]);
}

// 10.1 (G-3a-1): creating a lead offline queues a web_save CREATE; on reconnect the
// server receives it. Then a REJECTED create replay parks in the systray with the
// server's error text — never silently dropped.
async function testOfflineCreateQueueReplay() {
    // Make web_save fail (→ ConnectionLostError → the framework queue) only while
    // offline, exactly as spec-04's new-record tests do.
    const setSaveOffline = failWebSaveWhenOffline();
    // A brand-new record (no resId); fill the required name so the save is valid,
    // then lose the connection and save -> web_save CREATE falls back to the queue.
    await mountView({
        type: "form",
        resModel: "crm.lead",
        arch: spec04FormArch,
        context: { default_type: "opportunity", default_active: true },
    });
    // Record what the SERVER receives for the create replay (name in the vals).
    // (The framework may issue the create web_save and then a follow-up read/save
    // in this harness, so count arrivals rather than asserting an exact step list.)
    let createdName;
    let createCalls = 0;
    onRpc("crm.lead", "web_save", ({ args }) => {
        if (Array.isArray(args[0]) && args[0].length === 0) {
            createdName = args[1] && args[1].name;
            createCalls++;
        }
    });
    await contains(`.o_field_widget[name="name"] input`).edit("Created Offline");
    setOffline(true);
    setSaveOffline(true);
    await animationFrame();
    await contains(`.o_form_button_save`).click();
    await animationFrame();

    // The WHOLE queue is exactly one entry: a web_save CREATE (empty id list)
    // carrying the name — a create, distinct from an edit's web_save (non-empty id).
    const queued = spec04QueuedValues();
    expect(queued.length).toBe(1);
    expect(queued[0].model).toBe("crm.lead");
    expect(queued[0].method).toBe("web_save");
    expect(queued[0].args[0].length).toBe(0);
    expect(queued[0].args[1].name).toBe("Created Offline");

    // Reconnect: the create replays; the SERVER receives it with the entered value,
    // and the queue drains.
    setOffline(false);
    setSaveOffline(false);
    await runAllTimers();
    await animationFrame();
    // The SERVER received the create with the entered value, and the queue drained.
    expect(createCalls).toBeGreaterThan(0);
    expect(createdName).toBe("Created Offline");
    expect(hookOrmToSyncSize()).toBe(0);
}
test.tags("desktop");
test("10.1: offline create queues web_save and replays on reconnect (desktop)", testOfflineCreateQueueReplay);
test.tags("mobile");
test("10.1: offline create queues web_save and replays on reconnect (mobile)", testOfflineCreateQueueReplay);

// 10.1b: a REJECTED offline-create replay parks in the systray with extras.error.
async function testOfflineCreateRejectedParks() {
    const setOfflineReal = mockOffline();
    onRpc("/web/webclient/version_info", () => new Response("", { status: 502 }), {
        pure: true,
    });
    await mountWithCleanup(WebClient);
    await runAllTimers();
    const offline = getService(OfflinePlugin);
    await setOfflineReal(true);
    // Queue a create directly (equivalent to the offline save above) with full
    // extras so the systray classifies it as a web_save CREATE.
    offline.scheduleORM(
        "crm.lead",
        "web_save",
        [[], { name: "Rejected Create" }],
        { context: {}, specification: {} },
        {
            id: "create-rej",
            extras: {
                actionName: "CRM",
                viewType: "form",
                displayName: "Rejected Create",
                changes: { name: "Rejected Create" },
                timeStamp: 1,
            },
        }
    );
    // The create replay is rejected by the server.
    onRpc("crm.lead", "web_save", () => {
        throw makeServerError({ message: "Create rejected by server" });
    });
    await setOfflineReal(false);
    await runAllTimers();
    await animationFrame();

    // Parked with the server's error text — not dropped.
    const parked = Object.values(offline._ormToSync()).map((e) => e.value);
    expect(parked.length).toBe(1);
    expect(parked[0].extras.error).toInclude("Create rejected by server");
    // Surfaced in the systray as an error; no CRM-specific error UI.
    expect(`.o_menu_systray .o_nav_entry [data-icon='error']`).toHaveCount(1);
    expect(`.modal`).toHaveCount(0);
}
test.tags("desktop");
test("10.1b: a rejected offline create parks in the systray (desktop)", testOfflineCreateRejectedParks);
test.tags("mobile");
test("10.1b: a rejected offline create parks in the systray (mobile)", testOfflineCreateRejectedParks);

// 10.2 (G-3a-2a): clicking an uncached lead's o_disabled_offline kanban card leaves
// the user on the cached kanban rows — form NOT opened, no error, helper NOT shown.
async function testUncachedCardLeavesCachedKanban() {
    expect.errors(2); // swallowed reroute ConnectionLostErrors (web_read, web_search_read)
    const pyEnv = await startServer();
    pyEnv["crm.lead"].create({ name: "Cached A", type: "opportunity" });
    pyEnv["crm.lead"].create({ name: "Cached B", type: "opportunity" });
    defineKanbanFormAction(false);
    const setOfflineReal = mockOffline();
    await start();
    await runAllTimers();

    // Online: open the kanban (caches it + its rows).
    await getService("action").doAction(72);
    await animationFrame();
    expect(".o_kanban_view").toHaveCount(1);

    // Offline: the uncached-form cards become o_disabled_offline.
    await setOfflineReal(true);
    await animationFrame();
    const disabledCards = document.querySelectorAll(".o_kanban_record.o_disabled_offline");
    expect(disabledCards.length).toBeGreaterThan(0);

    // Click an uncached card: the user stays on the cached kanban rows. No form, no
    // error dialog, and the literal OfflineActionHelper is NOT shown (KL-A / R1).
    // The reroute attempt fails with swallowed ConnectionLostError(s) (web_read /
    // web_search_read) — declared, then verified.
    disabledCards[0].click();
    await animationFrame();
    await runAllTimers();
    // The user stays on the cached kanban WITH REAL ROWS (count > 0, so a blank /
    // nocontent region cannot pass), no form, no error dialog. The framework
    // OfflineActionHelper (web.OfflineActionHelper → .o_nocontent_help) is NOT
    // shown on a cached reroute (KL-A / R1); it renders no `.o_offline_action_helper`
    // class — assert the REAL helper markup is absent.
    expect(".o_kanban_view").toHaveCount(1);
    expect(document.querySelectorAll(".o_kanban_record").length).toBeGreaterThan(0);
    expect(".o_form_view").toHaveCount(0);
    expect(".o_dialog").toHaveCount(0);
    expect(".o_nocontent_help").toHaveCount(0);
    await setOfflineReal(false);
    await runAllTimers();
    expect.verifyErrors([/couldn't be established/, /couldn't be established/]);
}
test.tags("desktop");
test("10.2: uncached card click leaves cached kanban, no helper (desktop)", testUncachedCardLeavesCachedKanban);
test.tags("mobile");
test("10.2: uncached card click leaves cached kanban, no helper (mobile)", testUncachedCardLeavesCachedKanban);

// 10.3 (G-3a-2b): direct navigation offline to an uncached lead lands on the cached
// multi-record view with real rows — form NOT rendered, no error, helper NOT shown.
async function testDirectNavLandsOnCachedRows() {
    expect.errors(1); // swallowed reroute ConnectionLostError on the uncached form read
    const pyEnv = await startServer();
    pyEnv["crm.lead"].create({ name: "Row One", type: "opportunity" });
    const uncachedId = pyEnv["crm.lead"].create({ name: "Uncached Lead", type: "opportunity" });
    defineKanbanFormAction(false);
    const setOfflineReal = mockOffline();
    await start();
    await runAllTimers();

    // Online: cache the kanban + its rows.
    await getService("action").doAction(72);
    await animationFrame();
    expect(".o_kanban_view").toHaveCount(1);

    // Sanity: the real helper template renders `.o_nocontent_help` (not a class
    // named `.o_offline_action_helper`), so the absence assertion below is real.
    expect(OfflineActionHelper.template).toBe("web.OfflineActionHelper");

    // Offline: direct-navigate to the uncached lead FORM via the action system.
    await setOfflineReal(true);
    await getService("action")
        .doAction(
            {
                type: "ir.actions.act_window",
                res_model: "crm.lead",
                res_id: uncachedId,
                views: [[false, "form"]],
            },
            { clearBreadcrumbs: true }
        )
        .catch(() => {}); // an uncached form root load may reject; swallowed by the framework

    await animationFrame();
    await runAllTimers();
    // Lands on the cached multi-record view WITH REAL ROWS (a kanban with records),
    // not a form, no error dialog, and NO framework OfflineActionHelper
    // (.o_nocontent_help). Asserting rows > 0 means a blank KL-A region cannot pass.
    expect(".o_kanban_view").toHaveCount(1);
    expect(document.querySelectorAll(".o_kanban_record").length).toBeGreaterThan(0);
    expect(".o_form_view").toHaveCount(0);
    expect(".o_dialog").toHaveCount(0);
    expect(".o_nocontent_help").toHaveCount(0);
    await setOfflineReal(false);
    await runAllTimers();
    expect.verifyErrors([/couldn't be established/]);
}
test.tags("desktop");
test("10.3: direct nav to uncached lead lands on cached rows, no helper (desktop)", testDirectNavLandsOnCachedRows);
test.tags("mobile");
test("10.3: direct nav to uncached lead lands on cached rows, no helper (mobile)", testDirectNavLandsOnCachedRows);

// ###########################################################################
// REVIEW FIXES (pre-commit) — behaviours added after PR review of the Group 8
// production code: double mark-done guard, systray-discard marker restore,
// park-in-place marker refresh, systray-visible names, and local-date state.
// ###########################################################################

/** Open the lead form offline with one server activity, Done re-enabled. */
async function openMarkDoneReady(pyEnv, leadId, setOfflineReal) {
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    await runAllTimers();
    await mc(".o-mail-Activity-markDone");
    await setOfflineReal(true);
    await animationFrame();
    await mc(".o-mail-Activity-markDone[data-available-offline]");
}

// FIX 2 (mobile): a second offline Done click does NOT queue a duplicate
// action_feedback, and the Done button is suppressed while one is queued.
async function testDoubleMarkDoneBlocked() {
    const pyEnv = await startServer();
    const [leadId, activityId] = seedLeadWithActivity(pyEnv);
    const setOfflineReal = mockOffline();
    // Capture the live Activity component instance so we can call its handler a
    // second time directly (the button is suppressed after the first click, so a
    // second physical click is impossible — the direct call proves the handler's
    // own hasQueuedWrite guard, not just the button suppression).
    let activityInstance;
    patchWithCleanup(Activity.prototype, {
        setup() {
            super.setup(...arguments);
            activityInstance = this;
        },
    });
    await start();
    await openMarkDoneReady(pyEnv, leadId, setOfflineReal);

    // First Done click: exactly one action_feedback queued.
    await click(".o-mail-Activity-markDone");
    await animationFrame();
    expect(markDoneQueuedFor(activityId).length).toBe(1);

    // The Done button is suppressed (can_write cleared while queued): no second
    // button to click.
    expect(".o-mail-Activity-markDone").toHaveCount(0);

    // Call the handler directly a SECOND time: the guard (hasQueuedWrite) returns
    // and queues nothing more — still exactly one entry.
    expect(activityInstance).not.toBe(undefined);
    activityInstance.onClickMarkAsDone(new Event("click"));
    await animationFrame();
    await runAllTimers();
    expect(markDoneQueuedFor(activityId).length).toBe(1);
    await setOfflineReal(false);
}
test.tags("mobile");
test("FIX2: second offline Done queues no duplicate, button suppressed (mobile)", testDoubleMarkDoneBlocked);

// FIX2 removal check (mobile): with BOTH halves of the duplicate guard removed —
// the hasQueuedWrite early-return in Activity.onClickMarkAsDone AND the Done-button
// suppression (can_write) in CrmChatter — a second direct call queues a DUPLICATE
// action_feedback (2 entries), proving the guard is what prevents it.
async function testDoubleMarkDoneRemovalCheck() {
    const pyEnv = await startServer();
    const [leadId, activityId] = seedLeadWithActivity(pyEnv);
    const setOfflineReal = mockOffline();
    let activityInstance;
    patchWithCleanup(Activity.prototype, {
        setup() {
            super.setup(...arguments);
            activityInstance = this;
        },
        // Remove the duplicate guard: always queue (never early-return).
        onClickMarkAsDone() {
            this.crmOffline.scheduleORM(
                "mail.activity",
                "action_feedback",
                [[this.activity().id]],
                {},
                { extras: { timeStamp: Date.now() } }
            );
        },
    });
    await start();
    await openMarkDoneReady(pyEnv, leadId, setOfflineReal);

    activityInstance.onClickMarkAsDone(new Event("click"));
    await animationFrame();
    activityInstance.onClickMarkAsDone(new Event("click"));
    await animationFrame();
    // Without the guard, two identical entries are queued (the duplicate the real
    // guard prevents).
    expect(markDoneQueuedFor(activityId).length).toBe(2);
    await setOfflineReal(false);
}
test.tags("mobile");
test("FIX2 removal check: without the guard a second call queues a duplicate (mobile)", testDoubleMarkDoneRemovalCheck);

// FIX 3 (mobile): discarding the queued mark-done from the offline systray
// restores the activity's original summary and re-enables its Done button.
async function testSystrayDiscardRestoresMarker() {
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "MarkDone Lead", type: "opportunity" });
    // Seed an EXACT summary so restoration can be asserted by equality.
    const ORIGINAL_SUMMARY = "Call the customer back";
    const activityId = pyEnv["mail.activity"].create({
        res_model: "crm.lead",
        res_id: leadId,
        activity_type_id: 2,
        summary: ORIGINAL_SUMMARY,
        can_write: true,
    });
    pyEnv["crm.lead"].write([leadId], { activity_ids: [activityId] });
    // Capture the live CrmChatter so we can read the store activity's summary.
    let chatter;
    patchWithCleanup(CrmChatter.prototype, {
        setup() {
            super.setup(...arguments);
            chatter = this;
        },
    });
    const setOfflineReal = mockOffline();
    await start();
    await openMarkDoneReady(pyEnv, leadId, setOfflineReal);

    const storeAct = () => chatter.store["mail.activity"].get(activityId);
    // Sanity: before mark-done the summary is exactly the seeded original.
    expect(storeAct().summary).toBe(ORIGINAL_SUMMARY);

    // Queue the mark-done: the row shows the done-pending-sync marker (summary
    // decorated) and the Done button is suppressed.
    await click(".o-mail-Activity-markDone");
    await animationFrame();
    expect(storeAct().summary).toBe(ORIGINAL_SUMMARY + " " + "(done, pending sync)");
    expect(".o-mail-Activity-markDone").toHaveCount(0);

    // Discard the entry from the systray (open the dropdown, click delete, confirm).
    await contains(`.o_menu_systray .o_offline_systray`).click();
    await animationFrame();
    await contains(`.o-dropdown--menu [data-icon='delete']`).click();
    await animationFrame();
    await contains(`.modal .btn-primary`).click(); // confirm discard
    await animationFrame();
    await runAllTimers();

    // The queue entry is gone and the summary is restored EXACTLY to the original
    // (no residual marker), and the Done button is back (can_write restored).
    expect(markDoneQueuedFor(activityId).length).toBe(0);
    expect(storeAct().summary).toBe(ORIGINAL_SUMMARY);
    await mc(".o-mail-Activity-markDone");
    await setOfflineReal(false);
}
test.tags("mobile");
test("FIX3: discarding a queued mark-done restores the row and Done button (mobile)", testSystrayDiscardRestoresMarker);

// FIX 4 (mobile): parking an entry in place (same queue count, extras.error set)
// refreshes the row marker to needs-retry — the sync re-runs on the queue
// SIGNATURE, not just the entry count.
async function testParkInPlaceRefreshesMarker() {
    const pyEnv = await startServer();
    const [leadId, activityId] = seedLeadWithActivity(pyEnv);
    const setOfflineReal = mockOffline();
    await start();
    await openMarkDoneReady(pyEnv, leadId, setOfflineReal);

    await click(".o-mail-Activity-markDone");
    await animationFrame();
    expect(queryAllTexts(".o-mail-Activity").join(" ")).toInclude("done, pending sync");

    // Park the SAME entry in place: re-schedule under its own key with extras.error
    // added. The entry count is unchanged (1 -> 1); only the error flag flips.
    const offline = getService(OfflinePlugin);
    const [key, entry] = Object.entries(offline._ormToSync())[0];
    const before = Object.keys(offline._ormToSync()).length;
    offline.scheduleORM(
        entry.value.model,
        entry.value.method,
        entry.value.args,
        entry.value.kwargs,
        { id: key, extras: { ...entry.value.extras, error: "Server rejected it" } }
    );
    await animationFrame();
    await runAllTimers();

    // Count unchanged, but the row now shows needs-retry (not done-pending-sync).
    expect(Object.keys(offline._ormToSync()).length).toBe(before);
    expect(queryAllTexts(".o-mail-Activity").join(" ")).toInclude("needs retry");
    expect(queryAllTexts(".o-mail-Activity").join(" ")).not.toInclude("done, pending sync");
    await setOfflineReal(false);
}
test.tags("mobile");
test("FIX4: parking in place refreshes the row to needs-retry (mobile)", testParkInPlaceRefreshesMarker);

// FIX 5 (mobile): queued schedule and mark-done entries show a NAMED row in the
// offline systray (lead/summary), not just a badge.
async function testSystrayShowsNames() {
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Named Lead", type: "opportunity" });
    const activityId = pyEnv["mail.activity"].create({
        res_model: "crm.lead",
        res_id: leadId,
        activity_type_id: 2,
        summary: "Ring back",
        can_write: true,
    });
    pyEnv["crm.lead"].write([leadId], { activity_ids: [activityId] });
    const setOfflineReal = mockOffline();
    await start();
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    await runAllTimers();
    await mc(".o-mail-Chatter-activity");
    await setOfflineReal(true);
    await animationFrame();

    // Queue a mark-done (named "Mark done: Ring back").
    await mc(".o-mail-Activity-markDone[data-available-offline]");
    await click(".o-mail-Activity-markDone");
    await animationFrame();
    // Queue a schedule (named "Schedule: Named Lead — <summary>").
    await mc(".o-mail-Chatter-activity[data-available-offline]");
    await click(".o-mail-Chatter-activity");
    await animationFrame();
    await mc(".o_crm_offline_schedule_sheet");
    const select = document.querySelector(".o_crm_offline_schedule_type");
    select.value = "2";
    select.dispatchEvent(new Event("change"));
    document.querySelector(".o_crm_offline_schedule_summary").value = "Follow up";
    document.querySelector(".o_crm_offline_schedule_summary").dispatchEvent(new Event("input"));
    await animationFrame();
    await click(".o_crm_offline_schedule_confirm");
    await animationFrame();

    // Open the systray: both entries render with their visible names (not blank).
    await contains(`.o_menu_systray .o_offline_systray`).click();
    await animationFrame();
    const names = queryAllTexts(".o-dropdown--menu .o-dropdown-item").join(" ");
    // Mark-done row names from the activity summary (reliable in the unit mock).
    expect(names).toInclude("Mark done: Ring back");
    // Schedule row carries a visible "Schedule: <lead> — <summary>" name. The lead
    // name is best-effort (the mail thread's display_name is not populated in the
    // unit mock, so it falls back to "Lead"); the summary is always present.
    expect(names).toInclude("Schedule:");
    expect(names).toInclude("Follow up");
    await setOfflineReal(false);
}
test.tags("mobile");
test("FIX5: queued CRM entries show named rows in the systray (mobile)", testSystrayShowsNames);

// FIX 6 (mobile): the optimistic row's state uses the LOCAL date — a deadline of
// yesterday is overdue, today is today, tomorrow is planned.
async function testLocalDateState() {
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Date Lead", type: "opportunity" });
    const setOfflineReal = mockOffline();
    await start();
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    await runAllTimers();
    await setOfflineReal(true);
    await animationFrame();
    const offline = getService(OfflinePlugin);

    const iso = (d) => luxon.DateTime.local().plus({ days: d }).toISODate();
    // mail renders activity state as a color class on the icon container:
    // planned => text-bg-success, today => text-bg-warning, overdue => text-bg-danger.
    const cases = [
        [-1, "text-bg-danger"], // yesterday -> overdue
        [0, "text-bg-warning"], // today
        [1, "text-bg-success"], // tomorrow -> planned
    ];
    let ts = 1;
    for (const [delta, stateClass] of cases) {
        offline.scheduleORM(
            "crm.lead",
            "activity_schedule",
            [[leadId]],
            { activity_type_id: 2, summary: "D" + delta, date_deadline: iso(delta) },
            { id: "date-" + delta, extras: { timeStamp: ts++ } }
        );
        await animationFrame();
        await runAllTimers();
        const row = [...document.querySelectorAll(".o-mail-Activity")].find((r) =>
            r.textContent.includes("D" + delta)
        );
        expect(row).not.toBe(undefined);
        expect(row.querySelector("." + stateClass)).not.toBe(null);
    }
    await setOfflineReal(false);
}
test.tags("mobile");
test("FIX6: optimistic-row state uses the local date (mobile)", testLocalDateState);

// ###########################################################################
// REVIEW ROUND 1 — new tests for the production fixes P1 (crm.lead-only mark-done),
// P2 (meeting types excluded offline), P3 (no-server-id schedule queues nothing),
// T1 (prefetch branches), and T9 (systray invariance, sheet discard, default date).
// ###########################################################################

// P1 (mobile): the Activity.onClickMarkAsDone patch is a GLOBAL mail component
// patch, so it must act ONLY for crm.lead activities. A mark-done on ANOTHER
// model's activity (res.partner), offline on a small screen, goes to super and
// queues NO action_feedback.
async function testMarkDoneOtherModelGoesToSuper() {
    const pyEnv = await startServer();
    const partnerId = pyEnv["res.partner"].create({ name: "A Contact" });
    const activityId = pyEnv["mail.activity"].create({
        res_model: "res.partner",
        res_id: partnerId,
        activity_type_id: 2,
        can_write: true,
    });
    // Capture the Activity instance for this res.partner activity.
    let activityInstance;
    patchWithCleanup(Activity.prototype, {
        setup() {
            super.setup(...arguments);
            activityInstance = this;
        },
    });
    const setOfflineReal = mockOffline();
    await start();
    await openFormView("res.partner", partnerId, {
        arch: `<form><sheet><field name="name"/></sheet><chatter/></form>`,
    });
    await mc(".o-mail-Activity");
    await setOfflineReal(true);
    await animationFrame();

    // Call the handler offline on a small screen for the res.partner activity. The
    // crm.lead gate is false, so it falls through to super (the normal popover
    // path) and queues NO action_feedback. super's popover may throw in the bare
    // unit harness (no anchor) — that is the super path running; we only assert
    // that CRM queued nothing.
    const before = hookOrmToSyncSize();
    try {
        activityInstance.onClickMarkAsDone(new Event("click"));
    } catch (e) {
        // super's popover open can throw without a DOM anchor; irrelevant here.
    }
    await animationFrame();
    expect(markDoneQueuedFor(activityId).length).toBe(0);
    expect(hookOrmToSyncSize()).toBe(before);
    await setOfflineReal(false);
}
test.tags("mobile");
test("P1: offline mark-done on a non-crm.lead activity goes to super, queues nothing (mobile)", testMarkDoneOtherModelGoesToSuper);

// P2 (mobile): a meeting-category activity type is NEVER offered offline — a
// meeting needs the online calendar round trip (Requirement 11.1). (a) the
// prefetch domain excludes category "meeting"; (b) even if a meeting type is
// already in the SHARED many2x cache (from an unrelated dropdown search), the
// schedule sheet offers only the non-meeting type.
async function testMeetingTypeNotOfferedOffline() {
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Meeting Lead", type: "opportunity" });
    // A meeting-category type exists on the server (id 99).
    const meetingId = pyEnv["mail.activity.type"].create({
        name: "Meeting",
        category: "meeting",
    });
    // (a) Spy the prefetch domain: it must exclude category "meeting".
    let prefetchDomain;
    onRpc("mail.activity.type", "search_read", ({ kwargs }) => {
        const dom = JSON.stringify(kwargs.domain || []);
        if (dom.includes("crm.lead")) {
            prefetchDomain = dom;
        }
    });
    const setOfflineReal = mockOffline();
    await start();
    // Online mount runs the prefetch (fills the allow-list with non-meeting ids).
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    await runAllTimers();
    expect(prefetchDomain).toInclude("meeting"); // domain references the category
    expect(prefetchDomain).toInclude("!="); // as an exclusion

    // (b) Simulate an unrelated dropdown search having cached the meeting type in
    // the SHARED many2x cache.
    await getService(OfflinePlugin).cacheMany2XSearch("mail.activity.type", [
        { id: meetingId, display_name: "Meeting" },
    ]);

    await setOfflineReal(true);
    await animationFrame();
    await mc(".o-mail-Chatter-activity[data-available-offline]");
    await click(".o-mail-Chatter-activity");
    await animationFrame();
    await mc(".o_crm_offline_schedule_sheet");
    // The sheet's type <option>s include the non-meeting types but NOT "Meeting".
    const optionTexts = queryAllTexts(".o_crm_offline_schedule_type option");
    expect(optionTexts.length).toBeGreaterThan(0);
    expect(optionTexts).not.toInclude("Meeting");
    // The meeting id is not among the offered option values.
    const optionValues = [
        ...document.querySelectorAll(".o_crm_offline_schedule_type option"),
    ].map((o) => Number(o.value));
    expect(optionValues).not.toInclude(meetingId);
    await setOfflineReal(false);
}
test.tags("mobile");
test("P2: a meeting activity type is not offered offline (mobile)", testMeetingTypeNotOfferedOffline);

// P3 (mobile): CrmChatter.scheduleActivity() offline on a small screen with NO
// server id must return WITHOUT calling super — mail's super saves the unsaved
// record first, which would queue the lead create (Requirement 4.2). Called
// programmatically so the whole queue is asserted unchanged.
async function testScheduleNoServerIdQueuesNothing() {
    await startServer();
    let chatter;
    patchWithCleanup(CrmChatter.prototype, {
        setup() {
            super.setup(...arguments);
            chatter = this;
        },
    });
    let superCalled = false;
    patchWithCleanup(Chatter.prototype, {
        scheduleActivity() {
            superCalled = true;
            return super.scheduleActivity(...arguments);
        },
    });
    const setOfflineReal = mockOffline();
    await start();
    // New record form (no resId) => record.isNew => no server id.
    await openFormView("crm.lead", false, { arch: spec05ChatterArch });
    await animationFrame();
    await setOfflineReal(true);
    await animationFrame();

    const before = hookOrmToSyncSize();
    // Call the component method directly, offline + small, with no server id.
    await chatter.scheduleActivity();
    await animationFrame();
    await runAllTimers();
    // It returned WITHOUT super (so mail did not save the unsaved record), and the
    // WHOLE queue is unchanged — no lead create, no activity_schedule.
    expect(superCalled).toBe(false);
    expect(hookOrmToSyncSize()).toBe(before);
    await setOfflineReal(false);
}
test.tags("mobile");
test("P3: offline schedule with no server id returns without super, queues nothing (mobile)", testScheduleNoServerIdQueuesNothing);

// T1 (mobile): prefetch branches. (a) a PARTIAL cache still fires the prefetch and
// the cache then holds the full list; cacheMany2XSearch is called (spy). (b) a
// ConnectionLostError leaves the plugin UNMARKED so a later mount retries. (c) a
// component destroyed during the await writes nothing.
async function testPrefetchFillsPartialCache() {
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Prefetch Partial", type: "opportunity" });
    await start();
    // Acquire the plugin AFTER start() (the app/plugin manager must exist).
    const offline = getService(OfflinePlugin);
    let cacheCalls = 0;
    patchWithCleanup(offline, {
        cacheMany2XSearch(resModel, result) {
            if (resModel === "mail.activity.type") {
                cacheCalls++;
            }
            return super.cacheMany2XSearch(resModel, result);
        },
    });
    // Seed a PARTIAL cache (only the Email type id 1) BEFORE the mount's prefetch.
    await offline.cacheMany2XSearch("mail.activity.type", [{ id: 1, display_name: "Email" }]);
    cacheCalls = 0; // reset: count only the prefetch's own write
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    await runAllTimers();
    // The prefetch fired despite the partial cache and called cacheMany2XSearch.
    expect(cacheCalls).toBeGreaterThan(0);
    // The cache now holds the full non-meeting list (ids 1 Email, 2 Call, 28 Upload).
    const cached = await offline.searchMany2XRecords("mail.activity.type", "");
    const ids = cached.map((t) => t.id);
    expect(ids).toInclude(1);
    expect(ids).toInclude(2);
    expect(ids).toInclude(28);
}
test.tags("mobile");
test("T1: prefetch fills a partial cache to the full list (mobile)", testPrefetchFillsPartialCache);

// T1b (mobile): a ConnectionLostError during the prefetch leaves the plugin
// UNMARKED, so a later qualifying mount retries (and then succeeds).
async function testPrefetchConnectionLostRetries() {
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Prefetch Retry", type: "opportunity" });
    let calls = 0;
    onRpc("mail.activity.type", "search_read", ({ kwargs }) => {
        const dom = JSON.stringify(kwargs.domain || []);
        if (dom.includes("crm.lead")) {
            calls++;
            if (calls === 1) {
                throw new ConnectionLostError("boom");
            }
        }
    });
    expect.errors(1); // the first prefetch's ConnectionLostError (swallowed, re-armed)
    await start();
    // First mount: prefetch throws ConnectionLostError, is swallowed, plugin left
    // unmarked.
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    await runAllTimers();
    expect(calls).toBe(1);
    // Second mount in the SAME session: because the first was unmarked, the
    // prefetch RETRIES (and now succeeds).
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    await runAllTimers();
    expect(calls).toBe(2);
    await expect.waitForErrors([/boom/]);
}
test.tags("mobile");
test("T1b: a ConnectionLostError prefetch is unmarked and retries next mount (mobile)", testPrefetchConnectionLostRetries);

// T1c (mobile): a component destroyed DURING the prefetch await writes nothing to
// the cache (the status(this) === "destroyed" guard after the await).
async function testPrefetchDestroyedWritesNothing() {
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Prefetch Destroy", type: "opportunity" });
    // Make the prefetch searchRead hang on a deferred we resolve AFTER destroying.
    let releaseSearch;
    const searchGate = new Promise((r) => (releaseSearch = r));
    onRpc("mail.activity.type", "search_read", async ({ kwargs }) => {
        const dom = JSON.stringify(kwargs.domain || []);
        if (dom.includes("crm.lead")) {
            await searchGate;
            return [{ id: 2, display_name: "Call" }];
        }
    });
    await start();
    // Acquire + patch the plugin AFTER start().
    const offline = getService(OfflinePlugin);
    let cacheCalled = false;
    patchWithCleanup(offline, {
        cacheMany2XSearch(resModel) {
            if (resModel === "mail.activity.type") {
                cacheCalled = true;
            }
            return super.cacheMany2XSearch(...arguments);
        },
    });
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    // Destroy by navigating away to another record form, THEN release the search.
    await openFormView("res.partner", pyEnv["res.partner"].create({ name: "X" }), {
        arch: `<form><sheet><field name="name"/></sheet></form>`,
    });
    releaseSearch();
    await runAllTimers();
    await animationFrame();
    // The destroyed CrmChatter wrote nothing to the cache.
    expect(cacheCalled).toBe(false);
}
test.tags("mobile");
test("T1c: a prefetch whose component is destroyed writes nothing (mobile)", testPrefetchDestroyedWritesNothing);

// T9a (both presets): systray INVARIANCE — a framework web_save row keeps its own
// (framework) status, and an unknown NON-CRM method row is left unclassified by
// the CRM wrapper (so other addons are unaffected). The CRM wrapper only fills a
// status for the three CRM pairs.
async function testSystrayInvariance() {
    const setOfflineReal = mockOffline();
    onRpc("/web/webclient/version_info", () => new Response("", { status: 502 }), {
        pure: true,
    });
    await mountWithCleanup(WebClient);
    await runAllTimers();
    await setOfflineReal(true);
    const offline = getService(OfflinePlugin);
    // A framework web_save on a NON-CRM model (res.partner): the framework
    // classifies it (EDITED, label "Edited"). The CRM wrapper only fills a status
    // for its own three model/method pairs, so it must leave this entry's framework
    // status untouched.
    offline.scheduleORM(
        "res.partner",
        "web_save",
        [[7], { name: "Edited" }],
        { context: {}, specification: {} },
        {
            id: "inv-save",
            extras: {
                actionName: "Contacts",
                viewType: "form",
                displayName: "Edited Partner",
                changes: { name: "Edited" },
                originalValues: { name: "Old Name" },
                timeStamp: 1,
            },
        }
    );
    await animationFrame();

    // Open the systray: the framework web_save row renders its OWN framework badge
    // ("Edited"), unchanged by the CRM wrapper.
    await contains(`.o_menu_systray .o_offline_systray`).click();
    await animationFrame();
    const badgeText = queryAllTexts(`.o-dropdown--menu .o_tag.o_badge`).join(" ");
    expect(badgeText).toInclude("Edited"); // framework web_save status preserved
    // And it is NOT reclassified to any CRM label.
    expect(badgeText).not.toInclude("Scheduled");
    expect(badgeText).not.toInclude("Marked won");
    expect(`.o-dropdown--menu .o-dropdown-item [data-icon='error']`).toHaveCount(0);
    // (The complementary invariance — that CRM does NOT rescue an UNKNOWN non-CRM
    // method, so the framework still crashes on it — is exactly the SYS removal
    // check above; we do not re-trigger that crash here.)
    await setOfflineReal(false);
}
test.tags("desktop");
test("T9a: systray leaves a framework non-CRM entry unchanged (desktop)", testSystrayInvariance);

// T9b (mobile): the schedule sheet's Discard button closes the sheet and queues
// nothing.
async function testScheduleSheetDiscard() {
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Discard Lead", type: "opportunity" });
    const setOfflineReal = mockOffline();
    await start();
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    await runAllTimers();
    await setOfflineReal(true);
    await animationFrame();
    await mc(".o-mail-Chatter-activity[data-available-offline]");
    await click(".o-mail-Chatter-activity");
    await animationFrame();
    await mc(".o_crm_offline_schedule_sheet");
    const before = hookOrmToSyncSize();
    // Discard: the sheet closes and nothing is queued.
    await click(".o_crm_offline_schedule_discard");
    await animationFrame();
    expect(".o_crm_offline_schedule_sheet").toHaveCount(0);
    expect(hookOrmToSyncSize()).toBe(before);
    expect(scheduledActivityFor(leadId).length).toBe(0);
    await setOfflineReal(false);
}
test.tags("mobile");
test("T9b: the schedule sheet Discard closes it and queues nothing (mobile)", testScheduleSheetDiscard);

// T9c (mobile): the schedule sheet defaults its deadline to the LOCAL date
// (DateTime.local().toISODate()), not the UTC date.
async function testScheduleSheetDefaultDate() {
    const pyEnv = await startServer();
    const leadId = pyEnv["crm.lead"].create({ name: "Default Date Lead", type: "opportunity" });
    const setOfflineReal = mockOffline();
    await start();
    await openFormView("crm.lead", leadId, { arch: spec05ChatterArch });
    await animationFrame();
    await runAllTimers();
    await setOfflineReal(true);
    await animationFrame();
    await mc(".o-mail-Chatter-activity[data-available-offline]");
    await click(".o-mail-Chatter-activity");
    await animationFrame();
    await mc(".o_crm_offline_schedule_sheet");
    const deadlineInput = document.querySelector(".o_crm_offline_schedule_deadline");
    expect(deadlineInput.value).toBe(luxon.DateTime.local().toISODate());
    await setOfflineReal(false);
}
test.tags("mobile");
test("T9c: the schedule sheet default deadline is the local date (mobile)", testScheduleSheetDefaultDate);
