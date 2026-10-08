import { animationFrame, expect, queryAllTexts, test } from "@odoo/hoot";
import { defineMailModels } from "@mail/../tests/mail_test_helpers";
import {
    defineModels,
    fields,
    getService,
    models,
    mountView,
    mountWithCleanup,
    MockServer,
    patchWithCleanup,
} from "@web/../tests/web_test_helpers";
import { OfflinePlugin } from "@web/core/offline/offline_plugin";
import { registry } from "@web/core/registry";
import { CrmMobilePipeline } from "@crm/mobile/crm_mobile_pipeline/crm_mobile_pipeline";

// The webclient services started behind `mountView` resolve mail models, so the
// mail test models must be defined (mirrors crm_offline.test.js). res.partner /
// res.currency come from defineMailModels().
defineMailModels();

/**
 * Local mock models for the mobile pipeline tests. Field TYPES match production
 * (crm_lead.py / crm_stage.py): stage_id Many2one(crm.stage), expected_revenue
 * Integer summed, team_id Many2one(crm.team). Three stages (so three columns);
 * one lead per stage.
 */
class Stage extends models.Model {
    _name = "crm.stage";
    name = fields.Char();
    is_won = fields.Boolean();
    _records = [
        { id: 1, name: "New" },
        { id: 2, name: "Qualified" },
        { id: 3, name: "Won", is_won: true },
    ];
}

class Team extends models.Model {
    _name = "crm.team";
    name = fields.Char();
    _records = [{ id: 1, name: "Sales" }];
}

class Lead extends models.Model {
    _name = "crm.lead";
    name = fields.Char({ required: true });
    type = fields.Char();
    active = fields.Boolean();
    contact_name = fields.Char();
    partner_name = fields.Char();
    stage_id = fields.Many2one({ string: "Stage", relation: "crm.stage" });
    team_id = fields.Many2one({ string: "Sales Team", relation: "crm.team" });
    activity_state = fields.Char();
    expected_revenue = fields.Integer({ string: "Revenue", aggregator: "sum" });
    _records = [
        {
            id: 1,
            name: "Lead A",
            type: "opportunity",
            active: true,
            stage_id: 1,
            team_id: 1,
            expected_revenue: 100,
            activity_state: "planned",
        },
        {
            id: 2,
            name: "Lead B",
            type: "opportunity",
            active: true,
            stage_id: 2,
            team_id: 1,
            expected_revenue: 250,
            activity_state: "today",
        },
        {
            id: 3,
            name: "Lead C",
            type: "opportunity",
            active: true,
            stage_id: 3,
            team_id: 1,
            expected_revenue: 70,
            activity_state: "planned",
        },
    ];
}

defineModels([Lead, Stage, Team]);

// A production-shaped pipeline arch carrying the `o_opportunity_kanban` MARKER
// class (the discriminator for pipeline mode, spec 08 D11/D12 — the class on the
// real stage pipeline crm_case_kanban_view_leads), with the expected_revenue
// progressbar sum_field so the header revenue sum has an aggregate to read.
const PIPELINE_ARCH = `
    <kanban class="o_opportunity_kanban" js_class="crm_kanban">
        <field name="stage_id"/>
        <field name="expected_revenue"/>
        <field name="activity_state"/>
        <progressbar field="activity_state" colors='{"planned": "success", "today": "warning", "overdue": "danger"}' sum_field="expected_revenue"/>
        <templates>
            <t t-name="card">
                <field class="o_crm_card_name" name="name"/>
                <field class="o_crm_card_expected_revenue" name="expected_revenue"/>
            </t>
        </templates>
    </kanban>`;

// A board arch WITHOUT the marker (as every spec-07 test arch is): pipeline mode
// must NOT activate, so the base column row + the spec-07 strip render.
const PLAIN_ARCH = `
    <kanban js_class="crm_kanban">
        <field name="stage_id"/>
        <field name="expected_revenue"/>
        <field name="activity_state"/>
        <progressbar field="activity_state" colors='{"planned": "success"}' sum_field="expected_revenue"/>
        <templates>
            <t t-name="card"><field name="name"/></t>
        </templates>
    </kanban>`;

