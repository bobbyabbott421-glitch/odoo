import { Component, xml } from "@odoo/owl";
import { expect, test } from "@odoo/hoot";
import { defineMailModels } from "@mail/../tests/mail_test_helpers";
import {
    getService,
    mountWithCleanup,
    patchWithCleanup,
} from "@web/../tests/web_test_helpers";
import { OfflinePlugin } from "@web/core/offline/offline_plugin";
import { NonSecureContextError } from "@web/core/errors/non_secure_context_error";
import { useCrmOffline } from "@crm/mobile/crm_offline_hooks";

// The webclient services started behind `mountWithCleanup` resolve mail models
// (e.g. `discuss.channel`) from the mock server, so the mail test models must be
// defined. This mirrors the existing crm Hoot tests (crm_team_switcher.test.js).
defineMailModels();

/**
 * Module-level handle to the object returned by `useCrmOffline()`. The probe
 * component writes it in `setup()` so each test can call the hook's members
 * directly and assert their live return values.
 */
let hook;

class Probe extends Component {
    static template = xml`<div/>`;
    setup() {
        hook = useCrmOffline();
    }
}

/**
 * Mount the probe, exposing the hook object on the module-level `hook`.
 * `mountWithCleanup` tears the component down after each test.
 */
async function mountProbe() {
    hook = undefined;
    await mountWithCleanup(Probe);
}

/**
 * Toggle the framework offline signal directly on the plugin. We drive the
 * signal rather than `mockOffline()` (which also installs an `onRpc("/*")`
 * returning 502): toggling the signal is all the hook predicates read, and it
 * avoids turning unrelated background RPCs into non-deterministic
 * connection-lost errors when the suite runs alongside the mail services.
 */
function setOffline(offline) {
    getService(OfflinePlugin).setOffline(offline);
}

/**
 * Schedule a queued ORM entry straight on the plugin, for the queued-write
 * read tests. `args[0]` is the ids array for a `write`/`web_save` (confirmed in
 * web's offline_systray.test.js).
 */
function scheduleWrite(model, ids, extras = {}) {
    getService(OfflinePlugin).scheduleORM(model, "web_save", [ids], {}, {
        extras: { timeStamp: 1, ...extras },
    });
}

// ===========================================================================
// isOffline — reads the live connection signal (Requirements 2.1, 2.3, 3.1).
// Exercised online and offline. Run under both presets.
// ===========================================================================

async function testIsOffline() {
    await mountProbe();
    expect(hook.isOffline()).toBe(false); // online
    setOffline(true);
    expect(hook.isOffline()).toBe(true); // offline
    setOffline(false);
    expect(hook.isOffline()).toBe(false); // back online
}

test.tags("desktop");
test("isOffline reflects connectivity (desktop)", testIsOffline);

test.tags("mobile");
test("isOffline reflects connectivity (mobile)", testIsOffline);

// ===========================================================================
// isSmall — pinned to the preset (Requirements 2.2, 2.3, 3.2). Comparing
// against the UI plugin getter would be circular, so the expected value is
// pinned: false on desktop, true on mobile. Asserted both online and offline
// to show the small-screen signal is independent of connectivity.
// ===========================================================================

async function testIsSmall(expected) {
    await mountProbe();
    expect(hook.isSmall()).toBe(expected); // online
    setOffline(true);
    expect(hook.isSmall()).toBe(expected); // offline — unchanged
    setOffline(false);
}

test.tags("desktop");
test("isSmall is false under the desktop preset", () => testIsSmall(false));

test.tags("mobile");
test("isSmall is true under the mobile preset", () => testIsSmall(true));

// ===========================================================================
// isAvailableOffline — real delegation to the plugin (Requirements 1.1, 3.1).
// The plugin answers from its in-memory `_visited` map, which it populates from
// its own cache only when going offline. Online, nothing is populated yet, so
// the hook returns the plugin's online answer; offline (after the cache is
// loaded) it returns true for the seeded record. Both states are asserted,
// under both presets.
// ===========================================================================

