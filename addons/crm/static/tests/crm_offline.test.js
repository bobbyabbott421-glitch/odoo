import { Component, xml } from "@odoo/owl";
import { expect, test } from "@odoo/hoot";
import { defineMailModels } from "@mail/../tests/mail_test_helpers";
import {
    getService,
    mockOffline,
    mountWithCleanup,
} from "@web/../tests/web_test_helpers";
import { OfflinePlugin } from "@web/core/offline/offline_plugin";
import { UIPlugin } from "@web/core/ui/ui_plugin";
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

// ---------------------------------------------------------------------------
// isOffline — false online, true after going offline (Requirement 2.1)
// ---------------------------------------------------------------------------

async function testIsOffline() {
    const setOffline = mockOffline();
    await mountProbe();
    expect(hook.isOffline()).toBe(false);
    await setOffline(true);
    expect(hook.isOffline()).toBe(true);
    await setOffline(false);
    expect(hook.isOffline()).toBe(false);
}

test.tags("desktop");
test("isOffline mirrors the plugin signal (desktop)", testIsOffline);

test.tags("mobile");
test("isOffline mirrors the plugin signal (mobile)", testIsOffline);

// ---------------------------------------------------------------------------
// isSmall — pinned to the preset (Requirement 2.2). Comparing against
// getService(UIPlugin).isSmall() would be circular, so the expected value is
// pinned: false on desktop, true on mobile.
// ---------------------------------------------------------------------------

test.tags("desktop");
test("isSmall is false under the desktop preset", async () => {
    await mountProbe();
    expect(hook.isSmall()).toBe(false);
});

test.tags("mobile");
test("isSmall is true under the mobile preset", async () => {
    await mountProbe();
    expect(hook.isSmall()).toBe(true);
});

// ---------------------------------------------------------------------------
// isAvailableOffline — real delegation to the plugin (Requirement 1.1, 3.1).
// The plugin answers from its in-memory `_visited` map, which it populates from
// its own cache only when going offline. So the sequence is: seed the cache
// while online with setAvailableOffline, go offline, await getVisitedStatus()
// (the promise that resolves once `_visited` is populated), then read.
// ---------------------------------------------------------------------------

async function testIsAvailableOffline() {
    const setOffline = mockOffline();
    await mountProbe();
    const offline = getService(OfflinePlugin);
    const actionId = 42;
    const resId = 7;

    // Seed the cache while online (setAvailableOffline only persists when not offline).
    await offline.setAvailableOffline(actionId, "form", { resId });

    // Go offline; the plugin loads the visited items from its own cache into `_visited`.
    await setOffline(true);
    await offline.getVisitedStatus();

    // Seeded action/view/record resolves true via the hook's delegation.
    expect(hook.isAvailableOffline(actionId, "form", resId)).toBe(true);
    // Unseeded record of a seeded action/view: the cached form id list does not
    // include it, so the plugin returns false.
    expect(hook.isAvailableOffline(actionId, "form", 999)).toBe(false);
    // Unseeded action entirely: the hook returns exactly what the plugin returns
    // for an unknown action/form, proving faithful delegation. For an unknown
    // action the plugin's form branch yields `undefined` (falsy), which the hook
    // passes through verbatim.
    expect(hook.isAvailableOffline(999, "form", resId)).toBe(
        offline.isAvailableOffline(999, "form", resId)
    );
    expect(hook.isAvailableOffline(999, "form", resId)).toBe(undefined);
}

test.tags("desktop");
test("isAvailableOffline delegates to the plugin (desktop)", testIsAvailableOffline);

test.tags("mobile");
test("isAvailableOffline delegates to the plugin (mobile)", testIsAvailableOffline);

// ---------------------------------------------------------------------------
// hasQueuedWrite — empty queue (Requirement 4.1, 4.2)
// ---------------------------------------------------------------------------

async function testHasQueuedWriteEmpty() {
    await mountProbe();
    expect(hook.hasQueuedWrite()).toBe(false);
    expect(hook.hasQueuedWrite("crm.lead", 7)).toBe(false);
}

test.tags("desktop");
test("hasQueuedWrite is false on an empty queue (desktop)", testHasQueuedWriteEmpty);

test.tags("mobile");
test("hasQueuedWrite is false on an empty queue (mobile)", testHasQueuedWriteEmpty);

