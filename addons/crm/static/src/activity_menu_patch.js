import { Domain } from "@web/core/domain";
import { ActivityMenu } from "@mail/core/web/activity_menu";
import { Activity } from "@mail/core/web/activity";
import { patch } from "@web/core/utils/patch";
import { registry } from "@web/core/registry";
import { useCrmOffline } from "@crm/mobile/crm_offline_hooks";
import { _t } from "@web/core/l10n/translation";
import { user } from "@web/core/user";
import { Component, proxy, t, useProps, xml } from "@odoo/owl";

const { DateTime } = luxon;

patch(ActivityMenu.prototype, {
    setup() {
        super.setup();
        this.crmOffline = useCrmOffline();
    },

    availableViews(group) {
        if (group.model === "crm.lead") {
            return [
                [false, "list"],
                [false, "kanban"],
                [false, "form"],
                [false, "calendar"],
                [false, "pivot"],
                [false, "graph"],
                [false, "activity"],
            ];
        }
        return super.availableViews(...arguments);
    },

    openActivityGroup(group, filter = "all", newWindow) {
        // fetch the data from the button otherwise fetch the ones from the parent (.o_ActivityMenuView_activityGroup).
        const context = {};
        if (group.model === "crm.lead") {
            // Offline, the my-activities action load/navigation has no fallback.
            // The crm.lead entry is a <div>/<span> (not a <button>), so the
            // framework's offline pass does not disable it; this JS guard makes
            // it unreachable offline by click, middle-click and new-window. It
            // returns BEFORE dropdown.close() so nothing navigates and nothing
            // is thrown. Other models fall through to super unchanged.
            if (this.crmOffline.isOffline()) {
                return;
            }
            this.dropdown.close();
            if (filter === "my" || filter === "all") {
                context["search_default_activities_overdue"] = 1;
                context["search_default_activities_today"] = 1;
            } else if (filter === "overdue") {
                context["search_default_activities_overdue"] = 1;
            } else if (filter === "today") {
                context["search_default_activities_today"] = 1;
            } else {
                context["search_default_activities_upcoming_all"] = 1;
            }
            // Necessary because activity_ids of mail.activity.mixin has auto_join
            // So, duplicates are faking the count and "Load more" doesn't show up
            context["force_search_count"] = 1;
            this.action.loadAction("crm.crm_lead_action_my_activities").then((action) => {
                // to show lost leads in the activity
                action.domain = Domain.and([
                    action.domain || [],
                    [["active", "in", [true, false]]],
                ]).toList();
                this.action.doAction(action, {
                    newWindow,
                    additionalContext: context,
                    clearBreadcrumbs: true,
                });
            });
        } else {
            return super.openActivityGroup(...arguments);
        }
    },
});


// ###########################################################################
// 3b — OFFLINE ACTIVITY SCHEDULING (mobile only). On a small screen, offline,
// CrmChatter.scheduleActivity() (crm_form.js) opens this inline-template bottom
// sheet instead of the server-only mail.activity.schedule wizard, and queues ONE
// verbatim-replayable activity_schedule call on the lead. Online / desktop are
// unchanged (CrmChatter.scheduleActivity falls through to super). The sheet
// component is defined here and imported by crm_form.js; its styling is in
// crm_form.scss, loaded by the same web.assets_backend glob. No new file.
// ###########################################################################

export class CrmActivityScheduleSheet extends Component {
    static template = xml`
        <div class="o_crm_offline_schedule_sheet p-3">
            <h6 class="fw-bolder mb-3">Schedule Activity</h6>
            <div class="mb-2">
                <label class="o_form_label">Activity Type</label>
                <select class="o_input form-select o_crm_offline_schedule_type"
                        t-model.proxy.number="this.state.activityTypeId">
                    <option t-foreach="this.props.activityTypes" t-as="type" t-key="type.id"
                            t-att-value="type.id" t-esc="type.display_name"/>
                </select>
            </div>
            <div class="mb-2">
                <label class="o_form_label">Summary</label>
                <input type="text" class="o_input form-control o_crm_offline_schedule_summary"
                       t-model.proxy="this.state.summary"/>
            </div>
            <div class="mb-2">
                <label class="o_form_label">Due Date</label>
                <input type="date" class="o_input form-control o_crm_offline_schedule_deadline"
                       t-model.proxy="this.state.deadline"/>
            </div>
            <div class="d-flex justify-content-end gap-2 mt-3">
                <button class="btn btn-secondary o_crm_offline_schedule_discard"
                        t-on-click="() => this.props.close()">Discard</button>
                <button class="btn btn-primary o_crm_offline_schedule_confirm"
                        data-available-offline="1" t-on-click="() => this.onConfirm()">
                    Schedule
                </button>
            </div>
        </div>`;

    setup() {
        this.props = useProps({
            activityTypes: t.array(),
            leadId: t.number(),
            close: t.function([]),
            schedule: t.function([t.object()]),
        });
        // Defaults: first cached type, empty summary, deadline = LOCAL today
        // (DateTime.local(), not the UTC date), assignee = current user.
        const today = DateTime.local().toISODate();
        this.state = proxy({
            activityTypeId: this.props.activityTypes[0] ? this.props.activityTypes[0].id : false,
            summary: "",
            deadline: today,
        });
    }

    onConfirm() {
        this.props.schedule({
            activity_type_id: this.state.activityTypeId,
            summary: this.state.summary,
            date_deadline: this.state.deadline,
            user_id: user.userId,
        });
        this.props.close();
    }
}

