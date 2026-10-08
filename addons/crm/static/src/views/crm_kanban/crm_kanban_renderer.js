import { proxy } from "@odoo/owl";
import { CrmColumnProgress } from "./crm_column_progress";
import { CrmKanbanRecord, CrmMobileLeadCard } from "@crm/mobile/crm_mobile_lead_card/crm_mobile_lead_card";
import { CrmMobilePipeline } from "@crm/mobile/crm_mobile_pipeline/crm_mobile_pipeline";
import { useCrmOffline } from "@crm/mobile/crm_offline_hooks";
import { OfflineActionHelper } from "@web/views/offline_action_helper";
import { RottingKanbanHeader } from "@mail/js/rotting_mixin/rotting_kanban_header";
import { RottingKanbanRenderer } from "@mail/js/rotting_mixin/rotting_kanban_renderer";

class CrmKanbanHeader extends RottingKanbanHeader {
    static components = {
        ...RottingKanbanHeader.components,
        ColumnProgress: CrmColumnProgress,
    };
}

export class CrmKanbanRenderer extends RottingKanbanRenderer {
    // Spec 08: a primary inherit of web.KanbanRenderer. On a small screen, over a
    // stage board, it renders the CrmMobilePipeline header + ONE stage column at
    // a time (the mobile pipeline). Desktop / online / non-stage boards render the
    // base column row unchanged (the template `t-else`), so desktop is untouched.
    static template = "crm.MobilePipelineRenderer";
    static components = {
        ...RottingKanbanRenderer.components,
        KanbanHeader: CrmKanbanHeader,
        KanbanRecord: CrmKanbanRecord,
        CrmMobileLeadCard,
        CrmMobilePipeline,
        OfflineActionHelper,
    };

    setup() {
        super.setup(...arguments);
        this.crmOffline = useCrmOffline();
        // The active-stage index for the one-stage-at-a-time mobile pipeline.
        this.pipelineState = proxy({ index: 0 });
    }

    /**
     * True when the NEW mobile pipeline presentation is active: a small screen,
     * a board grouped by stage_id, AND the arch carries the `o_opportunity_kanban`
     * marker class (the production stage pipeline `crm_case_kanban_view_leads`,
     * the board "My Pipeline" opens — `default_group_by="stage_id"`).
     *
     * The marker is the discriminator (spec 08 decision D11/D12): every spec-07
     * test arch mounts a `<kanban js_class="crm_kanban">` WITHOUT
     * `o_opportunity_kanban`, so for them this is false and the base column row +
     * the spec-07 strip render byte-for-byte as before. The forecast kanban
     * (date_deadline) and desktop are also excluded.
     */
    get _mobilePipelineActive() {
        const className = this.props.archInfo?.className || "";
        return (
            this.crmOffline.isSmall() &&
            this.props.list?.groupByField?.name === "stage_id" &&
            className.split(/\s+/).includes("o_opportunity_kanban")
        );
    }

    /** The loaded stage groups, guarded. */
    get pipelineGroups() {
        return this.props.list?.groups || [];
    }

    /**
     * The active index clamped into range. Groups can change on reload, so clamp
     * on read rather than trusting the stored value.
     */
    get pipelineIndex() {
        const n = this.pipelineGroups.length;
        if (n === 0) {
            return 0;
        }
        return Math.min(Math.max(this.pipelineState.index, 0), n - 1);
    }

    /** The active group, or undefined. */
    get pipelineCurrentGroup() {
        return this.pipelineGroups[this.pipelineIndex];
    }

    pipelinePrev() {
        this.pipelineState.index = Math.max(this.pipelineIndex - 1, 0);
    }

    pipelineNext() {
        this.pipelineState.index = Math.min(
            this.pipelineIndex + 1,
            this.pipelineGroups.length - 1
        );
    }

    /**
     * The queued offline creates, derived from the framework queue through the
     * shared hook (`queuedWrites("crm.lead")`, the only CRM reader of the queue
     * signal — NOT a second store). Kept only the empty-id `web_save` entries
     * (offline creates with no server id yet), mapped to card descriptors
     * `{ key, values, parkedError }`. Returns [] when the pipeline is inactive
     * (desktop / non-stage board) so nothing renders there. Every read guarded.
     */
    get pendingCards() {
        if (!this._mobilePipelineActive) {
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
                const key = extras.timeStamp || JSON.stringify(values);
                return { key, values, parkedError: extras.error };
            });
    }

    /** The reduced stage groups for a pending card's stage-label resolution. */
    get pendingStageGroups() {
        return this.pipelineGroups.map((g) => ({
            serverValue: g?.serverValue,
            displayName: g?.displayName,
        }));
    }

    /**
     * The queued offline creates that belong in the ACTIVE stage column.
     *
     * A pending create carries a `stage_id` (server value) and belongs in the
     * column whose `serverValue` matches. A pending create with no `stage_id`,
     * or whose stage matches no loaded group, is shown in the FIRST column so it
     * is never lost. Guarded: no pending cards → [].
     */
    get currentPendingCards() {
        const cards = this.pendingCards;
        if (cards.length === 0) {
            return [];
        }
        const current = this.pipelineCurrentGroup;
        if (!current) {
            return [];
        }
        const groupValues = new Set(
            this.pipelineGroups.map((g) => g?.serverValue).filter((v) => v)
        );
        return cards.filter((card) => {
            const stageId = card?.values?.stage_id;
            const resolved = stageId && groupValues.has(stageId);
            if (resolved) {
                return stageId === current.serverValue;
            }
            return this.pipelineIndex === 0;
        });
    }

    /**
     * Whether to show the framework offline action helper in the active stage
     * body instead of an empty column: offline, and the current stage has a
     * non-zero server count but no loaded records (its view/search was not
     * cached online, so the records could not be fetched offline). A cached
     * stage with its records loaded, or a genuinely empty cached stage (count
     * 0), shows no helper. Guarded: online / no group → false.
     */
    get showPipelineOfflineHelper() {
        if (!this.crmOffline.isOffline()) {
            return false;
        }
        const current = this.pipelineCurrentGroup;
        if (!current) {
            return false;
        }
        const loaded = current.list?.records?.length || 0;
        const count = current.count || 0;
        return count > 0 && loaded === 0;
    }
}
