import { checkRainbowmanMessage } from "@crm/views/check_rainbowman_message";
import { _t } from "@web/core/l10n/translation";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { formView } from "@web/views/form/form_view";
import { getScheduleORMExtras } from "@web/model/relational_model/utils";
import { Chatter } from "@mail/chatter/web_portal_project/chatter";
import { ConnectionLostError } from "@web/core/network/rpc";
import { useCrmOffline } from "@crm/mobile/crm_offline_hooks";
import { onMounted, onPatched, signal, status, useOnChange, usePlugin } from "@odoo/owl";
import { OfflinePlugin } from "@web/core/offline/offline_plugin";
import { BottomSheetPlugin } from "@web/core/bottom_sheet/bottom_sheet_plugin";
import { CrmActivityScheduleSheet } from "@crm/activity_menu_patch";
import { user } from "@web/core/user";

const { DateTime } = luxon;

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
// 3b activity-type prefetch: tracks, PER OfflinePlugin instance, whether the
// online-mobile prefetch has already run this page session. A WeakSet keyed by
// the plugin instance (NOT a module-level boolean) so it does not leak between
// Hoot tests, which each get a fresh plugin.
const _activityTypePrefetched = new WeakSet();

export class CrmChatter extends Chatter {
    setup() {
        super.setup();
        this.crmOffline = useCrmOffline();
        this._hasCachedActivityTypes = signal(false);
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
                // Re-evaluate the activity-type cache on every connectivity change
                // so the schedule gate (and its data-available-offline attribute)
                // updates when we go offline after the prefetch has primed the cache.
                this._refreshCachedActivityTypes();
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

        // 3b activity-type prefetch (online + small screen + a lead with a server
        // id). The schedule control's cachedTypes gate reads the framework many2x
        // cache for mail.activity.type, which nothing populates for a crm lead
        // (crm views declare no activity_type_id field, and the chatter's
        // activities arrive via the mail store, not the relational model). So we
        // prime that EXISTING cache once per session with one unlimited searchRead
        // over the same domain the schedule wizard uses. Gated on 'has not run this
        // session' (per plugin instance) rather than 'cache empty', so it fills a
        // partial cache too. Never offline, never on desktop; one background RPC on
        // mobile online. ConnectionLostError is swallowed and left unmarked to retry.
        this._offlinePlugin = usePlugin(OfflinePlugin);
        this._bottomSheet = usePlugin(BottomSheetPlugin);
        this.orm = useService("orm");
        // 3b fix: originals of server-activity summaries we decorated with a
        // marker, keyed by activity id, owned by THIS component (not a field on
        // the shared store record) so we can restore them when the queue entry
        // leaves (e.g. discarded from the systray).
        this._markerOriginals = new Map();
        // 3b fix: originals of can_write we cleared to suppress a Done button while
        // its mark-done is queued (prevents a duplicate action_feedback), restored
        // when the entry leaves the queue.
        this._doneWriteOriginals = new Map();
        onMounted(() => this._refreshCachedActivityTypes());
        onMounted(() => this._prefetchActivityTypes());
        // 3b: keep data-available-offline on the chatter Activity button in sync
        // with the gate (small screen + offline + lead has a server id + activity
        // types cached). onPatched re-evaluates so the attribute TRACKS the gate;
        // when the gate turns false the attribute is REMOVED and the framework
        // re-disables the bare <button>. Both halves of the spec-05 rule: this
        // attribute + the scheduleORM in the patched store.scheduleActivity.
        onMounted(() => this._syncActivityOfflineAttr());
        onPatched(() => this._syncActivityOfflineAttr());
        // 3b optimistic activity rows: rebuilt from the offline queue (not held
        // in memory) so they survive leaving/reopening the form offline. Runs on
        // mount and whenever the queue changes.
        onMounted(() => this._syncOptimisticActivities());
        // Re-run on a SIGNATURE of the queue (each entry's key + whether it is
        // parked with extras.error), NOT just the entry count: a rejection parks
        // the SAME entry (count unchanged) but flips its error flag, which must
        // update the needs-retry marker.
        useOnChange(
            () => [this._queueSignature()],
            () => this._syncOptimisticActivities(),
            { initialRun: false }
        );
        // Re-apply when any gate signal changes (cached-types resolving async,
        // connectivity, small-screen) even if mail does not otherwise re-render.
        useOnChange(
            () => [
                this.crmOffline.isOffline(),
                this.crmOffline.isSmall(),
                this._hasCachedActivityTypes(),
            ],
            () => this._syncActivityOfflineAttr(),
            { initialRun: false }
        );
    }

