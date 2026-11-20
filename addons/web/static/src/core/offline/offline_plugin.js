import {
    computed,
    markRaw,
    onWillDestroy,
    Plugin,
    signal,
    useListener,
    usePlugin,
} from "@odoo/owl";
import { browser } from "@web/core/browser/browser";
import { Crypto, CRYPTO_ALGO } from "@web/core/crypto";
import { DebugModePlugin } from "@web/core/debug_mode_plugin";
import { NonSecureContextError } from "@web/core/errors/non_secure_context_error";
import { _t } from "@web/core/l10n/translation";
import { normalize } from "@web/core/l10n/utils";
import { ConnectionLostError, RPCError, rpc, rpcBus } from "@web/core/network/rpc";
import { offlineRevisionKey, offlineScope } from "@web/core/offline/offline_scope";
import { ORM } from "@web/core/orm_plugin";
import { registry } from "@web/core/registry";
import { user } from "@web/core/user";
import { services } from "@web/core/services";
import { IndexedDB } from "@web/core/utils/indexed_db";
import { hashCode } from "@web/core/utils/strings";
import { session } from "@web/session";

const IS_READY = Symbol("ready");

class FakeIndexedDB {
    // used in non secure context to disable the offline features as data can't be encrypted
    invalidate() {}
    read() {
        return Promise.resolve({});
    }
    write() {}
    delete() {}
    getAllKeys() {
        return Promise.resolve([]);
    }
    getAllEntries() {
        return Promise.resolve([]);
    }
}

export class OfflinePlugin extends Plugin {
    static VISITED_UI_TABLE_NAME = "visited-ui-items";
    static VISITED_UI_TABLE_NAME_DEBUG = "visited-ui-items-debug";
    static ORM_SYNC_TABLE_NAME = "orm-to-sync";
    static MANY2X_TABLE_PREFIX = "many2x_";

    static SELECTORS_TO_DISABLE = ["button:not([data-available-offline]):not([disabled])"];

    debugMode = usePlugin(DebugModePlugin);
    orm = usePlugin(ORM);

    _idb = window.isSecureContext
        ? markRaw(new IndexedDB(
            JSON.stringify(["offline-work", session.db, user.userId]), null, { durability: "strict" }
        ))
        : new FakeIndexedDB();
    _crypto =
        window.isSecureContext &&
        session.browser_cache_secret &&
        new Crypto(session.browser_cache_secret);
    _workCrypto = window.isSecureContext && session.browser_offline_work_secret
        ? new Crypto(session.browser_offline_work_secret)
        : this._crypto;
    _readCache = window.isSecureContext
        ? markRaw(new IndexedDB(offlineScope("offline-reads"), session.registry_hash + CRYPTO_ALGO))
        : new FakeIndexedDB();
    _visitedUITable = computed(() =>
        this.debugMode.isActive()
            ? OfflinePlugin.VISITED_UI_TABLE_NAME_DEBUG
            : OfflinePlugin.VISITED_UI_TABLE_NAME
    );
    cacheGeneration = 0;
    _revision = browser.localStorage.getItem(offlineRevisionKey());
    _timeout = null; // used to repeatedly ping the server when offline
    _observer = null; // used to detect DOM mutations and disable the UI when offline

    /** whether the connection to the server is currently lost */
    isOffline = signal(false);

    /** whether scheduled ORM calls are currently being synced */
    syncingORM = signal(false);
    legacyPending = signal(false);
    unreadablePending = signal(false);

    /** orm calls that need to be synced once we go back online */
    _ormToSync = signal.Object({});

    /** items available offline (only populated when offline) */
    _visited = signal.Object({ [IS_READY]: null });

