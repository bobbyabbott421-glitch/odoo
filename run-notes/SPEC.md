# Offline mode for the Odoo CRM: specification

Lines marked **[Technical Tn]** are technical detail rather than business requirements.

## Outcome

Sales reps can keep using the Odoo CRM, on phone and desktop, when their connection is weak or drops, and nothing they do is lost or wrong when it comes back.

## Who uses it and where

Reps often work without a reliable connection: on trains, at client sites and in warehouses, mostly on their phones. Some teams have around 10,000 leads. Some devices are shared by several people.

## Requirements

### Getting in and finding things

- A rep who has used the CRM before can open it with no connection and still reach their pipeline as they last saw it, including the sales team they were looking at.
- Leads they've opened before show the same details, history, notes and activities as online, with a note of how recent the information is. Searching and filtering what's on the device works, or is clearly unavailable.
- Anything that isn't available offline says so plainly. A rep never sees an empty or broken screen, or one that keeps loading.
- It stays responsive on a weak connection and for teams with large pipelines (some have around 10,000 leads).

### Doing the job

- A rep can do their normal day-to-day work offline and end up with the same result as if they had done it online, including the effects a change has elsewhere.
- Each feature works offline, is clearly unavailable, or, if it only decorates the screen, is left out. Nothing half-works or shows an error, and nothing a rep creates offline leaves them stuck later. You decide, feature by feature, what works offline.
- Reps can see, in plain words, what is waiting to be sent.

### When the connection returns

- Everything done offline reaches the server on its own, in the order it was done, with the same result as doing it online. Nothing is lost or applied twice.
- If someone else changed the same lead in the meantime, the rep's change is applied over it when it is sent. Reps aren't asked to choose between versions.
- If a change can't be applied (for example, the lead was deleted, the rep no longer has access, or their login expired), the rep is told clearly, the change isn't thrown away, and the rest carries on.
- If Odoo is updated while changes are waiting, they aren't silently lost.

### Shared devices

- Offline data never shows anyone more than they could see online, including when several people share a device, and one person's work is never recorded under someone else's name.

### On a phone

- Reps can install it on their phone like an app and go straight to their pipeline. It fits the screen and is easy to use by touch.
- Online, everything on desktop looks and works as it does today.
- Anything new works with screen readers, dark mode, right-to-left languages and translations, like the rest of Odoo.

## Constraints

- You decide what needs to change, and where, to make this work well and keep the rest of Odoo working. That can include other apps that build on the CRM, Odoo's shared offline support and the data model, as long as existing databases upgrade cleanly and keep their data.
- Build on the offline support Odoo already has, improving it where needed, rather than creating a separate offline system. **[Technical T1]** It lives mainly under `addons/web/static/src/`: `core/offline/`, `core/network/`, `core/utils/indexed_db.js`, `service_worker.js` and `webclient/offline_systray/`.
- Don't add third-party tools or packages, don't change who can see or do what, and don't build a separate native app.
- **[Technical T11]** Packages that are only needed to run or test the work may be installed into the task's Python environment, with its `pip`. The repository itself must not gain any new dependency, and `requirements.txt` must stay unchanged. List every package you installed, and why, in the report.
- Online behavior and speed stay as they are today. Existing tests keep passing and aren't weakened or removed. Follow the conventions of the existing codebase.
- Test the new behavior thoroughly under realistic conditions, including a real loss of connection rather than a simulated one.

## Decisions already made

- Which features work offline is your call, feature by feature. Record each decision and the reason.
- When someone else changed a lead meanwhile, the rep's change wins, with no dialog.
- Changes outside the CRM, to Odoo's shared offline support and to the data model are allowed when needed. List each one with its reason.
- No performance number is set. Measure what you find and report it.
- No deadline. Prefer complete and correct; list anything left undone.

## Done when

1. Every requirement above works as described, or is clearly unavailable offline with the reason recorded.
2. **[Technical T2]** Before changing code, a baseline is recorded: the commands that run Odoo's Python tests, the JavaScript unit tests on the desktop and mobile presets, and the browser tours for `crm`, `web`, `mail` and every module that depends on `crm`, each with tests collected, run, passed and failed. A run of zero tests counts as a failure.
3. **[Technical T3]** Each area of new behavior has at least one test against a real Odoo server in a real browser with a real loss of connection (browser offline and server stopped), using Odoo's own test tooling, and the new JavaScript tests pass on both the desktop and mobile presets.
4. **[Technical T2]** The baseline suites show no new failures, compared by test ID, and no existing test was removed, skipped or weakened.
5. **[Technical T4]** Online load time and server calls for the pipeline and the lead form are measured before and after the change, and offline pipeline load is measured with about 10,000 leads. The numbers are reported.
6. **[Technical T5]** The database `crm_base`, built from the base commit with demo data, upgrades cleanly with every changed module and keeps its records.
7. **[Technical T6]** All work is on branches created from the base commit, each named `codex/` plus a short name of your choice, and committed in Odoo's commit-message format, one logical change per commit, without rewriting history. The branches are pushed to `origin` and each has a pull request open against `20.0`, unmerged. Use one pull request, or a few if the work splits into parts that can be reviewed on their own. If you open more than one, stack them so the last branch contains all earlier work, and say so in each description. Nothing is pushed to any other branch.
8. The report below is written.

## Report

**[Technical T7]** Keep it as `REPORT.md` in the task's scratch folder `/workspace/run-notes/` (never in the repository), use it as the description of the last pull request (earlier ones link to it), and repeat it in your final message. Cover:

- what works offline, what doesn't, and why;
- every change outside the CRM and every data-model change, with the reason;
- how you tested it, with the commands and the pass and fail counts per suite;
- any problems or limits you found but didn't fix, each with how to reproduce it.