    _leadServerId() {
        const thread = this.state.thread;
        const id = thread && thread.model === "crm.lead" ? thread.id : false;
        return typeof id === "number" && id > 0 ? id : false;
    }

    async _refreshCachedActivityTypes() {
        // Read the EXISTING many2x cache (works offline and online); the gate
        // needs this known offline, when the prefetch has not run this session.
        const cached = await this._offlinePlugin.searchMany2XRecords(
            "mail.activity.type",
            ""
        );
        if (status(this) === "destroyed") {
            return;
        }
        this._hasCachedActivityTypes.set(!!(cached && cached.length));
        this._syncActivityOfflineAttr();
    }

    // Map a queue key to a STABLE negative temp id (so the same queued schedule
    // yields the same row id across remounts). Simple deterministic string hash.
    _tempIdForKey(key) {
        let h = 0;
        const str = String(key);
        for (let i = 0; i < str.length; i++) {
            h = (h * 31 + str.charCodeAt(i)) | 0;
        }
        return -(Math.abs(h) + 1); // always negative, never 0
    }

    // Queue entries (model, method, args, kwargs, extras, and the key) as a list.
    _queueEntries() {
        return Object.entries(this._offlinePlugin._ormToSync()).map(([key, e]) => ({
            key,
            ...e.value,
            extras: e.value.extras || e.extras,
        }));
    }

    // A stable signature of the queue: each entry's key plus whether it is parked
    // (extras.error). Changes when an entry is added, removed, OR parked in place,
    // so the optimistic-row sync re-runs on a rejection even if the count is equal.
    _queueSignature() {
        return this._queueEntries()
            .map((e) => e.key + ":" + (e.extras && e.extras.error ? "1" : "0"))
            .sort()
            .join("|");
    }

    // 3b: rebuild this lead's optimistic activity rows from the offline queue.
    _syncOptimisticActivities() {
        const thread = this.state.thread;
        const leadId = thread && thread.model === "crm.lead" ? thread.id : false;
        if (!leadId || typeof leadId !== "number") {
            return;
        }
        const entries = this._queueEntries();

        // Pending-sync marker on an EXISTING server activity: an action_feedback
        // entry targeting its id. Reflect it in the rendered summary; derived from
        // the queue, non-destructive (we only append a marker for display).
        const doneErrors = {};
        for (const e of entries) {
            if (
                e.model === "mail.activity" &&
                e.method === "action_feedback" &&
                Array.isArray(e.args?.[0])
            ) {
                for (const aid of e.args[0]) {
                    doneErrors[aid] = e.extras && e.extras.error ? e.extras.error : false;
                }
            }
        }
        for (const act of thread.activities) {
            if (act.id > 0 && act.id in doneErrors) {
                const marker = doneErrors[act.id]
                    ? _t("(needs retry)")
                    : _t("(done, pending sync)");
                this._applyActivityMarker(act, marker);
                // Double mark-done guard (attribute half): while an action_feedback
                // is queued for this activity, suppress its Done button so a second
                // click cannot queue a duplicate. mail renders the Done button only
                // for can_write=true, so clearing can_write removes the button
                // (strictly stronger than removing data-available-offline). The
                // original can_write is restored when the entry leaves the queue.
                this._suppressDoneButton(act);
            } else if (act.id > 0 && this._markerOriginals.has(act.id)) {
                // The entry that decorated this server activity is gone (replayed
                // OR discarded from the systray): restore its original summary and
                // its Done button, and forget the stored originals.
                this._restoreActivityMarker(act);
                this._restoreDoneButton(act);
            }
        }

        // Schedule entries for THIS lead => one optimistic row each, keyed by a
        // stable temp id. Insert missing rows; drop temp rows whose key is gone.
        const wantByTempId = {};
        for (const e of entries) {
            if (
                e.model === "crm.lead" &&
                e.method === "activity_schedule" &&
                Array.isArray(e.args?.[0]) &&
                e.args[0].includes(leadId)
            ) {
                const tempId = this._tempIdForKey(e.key);
                wantByTempId[tempId] = e;
            }
        }
        // Drop stale temp rows (negative id no longer wanted).
        for (const act of [...thread.activities]) {
            if (act.id < 0 && !(act.id in wantByTempId)) {
                act.remove && act.remove({ broadcast: false });
            }
        }
        // Insert/update wanted temp rows.
        for (const [tempIdStr, e] of Object.entries(wantByTempId)) {
            const tempId = Number(tempIdStr);
            const k = e.kwargs || {};
            const parked = e.extras && e.extras.error;
            const baseSummary = k.summary || _t("Activity");
            const marker = parked ? _t("(needs retry)") : _t("(pending sync)");
            this.store["mail.activity"].insert(
                {
                    id: tempId,
                    res_model: "crm.lead",
                    res_id: leadId,
                    activity_type_id: k.activity_type_id
                        ? { id: k.activity_type_id }
                        : undefined,
                    summary: baseSummary + " " + marker,
                    date_deadline: k.date_deadline || false,
                    user_id: k.user_id ? { id: k.user_id } : undefined,
                    state: this._stateForDeadline(k.date_deadline),
                    can_write: false,
                },
                { broadcast: false }
            );
            const act = this.store["mail.activity"].get(tempId);
            if (act && !thread.activities.includes(act)) {
                thread.activities.add(act);
            }
        }
    }

