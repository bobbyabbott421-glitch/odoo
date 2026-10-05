import { checkRainbowmanMessage } from "@crm/views/check_rainbowman_message";
import { _t } from "@web/core/l10n/translation";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { formView } from "@web/views/form/form_view";
import { getScheduleORMExtras } from "@web/model/relational_model/utils";
import { Chatter } from "@mail/chatter/web_portal_project/chatter";
import { ConnectionLostError } from "@web/core/network/rpc";
import { useCrmOffline } from "@crm/mobile/crm_offline_hooks";
import { useOnChange } from "@odoo/owl";

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
        // The "set automated probability" control is an <a type="object"> (not a
        // <button>), so the framework's offline pass does NOT disable it. It
        // recomputes probability server-side with no offline fallback; offline we
        // block it here (the crm_form view CRM owns), returning false so no RPC is
        // issued and nothing navigates. Online it falls through to super.
        if (
            this.model.offlinePlugin.isOffline() &&
            clickParams.name === "action_set_automated_probability"
        ) {
            return false;
        }
        if (
            this.model.offlinePlugin.isOffline() &&
            clickParams.name === "action_set_won_rainbowman"
        ) {
            const record = this.model.root;
            // A record with no server id (a brand-new opportunity, or one created
            // offline and not yet synced) MUST NOT be marked won offline: action_set_won
            // needs a concrete id, which would have to come from another queued call,
            // and the framework replays the queue verbatim with no id remapping. Check
            // this BEFORE saving, so the click queues NOTHING at all (not even the
            // offline create a save would enqueue). Block it with a clear notification
            // and return false (the control cannot be statically disabled per-record
            // offline-only without changing online behavior, since the framework's
            // disable pass keys on attribute presence, not a dynamic expression).
            if (record.isNew) {
                this.notification.add(
                    _t("Sync this opportunity before marking it won."),
                    { type: "warning" }
                );
                return false;
            }
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

/**
 * Lead-form chatter, offline-aware. Scoped to the crm.lead form only (wired via
 * CrmFormRenderer below), never a global patch of mail's Chatter or Thread.
 *
 * Offline a cached lead must open read-only with NO uncaught error and NO write
 * path succeeding:
 *  - load(): mail's Chatter.load() awaits thread.fetchThreadData(), whose
 *    non-messages fetchStoreData rejects offline; load() is called un-awaited,
 *    so that rejection would surface unhandled. Our override is async and, when
 *    offline, early-returns after setting `_loadSkipped = true` (cached messages
 *    already in the store stay visible). When online it awaits super.load() in a
 *    try/catch: a ConnectionLostError (the signal can flap online for ~a frame
 *    mid-reopen) is swallowed and re-arms `_loadSkipped`; any other error
 *    propagates. On reconnect the useOnChange below refetches once by calling the
 *    guarded `this.load` (not `super.load`), so a drop mid-refetch re-arms again
 *    rather than throwing.
 *  - toggleComposer(): closing/forbidding the composer offline removes the
 *    <Composer> entirely (chatter.xml renders it only while composerType is
 *    truthy), which kills typing, Enter-to-send and composer paste-upload in one
 *    move; the draft lives on thread.composer and is preserved. A useOnChange
 *    also closes an already-open composer the moment the connection drops.
 *  - the attachment dropzone onDrop (an inline closure in mail's patched setup,
 *    not overridable here) calls this.attachmentUploader.uploadFile; wrapping
 *    that uploader to a no-op offline stops the UPLOAD on any drop. For an
 *    UNSAVED lead the drop also runs the form's own save (saveRecord) first,
 *    which cannot be blocked for the drop alone — Known Limitation KL-2: offline
 *    it queues one ordinary create (same as pressing Save) and uploads nothing.
 */
export class CrmChatter extends Chatter {
    setup() {
        super.setup();
        this.crmOffline = useCrmOffline();
        // Wrap the chatter's own attachment uploader so a dropped file is not
        // uploaded offline (covers the dropzone onDrop closure in mail's patch).
        const uploadFile = this.attachmentUploader.uploadFile.bind(this.attachmentUploader);
        this.attachmentUploader.uploadFile = (...args) => {
            if (this.crmOffline.isOffline()) {
                return Promise.resolve();
            }
            return uploadFile(...args);
        };
        // Close an open composer the moment the connection drops (and never open
        // one while offline). Removing <Composer> kills typing/Enter/paste.
        useOnChange(
            () => [this.crmOffline.isOffline()],
            (isOffline) => {
                if (isOffline) {
                    this.state.composerType = false;
                } else if (this._loadSkipped) {
                    // Reconnect: refetch the thread data that was skipped offline.
                    // Go through the guarded `this.load` (not `super.load`): if the
                    // connection drops again mid-refetch, its try/catch swallows the
                    // ConnectionLostError and re-arms `_loadSkipped` so the next
                    // reconnect retries — never an unhandled rejection.
                    this._loadSkipped = false;
                    this.load(this.state.thread, this.initialRequestList);
                }
            },
            { initialRun: false }
        );
    }

    /**
     * @override — never let the thread-data fetch surface an unhandled rejection
     * offline. Sampling isOffline() once is not enough: during an offline reopen
     * the signal can be briefly online (cache-served reads trigger RPC:RESPONSE,
     * which flips the plugin back online for ~a frame), so load() may run and
     * schedule a fetch that then fails once the signal settles offline. We swallow
     * the resulting ConnectionLostError and mark the fetch skipped so the reconnect
     * handler refetches once; any other error propagates unchanged.
     */
    async load(thread, requestList) {
        if (this.crmOffline.isOffline()) {
            this._loadSkipped = true;
            return;
        }
        try {
            return await super.load(thread, requestList);
        } catch (e) {
            if (e instanceof ConnectionLostError) {
                this._loadSkipped = true;
                return;
            }
            throw e;
        }
    }

    /** @override — the composer stays closed offline (no post/paste possible). */
    toggleComposer(mode = false, options = {}) {
        if (this.crmOffline.isOffline()) {
            this.state.composerType = false;
            return;
        }
        return super.toggleComposer(mode, options);
    }
}

/**
 * CRM lead-form renderer: swaps in CrmChatter for this view only. formView.Renderer
 * already carries mail's FormRenderer patch (which sets mailComponents.Chatter);
 * we override just that entry, leaving every other form's chatter untouched.
 */
export class CrmFormRenderer extends formView.Renderer {
    setup() {
        super.setup();
        this.mailComponents = { ...this.mailComponents, Chatter: CrmChatter };
    }
}

registry.category("views").add("crm_form", {
    ...formView,
    Model: CrmFormModel,
    Controller: CrmFormController,
    Renderer: CrmFormRenderer,
});
