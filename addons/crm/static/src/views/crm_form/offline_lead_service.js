import { browser } from "@web/core/browser/browser";
import { ConnectionLostError, rpcBus } from "@web/core/network/rpc";
import { registry } from "@web/core/registry";

const leadKey = (id) => `crm.lead/${id}`;

registry.category("services").add("crm.offline_leads", {
    dependencies: ["offline", "orm"],
    start(env, { offline, orm }) {
        let disconnected = false;
        async function verifyVisited() {
            const ids = (await offline.getSnapshotKeys())
                .filter((key) => key.startsWith("crm.lead/"))
                .map((key) => Number(key.slice("crm.lead/".length)));
            for (let i = 0; i < ids.length; i += 500) {
                const batch = ids.slice(i, i + 500);
                const visible = await orm.silent.search("crm.lead", [["id", "in", batch]], {
                    context: { active_test: false },
                });
                if (visible.length !== batch.length) {
                    offline.invalidateAccess();
                    // Remove stale cards and details from the current document as well.
                    const path = browser.location.pathname;
                    const missing = batch.filter((id) => !visible.includes(id));
                    if (path === "/odoo/crm" || missing.some((id) => path === `/odoo/crm/${id}`)) {
                        browser.location.replace("/odoo/crm");
                    }
                    return;
                }
            }
        }
        rpcBus.addEventListener("OFFLINE:APPLIED", ({ detail: { value } }) => {
            if (value.model === "crm.lead" && ["offline_log_note", "offline_schedule_todo"].includes(value.method)) {
                env.bus.trigger("MAIL:RELOAD-THREAD", { model: value.model, id: value.args[0][0] });
            }
        });
        rpcBus.addEventListener("RPC:RESPONSE", ({ detail }) => {
            if (detail.error instanceof ConnectionLostError) {
                disconnected = true;
                return;
            }
            if (disconnected && !detail.error) {
                disconnected = false;
                verifyVisited().catch(() => { disconnected = true; });
            }
            const params = detail.data?.params;
            if (!detail.error && params?.model === "crm.lead" && params.method === "web_read") {
                for (const lead of detail.result || []) {
                    offline.writeSnapshot(leadKey(lead.id), true).catch(() => {});
                }
            }
        });
        return {
            async lastChecked(id) {
                return (await offline.readSnapshot(leadKey(id)))?.savedAt;
            },
        };
    },
});
