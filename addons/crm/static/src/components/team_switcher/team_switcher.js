import { Dropdown } from "@web/core/dropdown/dropdown";
import { DropdownItem } from "@web/core/dropdown/dropdown_item";
import { _t } from "@web/core/l10n/translation";
import { user } from "@web/core/user";
import { useService } from "@web/core/utils/hooks";
import { useCrmOffline } from "@crm/mobile/crm_offline_hooks";

import { Component, onWillStart, signal, status, useOnChange } from "@odoo/owl";

export class TeamSwitcher extends Component {
    static template = "crm.team_switcher";
    static components = { Dropdown, DropdownItem };

    /**
     * @override
     */
    setup() {
        super.setup();
        this.actionService = useService("action");
        this.crmOffline = useCrmOffline();

        // The manager flag is held in a reactive signal (owl exports
        // `signal`/`proxy`, not `reactive`) so that a value set on reconnect
        // re-renders the dropdown with no other user action. The template reads
        // it through the `isSaleManager` getter below.
        this._isSaleManager = signal(false);

        onWillStart(async () => {
            if (this.crmOffline.isOffline()) {
                // Offline: skip the manager probe (SKIP, no RPC). Treat the user
                // as not-a-manager (Manage Teams hidden) and remember that the
                // probe was skipped so it runs once on reconnect.
                this._managerProbeSkipped = true;
                return;
            }
            this._isSaleManager.set(await user.hasGroup("sales_team.group_sale_manager"));
        });

        // On reconnect, run the skipped probe exactly once and write the reactive
        // signal; the `status(this)` check guards against a destroyed component.
        useOnChange(
            () => [this.crmOffline.isOffline()],
            (isOffline) => {
                if (!isOffline && this._managerProbeSkipped) {
                    this._managerProbeSkipped = false;
                    user.hasGroup("sales_team.group_sale_manager").then((v) => {
                        if (status(this) !== "destroyed") {
                            this._isSaleManager.set(v);
                        }
                    });
                }
            },
            { initialRun: false }
        );
    }

    get allTeamsLabel() {
        return _t("All Teams");
    }

    get currentLabel() {
        return this.teams.find((t) => t.id === this.selectedTeamId)?.name || this.allTeamsLabel;
    }

    get hasDropdown() {
        return this.teams.length > 0;
    }

    get isSaleManager() {
        return this._isSaleManager();
    }

    get selectedTeamId() {
        return this.env.searchModel.state.switcherTeamId;
    }

    get teams() {
        return this.env.searchModel.state.switcherTeams;
    }

    onClickManageTeams() {
        if (this.crmOffline.isOffline()) {
            return;
        }
        this.actionService.doAction("sales_team.crm_team_action_config");
    }

    /**
     * Change the currently selected team:
     * - crm.lead records are filtered to that team + team-less records
     * - only that team's stages are shown + the stages of team-less records
     * - the team becomes the default when creating a new crm.lead or crm.stage
     * @param {Number} teamId Id of the new selected team, "undefined" fallbacks on "All Sales Team".
     */
    onSelect(teamId) {
        if (this.selectedTeamId === teamId) {
            return;
        }
        this.env.searchModel._updateSwitcherSelection(teamId);
    }
};