    // Append a translated marker to a server activity's rendered summary. The
    // original summary is kept in this component's _markerOriginals Map (NOT a
    // field on the shared store record), keyed by activity id, so it can be
    // restored when the queue entry leaves (replayed or discarded).
    _applyActivityMarker(act, marker) {
        if (!this._markerOriginals.has(act.id)) {
            this._markerOriginals.set(act.id, act.summary || "");
        }
        const original = this._markerOriginals.get(act.id);
        act.summary = (original + " " + marker).trim();
    }

    // Restore a previously-decorated server activity's original summary and drop
    // the stored original (the queue entry that justified the marker is gone).
    _restoreActivityMarker(act) {
        const original = this._markerOriginals.get(act.id);
        if (original !== undefined) {
            act.summary = original;
        }
        this._markerOriginals.delete(act.id);
    }

    // Suppress a server activity's Done button while its action_feedback is queued
    // (mail renders Done only for can_write=true). Original can_write kept in a
    // component Map, restored when the entry leaves the queue.
    _suppressDoneButton(act) {
        if (!this._doneWriteOriginals.has(act.id)) {
            this._doneWriteOriginals.set(act.id, act.can_write);
        }
        act.can_write = false;
    }

    _restoreDoneButton(act) {
        if (this._doneWriteOriginals.has(act.id)) {
            act.can_write = this._doneWriteOriginals.get(act.id);
            this._doneWriteOriginals.delete(act.id);
        }
    }

    // Server state rule (mail_activity_mixin.py:206-210): deadline < today =>
    // overdue, = today => today, > today => planned. Compare against the LOCAL
    // date (DateTime.local().toISODate()), not the UTC date, so the state is
    // correct in every time zone (new Date().toISOString() is UTC and is wrong
    // for part of the day in zones behind/ahead of UTC).
    _stateForDeadline(deadline) {
        if (!deadline) {
            return "planned";
        }
        const today = DateTime.local().toISODate();
        if (deadline < today) {
            return "overdue";
        }
        if (deadline === today) {
            return "today";
        }
        return "planned";
    }

    _syncActivityOfflineAttr() {
        const root = (this.rootRef && this.rootRef()) || document;
        const smallOffline = this.crmOffline.isSmall() && this.crmOffline.isOffline();

        // Schedule entry (chatter Activity button): also needs a server id and at
        // least one cached activity type.
        const scheduleBtn = root.querySelector(".o-mail-Chatter-activity");
        if (scheduleBtn) {
            const scheduleGate =
                smallOffline && !!this._leadServerId() && this._hasCachedActivityTypes();
            if (scheduleGate) {
                scheduleBtn.setAttribute("data-available-offline", "1");
            } else {
                scheduleBtn.removeAttribute("data-available-offline");
            }
        }

        // Per-activity Done buttons: re-enable offline on a small screen. mail only
        // renders a Done button for an activity with can_write=true, and the patched
        // Activity.onClickMarkAsDone guards on a real server id (id > 0), so an
        // offline-created (temp-id) activity — which carries can_write=false and no
        // Done button — is never a mark-done target. The attribute only makes the
        // button clickable; the queued write and the id guard live in the patch.
        for (const doneBtn of root.querySelectorAll(".o-mail-Activity-markDone")) {
            if (smallOffline) {
                doneBtn.setAttribute("data-available-offline", "1");
            } else {
                doneBtn.removeAttribute("data-available-offline");
            }
        }
    }

