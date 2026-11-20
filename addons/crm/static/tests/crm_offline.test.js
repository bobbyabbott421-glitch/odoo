import { expect, test } from "@odoo/hoot";
import { defineMailModels } from "@mail/../tests/mail_test_helpers";
import { offlineScope } from "@web/core/offline/offline_scope";
import { OfflinePlugin } from "@web/core/offline/offline_plugin";
import { rpcBus } from "@web/core/network/rpc";
import { user } from "@web/core/user";
import { getService, makeTestApp, patchWithCleanup } from "@web/../tests/web_test_helpers";
import { session } from "@web/session";

defineMailModels();

test("offline storage follows the database, rep and active companies", async () => {
    await makeTestApp();
    const key = () => offlineScope("crm.switcher_team_id");
    const original = key();
    patchWithCleanup(session, { db: "other-database" });
    const database = key();
    expect(database).not.toBe(original);
    patchWithCleanup(user, { userId: 99 });
    const account = key();
    expect(account).not.toBe(database);
    patchWithCleanup(user, { get context() { return { allowed_company_ids: [98] }; } });
    expect(key()).not.toBe(account);
});

test("a denied read clears stored history and ongoing snapshot writes", async () => {
    await makeTestApp();
    const offline = getService(OfflinePlugin);
    const pending = Promise.withResolvers();
    const crypto = offline._crypto;
    let writes = 0;
    let invalidations = 0;
    patchWithCleanup(offline, {
        _crypto: { encrypt: () => pending.promise },
        _readCache: {
            invalidate: () => invalidations++,
            write: () => writes++,
        },
    });
    const saved = offline.writeSnapshot("visited lead", { name: "Site visit" });
    rpcBus.trigger("RPC:RESPONSE", {
        data: { id: 1, params: { model: "crm.lead", method: "web_read" } },
        settings: { silent: true },
        error: { exceptionName: "odoo.exceptions.AccessError" },
    });
    pending.resolve({});
    await saved;
    expect(invalidations).toBe(1);
    expect(writes).toBe(0);
    expect(offline._readCache.name).toBe(offlineScope("offline-reads"));
    patchWithCleanup(offline, { _crypto: crypto });
    await offline.writeSnapshot("still authorized", { name: "Return visit" });
    expect((await offline.readSnapshot("still authorized")).data.name).toBe("Return visit");
});

test("the saved order survives enrichment and an unreadable pending row", async () => {
    await makeTestApp();
    const offline = getService(OfflinePlugin);
    offline.setOffline(true);
    const model = "crm.lead";
    const method = "web_save";
    const args = [[42], { name: "Visit" }];
    async function save(id, displayName) {
        const kwargs = { offline_operation: { key: id } };
        return offline.scheduleORM(model, method, args, kwargs, {
            request: { id, model, method, args, kwargs },
            extras: { displayName },
        });
    }
    await save("first", "Visit");
    await save("second", "Return visit");
    await save("first", "Saved visit");
    const stored = await offline._idb.read(OfflinePlugin.ORM_SYNC_TABLE_NAME, "first");
    expect(Boolean(stored.ciphertext)).toBe(true);
    expect(stored.args).toBe(undefined);
    await offline._idb.write(OfflinePlugin.ORM_SYNC_TABLE_NAME, "unreadable", {});
    await offline._updateScheduledORMList();
    expect(offline.unreadablePending()).toBe(true);
    expect(offline._ormToSync().first.value.extras.order).toBe(1);
    expect(offline._ormToSync().second.value.extras.order).toBe(2);
    expect(offline._ormToSync().first.value.extras.displayName).toBe("Saved visit");
});

test("an online save can finish when this device is full", async () => {
    await makeTestApp();
    const offline = getService(OfflinePlugin);
    patchWithCleanup(offline, {
        scheduleORM: async () => { throw new DOMException("Full", "QuotaExceededError"); },
    });
    const request = { id: "unique", model: "crm.lead", method: "web_save", args: [[42], { name: "Site" }], kwargs: {} };
    const result = await offline._submitOfflineWrite(request, async () => [{ id: 42 }]);
    expect(result).toEqual([{ id: 42 }]);
    expect(offline.hasScheduledCalls).toBe(false);
});


test("a busy sender leaves a new save queued without waiting for the network", async () => {
    await makeTestApp();
    const offline = getService(OfflinePlugin);
    const params = { model: "crm.lead", method: "web_save", args: [[8], { name: "Depot" }], kwargs: {} };
    patchWithCleanup(navigator.locks, {
        request(name, options, callback) {
            if (options.ifAvailable) {
                return callback(null);
            }
            return options();
        },
    });
    patchWithCleanup(offline, { _syncORM() { expect.step("schedule delivery"); } });
    let error;
    try {
        await offline._submitOfflineWrite({ id: "new-save", ...params }, () => expect.step("sent"));
    } catch (e) {
        error = e;
    }
    expect(error.offlineWrite.id).toBe("new-save");
    expect(offline._ormToSync()["new-save"].value.args).toEqual(params.args);
    expect.verifySteps(["schedule delivery"]);
});
