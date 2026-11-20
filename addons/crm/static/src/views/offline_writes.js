import { registry } from "@web/core/registry";
import { user } from "@web/core/user";
import { session } from "@web/session";

const methods = new Set(["web_save", "web_save_multi", "web_unlink", "action_archive", "action_unarchive",
    "offline_log_note", "offline_schedule_todo"]);

registry.category("offline_write_tokens").add("crm.lead", (method, parent) => {
    if (session.crm_offline_writes && methods.has(method) && globalThis.crypto?.randomUUID) {
        return { key: crypto.randomUUID(), uid: user.userId, db: session.db, parent };
    }
});
