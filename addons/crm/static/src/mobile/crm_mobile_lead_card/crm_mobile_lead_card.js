import { Component, t, useProps } from "@odoo/owl";

import { _t } from "@web/core/l10n/translation";
import { formatMonetary } from "@web/views/fields/formatters";
import { KanbanRecord } from "@web/views/kanban/kanban_record";
import { useCrmOffline } from "@crm/mobile/crm_offline_hooks";

/**
 * CrmMobileLeadCard — the mobile presentation of a lead.
 *
 * Two modes (exactly one of `record` / `queuedValues` is set):
 *  1. Record mode — rendered additively inside the kanban article for a real
 *     `crm.lead` record on the board.
 *  2. Queued-create mode — rendered in the host's pending-create strip for a
 *     queued offline create.
 *
 * This file currently implements RECORD MODE presentation only (name,
 * partner/contact name, formatted expected revenue). The props for the other
 * mode are accepted now; the pending indicator, the uncached-lead message, and
 * the queued-create-mode marker are added by later tasks.
 *
 * Every field read is guarded so a missing field renders empty, never throws.
 */
export class CrmMobileLeadCard extends Component {
    static template = "crm.MobileLeadCard";

    props = useProps({
        record: t.any().optional(),
        queuedValues: t.object().optional(),
        parkedError: t.any().optional(),
        actionId: t.any().optional(),
        stageGroups: t.array().optional(() => []),
    });

    setup() {
        super.setup();
        this.crmOffline = useCrmOffline();
    }

    /** True when the card is rendering a queued offline create (strip mode). */
    get isQueuedCreate() {
        return !!this.props.queuedValues;
    }

    /** Lead name, guarded; empty string when absent. */
    get name() {
        if (this.isQueuedCreate) {
            return this.props.queuedValues?.name || "";
        }
        return this.props.record?.data?.name || "";
    }

    /**
     * Partner / contact display name, guarded.
     * Record mode: many2one display name, then free-text contact/company names.
     * Queued-create mode: the entered free-text contact name.
     */
    get partnerName() {
        if (this.isQueuedCreate) {
            return this.props.queuedValues?.contact_name || "";
        }
        const data = this.props.record?.data;
        return (
            data?.partner_id?.display_name ||
            data?.contact_name ||
            data?.partner_name ||
            ""
        );
    }

    /**
     * Expected revenue formatted as a monetary string, guarded.
     * Record mode uses the record's `company_currency`; queued-create mode has
     * no resolvable currency, so it formats the raw amount plainly. Undefined
     * or empty values render as an empty string.
     */
    get expectedRevenue() {
        if (this.isQueuedCreate) {
            const value = this.props.queuedValues?.expected_revenue;
            return value ? formatMonetary(value, {}) : "";
        }
        const data = this.props.record?.data;
        const value = data?.expected_revenue;
        const currencyId = data?.company_currency?.id;
        return value ? formatMonetary(value, currencyId ? { currencyId } : {}) : "";
    }

    /**
     * Whether to show the pending-sync indicator in RECORD mode.
     *
     * A single boolean derived from the framework queue (`_ormToSync()` via
     * `useCrmOffline().hasQueuedWrite`), NOT a per-entry badge and NOT a
     * card-owned dirty flag — two queued edits on the same lead still yield one
     * indicator. Queued-create mode handles its own indicator in task 8, so
     * this getter is record-mode-only here (task 8 will revisit).
     *
     * Guarded: no record or no server id → false.
     */
    get showPendingIndicator() {
        if (this.isQueuedCreate) {
            return false;
        }
        const resId = this.props.record?.resId;
        if (!resId) {
            return false;
        }
        return this.crmOffline.hasQueuedWrite("crm.lead", resId);
    }

    /** Translatable label for the record-mode pending-sync indicator. */
    get pendingLabel() {
        return _t("Pending sync");
    }

    /**
     * Whether to show the uncached-lead in-card message in RECORD mode.
     *
     * The framework disables an uncached lead's card tap target offline
     * (`o_disabled_offline`), so the explanation renders as card STATE, not on
     * a tap: whenever we are on a small screen, offline, and the lead's form
     * was NOT cached online (`isAvailableOffline(actionId, "form", resId)` is
     * false). A cached lead shows no message and keeps normal tap behavior.
     *
     * Never shown in queued-create mode (a brand-new offline create is not an
     * "uncached visited lead"). Also guarded on `record.resId`: a record with
     * no server id is a new/unsaved record, not a visited lead — without the
     * `resId` guard `isAvailableOffline` with an undefined resId would be "not
     * available" and the message would wrongly show.
     */
    get showUncachedMessage() {
        if (this.isQueuedCreate) {
            return false;
        }
        return (
            this.crmOffline.isSmall() &&
            this.crmOffline.isOffline() &&
            !!this.props.record?.resId &&
            !this.crmOffline.isAvailableOffline(this.props.actionId, "form", this.props.record?.resId)
        );
    }

    /** Translatable text for the uncached-lead in-card message. */
    get uncachedLabel() {
        return _t("This lead was not opened online, so it is not available offline.");
    }

    /**
     * Resolved stage label for a QUEUED-CREATE card (strip mode); "" otherwise.
     *
     * The queued create carries a stage id (`queuedValues.stage_id`), not a
     * label. The stage label comes from the loaded groups: resolve it from the
     * host's `stageGroups` prop (an array of `{ serverValue, displayName }` the
     * Controller derives from `root.groups`) by matching `serverValue ===
     * stage_id` → `displayName`. An unresolved stage (no match, or no stage_id)
     * shows no stage — there is no fallback. Record mode shows no stage.
     *
     * Every read is guarded so a missing field renders "".
     */
    get stageLabel() {
        if (!this.isQueuedCreate) {
            return "";
        }
        const stageId = this.props.queuedValues?.stage_id;
        if (!stageId) {
            return "";
        }
        const match = (this.props.stageGroups || []).find((g) => g?.serverValue === stageId);
        return match?.displayName || "";
    }

    /**
     * Translatable marker for a QUEUED-CREATE card.
     *
     * A parked entry (the host passes its `extras.error` as `parkedError`)
     * shows "Needs retry"; a non-parked queued create shows "Pending sync".
     * The systray remains the only error surface — no CRM-specific error UI.
     */
    get pendingMarkerLabel() {
        return this.props.parkedError ? _t("Needs retry") : _t("Pending sync");
    }

    /** Always show a marker on a queued-create strip card. */
    get showQueuedCreateMarker() {
        return this.isQueuedCreate;
    }
}

/**
 * CrmKanbanRecord — additive card host wiring (spec 07, task 4.1 — Fact 12).
 *
 * A primary-inherit subclass of web's KanbanRecord whose template inserts a
 * `CrmMobileLeadCard` as the FIRST child of the kanban article (gated on
 * isSmall() in the template). Nothing is swapped: the compiled arch body, the
 * card menu, selection, drag/drop, and the footer priority/activity widgets all
 * keep working — the mobile card is only ADDED above the arch body. The crm
 * kanban renderer registers this as its `KanbanRecord` component so only the
 * `crm_kanban` view uses it.
 */
export class CrmKanbanRecord extends KanbanRecord {
    static template = "crm.MobileKanbanRecord";
    static components = { ...KanbanRecord.components, CrmMobileLeadCard };

    setup() {
        super.setup();
        this.crmOffline = useCrmOffline();
    }
}
