import { useOnChange } from "@odoo/owl";
import { OfflineFollowup } from "./offline_followup";
import { Chatter } from "@mail/chatter/web_portal_project/chatter";
import { Store } from "@mail/core/common/store_service";
import { browser } from "@web/core/browser/browser";
import { formatDateTime } from "@web/core/l10n/dates";
import { _t } from "@web/core/l10n/translation";
import { ConnectionLostError, rpc } from "@web/core/network/rpc";
import { user } from "@web/core/user";
import { patch } from "@web/core/utils/patch";

function isLeadRead(request) {
    const [name, params] = request;
    return (
        (name === "mail.thread" || name === "/mail/thread/messages") &&
        params?.thread_model === "crm.lead" &&
        Number.isInteger(params.thread_id) &&
        !Object.keys(params.access_params || {}).length
    );
}

function snapshotKey([name, params]) {
    return JSON.stringify(["crm.chatter", user.context, name, params]);
}

function setReadDate(thread, key, date) {
    thread.offlineReadDates = { ...thread.offlineReadDates, [key]: date };
}

patch(Store.prototype, {
    async _fetchStoreDataRpc(requests) {
        const offline = this.env.services.offline;
        const reads = requests.flatMap((request, i) => isLeadRead(request) ? [i] : []);
        if (!reads.length || !offline) {
            return super._fetchStoreDataRpc(requests);
        }
        const generation = offline.cacheGeneration;
        const settings = { silent: this.fetchSilent };
        if (reads.length === requests.length) {
            settings.xhr = new browser.XMLHttpRequest();
            settings.xhr.timeout = 5000;
        }
        const parts = await rpc("/mail/store", {
            fetch_params: requests,
            context: user.context,
            separate_reads: reads,
        }, settings);
        if (!Array.isArray(parts)) {
            // An older server (or a logged-out session) has no per-read results.
            return parts;
        }
        const denied = parts.some(([, part]) =>
            part["mail.thread"]?.some((thread) => thread.hasReadAccess === false)
        );
        if (denied) {
            offline.invalidateAccess();
        }
        for (const [i, part] of parts) {
            if (!denied && i !== null) {
                // Start encryption before insert, which consumes special store fields.
                const key = snapshotKey(requests[i]);
                offline.writeSnapshot(key, structuredClone(part), generation).then((date) => {
                    setReadDate(this._offlineLeadThread(requests[i]), key, date);
                }).catch(() => {});
            }
            this.insert(part);
        }
        return {};
    },

    _offlineLeadThread([, params]) {
        return this["mail.thread"].insert({ id: params.thread_id, model: "crm.lead" });
    },

    async _handleFetchStoreDataError(request, error) {
        const [, , response] = request;
        if (!(error instanceof ConnectionLostError) || !isLeadRead(request)) {
            return super._handleFetchStoreDataError(request, error);
        }
        const key = snapshotKey(request);
        try {
            const snapshot = await this.env.services.offline.readSnapshot(key);
            setReadDate(this._offlineLeadThread(request), key, snapshot?.savedAt);
            const data = snapshot?.data || {};
            if (data.DataResponse) {
                data.DataResponse = data.DataResponse.map((r) => ({ ...r, id: response.id }));
            } else if (!response._autoResolve) {
                data.DataResponse = [{ id: response.id, messages: [], _resolve: true }];
            }
            this.insert(data);
            if (response._autoResolve) {
                response._resolve = true;
            }
        } catch (e) {
            response._resultResolvers.reject(e);
        }
    },
});

patch(Chatter, { components: { ...Chatter.components, OfflineFollowup } });

patch(Chatter.prototype, {
    setup() {
        super.setup(...arguments);
        useOnChange(
            () => [this.state.thread, this.env.services.offline?.offline],
            (thread, offline) => {
                if (offline && thread?.model === "crm.lead") {
                    this.env.services["crm.offline_leads"].lastChecked(thread.id).then((date) => {
                        thread.offlineDetailsDate = date;
                    });
                }
            }
        );
    },

    get offlineDetailsNotice() {
        const thread = this.state.thread;
        if (thread?.model !== "crm.lead" || !this.env.services.offline?.offline) {
            return "";
        }
        return thread.offlineDetailsDate
            ? _t("Lead details last checked on %s", formatDateTime(luxon.DateTime.fromMillis(thread.offlineDetailsDate)))
            : _t("The last update time for these lead details is unavailable offline.");
    },

    get offlineHistoryNotice() {
        if (this.state.thread?.model !== "crm.lead" || !this.env.services.offline?.offline) {
            return "";
        }
        const dates = Object.values(this.state.thread.offlineReadDates || {});
        if (!dates.length || dates.some((date) => !date)) {
            return _t("Part of this lead's history is unavailable offline. Connect to load it.");
        }
        return _t("Lead history saved on %s", formatDateTime(luxon.DateTime.fromMillis(Math.min(...dates))));
    },
});
