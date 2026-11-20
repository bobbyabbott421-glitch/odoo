import { defineMailModels } from "@mail/../tests/mail_test_helpers";
import { expect, test } from "@odoo/hoot";
import { OfflineAccess } from "@crm/components/offline_access/offline_access";
import {
    assignDialogTestEnv,
    contains,
    mountWithCleanup,
} from "@web/../tests/web_test_helpers";

defineMailModels();

test("offline enrollment explains a mismatched passphrase and leaves it editable", async () => {
    assignDialogTestEnv();
    await mountWithCleanup(OfflineAccess, { props: { close() {} } });
    await contains("input[name=passphrase]").edit("Twelve letters first");
    await contains("input[name=confirmation]").edit("Twelve letters second");
    await contains("form button[type=submit]").click();
    expect("[role=status]").toHaveText("The passphrases differ. Enter the same passphrase twice.");
    expect("form button:disabled").toHaveCount(0);
    expect("input[name=passphrase]").toHaveAttribute("type", "password");
    expect("input[name=confirmation]").toHaveAttribute("autocomplete", "new-password");
});
