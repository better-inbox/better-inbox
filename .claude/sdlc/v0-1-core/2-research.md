# Research: better-inbox v0.1

Greenfield project — the "codebase" researched is better-auth itself (the host framework whose patterns we must follow), read from source at **v1.6.23, commit 6f3ba45** (shallow clone; re-clone with `git clone --depth 1 https://github.com/better-auth/better-auth` to verify citations). Market/contrarian research was performed conversationally on 2026-07-07 before this phase; conclusions are summarized here.

## Summary

Every open question from the idea phase resolved in our favor by reading better-auth source. Plugin schema supports a first-class `json` field type, so the `data` payload needs no stringification. `createAuthEndpoint.serverOnly` exists precisely for our `notify` case — callable via `auth.api.*`, never registered on the HTTP router. Cross-plugin table access is a first-party pattern: the organization plugin itself queries `model: "member"` through the generic adapter, which is exactly how our org fan-out will. The adapter's `findMany` supports `where` operators (`eq/ne/lt/lte/gt/gte/in/not_in/contains/starts_with/ends_with`), `limit`, `offset`, `sortBy`, and a separate `count()` — cursor pagination and unread counts need no raw SQL. `@better-auth/memory-adapter` is a published package, giving us a zero-infra test harness.

The pattern baseline is the **device-authorization plugin** — the best-sized exemplar of a plugin with its own table: `schema.ts` (60 lines), `index.ts` (150, options-zod + plugin factory), `routes.ts` (endpoints), `client.ts` (18 lines), `error-codes.ts`, one test file. The organization plugin supplies two specific idioms we need: member queries and `ctx.body.organizationId || session.session.activeOrganizationId`.

## Key Facts (all verified by direct reads)

| Fact | Evidence (path in better-auth repo @ 6f3ba45) |
|------|-----------|
| `json` is a valid `DBFieldType` | `packages/core/src/db/type.ts:164-171` |
| `createAuthEndpoint.serverOnly(options, handler)` — off HTTP router, on `auth.api` | `packages/core/src/api/index.ts:135-179` |
| Plugin schema shape: `{ modelName: { fields: { name: { type, required } } } } satisfies BetterAuthPluginDBSchema` | `packages/better-auth/src/plugins/device-authorization/schema.ts:4-45` |
| Plugin factory: `{ id, schema: mergeSchema(schema, options?.schema), endpoints, $ERROR_CODES, options } satisfies BetterAuthPlugin` | `packages/better-auth/src/plugins/device-authorization/index.ts:129-148` |
| Endpoint idiom: `createAuthEndpoint(path, { method, body: zodSchema, use: [sessionMiddleware] }, handler)`; errors via `APIError.from("FORBIDDEN", CODE)` | `packages/better-auth/src/plugins/multi-session/index.ts:7` (import), `organization/routes/crud-members.ts:655-680` |
| `sessionMiddleware`, `APIError`, `createAuthEndpoint` are public: `better-auth/api` export exists | `packages/better-auth/package.json` exports map |
| Cross-plugin member query: `ctx.context.adapter.findMany<Member>({ model: "member", where: [{ field: "organizationId", value }] })` | `organization/routes/crud-members.ts:662-670` |
| Member roles are comma-separated strings; role checks use `member.role.split(",")` | `organization/routes/crud-members.ts:671-674` |
| Active-org idiom: `ctx.body.organizationId \|\| session.session.activeOrganizationId` | `organization/routes/crud-members.ts:87,315,548` |
| `findMany` supports `where[], limit, offset, sortBy {field, direction}`; `count({model, where})` exists; where operators list | `packages/core/src/db/adapter/index.ts:308-320, 415-435` |
| Minimal client plugin: `{ id, $InferServerPlugin: {} as ReturnType<typeof plugin>, pathMethods }` | `plugins/device-authorization/client.ts` (18 lines) |
| Test adapter published as `@better-auth/memory-adapter` | `packages/memory-adapter/package.json` |
| better-auth current version 1.6.23 | `packages/better-auth/package.json` |

## Library/API Surface
- **Dependencies**: `better-auth` ^1.6 (peer), `zod` (peer or dep — better-auth already requires it), `react` >=18 (optional peer for `/react`), `@better-auth/memory-adapter` + `vitest` + `@testing-library/react` + `happy-dom` (dev). Build: `tsup`. Package manager: bun.
- **Gotchas**:
  - `getTestInstance` used by better-auth's own plugin tests is **internal** (`src/test-utils/`), not published — we build a ~30-line local harness instead.
  - Client plugins can ship nanostores atoms + `useAuthQuery`, but `useAuthQuery` is internal. Third-party precedent (device-authorization/client.ts) ships only `$InferServerPlugin` + `pathMethods` — polling/state belongs in our own React hook.
  - Adapter `Where` has per-condition `connector: "AND"|"OR"`, but mixed AND/OR semantics across adapters is risky — avoid OR queries in v0.1.
  - Plugin schema cannot declare DB indexes — document recommended manual index in README.

## Market / Contrarian (from 2026-07-07 conversation, condensed)
- Category demand proven by Novu (`<Inbox />` is their flagship) but incumbents are platforms; nothing exists in library/plugin shape. betternotify (277★) is a stateless *send pipeline* — different layer, no DB, no inbox; not a competitor for this scope.
- Contrarian: direct demand evidence is soft (no notification requests in better-auth repo; betternotify has stars but few engaged users). Hence the pre-committed validation gate in 1-idea.md: two-week window post-launch, genuine usage signals or park. Build cost is capped at one weekend by scope discipline.
- Naming: `better-inbox` npm (owned, 0.0.1 stub), better-inbox.dev (owned), GitHub org was free as of 2026-07-07 morning — register before launch. README must state "community plugin, not affiliated with better-auth."

## Risks & Concerns
- **better-auth plugin API churn**: pin peer range `^1.6`; the `BetterAuthPluginRegistry` module augmentation (device-authorization/index.ts:18-24) is optional sugar — verify it works from an external package or skip it.
- **Org fan-out write amplification**: capped at 1000 members with a clean error.
- **React 19/Next 15 compat**: components are plain client components, no server-component tricks in v0.1.

## Recommendations for Plan
- Pattern baseline: device-authorization plugin (structure), organization plugin (member/org idioms only).
- Test via local harness: `betterAuth({ database: memoryAdapter({}), emailAndPassword: { enabled: true }, plugins: [inbox(), organization()] })`, create users/sessions through `auth.api.signUpEmail`, pass session token as headers.
- Keep client plugin minimal (`$InferServerPlugin` + `pathMethods`); all polling/state in `useInbox` (plain React, no nanostores).
- List endpoint default returns ALL of the user's rows (personal + every org); optional exact `organizationId` filter. No implicit OR-merge of personal+active-org (adapter OR risk).