async function testIsAvailableOffline() {
    await mountProbe();
    const offline = getService(OfflinePlugin);
    const actionId = 42;
    const resId = 7;

    // Seed the cache while online (setAvailableOffline only persists when not offline).
    await offline.setAvailableOffline(actionId, "form", { resId });

    // Online: `_visited` is not populated, so the hook returns the plugin's
    // online answer verbatim (faithful delegation, not a cached true).
    expect(hook.isAvailableOffline(actionId, "form", resId)).toBe(
        offline.isAvailableOffline(actionId, "form", resId)
    );

    // Go offline; the plugin loads the visited items from its own cache into `_visited`.
    setOffline(true);
    await offline.getVisitedStatus();

    // Offline: seeded action/view/record resolves true via the hook's delegation.
    expect(hook.isAvailableOffline(actionId, "form", resId)).toBe(true);
    // Unseeded record of a seeded action/view: the cached form id list does not
    // include it, so the plugin returns false.
    expect(hook.isAvailableOffline(actionId, "form", 999)).toBe(false);
    // Unseeded action entirely: the hook returns exactly what the plugin returns
    // for an unknown action/form, proving faithful delegation. For an unknown
    // action the plugin's form branch yields `undefined`, which the hook passes
    // through verbatim.
    expect(hook.isAvailableOffline(999, "form", resId)).toBe(
        offline.isAvailableOffline(999, "form", resId)
    );
    expect(hook.isAvailableOffline(999, "form", resId)).toBe(undefined);
    setOffline(false);
}

test.tags("desktop");
test("isAvailableOffline delegates to the plugin (desktop)", testIsAvailableOffline);

test.tags("mobile");
test("isAvailableOffline delegates to the plugin (mobile)", testIsAvailableOffline);

// ===========================================================================
// hasQueuedWrite — reads the framework's _ormToSync() signal (Requirement 4).
// Covered online and offline, keyed and no-arg, matching/non-matching, parked,
// and the non-array args[0] guard. Run under both presets.
// ===========================================================================

async function testHasQueuedWriteEmpty() {
    await mountProbe();
    // Online, empty queue.
    expect(hook.hasQueuedWrite()).toBe(false);
    expect(hook.hasQueuedWrite("crm.lead", 7)).toBe(false);
}

test.tags("desktop");
test("hasQueuedWrite is false on an empty queue (desktop)", testHasQueuedWriteEmpty);

test.tags("mobile");
test("hasQueuedWrite is false on an empty queue (mobile)", testHasQueuedWriteEmpty);

// A write queued while OFFLINE is the real case: the salesperson edits offline
// and the framework captures the call. hasQueuedWrite must see it.
async function testHasQueuedWriteOffline() {
    await mountProbe();
    setOffline(true);

    expect(hook.hasQueuedWrite()).toBe(false);
    scheduleWrite("crm.lead", [7]);
    // Keyed and no-arg forms both report the offline-queued write.
    expect(hook.hasQueuedWrite("crm.lead", 7)).toBe(true);
    expect(hook.hasQueuedWrite()).toBe(true);
    setOffline(false);
}

test.tags("desktop");
test("hasQueuedWrite sees a write queued while offline (desktop)", testHasQueuedWriteOffline);

test.tags("mobile");
test("hasQueuedWrite sees a write queued while offline (mobile)", testHasQueuedWriteOffline);

// Online, a queued entry (e.g. a replay still pending) matches by model + id.
async function testHasQueuedWriteMatch() {
    await mountProbe();
    scheduleWrite("crm.lead", [7]);
    expect(hook.hasQueuedWrite("crm.lead", 7)).toBe(true);
    // No-arg form also reports it.
    expect(hook.hasQueuedWrite()).toBe(true);
}

test.tags("desktop");
test("hasQueuedWrite matches a keyed entry (desktop)", testHasQueuedWriteMatch);

test.tags("mobile");
test("hasQueuedWrite matches a keyed entry (mobile)", testHasQueuedWriteMatch);

// Wrong model or wrong id does not match.
async function testHasQueuedWriteNonMatch() {
    await mountProbe();
    scheduleWrite("crm.lead", [7]);
    expect(hook.hasQueuedWrite("crm.stage", 7)).toBe(false); // wrong model
    expect(hook.hasQueuedWrite("crm.lead", 8)).toBe(false); // wrong id
}

test.tags("desktop");
test("hasQueuedWrite rejects a non-matching entry (desktop)", testHasQueuedWriteNonMatch);

test.tags("mobile");
test("hasQueuedWrite rejects a non-matching entry (mobile)", testHasQueuedWriteNonMatch);