/** Drive the framework offline signal directly (no mockOffline catch-all). */
function setOffline(offline) {
    getService(OfflinePlugin).setOffline(offline);
}

/**
 * Mount the REAL crm_kanban view (production registry entry, no { force: true })
 * grouped by stage_id with the given arch, and capture the live model + renderer
 * so tests can navigate stages and reload. Returns { getModel, getRenderer }.
 */
async function mountPipeline(arch = PIPELINE_ARCH, { domain } = {}) {
    const crmKanbanView = registry.category("views").get("crm_kanban");
    let model;
    let renderer;
    patchWithCleanup(crmKanbanView.Controller.prototype, {
        setup() {
            super.setup(...arguments);
            model = this.model;
        },
    });
    patchWithCleanup(crmKanbanView.Renderer.prototype, {
        setup() {
            super.setup(...arguments);
            renderer = this;
        },
    });
    await mountView({
        type: "kanban",
        resModel: "crm.lead",
        arch,
        groupBy: ["stage_id"],
        ...(domain ? { domain } : {}),
    });
    return { getModel: () => model, getRenderer: () => renderer };
}

/** Schedule an empty-id crm.lead web_save create (an offline pending create). */
function scheduleCreate(values, extras = {}) {
    return getService(OfflinePlugin).scheduleORM(
        "crm.lead",
        "web_save",
        [[], values],
        { context: {}, specification: {} },
        {
            extras: {
                actionName: "CRM",
                displayName: values.name || "New lead",
                changes: {},
                timeStamp: 1,
                ...extras,
            },
        }
    );
}

// ===========================================================================
// R1 — one stage at a time + fixed header (name / count / revenue sum)
// ===========================================================================

// MOBILE: the pipeline renders exactly ONE stage column, full width, and a fixed
// header carrying the active stage name, its lead count, and its revenue sum.
async function testPipelineRendersOneStage() {
    const { getRenderer } = await mountPipeline();
    await animationFrame();

    // The pipeline chrome is present (marker arch + small screen).
    expect(".o_crm_mobile_pipeline").toHaveCount(1);
    expect(".o_crm_mobile_pipeline_header").toHaveCount(1);
    // Exactly one stage column body is rendered at a time.
    expect(".o_crm_mobile_pipeline_stage").toHaveCount(1);

    // The header shows the FIRST stage (New), its count (1 lead), and the
    // formatted revenue sum (100). Driven by the live model groups.
    const renderer = getRenderer();
    expect(renderer.pipelineGroups.length).toBe(3);
    expect(queryAllTexts(".o_crm_mobile_pipeline_stage_name")[0]).toBe("New");
    expect(queryAllTexts(".o_crm_mobile_pipeline_count")[0]).toInclude("1");
    const revenue = queryAllTexts(".o_crm_mobile_pipeline_revenue")[0] || "";
    expect(revenue).toMatch(/100/);

    // The active column renders its one real lead card (Lead A, stage New).
    expect(".o_crm_mobile_pipeline_stage .o_crm_mobile_lead_card").toHaveCount(1);
    expect(queryAllTexts(".o_crm_mobile_pipeline_stage .o_crm_mobile_lead_card_name")).toEqual([
        "Lead A",
    ]);
}
test.tags("mobile");
test("pipeline renders one stage with header name/count/revenue (mobile)", testPipelineRendersOneStage);

