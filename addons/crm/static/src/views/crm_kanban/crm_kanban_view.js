import { registry } from "@web/core/registry";
import { usePlugin } from "@odoo/owl";
import { CrmControlPanel } from "@crm/views/crm_control_panel";
import { CrmKanbanModel } from "@crm/views/crm_kanban/crm_kanban_model";
import { CrmKanbanArchParser } from "@crm/views/crm_kanban/crm_kanban_arch_parser";
import { CrmKanbanRenderer } from "@crm/views/crm_kanban/crm_kanban_renderer";
import { CrmSearchModel } from "@crm/views/crm_search_model";
import { rottingKanbanView } from "@mail/js/rotting_mixin/rotting_kanban_view";
import { LeadGenerationDropdown } from "../../components/lead_generation_dropdown/lead_generation_dropdown";
import { useCrmOffline } from "@crm/mobile/crm_offline_hooks";
import { BottomSheetPlugin } from "@web/core/bottom_sheet/bottom_sheet_plugin";
import { CrmMobileQuickCreate } from "@crm/mobile/crm_mobile_quick_create/crm_mobile_quick_create";
import { CrmMobileLeadCard } from "@crm/mobile/crm_mobile_lead_card/crm_mobile_lead_card";

export const crmKanbanView = {
    ...rottingKanbanView,
    ArchParser: CrmKanbanArchParser,
    // Makes it easier to patch
    Controller: class extends rottingKanbanView.Controller {
        // Spec 07 (task 8.1 — Fact 11): the Controller owns the pending-create
        // strip template (a primary inherit of web.KanbanView authored in
        // crm_mobile_lead_card.xml), so point its `static template` here.
        static template = "crm.MobileKanbanView";
        static components = {
            ...rottingKanbanView.Controller.components,
            LeadGenerationDropdown,
            CrmMobileLeadCard,
        }

        setup() {
            super.setup(...arguments);
            // Shared offline hook (plugin API only — no legacy service bridge).
            this.crmOffline = useCrmOffline();
            // The bottom-sheet host for the offline mobile quick-create.
            this._bottomSheet = usePlugin(BottomSheetPlugin);
        }

        get progressBarAggregateFields() {
            const res = super.progressBarAggregateFields;
            const progressAttributes = this.props.archInfo.progressAttributes;
            if (progressAttributes && progressAttributes.recurring_revenue_sum_field) {
                res.push(progressAttributes.recurring_revenue_sum_field);
            }
            return res;
        }

        /**
         * Spec 07: all new mobile behaviour (the offline New-button override, the
         * quick-create sheet, and the pending-create strip) is restricted to the
         * PIPELINE board — the one grouped by stage_id. The forecast kanban extends
         * this Controller but groups by date_deadline (and is DISABLE offline), so it
         * must NOT inherit any of it: without this gate, offline on a phone the
         * forecast New button would be force-enabled and the stage selector / strip
         * would treat date groups as stages.
         */
        get _crmMobileStageBoard() {
            return this.model.root.groupByField?.name === "stage_id";
        }

        /**
         * Spec 07 (Req 4.1 / Fact 9): keep the New button enabled offline on a
         * small screen so the framework offline pass (which disables
         * `button:not([data-available-offline])`) leaves it live and the mobile
         * quick-create sheet is reachable. Online or desktop fall through to the
         * framework behaviour unchanged (which checks whether the inline
         * quick-create view was cached).
         */
        get isNewButtonAvailableOffline() {
            if (this._crmMobileStageBoard && this.crmOffline.isSmall() && this.crmOffline.isOffline()) {
                return true;
            }
            return super.isNewButtonAvailableOffline;
        }

        /**
         * Spec 07 (Req 4.2 / Fact 9, 13): on a small screen offline, open the
         * mobile quick-create as a bottom sheet instead of the inline kanban
         * quick-create. The Controller owns the three systray base fields
         * (actionId/actionName/viewType) from its `env.config` — the sheet has
         * no `env.config` of its own — and passes them as `extrasBase`, along
         * with the kanban `root.groups` (stage list) and `root.context`
         * (pipeline defaults). Online or desktop fall through to `super`
         * unchanged (the existing inline quick-create / wizard).
         */
        createRecord() {
            if (this._crmMobileStageBoard && this.crmOffline.isSmall() && this.crmOffline.isOffline()) {
                const root = this.model.root;
                const extrasBase = {
                    actionId: this.env.config.actionId,
                    actionName: this.env.config.actionName,
                    viewType: this.env.config.viewType,
                };
                let removeSheet = () => {};
                removeSheet = this._bottomSheet.add(
                    document.body,
                    CrmMobileQuickCreate,
                    {
                        close: () => removeSheet(),
                        groups: root.groups,
                        context: root.context,
                        extrasBase,
                    },
                    { class: "o_crm_mobile_quick_create_sheet" }
                );
                return;
            }
            return super.createRecord(...arguments);
        }

        /**
         * Spec 07 (Req 9 / Fact 11, 15): the queued offline creates to render in
         * the pending-create strip.
         *
         * Read through the shared hook accessor `queuedWrites("crm.lead")` (NOT
         * by resolving the offline plugin directly), then keep only the empty-id
         * `web_save` entries (`args[0]` an empty array) — those are offline
         * creates with no server id yet, regardless of origin (quick-create or
         * form view) and regardless of actionId. Each maps to a card descriptor:
         * a stable key, the queued VALUES (`args[1]`), and any parked error
         * (`extras.error`). Desktop (not small) renders nothing. Every read is
         * guarded so a missing field does not crash.
         */
        get pendingCreateCards() {
            if (!this._crmMobileStageBoard || !this.crmOffline.isSmall()) {
                return [];
            }
            const entries = this.crmOffline.queuedWrites("crm.lead") || [];
            return entries
                .filter(
                    (v) =>
                        v &&
                        v.method === "web_save" &&
                        Array.isArray(v.args?.[0]) &&
                        v.args[0].length === 0
                )
                .map((v) => {
                    const values = v.args?.[1] || {};
                    const extras = v.extras || {};
                    // Stable within a session: the queue entry's timeStamp if
                    // present, else a signature of the entered values.
                    const key = extras.timeStamp || JSON.stringify(values);
                    return {
                        key,
                        values,
                        parkedError: extras.error,
                    };
                });
        }

        /**
         * Spec 07 (Req 9.6): the loaded kanban groups reduced to
         * `{ serverValue, displayName }`, so a strip card can resolve a queued
         * `stage_id` to its stage label. Guarded: no root/groups → [].
         */
        get pendingStageGroups() {
            return (
                this.model.root.groups?.map((g) => ({
                    serverValue: g.serverValue,
                    displayName: g.displayName,
                })) || []
            );
        }
    },
    ControlPanel: CrmControlPanel,
    Model: CrmKanbanModel,
    Renderer: CrmKanbanRenderer,
    SearchModel: CrmSearchModel,
    buttonTemplate: "crm.Kanban.Buttons",
};

registry.category("views").add("crm_kanban", crmKanbanView);
