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
});