// MOBILE: next/prev navigate between adjacent stages; disabled at the ends.
async function testPipelineNavigation() {
    await mountPipeline();
    await animationFrame();

    // At the first stage: prev disabled, next enabled.
    expect(".o_crm_mobile_pipeline_prev").toHaveProperty("disabled", true);
    expect(".o_crm_mobile_pipeline_next").toHaveProperty("disabled", false);
    expect(queryAllTexts(".o_crm_mobile_pipeline_stage_name")[0]).toBe("New");

    // Next → stage 2 (Qualified), count 1, revenue 250, Lead B.
    document.querySelector(".o_crm_mobile_pipeline_next").click();
    await animationFrame();
    expect(queryAllTexts(".o_crm_mobile_pipeline_stage_name")[0]).toBe("Qualified");
    expect(queryAllTexts(".o_crm_mobile_pipeline_stage .o_crm_mobile_lead_card_name")).toEqual([
        "Lead B",
    ]);

    // Next → stage 3 (Won): next now disabled (at the end), prev enabled.
    document.querySelector(".o_crm_mobile_pipeline_next").click();
    await animationFrame();
    expect(queryAllTexts(".o_crm_mobile_pipeline_stage_name")[0]).toBe("Won");
    expect(".o_crm_mobile_pipeline_next").toHaveProperty("disabled", true);
    expect(".o_crm_mobile_pipeline_prev").toHaveProperty("disabled", false);

    // Prev → back to Qualified.
    document.querySelector(".o_crm_mobile_pipeline_prev").click();
    await animationFrame();
    expect(queryAllTexts(".o_crm_mobile_pipeline_stage_name")[0]).toBe("Qualified");
}
test.tags("mobile");
test("pipeline navigates adjacent stages, disabled at ends (mobile)", testPipelineNavigation);

// MOBILE: exactly one stage visible at a time — the other stages' cards are NOT
// in the DOM (only the active column body renders).
async function testPipelineOneStageVisible() {
    await mountPipeline();
    await animationFrame();

    // Only Lead A (stage New) is in the DOM; Lead B / Lead C are not.
    const names = queryAllTexts(".o_crm_mobile_pipeline_stage .o_crm_mobile_lead_card_name");
    expect(names).toEqual(["Lead A"]);
    expect(names).not.toInclude("Lead B");
    expect(names).not.toInclude("Lead C");
}
test.tags("mobile");
test("pipeline shows exactly one stage body at a time (mobile)", testPipelineOneStageVisible);

// ===========================================================================
// R2 — registry wiring: the crm_kanban registry entry drives the pipeline
// ===========================================================================

// MOBILE: the production `crm_kanban` registry view (its Renderer =
// CrmKanbanRenderer with the pipeline template) is what renders the pipeline —
// not a test-local component. Removal check: remove the pipeline branch from
// crm.MobilePipelineRenderer / `_mobilePipelineActive` → this goes red.
async function testPipelineRegistryWiring() {
    const { getRenderer } = await mountPipeline();
    await animationFrame();
    // The live renderer is the production CrmKanbanRenderer and reports the
    // pipeline active for the marker arch.
    expect(getRenderer()._mobilePipelineActive).toBe(true);
    expect(".o_crm_mobile_pipeline").toHaveCount(1);
}
test.tags("mobile");
test("registry crm_kanban drives the pipeline (mobile)", testPipelineRegistryWiring);

// ===========================================================================
// R3 — pending-create card inside its stage column; no strip in pipeline mode
// ===========================================================================

