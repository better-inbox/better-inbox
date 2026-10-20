# @byo-oss/notifications

In-app notifications as a better-auth plugin (formerly `better-inbox`). `llms.txt` is the full usage reference; read it before wiring this into an app.

## Installing it in an app

The same steps, with checks, ship as a skill: `skills/byo-notifications/SKILL.md` (`npx skills add byo-oss/notifications`). Keep the two in step when setup changes.

1. `npm install @byo-oss/notifications`
2. Server: add `inbox()` to `betterAuth({ plugins })`, then run the app's migration (`npx @better-auth/cli migrate`, or regenerate drizzle/prisma).
3. Client: add `inboxClient()` from `@byo-oss/notifications/client` to `createAuthClient({ plugins })`.
4. UI: render `<InboxButton client={authClient} onNavigate={...} />` from `@byo-oss/notifications/react` once, in the app shell. Pass the router's navigate to `onNavigate`.
5. Tailwind v4: add `@source "<path>/node_modules/@byo-oss/notifications/dist";` to the CSS, or the components render unstyled.
6. Send with `auth.api.notify({ body })` from server code only. It is never an HTTP route.
7. With email routes: add `@wraps.dev/email`, configure `channels` and `routes`, and call `auth.api.processDeliveries({})` from a cron every minute. Without the cron, delayed emails and retries never go out.

## Rules

- Address people by better-auth `userId`, organizations by `organizationId`. Don't keep a separate recipient table.
- Don't query or write the plugin's tables from app code. Go through `auth.api.*`, the hooks and the exported functions (`deleteOrganizationData`, `deleteMemberData`, `exportNotificationsData`).
- A custom channel is `{ deliver(ctx) }`: throw to retry, throw `PermanentDeliveryError` for sends that can never succeed, never mutate `ctx`. Test it with `testChannel` from `@byo-oss/notifications/testing`.

## Working on this repo

- `bun install`, then `bun run typecheck`, `bun run test` and `bun run build`.
- Tests run against a real better-auth instance on the memory adapter (`src/test-utils.ts`).
- Releases: bump `package.json`, merge, tag `v<version>`. The release workflow publishes through npm trusted publishing.
- Follow the BYO conventions: https://github.com/byo-oss/conventions/blob/main/SPEC.md
