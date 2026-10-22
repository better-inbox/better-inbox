---
name: byo-notifications
description: In-app notifications for better-auth apps with @byo-oss/notifications (formerly better-inbox). Use when adding a notification bell or inbox, sending notifications from server code, emailing notifications that go unread, notifying an organization's members, or writing a custom delivery channel.
---

# @byo-oss/notifications

A better-auth plugin: notifications are rows in the app's own database, addressed by better-auth `userId` (and optionally `organizationId`), shown by a React bell, and emailed only if they go unread.

The API reference is `node_modules/@byo-oss/notifications/llms.txt` once the package is installed. Read it before writing calls; this skill covers wiring and the gotchas.

## Setup

Work through these in order. Each step ends on a check; move on only when it holds.

1. **Install.** `npm install @byo-oss/notifications @better-auth/core` (use the repo's package manager). Requires better-auth 1.7.7+. Install `@better-auth/core` at the same version as `better-auth`. Done when both are in the dependencies of the package that holds the better-auth config, and of the web app if that's a separate package.

2. **Server plugin.** Add `inbox()` from `@byo-oss/notifications` to `betterAuth({ plugins })`. If the app uses the organization plugin, list it too; org fan-out and org cleanup come from it. Done when the app typechecks.

3. **Migration.** Generate tables the way the repo already does: `npx @better-auth/cli migrate` for better-auth's own migrator, or `npx @better-auth/cli generate` and then the repo's drizzle or prisma flow. It adds `notification`, `notificationDelivery` and `inboxPresence`, with nothing on better-auth's own tables. Done when the migration is written and applied to the dev database.

4. **Client plugin.** Add `inboxClient()` from `@byo-oss/notifications/client` to `createAuthClient({ plugins })`. Done when `authClient.inbox.unreadCount` typechecks.

5. **The bell.** Render `<InboxButton client={authClient} onNavigate={...} />` from `@byo-oss/notifications/react` once, in the layout that wraps signed-in pages, so navigation doesn't remount it.
   - `onNavigate` takes the app router: Next.js `(href) => router.push(href)`, TanStack Router `(href) => router.navigate({ href })`.
   - It renders its own `<button>`. Match the design system with `buttonClassName` (shadcn: `buttonVariants({ variant: "ghost", size: "icon" })`), not a wrapping button.
   - Tailwind v4 skips `node_modules`: add `@source "<relative path>/node_modules/@byo-oss/notifications/dist";` to the CSS file that imports Tailwind, with the path relative to that file.

   Done when the bell renders styled for a signed-in user.

6. **Send.** Call `auth.api.notify({ body: { userId, type, title, href } })` from server code where the event happens (a server action, webhook handler, job). It is server-only, never an HTTP route. `type` is a dotted event name (`comment.reply`, `billing.payment_failed`) that later picks email routes. Done when a notification sent in dev shows in the bell.

7. **Email, only if asked for.** Install `@wraps.dev/email`, then add `appUrl`, `channels: { email: wrapsEmail({ from }) }` and `routes` keyed by `type` (see `llms.txt`). Then add a scheduled call to `auth.api.processDeliveries({})`, every minute, in whatever runs the app's cron. Without it, delayed emails and retries never go out. If the app already uses `@byo-oss/core`, its `sweepAll(auth)` route runs this sweep too and can replace the `processDeliveries` call. Done when a routed notification produces a `sent` delivery in dev.

8. **Events, only if asked for.** Pass `onEvent` to `inbox()`, built with `createEventBus` from `@byo-oss/core` (see `llms.txt` for the event table). Handlers run after the write commits: `notify` inside `runWithTransaction` waits for its commit, while the sweep never joins a transaction (call it outside one; its failure events fire at once). Never route `notifications.*` events back into `notify`. Done when a `notify` in dev reaches the handler with `notifications.notification.created`.

## Rules

- Address people by better-auth user id and organizations by `organizationId`. A recipient list of email addresses is a sign the call belongs elsewhere.
- App code reaches the package through `auth.api.*`, the client, the React exports and the exported functions. Leave its tables to it.
- Organization changes clean up after themselves (delete, remove member, leave). Deletes made outside the organization plugin's endpoints call `deleteOrganizationData(auth, orgId)` or `deleteMemberData(auth, { userId, organizationId })`.
- Never route `notifications.*` events (from `inbox({ onEvent })`) back into `notify`; it rejects those types.
- Every UI string has a `labels` override; reach for it before forking a component.

## Custom channels

A channel is `{ deliver(ctx) }`: resolve when the provider accepted the send, throw to retry, throw `PermanentDeliveryError` for a send that can never succeed, and leave `ctx` unchanged. Test it with the contract suite (vitest, ESM):

```ts
import { testChannel } from "@byo-oss/notifications/testing"
testChannel(() => myChannel({ client: fake }), { failing: () => myChannel({ client: rejecting }) })
```

Done when the suite passes.
