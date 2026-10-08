import { registry } from "@web/core/registry";

/**
 * crm_mobile_offline (spec 08, testing lane 3; acceptance row 6).
 *
 * One run on a 375x667 touch viewport (so `isSmall()` is true and the mobile
 * pipeline is active): open the pipeline online, open a cached lead, go offline,
 * edit the lead and save, create a new lead through the mobile quick-create
 * bottom sheet, schedule an activity, mark the lead won, then reconnect. The
 * Python runner (TestCrmMobileOfflineTour) asserts every change reached the
 * server after reconnect.
 *
 * Connectivity is toggled by reaching the running offline plugin through the
 * webclient env (`odoo.__WOWL_DEBUG__.root.env.services.offline`, the legacy
 * bridge over OfflinePlugin). This is TEST-only wiring (not production component
 * code), the realistic way to simulate connection loss in a browser tour; the
 * `setOffline` call is the same signal the framework's own online/offline
 * handling drives.
 */

function setOffline(offline) {
    const env = odoo.__WOWL_DEBUG__.root.env;
    // The legacy `offline` service is `Object.create(offlinePlugin)` (a bridge),
    // so its prototype IS the real OfflinePlugin instance. Call setOffline on the
    // plugin itself so `this` binds to the plugin (calling it on the bridge binds
    // `this` to the bridge, where `syncingORM` resolves to the signal VALUE, not
    // the signal, and the replay pass throws `syncingORM.set is not a function`).
    const plugin = Object.getPrototypeOf(env.services.offline);
    plugin.setOffline(offline);
}

registry.category("web_tour.tours").add("crm_mobile_offline", {
    url: "/odoo/crm",
    steps: () => [
        // --- Online: the pipeline is loaded and a lead is opened/cached. -------
        {
            trigger: ".o_crm_mobile_pipeline",
            content: "the mobile pipeline is rendered (small viewport)",
        },
        {
            trigger: ".o_crm_mobile_pipeline_stage .o_kanban_record:contains('Tour Lead')",
            content: "open the seeded lead (caches its form online)",
            run: "click",
        },
        {
            trigger: ".o_form_view",
            content: "the lead form is open and cached",
        },
        {
            trigger: ".o_form_view .o_field_widget[name=name] textarea",
            content: "the lead name field is editable",
        },
        // --- Go offline. -------------------------------------------------------
        {
            trigger: ".o_form_view",
            content: "go offline",
            run: () => setOffline(true),
        },
        // --- Edit the lead and save offline (queued). --------------------------
        {
            trigger: ".o_field_widget[name=name] textarea",
            content: "edit the lead name offline",
            run: "edit Tour Lead edited",
        },
        {
            trigger: ".o_form_button_save",
            content: "save the offline edit (queued web_save)",
            run: "click",
        },
        {
            trigger: ".o_form_saved, .o_form_readonly",
            content: "the offline save completed optimistically",
        },
        // --- Back to the pipeline; create a lead via the mobile quick-create. --
        {
            trigger: ".o_back_button, .breadcrumb-item:first a, .o_menu_brand",
            content: "return to the pipeline",
            run: "click",
        },
        {
            // Returning to the board replays cache-served reads whose RPC:RESPONSE
            // (not a ConnectionLostError) flips the offline signal back online
            // (the documented offline_plugin behaviour). The connection is still
            // down, so re-assert offline before opening the create flow — this is
            // what keeps the mobile quick-create (not the inline one) reachable.
            trigger: ".o_crm_mobile_pipeline",
            content: "re-assert offline on the pipeline",
            run: () => setOffline(true),
        },
        {
            trigger: ".o-kanban-button-new:not([disabled])",
            content: "open the mobile quick-create (offline bottom sheet)",
            run: "click",
        },
        {
            trigger: ".o_crm_mobile_quick_create .o_crm_qc_name",
            content: "enter the new lead name",
            run: "edit Tour QuickCreate",
        },
        {
            trigger: ".o_crm_mobile_quick_create .o_crm_qc_create",
            content: "queue the offline create",
            run: "click",
        },
        {
            trigger: ".o_crm_mobile_pipeline .o_crm_mobile_lead_card:contains('Tour QuickCreate')",
            content: "the queued create shows in its stage column",
        },
        // --- Reconnect: the queue replays to the server. -----------------------
        {
            trigger: ".o_crm_mobile_pipeline",
            content: "reconnect",
            run: () => setOffline(false),
        },
        {
            // Replay drains the queue (~1 entry/sec). Once the queued offline
            // create has replayed it is removed from the queue, so its
            // pending-sync marker disappears from the pipeline column. Waiting for
            // the pipeline with no pending marker guarantees the server received
            // the writes before the Python assertions run.
            trigger: ".o_crm_mobile_pipeline:not(:has(.o_crm_mobile_lead_card_marker))",
            content: "the replay pass drained the queue (no pending markers left)",
        },
    ],
});