    /**
     * @override — mail's chatter Activity button calls this component method
     * (chatter_patch.js:507), which normally delegates to store.scheduleActivity
     * (the server-only mail.activity.schedule wizard). Offline on a small screen,
     * for THIS crm lead, open the inline bottom-sheet and QUEUE one verbatim
     * activity_schedule call instead — confined to the crm lead form, using the
     * plugin API (useCrmOffline + the BottomSheetPlugin), with no legacy service
     * bridge and no global store patch. Online / desktop / no cached types fall
     * through to super (the normal wizard path).
     */
    async scheduleActivity() {
        const leadId = this._leadServerId();
        if (!(leadId && this.crmOffline.isSmall() && this.crmOffline.isOffline())) {
            return super.scheduleActivity(...arguments);
        }
        // Activity types come from the framework many2x cache (primed by the
        // prefetch). The Activity button is only enabled offline when the cache is
        // non-empty, so this path is normally reached with types; guard anyway.
        const activityTypes =
            (await this._offlinePlugin.searchMany2XRecords("mail.activity.type", "")) || [];
        if (status(this) === "destroyed" || !activityTypes.length) {
            return;
        }
        const leadName = this._crmLeadDisplayName();
        const target = document.querySelector(".o-mail-Chatter") || document.body;
        let removeSheet = () => {};
        removeSheet = this._bottomSheet.add(
            target,
            CrmActivityScheduleSheet,
            {
                activityTypes,
                leadId,
                close: () => removeSheet(),
                schedule: (vals) => {
                    // extras give the systray a named row (lead + summary) and an
                    // action label, the way spec 04's mark-won did (getScheduleORMExtras).
                    const summary = vals.summary || _t("Activity");
                    this.crmOffline.scheduleORM(
                        "crm.lead",
                        "activity_schedule",
                        [[leadId]],
                        { ...vals, user_id: vals.user_id || user.userId },
                        {
                            extras: {
                                actionName: _t("CRM"),
                                displayName: _t("Schedule: %s — %s", leadName, summary),
                                timeStamp: Date.now(),
                            },
                        }
                    );
                },
            },
            { class: "o_crm_offline_schedule_bottom_sheet" }
        );
    }

    /** Lead name for a systray-visible schedule entry (best-effort; the mail
     *  thread exposes displayName/display_name once the record is loaded). */
    _crmLeadDisplayName() {
        const thread = this.state.thread;
        return (
            (thread && thread.displayName) ||
            (thread && thread.display_name) ||
            (thread && thread.name) ||
            _t("Lead")
        );
    }

    async _prefetchActivityTypes() {
        const thread = this.state.thread;
        const leadId = thread && thread.model === "crm.lead" ? thread.id : false;
        if (
            this.crmOffline.isOffline() ||
            !this.crmOffline.isSmall() ||
            !leadId ||
            typeof leadId !== "number" ||
            leadId <= 0 ||
            _activityTypePrefetched.has(this._offlinePlugin)
        ) {
            return;
        }
        let result;
        try {
            result = await this.orm.searchRead(
                "mail.activity.type",
                ["|", ["res_model", "=", false], ["res_model", "=", "crm.lead"]],
                ["id", "display_name"]
            );
        } catch (e) {
            if (e instanceof ConnectionLostError) {
                // Leave the instance UNMARKED so a later qualifying mount retries.
                return;
            }
            throw e;
        }
        if (status(this) === "destroyed") {
            return;
        }
        _activityTypePrefetched.add(this._offlinePlugin);
        await this._offlinePlugin.cacheMany2XSearch("mail.activity.type", result);
        if (status(this) !== "destroyed") {
            this._hasCachedActivityTypes.set(result.length > 0);
            this._syncActivityOfflineAttr();
        }
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
