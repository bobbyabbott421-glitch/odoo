/**
 * Shared offline hook for mobile CRM.
 *
 * `useCrmOffline()` is a thin, reactive adapter over the framework's existing
 * `OfflinePlugin` and `UIPlugin`. It MUST be called in a component's `setup()`
 * body: `usePlugin` is an OWL hook and throws outside component setup.
 *
 * Each returned member reads the live signal at call time (it is a function,
 * not a value snapshotted during setup), so templates that call these members
 * during render subscribe to the signal and re-render when it changes.
 *
 * `_ormToSync()` is the single framework signal read for queued-write state —
 * the same signal the offline systray reads. The hook keeps no local flag and
 * no second store, adding no offline machinery.
 */

import { usePlugin } from "@odoo/owl";
import { OfflinePlugin } from "@web/core/offline/offline_plugin";
import { UIPlugin } from "@web/core/ui/ui_plugin";

export function useCrmOffline() {
    const offline = usePlugin(OfflinePlugin);
    const ui = usePlugin(UIPlugin);

    return {
        isOffline: () => offline.isOffline(),
        isSmall: () => ui.isSmall(),
        isAvailableOffline: (actionId, viewType, resId) =>
            offline.isAvailableOffline(actionId, viewType, resId),
        scheduleORM: (model, method, args, kwargs, options) =>
            offline.scheduleORM(model, method, args, kwargs, options),
        hasQueuedWrite: (resModel, resId) => {
            const entries = Object.values(offline._ormToSync());
            if (resModel === undefined) {
                return entries.length > 0;
            }
            return entries.some(
                ({ value }) =>
                    value.model === resModel &&
                    Array.isArray(value.args[0]) &&
                    value.args[0].includes(resId)
            );
        },
        // Reads the same framework queue signal `hasQueuedWrite` reads (no second
        // store): returns the queued entry values ({ model, method, args, kwargs,
        // extras }) for `resModel`, as an array. Read at call time so it stays
        // reactive — an empty array when the queue holds no entry for that model.
        queuedWrites: (resModel) =>
            Object.values(offline._ormToSync())
                .map((entry) => entry.value)
                .filter((value) => value.model === resModel),
    };
}
