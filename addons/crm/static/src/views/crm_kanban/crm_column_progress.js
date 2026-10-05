import { onWillStart, signal, status, useOnChange } from "@odoo/owl";
import { user } from "@web/core/user";
import { RottingColumnProgress } from "@mail/js/rotting_mixin/rotting_column_progress";
import { _t } from "@web/core/l10n/translation";
import { useCrmOffline } from "@crm/mobile/crm_offline_hooks";

export class CrmColumnProgress extends RottingColumnProgress {
    static template = "crm.ColumnProgress";
    setup() {
        super.setup();
        this.crmOffline = useCrmOffline();
        // The recurring-revenue flag is held in a reactive owl `signal` (owl
        // exports `signal`/`proxy`, NOT `reactive`) so a value set on reconnect
        // re-renders the view with no other user action. Template references
        // read it through the `showRecurringRevenue` getter, unchanged.
        this._showRecurringRevenue = signal(false);

        onWillStart(async () => {
            if (this.props.progressBarState.progressAttributes.recurring_revenue_sum_field) {
                // Probe only when ONLINE; offline, skip the server round-trip
                // (the SKIP classification) and mark it so the reconnect
                // callback can run it exactly once.
                if (this.crmOffline.isOffline()) {
                    this._rrProbeSkipped = true;
                } else {
                    this._showRecurringRevenue.set(
                        await user.hasGroup("crm.group_use_recurring_revenues")
                    );
                }
            }
        });

        // On reconnect, run the skipped probe exactly once and write the
        // reactive signal (guarded by `status(this)` so a destroyed component
        // never sets state).
        useOnChange(
            () => [this.crmOffline.isOffline()],
            (isOffline) => {
                if (
                    !isOffline &&
                    this._rrProbeSkipped &&
                    this.props.progressBarState.progressAttributes.recurring_revenue_sum_field
                ) {
                    this._rrProbeSkipped = false;
                    user.hasGroup("crm.group_use_recurring_revenues").then((v) => {
                        if (status(this) !== "destroyed") {
                            this._showRecurringRevenue.set(v);
                        }
                    });
                }
            },
            { initialRun: false }
        );
    }

    get showRecurringRevenue() {
        return this._showRecurringRevenue();
    }

    get displayRecurringRevenue() {
        return !this.crmOffline.isOffline() && this.showRecurringRevenue;
    }

    getRecurringRevenueGroupAggregate(group) {
        if (!this.displayRecurringRevenue) {
            return {};
        }
        const rrField = this.props.progressBarState.progressAttributes.recurring_revenue_sum_field;
        return this.props.progressBarState.getAggregateValue(group, rrField);
    }

    getColumnProgressTooltip(bar) {
        const barString = typeof bar.value === 'symbol' ? _t('Without activities scheduled') : bar.string;
        return `${bar.count} ${barString}`;
    }
}
