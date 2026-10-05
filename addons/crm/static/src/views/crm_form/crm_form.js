import { checkRainbowmanMessage } from "@crm/views/check_rainbowman_message";
import { _t } from "@web/core/l10n/translation";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { formView } from "@web/views/form/form_view";
import { getScheduleORMExtras } from "@web/model/relational_model/utils";

class CrmFormRecord extends formView.Model.Record {
     /**
     * override of record _save mechanism intended to affect the main form record
     * We check if the stage_id field was altered and if we need to display a rainbowman
     * message.
     *
     * This method will also simulate a real "force_save" on the email and phone
     * when needed. The "force_save" attribute only works on readonly field. For our
     * use case, we need to write the email and the phone even if the user didn't
     * change them, to synchronize those values with the partner (so the email / phone
     * inverse method can be called).
     *
     * We base this synchronization on the value of "partner_phone_update"
     * and "partner_email_update", which are computed fields that hold a value
     * whenever we need to synch.
     *
     * @override
     */
    async _save() {
        if (this.resModel !== "crm.lead") {
            return super._save(...arguments);
        }
        let changeStage = false;
        const needsSynchronizationEmail =
            this._changes.partner_email_update === undefined
                ? this._values.partner_email_update // original value
                : this._changes.partner_email_update; // new value

        const needsSynchronizationPhone =
            this._changes.partner_phone_update === undefined
                ? this._values.partner_phone_update // original value
                : this._changes.partner_phone_update; // new value

        if (needsSynchronizationEmail && this._changes.email_from === undefined && this._values.email_from) {
            this._changes.email_from = this._values.email_from;
        }
        if (needsSynchronizationPhone && this._changes.phone === undefined && this._values.phone) {
            this._changes.phone = this._values.phone;
        }

        if ("stage_id" in this._changes) {
            changeStage = this._values.stage_id !== this.data.stage_id;
        }

        const res = await super._save(...arguments);
        // Skip the rainbowman lookup when offline: checkRainbowmanMessage issues a
        // plain orm.call("crm.lead", "get_rainbowman_message", ...) that has no
        // offline queue fallback and would raise a connection-lost error. The save
        // itself is still queued by the framework; only this follow-up is gated.
        if (res && changeStage && !this.model.offlinePlugin.isOffline()) {
            await checkRainbowmanMessage(this.model.orm, this.model.effect, this.resId);
        }
        return res;
    }
}

class CrmFormModel extends formView.Model {
    static Record = CrmFormRecord;
    static services = [...formView.Model.services, "effect"];

    setup(params, services) {
        super.setup(...arguments);
        this.effect = services.effect;
    }
}

class CrmFormController extends formView.Controller {
    setup() {
        super.setup(...arguments);
        // Used only by the offline mark-won path to explain why a never-synced
        // opportunity cannot be marked won offline.
        this.notification = useService("notification");
    }

    /**
     * Offline mark-won interception.
     *
     * The "Won" button (`action_set_won_rainbowman`) calls a server-only method
     * that recomputes the rainbowman message and has no offline queue fallback.
     * Offline, we intercept the click, queue the queueable `action_set_won`
     * instead, and show the lead won optimistically. A record with no server id
     * cannot be queued (its id would come from another queued call), so offline
     * we block the click with a notification and queue nothing. Online (and for
     * every other button) we defer to the base controller unchanged.
     *
     * @override
     */
    async beforeExecuteActionButton(clickParams) {
        if (
            this.model.offlinePlugin.isOffline() &&
            clickParams.name === "action_set_won_rainbowman"
        ) {
            const record = this.model.root;
            // Save first, mirroring the base controller which captures
            // `saved = await record.save(...)` and only proceeds `if (saved !== false)`.
            // A pending offline edit is thereby queued as a web_save BEFORE the won
            // call, so the offline queue order (web_save then action_set_won) matches
            // the online flow (save, then button).
            const saved = await record.save();
            // An invalid/failed save (e.g. an empty required field makes save return
            // false) halts the button: queue no action_set_won, set no optimistic won,
            // and return false — matching the base controller's rejection of an
            // invalid-field save. With no pending changes, save returns true early.
            if (saved === false) {
                return false;
            }
            // A record with no server id (a brand-new opportunity, or one created
            // offline and not yet synced) MUST NOT queue action_set_won: its id would
            // have to come from another queued call, which the framework replays
            // verbatim with no id remapping. Block the click with a clear notification
            // and queue nothing (the control cannot be statically disabled per-record
            // offline-only without changing online behavior, since the framework's
            // disable pass keys on attribute presence, not a dynamic expression).
            if (record.isNew) {
                this.notification.add(
                    _t("Sync this opportunity before marking it won."),
                    { type: "warning" }
                );
                return false;
            }
            // Queue exactly one queueable call (NOT the rainbowman variant).
            this.model.offlinePlugin.scheduleORM(
                "crm.lead",
                "action_set_won",
                [[record.resId]],
                { context: record.context },
                { extras: getScheduleORMExtras(this.model, [record]) }
            );
            // Optimistic won WITHOUT dirtying the record. `_applyValues` folds the
            // values into the committed baseline (_values), the reactive data,
            // _textValues and _initialTextValues, and refreshes the eval context — all
            // together — so the record stays non-dirty (_changes untouched) and the
            // view's `invisible` modifiers re-evaluate (the Won button hides and the
            // "Won" ribbon shows). This is the framework's own cohesive mechanism for
            // applying server-shaped values without marking the record dirty (used by
            // relational_model/static_list on reload); it is preferred over writing the
            // private fields independently. Do NOT use record.update() (which would
            // populate _changes), and do NOT set stage_id (the server resolves the won
            // stage via _stage_find on replay).
            record._applyValues({ probability: 100, won_status: "won" });
            this.model.notify();
            // Halt the normal button execution so action_set_won_rainbowman is never
            // issued.
            return false;
        }
        return super.beforeExecuteActionButton(clickParams);
    }
}

registry.category("views").add("crm_form", {
    ...formView,
    Model: CrmFormModel,
    Controller: CrmFormController,
});