// ###########################################################################
// 3b — OFFLINE MARK-DONE (mobile only), bypassing the mark-done popover. mail's
// Done button opens the ActivityMarkAsDone popover whose confirm calls
// markAsDone() + fetchNewMessages() (two server round-trips). We patch the
// COMPONENT method onClickMarkAsDone so that, offline on a small screen for an
// activity with a real server id, it queues action_feedback DIRECTLY (no popover,
// no fetchNewMessages) and never opens the popover. Online / desktop fall through
// to super. An activity with no server id (temp negative id, offline-created) is
// never a mark-done target.
// ###########################################################################
patch(Activity.prototype, {
    setup() {
        super.setup();
        // Plugin API (not the legacy this.env.services.offline bridge).
        this.crmOffline = useCrmOffline();
    },

    onClickMarkAsDone(ev) {
        const activity = this.activity();
        const id = activity && activity.id;
        if (
            activity &&
            activity.res_model === "crm.lead" &&
            this.crmOffline.isSmall() &&
            this.crmOffline.isOffline() &&
            typeof id === "number" &&
            id > 0
        ) {
            // Scoped to crm.lead activities only. `Activity.prototype` is a global
            // mail component, so this patch runs for every model's activity; the
            // offline branch must act ONLY for a crm.lead activity (the Done button
            // is re-enabled offline exclusively inside CrmChatter — crm_form.js —
            // but a direct/programmatic call on another model must still go to
            // super). Any non-crm.lead activity falls through to super unchanged.
            // Double mark-done guard: if an action_feedback is ALREADY queued for
            // this activity, queue NOTHING (a duplicate would fail on replay). The
            // Done button also loses data-available-offline while queued (see
            // CrmChatter._syncActivityOfflineAttr); this guards a direct call.
            if (this.crmOffline.hasQueuedWrite("mail.activity", id)) {
                return;
            }
            // Queue the state-change-only call verbatim; the optimistic "done,
            // pending sync" marker is derived from this queue entry by CrmChatter.
            // extras carry a systray-visible name + action label.
            this.crmOffline.scheduleORM(
                "mail.activity",
                "action_feedback",
                [[id]],
                {},
                {
                    extras: {
                        actionName: _t("CRM"),
                        displayName: this._crmMarkDoneDisplayName(activity),
                        timeStamp: Date.now(),
                    },
                }
            );
            return;
        }
        return super.onClickMarkAsDone(ev);
    },

    /** Systray-visible name for a queued mark-done. */
    _crmMarkDoneDisplayName(activity) {
        const label =
            (activity && (activity.summary || activity.display_name)) ||
            (activity && activity.activity_type_id && activity.activity_type_id.name) ||
            _t("Activity");
        return _t("Mark done: %s", label);
    },
});

// ###########################################################################
// 3b/3a — teach the framework offline systray to classify the queued CRM calls.
//
// The web offline systray (addons/web/.../offline_systray/offline_systray.js)
// builds each queued entry's `status` ONLY for the five record-write methods it
// knows (web_save / web_unlink|unlink / action_archive / action_unarchive;
// STATUS map at offline_systray.js:14). Its template renders
// `element.status.color` and `element.status.label` unconditionally for EVERY
// entry (offline_systray.xml:51-53), with no guard. A queued call with any other
// method therefore leaves `status` undefined and crashes the systray render with
// `Cannot read properties of undefined (reading 'color')` the moment the entry
// is painted (on reconnect / park / dropdown open).
//
// CRM queues three such calls that the systray cannot classify:
//   - crm.lead / activity_schedule   (spec 06, 3b schedule)
//   - mail.activity / action_feedback (spec 06, 3b mark-done)
//   - crm.lead / action_set_won       (spec 04 mark-won) — same latent defect,
//     found by spec 06: a queued mark-won renders the broken status too.
//
// We cannot patch the component's prototype: `groupEntries` is a per-instance
// class field (a `computed(...)`, offline_systray.js:29) and the class is not
// exported. So we reach the Component through its systray registry entry and
// patch setup() to wrap the per-instance `groupEntries`, filling a `status` for
// ONLY these three (model, method) pairs — every other method is left untouched,
// so no other addon's systray behaviour changes. The systray stays the single
// queued-change / error surface; CRM adds no dialog, banner, toast or store.
// Labels are translated; colors reuse the systray's own palette values.
const CRM_SYSTRAY_STATUS = {
    "crm.lead/activity_schedule": { label: _t("Scheduled"), color: 10 },
    "mail.activity/action_feedback": { label: _t("Done"), color: 4 },
    "crm.lead/action_set_won": { label: _t("Marked won"), color: 10 },
};

const offlineSystrayEntry = registry.category("systray").get("offline");
patch(offlineSystrayEntry.Component.prototype, {
    setup() {
        super.setup();
        const originalGroupEntries = this.groupEntries;
        this.groupEntries = () => {
            const sections = originalGroupEntries();
            for (const [, items] of sections) {
                for (const item of items) {
                    if (item.status) {
                        continue; // already classified by the framework
                    }
                    const queued = this.offlinePlugin._ormToSync()[item.id];
                    const value = queued && queued.value;
                    if (!value) {
                        continue;
                    }
                    const crmStatus = CRM_SYSTRAY_STATUS[value.model + "/" + value.method];
                    if (crmStatus) {
                        item.status = crmStatus;
                    }
                }
            }
            return sections;
        };
    },
});
