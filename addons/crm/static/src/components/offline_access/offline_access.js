import { Component, proxy, t, useProps } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";
import { _t } from "@web/core/l10n/translation";
import { registry } from "@web/core/registry";
import { user } from "@web/core/user";
import { useService } from "@web/core/utils/hooks";
import { session } from "@web/session";

export class OfflineAccess extends Component {
    static template = "crm.OfflineAccess";
    static components = { Dialog };
    props = useProps({ close: t.function() });

    setup() {
        this.state = proxy({ busy: false, message: "" });
        this.supported = !!(navigator.serviceWorker && window.cookieStore && crypto.subtle);
    }

    async enroll(event) {
        event.preventDefault();
        const form = event.target;
        if (this.state.busy) {
            return;
        }
        if (form.passphrase.value !== form.confirmation.value) {
            this.state.message = _t("The passphrases differ. Enter the same passphrase twice.");
            return;
        }
        this.state.busy = true;
        const channel = new MessageChannel();
        let timeout;
        try {
            const deadline = new Promise((resolve) => {
                timeout = setTimeout(() => resolve(false), 10000);
            });
            const registration = await Promise.race([navigator.serviceWorker.ready, deadline]);
            let saved = false;
            if (registration?.active) {
                const reply = new Promise((resolve) => {
                    channel.port1.onmessage = ({ data }) => resolve(data);
                });
                registration.active.postMessage({
                    type: "odoo-offline-access", action: "enroll", uid: user.userId,
                    db: session.db, passphrase: form.passphrase.value,
                }, [channel.port2]);
                saved = await Promise.race([reply, deadline]);
            }
            if (saved) {
                form.reset();
                this.state.message = _t("Offline access is ready. Use your passphrase to reopen your pipeline.");
            } else {
                this.state.message = _t("Offline access could not be saved. Reconnect and try again.");
            }
        } catch {
            this.state.message = _t("Offline access could not be saved. Reconnect and try again.");
        } finally {
            clearTimeout(timeout);
            channel.port1.close();
            this.state.busy = false;
        }
    }
}

registry.category("user_menuitems").add("crm_offline_access", () => {
    const dialog = useService("dialog");
    const menu = useService("menu");
    return {
        type: "item", id: "crm_offline_access", sequence: 64,
        description: _t("CRM offline access"),
        hide: menu.getCurrentApp()?.webIcon?.split(",")[0] !== "crm",
        callback: () => dialog.add(OfflineAccess),
    };
});
