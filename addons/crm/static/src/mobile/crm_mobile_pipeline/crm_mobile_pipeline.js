import { Component, t, useProps } from "@odoo/owl";

import { _t } from "@web/core/l10n/translation";
import { formatMonetary } from "@web/views/fields/formatters";

/**
 * CrmMobilePipeline (spec 08, PART 4 item 1).
 *
 * The fixed header + navigation chrome for the mobile pipeline: it shows the
 * ACTIVE stage's name, lead count, and revenue sum, plus prev/next buttons to
 * move between adjacent stages. It is a CONTROLLED component — the active
 * `index` and the stage `groups` are owned by `CrmKanbanRenderer` (which also
 * renders the single visible `.o_kanban_group` column one stage at a time) and
 * passed in as props, with `onPrev` / `onNext` callbacks. This keeps a single
 * source of truth in the renderer, which owns the column rendering, and lets the
 * pipeline reuse the kanban model's loaded groups verbatim (NO second kanban
 * model).
 *
 * Rendered only on `isSmall()` and a stage board; desktop / online never mount
 * it (the renderer gates it). Every read is guarded so a missing group /
 * aggregate renders empty, never throws.
 */
export class CrmMobilePipeline extends Component {
    static template = "crm.MobilePipeline";

    props = useProps({
        // The loaded stage groups (kanban model `list.groups`).
        groups: t.array().optional(() => []),
        // The active stage index (owned by the renderer).
        index: t.number().optional(() => 0),
        // Navigation callbacks (owned by the renderer).
        onPrev: t.function().optional(),
        onNext: t.function().optional(),
    });

    /** The active group, or undefined when there are no groups. */
    get current() {
        return this.props.groups?.[this.props.index];
    }

    get atStart() {
        return (this.props.index || 0) <= 0;
    }

    get atEnd() {
        return (this.props.index || 0) >= (this.props.groups?.length || 0) - 1;
    }

    /** Active stage display name, guarded. */
    get stageName() {
        return this.current?.displayName || "";
    }

    /** Active stage lead count, guarded to 0. */
    get leadCount() {
        return this.current?.count || 0;
    }

    /**
     * Active stage revenue sum (summed `expected_revenue`), formatted as a
     * monetary string. The group's progressbar aggregate is read from
     * `aggregates.expected_revenue`; a missing aggregate formats 0. No currency
     * is resolvable at the group level, so it formats plainly (the same choice
     * the lead card makes for a queued create without a currency).
     */
    get revenueSum() {
        const value = this.current?.aggregates?.expected_revenue || 0;
        return formatMonetary(value, {});
    }

    onPrev() {
        if (!this.atStart) {
            this.props.onPrev?.();
        }
    }

    onNext() {
        if (!this.atEnd) {
            this.props.onNext?.();
        }
    }

    /** Translatable count label, e.g. "3 leads". */
    get countLabel() {
        return _t("%(count)s leads", { count: this.leadCount });
    }
}
