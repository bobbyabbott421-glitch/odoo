import { registry } from "@web/core/registry";
import { ShareTargetItem } from "@web/webclient/share_target/share_target_item";
import { onWillStart, status, useOnChange } from "@odoo/owl";
import { useCrmOffline } from "@crm/mobile/crm_offline_hooks";
import { ConnectionLostError } from "@web/core/network/rpc";
import { _t } from "@web/core/l10n/translation";

export class CrmShareTargetItem extends ShareTargetItem {
    static template = "crm.ShareTargetItem";
    static name = _t("Lead");
    static sequence = 4;

    setup() {
        super.setup();
        this.crmOffline = useCrmOffline();
        this.teamsDomain = [["company_id", "in", [this.currentCompany.id, false]]];
        onWillStart(() => this.updateTeams());
        // Offline the team list cannot be fetched; on reconnect, run the skipped
        // lookup exactly once so the selector populates with no other action.
        useOnChange(
            () => [this.crmOffline.isOffline()],
            (isOffline) => {
                if (!isOffline && this._teamsProbeSkipped) {
                    this._teamsProbeSkipped = false;
                    this.updateTeams();
                }
            },
            { initialRun: false }
        );
    }

    get isOffline() {
        return this.crmOffline.isOffline();
    }

    async updateTeams() {
        // The team lookup is a server round-trip with no offline fallback; skip
        // it offline (render the item disabled, see template) and remember to run
        // it once on reconnect.
        if (this.crmOffline.isOffline()) {
            this._teamsProbeSkipped = true;
            return;
        }
        let records;
        try {
            ({ records } = await this.orm.webSearchRead("crm.team", this.teamsDomain, {
                specification: { id: {}, display_name: {} },
                context: this.context,
            }));
        } catch (e) {
            // Connection dropped mid-fetch: re-arm so the next reconnect retries,
            // and swallow (no unhandled rejection). Any other error propagates.
            if (e instanceof ConnectionLostError) {
                this._teamsProbeSkipped = true;
                return;
            }
            throw e;
        }
        // Guard against a component torn down while the fetch was in flight.
        if (status(this) === "destroyed") {
            return;
        }
        this.state.teams = records;
        this.state.selected_team = this.state.teams.length
            ? this.state.teams[0]
            : false;
    }

    onCompanyChange(companyId) {
        super.onCompanyChange(companyId);
        this.teamsDomain = [["company_id", "in", [this.currentCompany.id, false]]];
        this.updateTeams();
    }

    get defaultState() {
        return { ...super.defaultState, teams: [], selected_team: false };
    }

    get hasMultiTeams() {
        return this.state.teams.length > 1;
    }

    get modelName() {
        return "crm.lead";
    }
    get context() {
        return {
            ...super.context,
            default_team_id: this.state.selected_team.id,
        };
    }

    get teamRecordProps() {
        return {
            mode: "readonly",
            values: { team: this.state.selected_team },
            fieldNames: ["team"],
            fields: {
                team: {
                    name: "team",
                    type: "many2one",
                    relation: "crm.team",
                    domain: this.teamsDomain,
                },
            },
            hooks: {
                onRecordChanged: (record) => {
                    this.state.selected_team = record.data.team;
                },
            },
        };
    }
}

registry.category("share_target_items").add("crm", CrmShareTargetItem);