    setup() {
        this.orm.submitOfflineWrite = this._submitOfflineWrite.bind(this);
        if (window.isSecureContext && indexedDB.databases) {
            indexedDB.databases().then(async (databases) => {
                if (databases.some((db) => db.name === "offline")) {
                    const legacy = new IndexedDB("offline", null);
                    this.legacyPending.set(!!(await legacy.getAllKeys(OfflinePlugin.ORM_SYNC_TABLE_NAME))?.length);
                }
            }).catch(() => {});
        }
        // Use "offline" and "online" events for instant detection of connection lost/restored.
        useListener(browser, "offline", () => {
            if (!this.isOffline()) {
                this.checkConnection();
            }
        });
        useListener(browser, "online", () => {
            if (this.isOffline()) {
                this.checkConnection();
            }
        });

        // Use RPC:RESPONSE to validate the current offline status, which is more accurate than
        // the "offline"/"online" events (e.g. server is down).
        useListener(rpcBus, "RPC:RESPONSE", (ev) => {
            const error = ev.detail.error;
            const name = error?.exceptionName;
            if (
                name === "odoo.exceptions.AccessDenied" ||
                name === "odoo.http.session.SessionExpiredException" ||
                (["web_read", "web_search_read", "web_read_group"].includes(ev.detail.data?.params?.method) &&
                    ["odoo.exceptions.AccessError", "odoo.exceptions.MissingError"].includes(name))
            ) {
                this.invalidateAccess();
            }
            this.setOffline(error instanceof ConnectionLostError);
        });

        useListener(browser, "storage", (event) => {
            if (event.key === offlineRevisionKey() && this._revision !== event.newValue) {
                this._revision = event.newValue;
                rpcBus.trigger("CLEAR-CACHES");
            }
        });

        // When the "CLEAR-CACHES" event is triggered, the rpc cache is wiped out, so we must also
        // clear the information about elements that are available offline, as they aren't anymore.
        useListener(rpcBus, "CLEAR-CACHES", () => {
            this.cacheGeneration++;
            this._readCache.invalidate([
                OfflinePlugin.VISITED_UI_TABLE_NAME,
                OfflinePlugin.VISITED_UI_TABLE_NAME_DEBUG,
                new RegExp(`^${OfflinePlugin.MANY2X_TABLE_PREFIX}`),
                "snapshots",
            ]);
            this._visited.set({});
        });

        this._updateScheduledORMList().then(async () => {
            if (!this.isOffline()) {
                // wait a bit for the webclient to be started before synchronizing
                await new Promise((r) => browser.setTimeout(r, 3000));
                this._syncORM();
            }
        });

        onWillDestroy(() => this._cleanup());
    }

    /**
     * Sets the offline status.
     *
     * If we're going offline, we must get the information about actions, views, records that
     * are available offline before toggling the status, such that the rest of the UI can
     * synchronously access the information when rendering offline. As reading from indexeddb
     * is async, we read everything once, and store it in an plain object. We also ensure that
     * buttons and inputs in the UI that haven't been tagged as "available-offline" are
     * disabled while being offline. Finally, we repeatedly try to ping the server to detect if
     * connection is back.
     *
     * If we're going online, we re-enable the UI and update the offline status.
     *
     * @param {boolean} offline
     */
    setOffline(offline) {
        if (offline === this.isOffline()) {
            return;
        }
        this.isOffline.set(offline);
        this._visited.set({});
        if (offline) {
            // Disable everything in the UI that isn't marked as available offline.
            this._offlineUI();
            // Create an observer instance linked to the callback function to keep disabling
            // elements that would appear in the DOM while being offline.
            this._observer = new MutationObserver(() => {
                if (this.isOffline()) {
                    this._offlineUI();
                }
            });
            this._observer.observe(document.body, {
                childList: true, // listen for direct children being added/removed
                subtree: true, // also observe descendants (not just direct children)
                attributeFilter: ["data-available-offline"], // listen for specific attribute change
            });

            // Repeatedly check if connection is back.
            let delay = 2000;
            const _checkConnection = async () => {
                if (this.isOffline()) {
                    await this.checkConnection();
                    // exponential backoff, with some jitter
                    delay = delay * 1.5 + 500 * Math.random();
                    this._timeout = browser.setTimeout(_checkConnection, delay);
                }
            };
            this._timeout = browser.setTimeout(_checkConnection, delay);

            // Retrieve the information about visited items from indexeddb.
            this._visited()[IS_READY] = this._populateVisited();
        } else {
            this._syncORM();
            this._cleanup();
        }
    }

