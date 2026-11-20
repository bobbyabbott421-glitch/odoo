import { Component, proxy, t, useProps } from "@odoo/owl";
import { _t } from "@web/core/l10n/translation";
import { rpcBus } from "@web/core/network/rpc";
import { serializeDate } from "@web/core/l10n/dates";
import { user } from "@web/core/user";
import { useBus, useService } from "@web/core/utils/hooks";

export class OfflineFollowup extends Component {
    static template = "crm.OfflineFollowup";
    props = useProps({ thread: t.object() });

    setup() {
        this.offline = useService("offline");
        this.orm = useService("orm");
        useBus(rpcBus, "OFFLINE:APPLIED", ({ detail }) => {
            if (detail.key === this.pendingKey) {
                this.state.notice = _t("Your change was sent.");
            }
        });
        this.state = proxy({
            kind: "", text: "", deadline: serializeDate(luxon.DateTime.local()), busy: false, notice: "",
        });
    }

    async save() {
        if (this.state.busy || !this.state.text.trim() || (this.state.kind === "activity" && !this.state.deadline)) {
            return;
        }
        const { kind, text, deadline } = this.state;
        const activity = kind === "activity";
        const method = activity ? "offline_schedule_todo" : "offline_log_note";
        const operation = this.orm.offlineWriteToken("crm.lead", method);
        const thread = this.props.thread;
        const args = [[thread.id], text.trim(), ...(activity ? [deadline] : [])];
        const kwargs = { context: user.context, offline_operation: operation };
        this.state.busy = true;
        try {
            await this.offline.scheduleORM("crm.lead", method, args, kwargs, {
                request: { id: operation.key, model: "crm.lead", method, args, kwargs },
                extras: {
                    operationLabel: activity ? _t("To-do") : _t("Internal note"),
                    actionName: _t("CRM"), displayName: text.trim(), timeStamp: Date.now(),
                    displayNames: [thread.displayName],
                },
            });
            this.pendingKey = operation.key;
            this.state.notice = activity ? _t("Your activity is waiting to be sent.") : _t("Your note is waiting to be sent.");
            this.state.text = "";
            this.state.kind = "";
        } catch {
            this.state.notice = _t("The device could not save this change. Keep it open and try again.");
        } finally {
            this.state.busy = false;
        }
    }
}