// ---------------------------------------------------------------------------
// hasQueuedWrite — matching keyed entry (Requirement 4.1)
// ---------------------------------------------------------------------------

async function testHasQueuedWriteMatch() {
    await mountProbe();
    getService(OfflinePlugin).scheduleORM(
        "crm.lead",
        "web_save",
        [[7]],
        {},
        { extras: { timeStamp: 1 } }
    );
    expect(hook.hasQueuedWrite("crm.lead", 7)).toBe(true);
}

test.tags("desktop");
test("hasQueuedWrite matches a keyed entry (desktop)", testHasQueuedWriteMatch);

test.tags("mobile");
test("hasQueuedWrite matches a keyed entry (mobile)", testHasQueuedWriteMatch);

// ---------------------------------------------------------------------------
// hasQueuedWrite — non-matching keyed entry (Requirement 4.1)
// ---------------------------------------------------------------------------

async function testHasQueuedWriteNonMatch() {
    await mountProbe();
    getService(OfflinePlugin).scheduleORM(
        "crm.lead",
        "web_save",
        [[7]],
        {},
        { extras: { timeStamp: 1 } }
    );
    // Wrong model.
    expect(hook.hasQueuedWrite("crm.stage", 7)).toBe(false);
    // Wrong id.
    expect(hook.hasQueuedWrite("crm.lead", 8)).toBe(false);
}

test.tags("desktop");
test("hasQueuedWrite rejects a non-matching entry (desktop)", testHasQueuedWriteNonMatch);

test.tags("mobile");
test("hasQueuedWrite rejects a non-matching entry (mobile)", testHasQueuedWriteNonMatch);

// ---------------------------------------------------------------------------
// hasQueuedWrite — no-arg any-write form (Requirement 4.2)
// ---------------------------------------------------------------------------

async function testHasQueuedWriteAnyWrite() {
    await mountProbe();
    expect(hook.hasQueuedWrite()).toBe(false);
    getService(OfflinePlugin).scheduleORM(
        "crm.lead",
        "web_save",
        [[7]],
        {},
        { extras: { timeStamp: 1 } }
    );
    expect(hook.hasQueuedWrite()).toBe(true);
}

test.tags("desktop");
test("hasQueuedWrite no-arg reports any queued entry (desktop)", testHasQueuedWriteAnyWrite);

test.tags("mobile");
test("hasQueuedWrite no-arg reports any queued entry (mobile)", testHasQueuedWriteAnyWrite);

// ---------------------------------------------------------------------------
// hasQueuedWrite — parked entry carrying extras.error (Requirement 4.3)
// ---------------------------------------------------------------------------

async function testHasQueuedWriteParked() {
    await mountProbe();
    getService(OfflinePlugin).scheduleORM(
        "crm.lead",
        "web_save",
        [[7]],
        {},
        { extras: { timeStamp: 1, error: "boom" } }
    );
    expect(hook.hasQueuedWrite("crm.lead", 7)).toBe(true);
    expect(hook.hasQueuedWrite()).toBe(true);
}

test.tags("desktop");
test("hasQueuedWrite counts a parked entry (desktop)", testHasQueuedWriteParked);

test.tags("mobile");
test("hasQueuedWrite counts a parked entry (mobile)", testHasQueuedWriteParked);

// ---------------------------------------------------------------------------
// scheduleORM — transparent pass-through to the plugin (Requirement 5.1)
// ---------------------------------------------------------------------------

async function testScheduleORMDelegates() {
    await mountProbe();
    hook.scheduleORM("crm.lead", "web_save", [[9]], {}, { extras: { timeStamp: 1 } });
    // The entry lands in the single framework signal the systray reads.
    const entries = Object.values(getService(OfflinePlugin)._ormToSync());
    expect(entries.length).toBe(1);
    expect(entries[0].value.model).toBe("crm.lead");
    expect(entries[0].value.args[0]).toEqual([9]);
    // And is observable through the hook's own predicate.
    expect(hook.hasQueuedWrite("crm.lead", 9)).toBe(true);
}

test.tags("desktop");
test("scheduleORM delegates to the plugin (desktop)", testScheduleORMDelegates);

test.tags("mobile");
test("scheduleORM delegates to the plugin (mobile)", testScheduleORMDelegates);