    /**
     * Pings the server to check if it is reachable.
     */
    async checkConnection() {
        try {
            await rpc("/web/webclient/version_info", {});
        } catch {
            // just catch the error, the offline status will be updated with RPC:RESPONSE
        }
    }

    // Expose the promise to allow tests to wait for it
    getVisitedStatus() {
        return this._visited()[IS_READY];
    }
    /**
     * Returns search queries that are available offline, their facets and the number of times they
     * have been accessed, given an action id and a view type.
     *
     * @param {number} actionId
     * @param {"kanban"|"list"}
     * @returns Promise<Object[]>
     */
    async getAvailableSearches(actionId, viewType) {
        await this._visited()[IS_READY];
        if (!this._visited()[actionId]?.views[viewType]) {
            return [];
        } else if (this._visited()[actionId]?.views[viewType] === true) {
            // Searches for that action/view type haven't been retrieve from idb yet
            this._visited()[actionId].views[viewType] = this._readCache
                .read(this._visitedUITable(), this._generateKey(actionId, viewType))
                .then((r) =>
                    Object.values(r || {})
                        .reverse() // last visited first
                        .sort(({ count: c1 }, { count: c2 }) => c2 - c1)
                        .map(({ search }) => search)
                );
        }
        const searches = await this._visited()[actionId]?.views[viewType];
        return [...searches];
    }

    /**
     * Returns a boolean indicating whether the requested element is available offline, i.e.
     * if it has been visited online and stored in cache.
     *
     * @param {number} actionId
     * @param {"kanban"|"list"|"form"} [viewType]
     * @param {number} [resId]
     * @returns boolean
     */
    isAvailableOffline(actionId, viewType, resId) {
        const action = this._visited()[actionId];
        if (!viewType) {
            return !!action;
        }
        const view = action?.views[viewType];
        if (viewType !== "form") {
            return !!view;
        }
        return view?.includes(resId);
    }

    /**
     * Mark an action, view type and optionally record as available offline.
     *
     * @param {number} actionId
     * @param {"kanban"|"list"|"form"|"kanban_quick_create"|"list_quick_create"} viewType
     * @param {Object} params
     * @param {number} [params.resId] the record id, when viewType is "form"
     * @param {Object} [params.search] the current search view state
     */
    async setAvailableOffline(actionId, viewType, { resId, search }) {
        if (!this.isOffline()) {
            const key = this._generateKey(actionId, viewType, resId);
            let value;
            if (["form", "kanban_quick_create", "list_quick_create"].includes(viewType)) {
                value = true;
            } else {
                value = (await this._readCache.read(this._visitedUITable(), key)) || {};
                let count = value[search.key]?.count || 0;
                search = value[search.key]?.search || search; // keep original search (no "Custom Filter")
                delete value[search.key]; // delete and re-add to mark it as "last visited"
                value[search.key] = { count: ++count, search };
            }
            return this._readCache.write(this._visitedUITable(), key, value);
        }
    }

    // -------------------------------------------------------------------------
    // ORM Offline
    // -------------------------------------------------------------------------

    async _submitOfflineWrite(request, send) {
        const { model, method, args, kwargs } = request;
        const extras = {
            actionName: _t("Pending changes"),
            displayName: args[1]?.name || (args[0].length ? _t("Record %s", args[0].join(", ")) : _t("New record")),
            timeStamp: Date.now(),
            changes: args[1] || {},
            originalValues: {},
        };
        try {
            await this.scheduleORM(model, method, args, kwargs, { request, extras, beforeSend: true });
        } catch (storageError) {
            // An online save still has its server receipt if local storage is full.
            if (!this.isOffline() && !this.hasScheduledCalls) {
                try {
                    return await send();
                } catch (error) {
                    if (error instanceof ConnectionLostError) {
                        error.offlineWrite = request;
                    }
                    throw error;
                }
            }
            const error = new ConnectionLostError();
            error.offlineWrite = request;
            throw error;
        }
        try {
            return await navigator.locks.request("db-sync", async () => {
                await this._updateScheduledORMList();
                const current = this._ormToSync()[request.id];
                const waiting = current && Object.values(this._ormToSync()).some(({ value }) =>
                    !value.extras?.error && value.extras?.order < current.value.extras.order
                );
                if (waiting || this.isOffline()) {
                    throw new ConnectionLostError();
                }
                const result = await send();
                await this.removeScheduledORM(request.id);
                return result;
            });
        } catch (error) {
            if (error instanceof ConnectionLostError) {
                error.offlineWrite = request;
            } else if (error instanceof RPCError) {
                if (error.code === 100 || ["odoo.exceptions.AccessError", "odoo.exceptions.AccessDenied",
                    "odoo.exceptions.MissingError"].includes(error.exceptionName)) {
                    await this.scheduleORM(model, method, args, kwargs, {
                        id: request.id, extras: { ...this._ormToSync()[request.id]?.value.extras,
                            error: error.data?.message || error.message },
                    });
                } else {
                    // A definite live validation failure goes back to the editable form.
                    await this.removeScheduledORM(request.id);
                }
            }
            throw error;
        }
    }

