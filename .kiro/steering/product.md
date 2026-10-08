---
inclusion: always
---
# Product

Odoo is an open-source business application suite. This workspace is a 20.0 fork;
active work is confined to the **crm** addon, which tracks leads and converts them
into opportunities through a pipeline.

## What this effort delivers

A salesperson using CRM on a phone, with an unreliable or absent connection, can:

- Open the pipeline and browse stages they loaded while online.
- Read and edit leads they visited online, and create new leads.
- Log calls, schedule follow-ups, and mark activities done.
- Look up existing contacts.

Every change made offline is captured and sent to the server automatically once the
connection returns, with no explicit sync step and no data entry lost.

## Experience principles

- **Mobile-first, desktop-unchanged.** New behavior appears only on small screens.
  The desktop CRM looks and works exactly as it did before.
- **Optimistic.** An offline edit shows its result immediately and is marked as
  waiting to sync, rather than blocking on the network.
- **Honest about limits.** Features that genuinely need the server (meeting
  scheduling, wizards, reports, lead generation, predictive scoring) are visibly
  unavailable offline rather than failing mid-action. A lead never loaded online
  explains itself instead of showing a blank screen.
- **No surprises on reconnect.** Replay is last-write-wins against the server; a
  change the server rejects is surfaced for manual retry, never silently dropped.

## Audience

Field sales users on phones are the primary audience for the offline/mobile work.
Desktop sales users and sales managers are existing audiences whose experience must
not regress.
