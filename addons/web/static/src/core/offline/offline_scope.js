import { browser } from "@web/core/browser/browser";
import { user } from "@web/core/user";
import { session } from "@web/session";

export function offlineRevisionKey() {
    return JSON.stringify(["offline-access", session.db, user.userId]);
}

/** Data available to a web client belongs to its database, user and active companies. */
export function offlineScope(name) {
    return JSON.stringify([
        name, session.db, user.userId, user.context.allowed_company_ids,
        browser.localStorage.getItem(offlineRevisionKey()),
    ]);
}
