/**
 * CrmMobileQuickCreate (spec 07, PART 4 item 3).
 *
 * An offline, mobile-only bottom-sheet for creating a crm.lead without a
 * connection. Opened by the CRM kanban Controller on `isSmall() && isOffline()`
 * (wired in spec-07 task 6); online / desktop keep the existing inline kanban
 * quick-create unchanged.
 *
 * The sheet captures free-text lead fields only — NO partner field, so no
 * contact is created offline. On a valid Create it queues exactly one verbatim
 * `crm.lead` `web_save` through the shared hook (`useCrmOffline().scheduleORM`),
 * matching the framework's own form-create enqueue shape, then closes. All
 * validation is client-side; nothing is queued when a field is invalid.
 *
 * The sheet has no model and no `env.config` of its own, so it never reads
 * `model.env.config`. The three systray base fields (actionId/actionName/
 * viewType) arrive from the Controller as the `extrasBase` prop; the sheet adds
 * displayName/changes/timeStamp at Create time.
 */

import { Component, proxy, t, useProps } from "@odoo/owl";
import { _t } from "@web/core/l10n/translation";
import { useCrmOffline } from "@crm/mobile/crm_offline_hooks";

export class CrmMobileQuickCreate extends Component {
    static template = "crm.MobileQuickCreate";

    props = useProps({
        close: t.function(),
        groups: t.array().optional(() => []),
        context: t.object().optional(() => ({})),
        extrasBase: t.object().optional(() => ({})),
    });

    setup() {
        super.setup();
        this.crmOffline = useCrmOffline();
        const opts = this.stageOptions;
        this.state = proxy({
            name: "",
            contact_name: "",
            phone: "",
            email_from: "",
            expected_revenue: "",
            stage_id: opts[0] ? opts[0].id : false,
            // Per-field invalid flags, reassigned (not mutated) so the proxy
            // re-renders the `is-invalid` styling when validation runs.
            invalid: {},
        });
    }

    /**
     * Stage options from the kanban model's loaded groups, in array order
     * (first group = default stage). A group whose `serverValue` is falsy (the
     * "None" / no-stage group) cannot name a real stage, so it is filtered out.
     */
    get stageOptions() {
        const groups = this.props.groups || [];
        return groups
            .map((g) => ({ id: g.serverValue, label: g.displayName }))
            .filter((opt) => opt.id);
    }

    get stageDisabled() {
        return this.stageOptions.length === 0;
    }

    /** Email is optional: empty is valid; a non-empty value must look like an email. */
    _validEmail(v) {
        if (!v) {
            return true;
        }
        return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
    }

    /** Revenue is optional: empty is valid; a non-empty value must be numeric. */
    _validRevenue(v) {
        if (v === "" || v === null || v === undefined) {
            return true;
        }
        return Number.isFinite(Number(v));
    }

    onCreate() {
        const name = (this.state.name || "").trim();
        const flags = {};
        if (!name) {
            flags.name = true;
        }
        if (!this._validRevenue(this.state.expected_revenue)) {
            flags.expected_revenue = true;
        }
        if (!this._validEmail(this.state.email_from)) {
            flags.email_from = true;
        }
        // Reassign for reactivity so the invalid styling updates.
        this.state.invalid = { ...flags };
        if (Object.keys(flags).length) {
            // At least one field is invalid: do nothing, queue nothing, stay open.
            return;
        }

        const VALUES = { name };
        const contactName = (this.state.contact_name || "").trim();
        if (contactName) {
            VALUES.contact_name = contactName;
        }
        const phone = (this.state.phone || "").trim();
        if (phone) {
            VALUES.phone = phone;
        }
        const email = (this.state.email_from || "").trim();
        if (email) {
            VALUES.email_from = email;
        }
        if (
            this.state.expected_revenue !== "" &&
            this.state.expected_revenue !== null &&
            this.state.expected_revenue !== undefined
        ) {
            VALUES.expected_revenue = Number(this.state.expected_revenue) || 0;
        }
        if (!this.stageDisabled && this.state.stage_id) {
            VALUES.stage_id = this.state.stage_id;
        }

        const EXTRAS = {
            ...this.props.extrasBase,
            displayName: name || _t("New lead"),
            changes: { ...VALUES },
            timeStamp: Date.now(),
        };

        // Queue the self-contained create verbatim, matching the framework's own
        // form-create enqueue: empty id list + the values dict, with the mandatory
        // `specification` kwarg so replay does not raise a TypeError.
        this.crmOffline.scheduleORM(
            "crm.lead",
            "web_save",
            [[], VALUES],
            { context: this.props.context, specification: {} },
            { extras: EXTRAS }
        );
        this.props.close();
    }

    onCancel() {
        this.props.close();
    }
}
