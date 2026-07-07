# Build: better-inbox v0.1 — core

**Started**: 2026-07-07
**Plan**: .claude/sdlc/v0-1-core/3-plan.md
**Status**: Chunks 1–5 complete (18/18 units green); chunk 6 in progress (demo app via subagent; publish gated on user OTP)
**Drift check**: base dbe2201 → HEAD 32fef66 at build start; only plan artifact changed. Clean.

## TDD Progress

| # | Chunk | Unit | Red | Green | Regression | Notes |
|---|-------|------|-----|-------|------------|-------|
| — | 1 | scaffold (verify install/typecheck/build) | — | — | ✅ | TS pinned to ^5.9 (TS6 `baseUrl` deprecation breaks tsup dts worker) |
| 1 | 2 | notify({userId}) creates; list returns it (tracer) | 🔴 | 🟢 | ✅ | memory adapter needs pre-seeded tables via getAuthTables (their own harness does the same) |
| 2 | 2 | list excludes other users' rows | ⚪ | 🟢 | ✅ | passed immediately — userId scoping inherent to unit 1's where-clause; investigated, correct |
| 4 | 2 | markRead own-only; foreign id → NOTIFICATION_NOT_FOUND | 🔴 | 🟢 | ⚠️ fixed | ran before unit 3 (unread filter needs a read row to exist); `Where[]` typing fix at gate |
| 3 | 2 | unread filter + offset pagination + hasMore | 🔴 | 🟢 | ✅ | red on filter; pagination was inherent to unit 1 impl |
| 5 | 2 | markAllRead marks only caller's unread | 🔴 | 🟢 | ✅ | adapter.updateMany exists as planned |
| 6 | 2 | unreadCount counts caller's unread | 🔴 | 🟢 | ✅ | adapter.count |
| 7 | 2 | endpoints 401 without session | ⚪ | 🟢 | ✅ | behavior by sessionMiddleware design; test pins the spec |
| 8 | 3 | org fan-out row per member, stamped orgId (tracer) | 🔴 | 🟢 | ✅ | createOrganization/addMember worked server-side first try |
| 9 | 3 | roles filter (comma-separated roles) | ⚪ | 🟢 | ✅ | inherent to fan-out branch written for unit 8 |
| 10 | 3 | no members / XOR violations → clean errors | ⚪ | 🟢 | ✅ | inherent (zod refine + branch guards) |
| 11 | 3 | maxFanout cap → error, zero rows written | ⚪ | 🟢 | ✅ | cap testable via inbox({maxFanout:2}) |
| 12 | 3 | list organizationId filter | 🔴 | 🟢 | ✅ | |
| 13 | 4 | client inbox.list full-stack (tracer) | 🔴 | 🟢 | ✅ | $InferServerPlugin inference works across package boundary — biggest plan risk retired |
| 14 | 4 | client markRead round-trip drops unreadCount | 🔴 | 🟢 | ✅ | |
| 15 | 5 | useInbox loads on mount | 🔴 | 🟢 | ✅ | |
| 16 | 5 | useInbox polls (count) + focus refetch (full) | 🔴 | 🟢 | ✅ | |
| 17 | 5 | optimistic markRead | 🔴 | 🟢 | ✅ | test caught real bug: read state-updater side-channel flag before flush; fixed via ref |
| 18 | 5 | InboxButton badge/panel/mark-all-read | 🔴 | 🟢 | ✅ | |

## Deviations from Plan
- Unit order 3↔4 swapped (unread-filter test needs markRead to create a read row). Noted per-unit above.
- `$ERROR_CODES` must be built with `defineErrorCodes()` (RawError objects) in better-auth 1.6.23 — plan assumed plain strings. `APIError.from(status, rawError)` consumes them directly.
- Test harness split into `createTestAuth` / `createTestAuthWithOrg` (conditional plugin spread widens the tuple type and kills `auth.api` endpoint inference).
- tsup config split into two configs so the react entry gets a `"use client"` banner and the server entries don't.
- TypeScript pinned to ^5.9 (TS 6.0.3 `baseUrl` deprecation error inside tsup's dts worker).
- Added `@better-auth/core` as devDependency (tests import `getAuthTables` to seed the memory adapter).

## Files Changed
| File | Purpose |
|------|---------|
| `src/schema.ts` | notification table (json data field, read boolean, user cascade) |
| `src/error-codes.ts` | defineErrorCodes registry |
| `src/routes.ts` | notify (serverOnly, single + org fan-out), list, mark-read, mark-all-read, unread-count |
| `src/index.ts` | inbox() plugin factory |
| `src/client.ts` | inboxClient() ($InferServerPlugin + pathMethods) |
| `src/react/use-inbox.ts` | polling hook, optimistic mutations |
| `src/react/inbox-panel.tsx`, `src/react/inbox-button.tsx` | UI, shadcn-token styling, zero-dep popover |
| `src/test-utils.ts` | memory-adapter harness |
| `src/inbox.test.ts`, `src/inbox-org.test.ts`, `src/client.test.ts`, `src/react/*.test.tsx` | 18 tests |
| `README.md`, `llms.txt` | docs written as training data |

## Verification
- `bun run test`: 18/18 passing (real memory adapter server-side; client tests full-stack through auth.handler; react via happy-dom)
- `bun run typecheck`: clean (strict, noUncheckedIndexedAccess)
- `bun run build`: ESM+CJS+dts for all three entries; `npm pack --dry-run`: 13.8 kB, 13 files
- Chunk 6 (demo app) delegated to subagent; publish awaits user OTP
