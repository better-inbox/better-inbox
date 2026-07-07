# Plan: better-inbox v0.1 — core

**Base commit**: dbe2201

Greenfield repo at `/Users/jarod/Projects/better-inbox`. Everything is created new; "Pattern From" references point into a shallow clone of better-auth at **v1.6.23 (commit 6f3ba45)**. If the clone is not at `$SCRATCHPAD/better-auth`, re-clone: `git clone --depth 1 https://github.com/better-auth/better-auth <dir>` and verify cited files still match the excerpts inlined below — **if an excerpt no longer matches, STOP and report; do not improvise against a newer better-auth.**

## Pattern Baseline

The template is better-auth's **device-authorization plugin** (right-sized: own table, options schema, endpoints, minimal client) with two idioms borrowed from the **organization plugin** (member queries, active-org fallback).

- `packages/better-auth/src/plugins/device-authorization/schema.ts` — table definition shape
- `packages/better-auth/src/plugins/device-authorization/index.ts:129-148` — plugin factory shape
- `packages/better-auth/src/plugins/device-authorization/client.ts` — minimal client plugin (`$InferServerPlugin` + `pathMethods`)
- `packages/better-auth/src/plugins/organization/routes/crud-members.ts:662-674` — cross-plugin member query + comma-separated role handling
- `packages/better-auth/src/plugins/multi-session/index.ts:7` — `import { APIError, sessionMiddleware } from "../../api"` → for us: `from "better-auth/api"` (public export, verified in their package.json exports map)

Key inlined excerpts (verified 2026-07-07 at commit 6f3ba45):

```ts
// schema shape — device-authorization/schema.ts:4-45
export const schema = {
  deviceCode: {
    fields: {
      deviceCode: { type: "string", required: true },
      userId: { type: "string", required: false },
      expiresAt: { type: "date", required: true },
      // ...
    },
  },
} satisfies BetterAuthPluginDBSchema;

// references idiom — organization/schema.ts:86-97
userId: { type: "string", required: true, references: { model: "user", field: "id" } },
createdAt: { type: "date", required: false },

// plugin factory — device-authorization/index.ts:129-148
export const deviceAuthorization = (options = {}) => {
  const opts = optionsSchema.parse(options);
  return {
    id: "device-authorization",
    schema: mergeSchema(schema, options?.schema),
    endpoints: { deviceCode: deviceCode(opts), /* ... */ },
    $ERROR_CODES: DEVICE_AUTHORIZATION_ERROR_CODES,
    options,
  } satisfies BetterAuthPlugin;
};

// server-only endpoint — core/src/api/index.ts:170-179
// callable via auth.api.*, never on the HTTP router:
createAuthEndpoint.serverOnly({ method: "POST", body: schema }, async (ctx) => { ... })

// cross-plugin member query — organization/routes/crud-members.ts:662-674
const members = await ctx.context.adapter.findMany<Member>({
  model: "member",
  where: [{ field: "organizationId", value: organizationId }],
});
const owners = members.filter((m) => m.role.split(",").includes(creatorRole));

// adapter surface — core/src/db/adapter/index.ts:308-320, 415-435
// where operators: eq ne lt lte gt gte in not_in contains starts_with ends_with
// findMany({ model, where, limit, offset, sortBy: { field, direction } })
// count({ model, where }); also create, update, updateMany on the adapter

// minimal client plugin — device-authorization/client.ts (entire file, 18 lines)
export const deviceAuthorizationClient = () => ({
  id: "device-authorization",
  $InferServerPlugin: {} as ReturnType<typeof deviceAuthorization>,
  pathMethods: { "/device/code": "POST", "/device": "GET" },
}) satisfies BetterAuthClientPlugin;
```

Follow these patterns exactly. Do not invent new patterns.

## Repo Layout (target)

```
package.json  tsconfig.json  tsup.config.ts  vitest.config.ts  README.md
src/
  index.ts        # inbox() plugin factory + type exports
  schema.ts       # notification table
  error-codes.ts  # INBOX_ERROR_CODES
  routes.ts       # listNotifications, markRead, markAllRead, unreadCount, notify
  client.ts       # inboxClient()
  test-utils.ts   # local test harness (memory adapter + signup helper)
  inbox.test.ts   inbox-org.test.ts   client.test.ts
  react/
    index.ts  use-inbox.ts  inbox-button.tsx  inbox-panel.tsx
    use-inbox.test.tsx  inbox-button.test.tsx
demo/             # chunk 6, Next.js app — manual QA only, excluded from package
```