// A parked entry (carrying extras.error after a failed replay) is still
// unsynced, so it is counted as a queued write (Requirement 4.3).
async function testHasQueuedWriteParked() {
    await mountProbe();
    scheduleWrite("crm.lead", [7], { error: "boom" });
    expect(hook.hasQueuedWrite("crm.lead", 7)).toBe(true);
    expect(hook.hasQueuedWrite()).toBe(true);
}

test.tags("desktop");
test("hasQueuedWrite counts a parked entry (desktop)", testHasQueuedWriteParked);

test.tags("mobile");
test("hasQueuedWrite counts a parked entry (mobile)", testHasQueuedWriteParked);

// Guard path: an entry on the right model whose args[0] is NOT an array must
// not match and must not throw (crm_offline_hooks.js guards with Array.isArray
// before calling .includes).
async function testHasQueuedWriteNonArrayArgs() {
    await mountProbe();
    // Schedule a crm.lead call whose args[0] is not an array of ids.
    getService(OfflinePlugin).scheduleORM(
        "crm.lead",
        "some_method",
        ["not-an-array"],
        {},
        { extras: { timeStamp: 1 } }
    );
    // Matching model, but args[0] is not an array: keyed form returns false and
    // does not throw.
    expect(hook.hasQueuedWrite("crm.lead", 7)).toBe(false);
    // The no-arg form still reports that *something* is queued.
    expect(hook.hasQueuedWrite()).toBe(true);
}

test.tags("desktop");
test("hasQueuedWrite tolerates a non-array args[0] (desktop)", testHasQueuedWriteNonArrayArgs);

test.tags("mobile");
test("hasQueuedWrite tolerates a non-array args[0] (mobile)", testHasQueuedWriteNonArrayArgs);

// ===========================================================================
// scheduleORM — transparent pass-through to the plugin (Requirement 5).
// Asserts the full argument list (model, method, args, kwargs, options.extras)
// reaches the queued entry unchanged and that the hook returns the plugin's key.
// ===========================================================================

async function testScheduleORMDelegates() {
    await mountProbe();
    const offline = getService(OfflinePlugin);
    const kwargs = { context: { foo: 1 } };
    const extras = { timeStamp: 5, actionName: "CRM" };

    const key = hook.scheduleORM("crm.lead", "web_save", [[9], { name: "x" }], kwargs, {
        extras,
    });

    const entries = Object.values(offline._ormToSync());
    expect(entries.length).toBe(1);
    const { value } = entries[0];
    // Every part of the call reaches the queued entry unchanged.
    expect(value.model).toBe("crm.lead");
    expect(value.method).toBe("web_save");
    expect(value.args).toEqual([[9], { name: "x" }]);
    expect(value.kwargs).toEqual(kwargs);
    expect(value.extras).toEqual(extras);
    // The hook returns the plugin's key (hashCode of the value, or options.id).
    expect(key).toBe(entries[0].key);
    // And the entry is observable through the hook's own predicate.
    expect(hook.hasQueuedWrite("crm.lead", 9)).toBe(true);
}

test.tags("desktop");
test("scheduleORM forwards the full call and returns the key (desktop)", testScheduleORMDelegates);

test.tags("mobile");
test("scheduleORM forwards the full call and returns the key (mobile)", testScheduleORMDelegates);

// In a non-secure context the plugin's scheduleORM throws NonSecureContextError
// at call time (offline_plugin.js checks window.isSecureContext in scheduleORM).
// The hook is a verbatim pass-through, so the error must surface unchanged.
// Hoot CAN patch window.isSecureContext via patchWithCleanup(window, ...), which
// the plugin reads live, so this is tested directly rather than documented-only.
async function testScheduleORMNonSecureContext() {
    await mountProbe();
    patchWithCleanup(window, { isSecureContext: false });
    expect(() =>
        hook.scheduleORM("crm.lead", "web_save", [[9]], {}, { extras: { timeStamp: 1 } })
    ).toThrow(NonSecureContextError);
}

test.tags("desktop");
test("scheduleORM surfaces NonSecureContextError in an insecure context (desktop)", testScheduleORMNonSecureContext);

test.tags("mobile");
test("scheduleORM surfaces NonSecureContextError in an insecure context (mobile)", testScheduleORMNonSecureContext);
