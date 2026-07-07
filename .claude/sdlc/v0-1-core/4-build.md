# Build: better-inbox v0.1 — core

**Started**: 2026-07-07
**Plan**: .claude/sdlc/v0-1-core/3-plan.md
**Status**: In Progress
**Drift check**: base dbe2201 → HEAD 32fef66; only plan artifact changed, no source in scope. Clean.

## TDD Progress

| # | Chunk | Unit | Red | Green | Regression | Notes |
|---|-------|------|-----|-------|------------|-------|
| — | 1 | scaffold (no behavior — verify install/typecheck/build) | — | — | | |
| 1 | 2 | notify({userId}) creates; list returns it (tracer) | | | | |
| 2 | 2 | list excludes other users' rows | | | | |
| 3 | 2 | unread filter + offset pagination + hasMore | | | | |
| 4 | 2 | markRead own-only; foreign id → NOTIFICATION_NOT_FOUND | | | | |
| 5 | 2 | markAllRead marks only caller's unread | | | | |
| 6 | 2 | unreadCount counts caller's unread | | | | |
| 7 | 2 | endpoints 401 without session | | | | |
| 8 | 3 | org fan-out row per member, stamped orgId (tracer) | | | | |
| 9 | 3 | roles filter (comma-separated role strings) | | | | |
| 10 | 3 | no members / XOR violations → clean errors | | | | |
| 11 | 3 | maxFanout cap exceeded → error, zero rows | | | | |
| 12 | 3 | list organizationId filter | | | | |
| 13 | 4 | client inbox.list full-stack (tracer) | | | | |
| 14 | 4 | client markRead round-trip drops unreadCount | | | | |
| 15 | 5 | useInbox loads on mount | | | | |
| 16 | 5 | useInbox polls + focus refetch | | | | |
| 17 | 5 | optimistic markRead | | | | |
| 18 | 5 | InboxButton badge/panel/mark-all-read | | | | |
