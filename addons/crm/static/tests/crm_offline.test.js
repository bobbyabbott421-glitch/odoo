import { Component, xml } from "@odoo/owl";
import { animationFrame, expect, queryAllTexts, runAllTimers, test } from "@odoo/hoot";
import { queryAttribute } from "@odoo/hoot-dom";
import { defineMailModels } from "@mail/../tests/mail_test_helpers";
import {
    contains,
    defineModels,
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
import { registry } from "@web/core/registry";
import { WebClient } from "@web/webclient/webclient";
import { useCrmOffline } from "@crm/mobile/crm_offline_hooks";

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
        },
    ];
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