// MOBILE: a queued offline create whose stage_id matches a stage renders ONCE,
// inside that stage's column, and NO strip is rendered (pipeline mode). Removal
// check: make the renderer ignore currentPendingCards → the in-column card
// assertion goes red.
async function testPipelinePendingCardInColumn() {
    const { getRenderer } = await mountPipeline();
    setOffline(true);

    // Queue a create for stage 2 (Qualified).
    const key = scheduleCreate({ name: "Queued B", stage_id: 2 });
    await animationFrame();

    // No flat strip in pipeline mode.
    expect(".o_crm_mobile_pending_strip").toHaveCount(0);

    // On stage 1 (New) the queued card is NOT shown (wrong stage).
    expect(queryAllTexts(".o_crm_mobile_pipeline_stage .o_crm_mobile_lead_card_name")).not.toInclude(
        "Queued B"
    );

    // Navigate to stage 2: the queued create appears once, inside this column.
    getRenderer().pipelineNext();
    await animationFrame();
    const names = queryAllTexts(".o_crm_mobile_pipeline_stage .o_crm_mobile_lead_card_name");
    expect(names).toInclude("Queued B");
    expect(names.filter((n) => n === "Queued B").length).toBe(1);
    // Its marker reads "Pending sync".
    const markers = queryAllTexts(".o_crm_mobile_pipeline_stage .o_crm_mobile_lead_card_marker");
    expect(markers.join(" ")).toInclude("Pending sync");

    getService(OfflinePlugin).removeScheduledORM(key);
    setOffline(false);
}
test.tags("mobile");
test("pending create renders inside its matching stage column, no strip (mobile)", testPipelinePendingCardInColumn);

// MOBILE: a queued create with NO stage_id renders in the FIRST stage column so
// it is never lost.
async function testPipelineNoStagePendingInFirstColumn() {
    await mountPipeline();
    setOffline(true);

    const key = scheduleCreate({ name: "Queued NoStage" });
    await animationFrame();

    // First column (New) is active: the no-stage queued create shows here.
    const names = queryAllTexts(".o_crm_mobile_pipeline_stage .o_crm_mobile_lead_card_name");
    expect(names).toInclude("Queued NoStage");
    expect(".o_crm_mobile_pending_strip").toHaveCount(0);

    getService(OfflinePlugin).removeScheduledORM(key);
    setOffline(false);
}
test.tags("mobile");
test("no-stage pending create renders in the first column (mobile)", testPipelineNoStagePendingInFirstColumn);

// MOBILE: WITHOUT the o_kanban_mobile marker (every spec-07 test arch), pipeline
// mode is OFF — the base column row renders AND the spec-07 strip shows the
// queued create. This proves the marker is the discriminator (D11): the frozen
// spec-07 strip behaviour is byte-for-byte preserved for unmarked arches.
// Removal check: drop the marker gate in `_mobilePipelineActive` /
// `_crmMobilePipelineMode` → the pipeline would also activate here and the strip
// assertion goes red.
async function testPlainArchStillRendersStrip() {
    await mountPipeline(PLAIN_ARCH);
    setOffline(true);

    const key = scheduleCreate({ name: "Strip Lead", stage_id: 1 });
    await animationFrame();

    // No pipeline (no marker); the spec-07 strip renders the queued create.
    expect(".o_crm_mobile_pipeline").toHaveCount(0);
    expect(".o_crm_mobile_pending_strip").toHaveCount(1);
    expect(queryAllTexts(".o_crm_mobile_pending_strip .o_crm_mobile_lead_card_name")).toInclude(
        "Strip Lead"
    );

    getService(OfflinePlugin).removeScheduledORM(key);
    setOffline(false);
}
test.tags("mobile");
test("plain (unmarked) arch still renders the spec-07 strip (mobile)", testPlainArchStillRendersStrip);

// ===========================================================================
// R4 / row 9 — uncached stage offline shows the framework offline action helper
// ===========================================================================

// MOBILE + offline: a stage with a non-zero server count but no loaded records
// (its records view/search was not cached) shows the framework OfflineActionHelper
// in the stage body instead of an empty column. Driven by forcing the current
// group's loaded records empty while its count stays non-zero. Removal check:
// remove the showPipelineOfflineHelper branch → this goes red.
async function testPipelineUncachedStageHelper() {
    const { getRenderer } = await mountPipeline();
    await animationFrame();
    const renderer = getRenderer();

    // Simulate an uncached active stage: count > 0 but no loaded records. Patch
    // the current group's list.records to empty and its count to non-zero, then
    // go offline and re-render.
    const group = renderer.pipelineCurrentGroup;
    patchWithCleanup(group.list, { records: [] });
    patchWithCleanup(group, { count: 5 });
    setOffline(true);
    await animationFrame();

    expect(renderer.showPipelineOfflineHelper).toBe(true);
    // The framework helper renders its nocontent region in the stage body.
    expect(".o_crm_mobile_pipeline_stage .o_view_nocontent").toHaveCount(1);

    setOffline(false);
}
test.tags("mobile");
test("uncached stage shows the offline action helper (mobile)", testPipelineUncachedStageHelper);