    async scheduleORM(model, method, args, kwargs, options) {
        if (!this._workCrypto) {
            throw new NonSecureContextError(
                _t("Offline features not available in a non-secure context")
            );
        }
        const request = options.request;
        const value = request
            ? { model: request.model, method: request.method, args: request.args, kwargs: request.kwargs, extras: options.extras }
            : { model, method, args, kwargs, extras: options.extras };
        const key = request?.id ?? options.id ?? hashCode(JSON.stringify(value));
        await navigator.locks.request("odoo-offline-queue", async () => {
            if (request) {
                const previous = await this._idb.read(OfflinePlugin.ORM_SYNC_TABLE_NAME, key);
                const order = previous && (await this._workCrypto.decrypt(previous)).extras.order;
                if (order) {
                    value.extras = { ...value.extras, order };
                } else {
                    const last = await this._idb.read("ordering", "last");
                    value.extras = { ...value.extras, order: (last || 0) + 1 };
                    await this._idb.write("ordering", "last", value.extras.order);
                }
            }
            await this._idb.write(OfflinePlugin.ORM_SYNC_TABLE_NAME, key, await this._workCrypto.encrypt(value));
            this._ormToSync()[key] = { key, value };
        });
        if (request && !options.beforeSend && !this.isOffline()) {
            this._syncORM();
        }
        return key;
    }

    async removeScheduledORM(key) {
        const pending = this._ormToSync()[key];
        delete this._ormToSync()[key];
        try {
            await this._idb.delete(OfflinePlugin.ORM_SYNC_TABLE_NAME, key);
        } catch (error) {
            this._ormToSync()[key] = pending;
            throw error;
        }
    }

    async retryScheduledORM(key) {
        const { value } = this._ormToSync()[key];
        const extras = { ...value.extras };
        delete extras.error;
        await this.scheduleORM(value.model, value.method, value.args, value.kwargs, { id: key, extras });
        return this._syncORM();
    }

    get hasScheduledCalls() {
        return !!Object.keys(this._ormToSync()).length || this.legacyPending() || this.unreadablePending();
    }

    // -------------------------------------------------------------------------
    // Server-authorized read snapshots
    // -------------------------------------------------------------------------

    invalidateAccess() {
        // Rotate the namespace for every company selection belonging to this
        // account. Other tabs clear RAM through the corresponding storage event.
        this._revision = `${Date.now()}-${Math.random()}`;
        browser.localStorage.setItem(offlineRevisionKey(), this._revision);
        rpcBus.trigger("CLEAR-CACHES");
    }

    /** Save a server-authorized read for use when the network is unavailable. */
    async writeSnapshot(key, data, generation = this.cacheGeneration) {
        if (this._crypto) {
            const savedAt = Date.now();
            const value = await this._crypto.encrypt({ data, savedAt });
            if (generation === this.cacheGeneration) {
                await this._readCache.write("snapshots", key, value);
                return savedAt;
            }
        }
    }

    getSnapshotKeys() {
        return this._readCache.getAllKeys("snapshots");
    }