## Data Model

```ts
// src/schema.ts
export const schema = {
  notification: {
    fields: {
      userId:         { type: "string",  required: true, references: { model: "user", field: "id" } }, // onDelete defaults to cascade
      organizationId: { type: "string",  required: false },
      type:           { type: "string",  required: true },   // app-defined discriminator
      title:          { type: "string",  required: true },
      body:           { type: "string",  required: false },
      href:           { type: "string",  required: false },
      data:           { type: "json",    required: false },  // json IS a valid DBFieldType — core/src/db/type.ts:169
      read:           { type: "boolean", required: true, defaultValue: false },
      createdAt:      { type: "date",    required: true },
    },
  },
} satisfies BetterAuthPluginDBSchema;
```

`read` is a boolean, not a nullable `readAt` date — filtering on `value: false` is portable across adapters; `eq null` semantics are not (see Considered & Rejected). `notify` sets `read: false` and `createdAt: new Date()` explicitly on insert (don't rely on `defaultValue` alone).

## API Design

```ts
// server-only (auth.api.notify) — createAuthEndpoint.serverOnly, no HTTP route
notify({ body: {
  userId?: string;            // XOR organizationId (zod .refine)
  organizationId?: string;    // fan-out to members
  roles?: string[];           // with organizationId only: filter members by role
  type: string; title: string; body?: string; href?: string; data?: Record<string, unknown>;
}})
// GET  /inbox/list           query { filter?: "unread"|"all"; limit?: 1-100 =20; offset?: number =0; organizationId?: string }
//                            → { notifications: Notification[]; hasMore: boolean }
// POST /inbox/mark-read      body { id } — where includes userId (ownership), 404 on miss
// POST /inbox/mark-all-read  body { organizationId? }
// GET  /inbox/unread-count   → { count: number }
```

All four HTTP endpoints `use: [sessionMiddleware]` and scope every adapter call by `ctx.context.session.user.id`. Default list = ALL the user's rows (personal + all orgs); `organizationId` is an exact filter. Pagination is offset-based, `limit+…hasMore` derived from fetching `limit + 1` rows.

Org fan-out in `notify`: query `model: "member"` by organizationId (idiom above), optional `roles` filter via `member.role.split(",")`, cap at `options.maxFanout` (default 1000, configurable so tests can set 3) → over cap or zero members or org plugin absent → `APIError` with a named code in `INBOX_ERROR_CODES`. Insert one row per member via `adapter.create` in a loop (memory + real adapters lack bulk insert; fine at ≤1000).

Plugin options: `inbox({ maxFanout?: number, schema?: InferOptionSchema<typeof schema> })` — zod-parsed like the baseline.

## Change List

### Chunk 1: Scaffold

| # | File | Change | Pattern From |
|---|------|--------|-------------|
| 1 | `package.json` | name `better-inbox` v0.1.0, type module, exports `.` `./client` `./react` (each dist ESM+CJS+dts), peerDeps `better-auth: ^1.6.0`, `react: >=18` (optional via peerDependenciesMeta), deps `zod: ^4`, devDeps better-auth, @better-auth/memory-adapter, tsup, typescript, vitest, happy-dom, @testing-library/react, react, react-dom; scripts: build/test/typecheck | betternotify-style exports map; keep single package, no monorepo |
| 2 | `tsconfig.json` | strict, moduleResolution bundler, jsx react-jsx, noEmit | standard |
| 3 | `tsup.config.ts` | entry `src/index.ts, src/client.ts, src/react/index.ts`; format esm+cjs; dts; external react, better-auth, zod | standard tsup |
| 4 | `vitest.config.ts` | environment happy-dom for `src/react/**`, node otherwise (environmentMatchGlobs); globals off | standard vitest |
| 5 | `src/index.ts`, `src/client.ts`, `src/react/index.ts` | placeholder exports so build passes | — |
| 6 | `.gitignore`, `.npmignore` or `files` field | dist only in package; exclude demo, .claude | — |

**Verify**: `bun install && bun run typecheck && bun run build`

### Chunk 2: Server plugin core (single-user)

| # | File | Change | Pattern From |
|---|------|--------|-------------|
| 1 | `src/schema.ts` | notification table as specified above | device-authorization/schema.ts:4-45 + organization/schema.ts:86-97 |
| 2 | `src/error-codes.ts` | `INBOX_ERROR_CODES`: NOTIFICATION_NOT_FOUND, ORGANIZATION_PLUGIN_REQUIRED, ORGANIZATION_HAS_NO_MEMBERS, FAN_OUT_LIMIT_EXCEEDED, USER_OR_ORGANIZATION_REQUIRED | device-authorization/error-codes.ts |
| 3 | `src/routes.ts` | `notify` (serverOnly, single-user path only in this chunk), `listNotifications`, `markRead`, `markAllRead`, `unreadCount` per API design | device-authorization/routes.ts (endpoint shape), core api index.ts:170-179 (serverOnly) |
| 4 | `src/index.ts` | `inbox(options)` factory: id "inbox", zod options schema, `schema: mergeSchema(schema, options?.schema)`, endpoints, `$ERROR_CODES` | device-authorization/index.ts:129-148 |
| 5 | `src/test-utils.ts` | `createTestAuth(opts?)`: betterAuth({ database: memoryAdapter({}), emailAndPassword: { enabled: true }, plugins: [inbox(opts), ...(opts.org ? [organization()] : [])] }); helper `signUpUser(auth, email)` returning `{ user, headers }` via `auth.api.signUpEmail` and session-token headers | their tests use internal getTestInstance — ours is a local ~30-line equivalent. **Escape hatch:** if extracting session headers from signUpEmail response proves fiddly, use `auth.api.signInEmail({ ..., returnHeaders: true })` pattern; if that also fails, STOP and report |
| 6 | `src/inbox.test.ts` | TDD units 1–7 | vitest, real memory adapter, no mocks |

**Verify**: `bun run test && bun run typecheck`

**Escape hatches**: `mergeSchema` import — better-auth's plugins import it from `../../db`; for us try `better-auth/db` then `better-auth/plugins` re-exports; if not publicly exported, inline a trivial merge and note the deviation. If `BetterAuthPluginDBSchema` isn't importable from `@better-auth/core/db` or `better-auth`, type schema as `BetterAuthPlugin["schema"]`. Skip the `BetterAuthPluginRegistry` module augmentation entirely (internal-only sugar).

### Chunk 3: Org fan-out (depends on chunk 2)

| # | File | Change | Pattern From |
|---|------|--------|-------------|
| 1 | `src/routes.ts` | extend `notify`: organizationId branch — member lookup, roles filter, maxFanout cap, per-member insert stamped with organizationId; XOR validation userId/organizationId | organization/routes/crud-members.ts:662-674 |
| 2 | `src/routes.ts` | `listNotifications` + `markAllRead` + `unreadCount`: optional exact `organizationId` filter | organization active-org idiom (crud-members.ts:87) — but explicit param only, no activeOrganizationId fallback (see Considered & Rejected) |
| 3 | `src/inbox-org.test.ts` | TDD units 8–12 (org plugin enabled via test harness) | organization plugin test setup for creating org + members via `auth.api.createOrganization` etc. |

**Verify**: `bun run test && bun run typecheck`

**Escape hatch**: detect org plugin absence by wrapping the member `findMany` in try/catch for unknown-model errors AND/OR checking `ctx.context.options.plugins?.some(p => p.id === "organization")` — check the id string against the actual org plugin source first. If neither works cleanly, STOP and report.

### Chunk 4: Client plugin (depends on chunk 2)

| # | File | Change | Pattern From |
|---|------|--------|-------------|
| 1 | `src/client.ts` | `inboxClient()`: `$InferServerPlugin: {} as ReturnType<typeof inbox>`, `pathMethods: { "/inbox/list": "GET", "/inbox/unread-count": "GET", "/inbox/mark-read": "POST", "/inbox/mark-all-read": "POST" }` | device-authorization/client.ts (entire file) |
| 2 | `src/client.test.ts` | TDD units 13–14: full-stack — `createAuthClient({ baseURL, plugins: [inboxClient()], fetchOptions: { customFetchImpl: (url, init) => auth.handler(new Request(url, init)) } })` | better-auth client test idiom |

**Verify**: `bun run test && bun run typecheck`

**Escape hatch**: expected client surface is `authClient.inbox.list(...)` etc., derived from paths. If methods don't materialize or types are wrong, STOP and report (fallback would be explicit `getActions`, but confirm with maintainer docs before building it).

### Chunk 5: React (depends on chunk 4)

| # | File | Change | Pattern From |
|---|------|--------|-------------|
| 1 | `src/react/use-inbox.ts` | `useInbox(client, { pollInterval=30_000, pageSize=20, organizationId? })` → `{ notifications, unreadCount, isLoading, error, hasMore, loadMore, markRead, markAllRead, refresh }`. Plain React state; interval + `visibilitychange`/`focus` refetch; optimistic markRead/markAllRead | no baseline in better-auth — plain React, keep it boring |
| 2 | `src/react/inbox-panel.tsx` | list UI: All/Unread tabs, items (title/body/relative time/unread dot), click → markRead + `onNavigate?.(href)`, mark-all-read button, load-more, empty state | shadcn CSS-variable tokens (`bg-popover text-popover-foreground border-border text-muted-foreground bg-primary` etc.) — classNames only, no shadcn/radix/tailwind dependency |
| 3 | `src/react/inbox-button.tsx` | bell + unread badge (99+ cap), toggles panel; custom popover: absolute positioning, outside-click + Escape close; zero deps | same token approach |
| 4 | `src/react/index.ts` | export `InboxButton`, `InboxPanel`, `useInbox`, types | — |
| 5 | `src/react/use-inbox.test.tsx` | TDD units 15–17 (mock client object with vi.fn; vi.useFakeTimers for polling) | mock boundary = client plugin surface (HTTP), never internals |
| 6 | `src/react/inbox-button.test.tsx` | TDD unit 18 (@testing-library/react) | — |

**Verify**: `bun run test && bun run typecheck && bun run build`

### Chunk 6: Demo + release prep (depends on all; mostly manual)

| # | File | Change | Notes |
|---|------|--------|-------|
| 1 | `demo/` | Next.js app: better-auth (emailAndPassword + organization) + better-inbox, SQLite, seed script creating 2 users + 1 org; page with `<InboxButton />`; a "simulate billing failure → notify org admins" button | for the launch GIF; NOT published, NOT in workspace build |
| 2 | `README.md` | quickstart (install → plugin → migrate → component), org fan-out example, "community plugin, not affiliated" line, manual index recommendation `(userId, createdAt)`, polling note | written like training data: one obvious path |
| 3 | `llms.txt` | condensed API reference | — |
| 4 | release | `npm publish` 0.1.0 over the 0.0.1 stub (needs Jarod's OTP); tag v0.1.0 | user-gated |

**Verify**: manual — demo flow end-to-end, GIF recorded, `npm pack --dry-run` shows only dist/README/llms.txt/package.json.

## TDD Units

Server tests use the REAL memory adapter — no mocks. React tests mock only the client surface (= HTTP boundary). Never mock internal functions.

| # | Chunk | Test File | Unit (one behavior) | Mock Boundaries |
|---|-------|-----------|--------------------|-----------------| 
| 1 | 2 | `src/inbox.test.ts` | `auth.api.notify({userId})` creates a notification; `listNotifications` returns it for that user's session (tracer) | none |
| 2 | 2 | `src/inbox.test.ts` | list never returns another user's notifications | none |
| 3 | 2 | `src/inbox.test.ts` | list `filter: "unread"` + offset pagination returns correct pages and `hasMore` | none |
| 4 | 2 | `src/inbox.test.ts` | markRead sets `read: true` for own notification; foreign/unknown id → NOTIFICATION_NOT_FOUND, other user's row untouched | none |
| 5 | 2 | `src/inbox.test.ts` | markAllRead marks all of caller's unread, only theirs | none |
| 6 | 2 | `src/inbox.test.ts` | unreadCount counts only caller's unread rows | none |
| 7 | 2 | `src/inbox.test.ts` | list/mark-read/mark-all-read/unread-count reject requests without a session (401) | none |
| 8 | 3 | `src/inbox-org.test.ts` | notify({organizationId}) creates one row per member, each stamped with organizationId (tracer) | none |
| 9 | 3 | `src/inbox-org.test.ts` | roles filter targets only members whose comma-separated role matches | none |
| 10 | 3 | `src/inbox-org.test.ts` | org with no members → ORGANIZATION_HAS_NO_MEMBERS; both/neither of userId+organizationId → USER_OR_ORGANIZATION_REQUIRED | none |
| 11 | 3 | `src/inbox-org.test.ts` | member count > maxFanout (set to 3 in test) → FAN_OUT_LIMIT_EXCEEDED, zero rows written | none |
| 12 | 3 | `src/inbox-org.test.ts` | list `organizationId` filter returns only that org's rows | none |
| 13 | 4 | `src/client.test.ts` | `authClient.inbox.list()` returns typed notifications through the real handler (tracer) | customFetchImpl → auth.handler (real stack) |
| 14 | 4 | `src/client.test.ts` | `authClient.inbox.markRead` round-trip drops `unreadCount` | same |
| 15 | 5 | `src/react/use-inbox.test.tsx` | useInbox loads notifications + unreadCount on mount | mock client object |
| 16 | 5 | `src/react/use-inbox.test.tsx` | useInbox refetches on pollInterval tick and on window focus | mock client + fake timers |
| 17 | 5 | `src/react/use-inbox.test.tsx` | markRead optimistically flips item + decrements unreadCount | mock client |
| 18 | 5 | `src/react/inbox-button.test.tsx` | badge shows count; click opens panel; mark-all-read calls client and zeroes badge | mock client |

## Interface Design Notes
- `useInbox` takes the client as an argument (no context provider in v0.1) — trivially testable with a plain object.
- Endpoints return plain data objects; all authorization is `where`-clause scoping by session user id — testable through public `auth.api` only.
- `maxFanout` is a plugin option so the cap is testable without creating 1001 users.
- Components accept `renderItem?` and `onNavigate?` so apps aren't locked into our markup/router.

## Risks
- **better-auth internal-import drift**: everything we import must come from public exports (`better-auth`, `better-auth/api`, `better-auth/client`, `@better-auth/core/db` if public). Chunk 2's escape hatches cover the two doubtful ones (`mergeSchema`, `BetterAuthPluginDBSchema`).
- **Client method inference across package boundary** ($InferServerPlugin from an external package) — chunk 4's tracer test exists precisely to catch this early; STOP-and-report escape hatch attached.
- **json field support per-adapter** — memory adapter fine; README notes SQLite stores JSON as text (better-auth handles serialization).

## Out of Scope
Everything in 1-idea.md's Out of Scope list, plus: activeOrganizationId-based default filtering, nanostores atoms, context provider, i18n, SSR prefetch helpers.

## Considered & Rejected

| Finding / option | Why rejected | Class |
|-------------------------|--------------|-------|
| `readAt: date \| null` + `eq null` where-clauses | null-equality semantics vary across adapters; `read: boolean` filter on `false` is portable | design |
| createdAt-cursor pagination | org fan-out inserts share a timestamp → cursor ties skip/duplicate rows; adapter natively supports offset | design |
| Implicit list merge of personal + active-org rows (OR query) | adapter `Where` connector OR is under-specified across adapters; explicit `organizationId` param is predictable | design |
| `session.session.activeOrganizationId` fallback in list | couples core endpoints to org plugin's session augmentation; client can pass the param; revisit v0.2 | design |
| nanostores atoms in client plugin (organization pattern) | their `useAuthQuery` is internal; plain React hook is simpler and sufficient; device-authorization precedent ships without atoms | design |
| better-auth's `getTestInstance` | internal to their repo, not published — local 30-line harness instead | availability |
| Radix/shadcn popover dependency | zero-runtime-deps goal; custom outside-click popover is ~20 lines | design |
| `BetterAuthPluginRegistry` module augmentation | internal registry sugar, unverified from external packages; not needed for functionality | risk |