// ===========================================================================
// R1.5 — desktop: no pipeline, the base column row renders unchanged
// ===========================================================================

// DESKTOP: isSmall() is false, so pipeline mode is OFF even with the marker arch
// — the base kanban column row renders all three stage columns. Proves the
// isSmall() gate (desktop untouched).
async function testNoPipelineOnDesktop() {
    const { getRenderer } = await mountPipeline();
    await animationFrame();

    expect(getRenderer()._mobilePipelineActive).toBe(false);
    expect(".o_crm_mobile_pipeline").toHaveCount(0);
    // Base column row: all three stage columns render.
    expect(".o_kanban_group").toHaveCount(3);
}
test.tags("desktop");
test("no pipeline on desktop — base columns render (desktop)", testNoPipelineOnDesktop);

// ===========================================================================
// Row 14 — direct-mount coverage of CrmMobilePipeline guard branches that the
// board tests cannot reach (the end-of-range nav guards and the empty-groups
// defaults). Mounts the component directly with controlled props and captured
// callbacks. This is a UNIT probe of the component's own guards, complementing
// the board tests that prove it works wired into the production renderer.
// ===========================================================================

let capturedPipeline;
class PipelineProbe extends CrmMobilePipeline {
    setup() {
        if (super.setup) {
            super.setup();
        }
        capturedPipeline = this;
    }
}

// MOBILE: the nav guards do NOT invoke the callback at the ends, and the
// empty-groups getters return the guarded defaults (no throw).
async function testPipelineGuards() {
    let prevCalls = 0;
    let nextCalls = 0;

    // Mount at the FIRST index of a 2-group list: onPrev is guarded (atStart).
    capturedPipeline = undefined;
    await mountWithCleanup(PipelineProbe, {
        props: {
            groups: [
                { displayName: "S1", count: 2, serverValue: 1, aggregates: { expected_revenue: 10 } },
                { displayName: "S2", count: 0, serverValue: 2, aggregates: {} },
            ],
            index: 0,
            onPrev: () => (prevCalls += 1),
            onNext: () => (nextCalls += 1),
        },
    });
    const p = capturedPipeline;
    expect(p.atStart).toBe(true);
    expect(p.atEnd).toBe(false);
    expect(p.stageName).toBe("S1");
    expect(p.leadCount).toBe(2);
    // onPrev at the start is guarded — the callback is NOT called.
    p.onPrev();
    expect(prevCalls).toBe(0);
    // onNext away from the end IS called.
    p.onNext();
    expect(nextCalls).toBe(1);

    // Empty-groups defaults: current undefined, name "", count 0, revenue formats
    // 0 (not a throw), atEnd true (length-1 = -1), atStart true.
    capturedPipeline = undefined;
    await mountWithCleanup(PipelineProbe, {
        props: { groups: [], index: 0, onPrev: () => {}, onNext: () => {} },
    });
    const e = capturedPipeline;
    expect(e.current).toBe(undefined);
    expect(e.stageName).toBe("");
    expect(e.leadCount).toBe(0);
    expect(typeof e.revenueSum).toBe("string");
    expect(e.atStart).toBe(true);
    expect(e.atEnd).toBe(true);
    // onNext at the (empty) end is guarded — no throw, callback not required.
    e.onNext();
}
test.tags("mobile");
test("pipeline guard branches: end-of-range nav + empty groups (mobile)", testPipelineGuards);