    async readSnapshot(key) {
        if (this._crypto) {
            const generation = this.cacheGeneration;
            const value = await this._readCache.read("snapshots", key);
            if (value) {
                try {
                    const snapshot = await this._crypto.decrypt(value);
                    return generation === this.cacheGeneration ? snapshot : undefined;
                } catch {
                    // A security change can rotate the user's cache secret.
                    await this._readCache.delete("snapshots", key);
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // Many2X Offline
    // -------------------------------------------------------------------------

    async cacheMany2XSearch(resModel, result) {
        if (!this._crypto) {
            return;
        }
        const tableName = OfflinePlugin.MANY2X_TABLE_PREFIX + resModel;
        const values = await this._encryptAndFormat(result);
        this._readCache.write(tableName, values);
    }

    async searchMany2XRecords(resModel, name) {
        if (!this._crypto) {
            return;
        }

        const normalizeSearch = normalize(name);
        const _searchFn = !normalizeSearch
            ? () => true
            : async (value) => {
                  const decryptedValue = normalize(await this._crypto.decrypt(value));
                  return decryptedValue.includes(normalizeSearch);
              };
        const tableName = OfflinePlugin.MANY2X_TABLE_PREFIX + resModel;
        const res = await this._readCache.search(tableName, _searchFn);
        return this._decryptAndFormat(res);
    }

    async readMany2XRecords(resModel, resIds) {
        if (!this._crypto) {
            return;
        }
        const tableName = OfflinePlugin.MANY2X_TABLE_PREFIX + resModel;
        const res = await this._readCache.read(tableName, resIds);
        return this._decryptAndFormat(res);
    }

    // -------------------------------------------------------------------------
    // Private
    // -------------------------------------------------------------------------

    /**
     * @private
     */
    _cleanup() {
        this._onlineUI();
        this._observer?.disconnect();
        browser.clearTimeout(this._timeout);
    }

    async _decryptAndFormat(offlineRes) {
        const decrytedRes = [];
        for (const r of offlineRes) {
            const value = r.value ? await this._crypto.decrypt(r.value) : undefined;
            decrytedRes.push({ id: Number(r.key), display_name: value });
        }
        return decrytedRes;
    }

    async _encryptAndFormat(ormResult) {
        const encryptedRes = [];
        for (const r of ormResult) {
            const value = await this._crypto.encrypt(
                typeof r.display_name === "string" ? r.display_name.split("\n")[0] : r.display_name
            );

            encryptedRes.push({ key: r.id, value });
        }
        return encryptedRes;
    }

    /**
     * Generates the key to identify an action, a viewType and optionally a record
     * id, to use as key in the indexeddb table.
     *
     * @private
     * @param {number} actionId
     * @param {"kanban"|"list"|"form"} viewType
     * @param {number} [params.resId] the record id, when viewType is "form"
     * @returns string
     */
    _generateKey(actionId, viewType, resId) {
        return JSON.stringify({ action: actionId, viewType, resId });
    }

    /**
     * Populates the `_visited` structure with the information read from indexeddb.
     *
     * @private
     */
    async _populateVisited() {
        return this._readCache.getAllKeys(this._visitedUITable()).then((keys) => {
            if (!this.isOffline()) {
                return; // status changed again meanwhile
            }
            for (const key of keys) {
                const { action, viewType, resId } = JSON.parse(key);
                this._visited()[action] = this._visited()[action] || { views: {} };
                if (viewType === "form") {
                    this._visited()[action].views.form = this._visited()[action].views.form || [];
                    this._visited()[action].views.form.push(resId);
                } else {
                    this._visited()[action].views[viewType] = true;
                }
            }
        });
    }

    /**
     * Disables interactive elements (e.g. buttons) that haven't been tagged as "available-offline".
     *
     * @private
     */
    _offlineUI() {
        // Re-enable elements that have been marked as available offline
        document.querySelectorAll(".o_disabled_offline[data-available-offline]").forEach((el) => {
            el.removeAttribute("disabled");
            el.classList.remove("o_disabled_offline");
        });
        document.querySelectorAll(OfflinePlugin.SELECTORS_TO_DISABLE.join(", ")).forEach((el) => {
            el.setAttribute("disabled", "");
            el.classList.add("o_disabled_offline");
        });
    }

    /**
     * Re-enables elements that have previously been disabled by @_offlineUI.
     *
     * @private
     */
    _onlineUI() {
        document.querySelectorAll(".o_disabled_offline").forEach((el) => {
            el.removeAttribute("disabled");
            el.classList.remove("o_disabled_offline");
        });
    }

    // -------------------------------------------------------------------------
    // ORM Offline
    // -------------------------------------------------------------------------

    async _syncORM() {
        if (!window.isSecureContext) {
            return;
        }

        // Only one tab can execute this block at a time
        // This can only be done in a secure context
        await navigator.locks.request("db-sync", async () => {
            this.syncingORM.set(true);
            try {
                await this._sendScheduledORM();
            } finally {
                this.syncingORM.set(false);
            }
        });
    }

    async _sendScheduledORM() {
        await this._updateScheduledORMList();
        for (const [index, { key }] of Object.values(this._ormToSync())
            .filter(({ value }) => !value.extras?.error)
            .sort((a, b) => (a.value.extras?.order ?? a.value.extras?.timeStamp ?? 0) -
                (b.value.extras?.order ?? b.value.extras?.timeStamp ?? 0))
            .entries()) {
            if (index !== 0) {
                await new Promise((r) => browser.setTimeout(r, 1000)); // Waits 1 second
            }
            const proceed = await navigator.locks.request("offline-change-" + key, () => this._sendPending(key));
            if (!proceed) {
                break;
            }
        }
    }

    async _sendPending(key) {
        const encrypted = await this._idb.read(OfflinePlugin.ORM_SYNC_TABLE_NAME, key);
        if (!encrypted) {
            return true; // Discarded in another tab since this sync started.
        }
        const value = await this._workCrypto.decrypt(encrypted);
        if (value.extras?.error) {
            return true;
        }
        try {
            const replay = Object.assign(Object.create(this.orm.silent), { replaying: true });
            const result = await replay.call(value.model, value.method, value.args, value.kwargs);
            await this.removeScheduledORM(key);
            rpcBus.trigger("OFFLINE:APPLIED", { key, value, result });
        } catch (error) {
            if (error instanceof ConnectionLostError) {
                return false;
            }
            await this.scheduleORM(value.model, value.method, value.args, value.kwargs, {
                id: key, extras: { ...value.extras, error: error.data?.message || error.message || _t("The change could not be sent.") },
            });
        }
        return true;
    }

    discardScheduledORM(key) {
        return navigator.locks.request("offline-change-" + key, () => this.removeScheduledORM(key));
    }

    async _updateScheduledORMList() {
        const table = await this._idb.getAllEntries(OfflinePlugin.ORM_SYNC_TABLE_NAME);
        const decoded = await Promise.allSettled((table || []).map(async ({ key, value }) => [
            key, { key, value: await this._workCrypto.decrypt(value) },
        ]));
        this.unreadablePending.set(decoded.some((entry) => entry.status === "rejected"));
        this._ormToSync.set(Object.fromEntries(
            decoded.filter((entry) => entry.status === "fulfilled").map((entry) => entry.value)
        ));
    }
}

services.add(OfflinePlugin);

/**
 * -----------------------------------------------------------------------------
 * @todo owl3 migration
 * temporary - to remove when all use of the offline service are removed
 * -----------------------------------------------------------------------------
 *
 * Bridges the legacy `useService("offline")` API to the OfflinePlugin. New code
 * should use `usePlugin(OfflinePlugin)` directly and read the `isOffline()` signal.
 */
export const offlineService = {
    start() {
        const offlinePlugin = usePlugin(OfflinePlugin);
        const offlineService = Object.create(offlinePlugin);
        Object.defineProperty(offlineService, "offline", {
            get() {
                return offlinePlugin.isOffline();
            },
            set(offline) {
                offlinePlugin.setOffline(offline);
            },
        });
        Object.defineProperty(offlineService, "syncingORM", {
            get() {
                return offlinePlugin.syncingORM();
            },
        });
        Object.defineProperty(offlineService, "scheduledORM", {
            get() {
                return offlinePlugin._ormToSync();
            },
        });
        return offlineService;
    },
};

registry.category("services").add("offline", offlineService);
