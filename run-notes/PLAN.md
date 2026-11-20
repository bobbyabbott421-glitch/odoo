# Plan

1. Record baseline suites, test IDs, online metrics and demo records. Establish browser-offline and stopped-server tests.
2. Restore the rep's pipeline, team, visited leads, history and activities. Isolate cached reads by identity and access context. Show freshness and explain unavailable data.
3. Implement supported CRM writes and ordered, idempotent replay. Preserve failed changes and pending work across upgrades. Document each feature decision and its effects in dependent modules.
4. Finish phone installation, direct pipeline launch, touch, screen-reader, dark-mode, RTL and translation checks. Verify desktop online behavior.
5. Repeat and compare baseline suites by ID, measure performance, upgrade crm_base and verify records. Publish the final report on the open, unmerged PR into 20.0.

Re-read SPEC.md at each phase start. Review each phase with a subagent, fix findings, rerun affected tests and commit logical changes on codex/crm-offline. Keep all scratch material in /workspace/run-notes.
