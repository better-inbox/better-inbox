# @byo-oss/notifications

Formerly [`better-inbox`](https://www.npmjs.com/package/better-inbox). Same API: change your imports.

In-app notifications for [better-auth](https://better-auth.com) apps. One plugin, one migration, one component — notifications live in **your** database, addressed to **your** users.

```
npm install @byo-oss/notifications
```

![Stripe webhook fires, the bell rings, and the inbox panel opens with the payment-failed notification](https://raw.githubusercontent.com/byo-oss/notifications/main/.github/demo.gif)

- **A better-auth plugin, not a platform.** No services to deploy, no dashboard SaaS. The `notification` table lives in your own database via better-auth's adapter (drizzle, prisma, kysely — whatever you already use).
- **Addressed to users, not email addresses.** `notify({ userId })` uses your better-auth user ids. Delete a user and their notifications go with them.
- **Organization-aware.** Notify a whole org — optionally filtered by role — via the better-auth organization plugin: `notify({ organizationId, roles: ["owner", "admin"] })`.
- **Email when it matters.** Route a notification type to email and it goes out only if the notification is still unread after a delay, or right away if the user isn't in the app. [Wraps](https://wraps.dev) sends it through your own AWS SES account.
- **One React component.** `<InboxButton />` gives you the bell, unread badge, and inbox panel, styled with shadcn CSS variables (works with any shadcn theme, zero runtime dependencies, no shadcn required).

> Community plugin — not affiliated with the better-auth team.

## Quickstart

Using a coding agent? `npx skills add byo-oss/notifications` installs a skill that walks it through these steps (`npx skills sync` picks it up from `node_modules` too).

**1. Add the plugin** to your better-auth config:

```ts
// lib/auth.ts
import { betterAuth } from "better-auth";
import { inbox } from "@byo-oss/notifications";

export const auth = betterAuth({
  // ...your existing config
  plugins: [inbox()],
});
```

**2. Migrate.** The plugin declares the `notification` table; your existing better-auth workflow creates it:

```
npx @better-auth/cli migrate --config lib/auth.ts   # or: generate, for drizzle/prisma
```

(Point `--config` at your better-auth config if the CLI doesn't auto-detect it.)

**3. Add the client plugin:**

```ts
// lib/auth-client.ts
import { createAuthClient } from "better-auth/react";
import { inboxClient } from "@byo-oss/notifications/client";

export const authClient = createAuthClient({
  plugins: [inboxClient()],
});
```

**4. Drop in the component** (any client component, e.g. your navbar):

```tsx
"use client";
import { InboxButton } from "@byo-oss/notifications/react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function Navbar() {
  const router = useRouter();
  return <InboxButton client={authClient} onNavigate={(href) => router.push(href)} />;
}
```

TanStack Start / Router: pass the whole href to `router.navigate({ href })`, and mount the button in the root layout so navigations don't remount it. A working app with an end-to-end suite is in [`examples/tanstack-start`](examples/tanstack-start).

```tsx
import { useRouter } from "@tanstack/react-router";

const router = useRouter();
<InboxButton client={authClient} onNavigate={(href) => router.navigate({ href })} />
```

Tailwind v4 skips `node_modules` when it scans for classes, so point it at the package from your CSS or some of the button's and panel's classes won't be generated:

```css
@import "tailwindcss";
@source "../node_modules/@byo-oss/notifications/dist"; /* path relative to this CSS file */
```

`InboxButton` renders its own `<button>`, so don't wrap it in another one. To match your design system's trigger, pass `buttonClassName`; it replaces the default look. With shadcn:

```tsx
import { buttonVariants } from "@/components/ui/button";

<InboxButton client={authClient} buttonClassName={buttonVariants({ variant: "ghost", size: "icon" })} />
```

**5. Send notifications** from any server code — a server action, a webhook handler, a cron job:

```ts
await auth.api.notify({
  body: {
    userId: comment.authorId,
    type: "comment.reply",
    title: `${user.name} replied to your comment`,
    href: `/posts/${post.id}#comment-${comment.id}`,
  },
});
```

`notify` is server-only: callable through `auth.api`, never exposed as an HTTP route.

## Notify a whole organization

With the better-auth [organization plugin](https://better-auth.com/docs/plugins/organization) enabled, address an org instead of a user. One notification is created per member (fan-out on write), each stamped with `organizationId`:

```ts
// Stripe webhook: payment failed → tell the org's admins
await auth.api.notify({
  body: {
    organizationId: subscription.metadata.orgId,
    roles: ["owner", "admin"], // optional — omit to notify every member
    type: "billing.payment_failed",
    title: "Payment failed — update your card",
    href: "/settings/billing",
  },
});
```

To leave out the member who caused the event, pass `excludeUserIds`. If `roles` and `excludeUserIds` leave nobody, `notify` returns `{ count: 0, notifications: [] }`; an organization with no members at all still throws.

```ts
// A comment in an org: tell every member except the author
await auth.api.notify({
  body: {
    organizationId: post.orgId,
    excludeUserIds: [session.user.id], // the actor gets no row
    type: "comment.added",
    title: `${session.user.name} commented`,
    href: `/posts/${post.id}`,
  },
});
```

Pass `userId` together with `organizationId` to notify one member in the org's context. It writes a single row stamped with `organizationId`, so it shows up under that org's `organizationId` filter. `notify` throws if the user is not a member.

```ts
await auth.api.notify({
  body: {
    userId: task.assigneeId,
    organizationId: task.orgId,
    type: "task.assigned",
    title: "Assigned to you",
    href: `/tasks/${task.id}`,
  },
});
```

`roles` and `excludeUserIds` apply only to fan-out, so they are rejected when `userId` is set.

Fan-out is capped at 1,000 members by default (`inbox({ maxFanout })` to change). Over the cap, `notify` throws instead of hammering your database.

### When a member leaves or an organization is deleted

The plugin cleans up after the organization plugin's own endpoints: `/organization/delete` deletes the org's notifications, and `/organization/remove-member` and `/organization/leave` delete that member's notifications in that org. Their notifications elsewhere stay. Deliveries go with their notifications. Pass `organizationCleanup: false` to keep them, e.g. for an audit trail.

Deleting a user removes all of their rows: through foreign keys on SQL databases, and through a user-delete hook on adapters without them (memory, MongoDB).

If you delete organizations or members some other way (a script, an admin tool, a direct database write), call the cleanup yourself:

```ts
import { deleteMemberData, deleteOrganizationData } from "@byo-oss/notifications";

await deleteOrganizationData(auth, organizationId);
await deleteMemberData(auth, { userId, organizationId });
```

`organizationId` has no foreign key, because the organization plugin is optional. These functions do what a cascade would. Call them too if your own `organizationHooks` (`afterDeleteOrganization`, `afterRemoveMember`) throw: that error replaces the response the plugin reads, so its cleanup skips. A notification fanned out at the moment its org is deleted can also survive; running `deleteOrganizationData` again is safe.

Called inside a better-auth transaction (`runWithTransaction`, as in a `@better-auth/scim` projection deprovisioning a member), they run in it: their deletes commit or roll back with the rest of it.

## Email if unread

Route a notification type to email, and it is emailed only if nobody has read or seen it in the app first. The in-app row is always written; email is a follow-up to it.

```
npm install @wraps.dev/email
```

```ts
import { inbox } from "@byo-oss/notifications";
import { wrapsEmail } from "@byo-oss/notifications/wraps";

inbox({
  appUrl: "https://app.acme.com", // turns href "/settings/billing" into a link
  channels: {
    email: wrapsEmail({ from: "Acme <notify@acme.com>" }),
  },
  routes: {
    // in-app now; email after 15 minutes if still unread, or right away if the user isn't in the app
    "billing.payment_failed": [{ channel: "email", ifUnreadAfter: { minutes: 15 } }],
    // in-app and email, both right away; the email goes out even if it's read first
    "security.new_login": [{ channel: "email", cancelIfRead: false }],
    // at most one email an hour per user, however often it fires
    "run.failed": [{ channel: "email", ifUnreadAfter: { minutes: 15 }, throttle: { hours: 1 } }],
    // "*": [...] would apply to every type without its own entry; types with no rule stay in-app
  },
});
```

`wrapsEmail` sends through [`@wraps.dev/email`](https://wraps.dev) from your own AWS SES account, resolving credentials from the environment. Pass `client: new WrapsEmail({ region, ... })` to configure it, and `render: ({ notification, user, appUrl }) => ({ subject, html, text })` to replace the default email (title, body and a View button). A channel is any `{ deliver({ notification, user, appUrl }) }` that throws on failure, so other providers are a few lines. A throw retries; throw `PermanentDeliveryError` (or any error with `permanent: true`) for a send that can never succeed, such as an invalid address, and the delivery fails at once.

**Read and seen both cancel it.** Clicking a notification marks it read. An unread row in the open panel is marked *seen* (`seenAt`) once at least half of it has been on screen for a second while the tab is visible. Rows below the scroll, or a panel flicked open and shut, don't count. Seen doesn't touch the badge or `read`, but it does cancel a pending email. For alerts whose email is the record, such as security events, set `cancelIfRead: false` and it goes out regardless.

**Throttle alerts that repeat.** With `throttle: { hours: 1 }`, a user gets at most one email of that type per hour; later ones are skipped (with `detail: "throttled"`) and stay in the inbox. The window counts from the last email actually sent. It holds within one process; two sweeps running at once in separate processes can each send one.

**"In the app" is a heartbeat.** `<InboxButton>` polls the unread count every 30 seconds while the tab is visible, and each poll records the user as present. An admin impersonating the user (better-auth's admin plugin) doesn't count. A user with no poll in the last 2 minutes (`presenceWindow`) is away, so an `ifUnreadAfter` email goes out right away instead of waiting. Set `sendNowIfAway: false` on a rule to always wait. With `pollInterval: 0`, or on pages without the inbox mounted, users count as away.

**Run the sweep on a schedule.** A plugin can't run jobs, so delayed emails and retries go out when you call `processDeliveries` from your own scheduler, every minute or so:

```ts
// app/api/cron/inbox/route.ts (Vercel Cron, a worker, a queue: anything that calls this)
export async function GET() {
  const result = await auth.api.processDeliveries({});
  return Response.json(result); // { sent, skipped, retrying, failed, hasMore }
}
```

Emails that are due right away (an away user, a rule with no delay) are sent inside `notify` when better-auth has a background task handler (`advanced: { backgroundTasks: { handler: waitUntil } }`) and the batch is 25 or fewer. Otherwise, including large org fan-outs, they go out on the next sweep. Each sweep handles `batchSize` deliveries (100) and returns `hasMore` when more are due.

**Delivery is at-least-once.** Each delivery is claimed atomically before it's sent, so overlapping sweeps don't double-send. A failed send retries with backoff (1 minute, doubling, up to an hour) and is marked `failed` after `maxAttempts` (5). A worker that dies mid-send has its delivery retried five minutes later, so a crash after SES accepted the email can send it twice.

**Opting out.** There are no built-in preferences yet. `shouldDeliver: ({ notification, user, channel }) => boolean | Promise<boolean>` lets you check your own before each send.

Every delivery is a row in `notificationDelivery` (see [Schema](#schema)), with its status and the reason it was skipped or the last error.

## Options

`inbox(options)`:

| Option | Type | Default | Meaning |
|--------|------|---------|---------|
| `appUrl` | string | | Your app's origin. Channels join a relative `href` onto it |
| `channels` | `Record<string, InboxChannel>` | `{}` | Delivery channels beyond the in-app inbox, by name |
| `routes` | `Record<type, DeliveryRule[]>` | `{}` | Which channels each `type` goes to. `"*"` is the fallback; a type with no rule stays in-app |
| `shouldDeliver` | `({ notification, user, channel }) => boolean \| Promise<boolean>` | | Return `false` to skip a delivery, e.g. from your own preferences |
| `presenceWindow` | number (ms) | `120000` | How recently a user must have polled to count as in the app |
| `maxAttempts` | number | `5` | Sends tried before a delivery is marked `failed` |
| `batchSize` | number | `100` | Deliveries per `processDeliveries` call |
| `maxFanout` | number | `1000` | Most members one organization `notify` may reach |
| `organizationCleanup` | boolean | `true` | Delete notifications when an org is deleted or a member is removed or leaves |
| `schema` | | | Rename tables and fields |

A `DeliveryRule`:

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `channel` | string | | A name from `channels` |
| `ifUnreadAfter` | `{ seconds?, minutes?, hours? }` | | Send only if still unread and unseen after this long. Omit to send right away |
| `sendNowIfAway` | boolean | `true` | With `ifUnreadAfter`, send at once when the user isn't in the app |
| `cancelIfRead` | boolean | `true` | Skip the send when the notification was read or seen first |
| `throttle` | `{ seconds?, minutes?, hours? }` | | At most one send of this type per user per window |

## API

### Server (`@byo-oss/notifications`)

| Endpoint | Kind | Input | Returns |
|----------|------|-------|---------|
| `auth.api.notify` | server-only | `body`: `type`, `title`, and `userId`, `organizationId` or both (one member's row, stamped with the org; the user must be a member). Optional `body`, `href`, `data` (JSON). Org fan-out also takes `roles` and `excludeUserIds` | `{ count, notifications }` |
| `auth.api.processDeliveries` | server-only | Optional `body: { limit }`, overriding `batchSize`. Call it from a cron | `{ sent, skipped, retrying, failed, hasMore }` |
| `auth.api.listNotifications` | own rows | `query`: `filter?: "unread" \| "all"`, `limit?` (≤100), `offset?`, `organizationId?` | `{ notifications, hasMore }` |
| `auth.api.markRead` | own rows | `body: { id }` | `{ notification }` |
| `auth.api.markSeen` | own rows | `body: { ids }`, up to 100. Stamps `seenAt`, cancelling pending emails; the panel calls it for rows that have been on screen | `{ count }` |
| `auth.api.markAllRead` | own rows | `body: { organizationId? }` | `{ count }` |
| `auth.api.unreadCount` | own rows | `query: { organizationId? }` | `{ count }` |

"Own rows" endpoints need a session and only ever see or change the caller's own notifications.

Server-only functions (not endpoints), for your own scripts and hooks:

| Function | Description |
|----------|-------------|
| `deleteOrganizationData(auth, organizationId)` | Deletes an org's notifications and their deliveries → `{ notifications }` (the count) |
| `deleteMemberData(auth, { userId, organizationId })` | Deletes one member's notifications in one org → `{ notifications }` |
| `exportNotificationsData(auth, { organizationId?, cursor?, limit? })` | One page (500 by default) of notifications, each with its `deliveries` and the user's `userEmail`, as plain JSON with ISO dates → `{ notifications, cursor }`. Pass `cursor` back until it's `null`. A row deleted mid-export (a member leaving, say) can make the next page skip one, so export with writes stopped |

### React (`@byo-oss/notifications/react`)

- `<InboxButton client={authClient} />` — bell + badge + panel. Props: `onNavigate`, `renderItem`, `pollInterval` (default 30s; unread count only, paused while the tab is hidden), `refreshOnFocus` (default `true`; full refresh when the tab becomes visible), `filter`, `organizationId`, `className` (the wrapper), `buttonClassName` (replaces the trigger's default classes). The visibility refresh is skipped when the data is under 5s old; opening the panel always refreshes. Opens on an **Unread** tab (fetched server-side with `filter: "unread"`) with **All** second; passing `filter` locks the list and hides the tabs.
- `useInbox(client, options)` — build your own UI: `{ notifications, unreadCount, isLoading, hasMore, loadMore, markRead, markSeen, markAllRead, refresh, refreshIfStale }`. In a custom UI, use `const seenRef = useSeenOnView(markSeen)` and put `ref={seenRef(n.id)}` on each unread row, so only rows people actually look at cancel pending emails. It uses IntersectionObserver and marks nothing where that's missing. Options: `pollInterval`, `pageSize`, `filter`, `organizationId`, `refreshOnFocus`. `refresh()` always fetches (concurrent calls share one request); `refreshIfStale()` skips if the data is under 5s old.
- `filter: "unread"` fetches only unread rows, so a page is a full page — `useInbox(authClient, { filter: "unread", pageSize: 5 })` yields five unread notifications instead of five rows you then filter down to however many are unread. Rows you mark read stay in the list until the next `refresh()`, and `loadMore()` accounts for them when paging.
- `<InboxPanel inbox={useInbox(...)} />` — the panel without the bell. Pass `view` + `onViewChange` to control its tabs; uncontrolled it defaults to Unread.
- `labels` on `InboxButton` and `InboxPanel` replaces any of the English strings: `notifications` (the bell's accessible name), `unread`, `all`, `markAllRead`, `empty`, `loadMore`, `unreadCount(count)` (announced to screen readers when the count changes) and `relativeTime(date)`. Keys you leave out keep `defaultInboxLabels`.

  ```tsx
  <InboxButton client={authClient} labels={{ unread: "Ungelesen", all: "Alle", markAllRead: "Alle gelesen" }} />
  ```

### Testing (`@byo-oss/notifications/testing`)

Writing your own channel (push, SMS, Slack)? Run the `InboxChannel` contract against it with vitest (ESM only, since vitest can't be `require()`d):

```ts
import { testChannel } from "@byo-oss/notifications/testing";

testChannel(() => slackChannel({ fetch: fakeFetch }), {
  failing: () => slackChannel({ fetch: failingFetch }), // checks that a failed send throws
});
```

It checks that `deliver` resolves for full and minimal notifications and for relative and absolute links, doesn't change its input, and throws when the send fails, which is what makes a delivery retry. If your channel reports sends that can never succeed, pass `permanentlyFailing` too, and it checks that those throw a `PermanentDeliveryError`. `deliveryContext(overrides)` builds a sample context for your own tests. The built-in Wraps channel runs the same suite.

## Schema

These tables are a public contract: a change that breaks reading existing rows is a major release. Rename tables or fields with the `schema` option. Nothing is added to better-auth's own tables.

**`notification`**: one row per person per notification.

| Field | Type | Meaning |
|-------|------|---------|
| `id` | string | Primary key |
| `userId` | string → `user.id`, cascade | Whose inbox it's in |
| `organizationId` | string, optional | The org it was sent in. No foreign key, because the organization plugin is optional |
| `type` | string | Your event name, e.g. `billing.payment_failed`. Picks the delivery routes |
| `title` | string | The headline in the inbox and the email subject |
| `body` | string, optional | A line of detail under the title |
| `href` | string, optional | Where clicking it goes. Emails join a relative path onto `appUrl` |
| `data` | json, optional | Anything else you passed to `notify` |
| `read` | boolean | Clicked or marked read |
| `seenAt` | date, optional | When it was first on screen. Cancels pending "if unread" emails |
| `createdAt` | date | When `notify` wrote it |

**`notificationDelivery`**: one row per notification per routed channel.

| Field | Type | Meaning |
|-------|------|---------|
| `id` | string | Primary key |
| `notificationId` | string → `notification.id`, cascade | The notification it delivers |
| `userId` | string → `user.id`, cascade | The recipient, copied from the notification |
| `type` | string | The notification's type, for throttling |
| `channel` | string | The channel's name in `channels` |
| `status` | string | `pending`, `sending`, `sent`, `skipped` or `failed` |
| `scheduledFor` | date | When it's due |
| `attempts` | number | Sends tried |
| `claimedAt` | date, optional | When a sweep claimed it. A claim older than five minutes is retried |
| `sentAt` | date, optional | When the channel accepted it |
| `detail` | string, optional | Why it was skipped, or the last error |
| `createdAt` | date | When it was scheduled |

**`inboxPresence`**: when each user last polled the inbox, so "email if unread" knows who's in the app.

| Field | Type | Meaning |
|-------|------|---------|
| `id` | string | Primary key |
| `userId` | string → `user.id`, cascade, unique | Whose heartbeat it is |
| `lastSeenAt` | date | Written at most once a minute |

## Performance note

Add an index for the list query once you have real traffic — plugin schemas can't declare indexes, so it's one manual line, e.g. drizzle:

```ts
index("notification_user_created_idx").on(table.userId, table.createdAt)
```

With email routes, the sweep queries `notificationDelivery` by status and due time:

```ts
index("notification_delivery_due_idx").on(table.status, table.scheduledFor)
// only if you use throttle:
index("notification_delivery_throttle_idx").on(table.userId, table.type, table.channel, table.sentAt)
```

Organization cleanup and export look notifications up by org and deliveries by notification. Postgres doesn't index foreign keys on its own:

```ts
index("notification_org_idx").on(table.organizationId)
index("notification_delivery_notification_idx").on(table.notificationId)
```

## Upgrading to 0.8

- Every reference now declares `onDelete: "cascade"`: `notification.userId`, `notificationDelivery.notificationId`, `notificationDelivery.userId` and `inboxPresence.userId`. better-auth's own `migrate` already cascaded. If you generate migrations with drizzle or prisma, regenerate and apply them so your foreign keys match.
- The plugin now deletes notifications when an organization is deleted or a member is removed or leaves (see [above](#when-a-member-leaves-or-an-organization-is-deleted)). If you wired your own cleanup for this, you can remove it.
- The panel's tabs render "Unread" and "All" as text, instead of `unread` and `all` capitalized by CSS. Tests that match the tab text exactly need the capitalized form.
- Deleting a user now also removes their rows on adapters without foreign keys (memory, MongoDB).
- New, additive: `exportNotificationsData`, `PermanentDeliveryError`, `labels` (including `badge`), `organizationCleanup`, and `@byo-oss/notifications/testing`.

## Upgrading to 0.6

0.6 adds a `seenAt` column to `notification` and two tables, `notificationDelivery` and `inboxPresence`. Re-run `migrate` (or `generate`) after upgrading, even if you don't use email.

If you hand `useInbox` your own client object rather than `authClient`, add `markSeen: ({ ids }) => authClient.inbox.markSeen({ ids })` to it. `InboxFetchClient` now requires it, because without it nothing is marked seen and every unread email goes out.

## What this is not (yet)

In-app first: email follows a notification that went unread, and it uses the inbox's own read state to decide. Notification preferences, push, SMS, digests and realtime websockets aren't here yet. Polling + refetch on tab visibility covers the badge honestly. If you need full multi-channel delivery pipelines today, look at [Novu](https://novu.co) or [betternotify](https://github.com/better-notify/better-notify).

## Outgrowing this

You've outgrown it when you need push, SMS or chat next to in-app, a preference center and digests across channels, non-engineers editing notification templates, or realtime delivery to thousands of concurrent users. The usual next stops are [Knock](https://knock.app), [Novu](https://novu.co) and [Courier](https://www.courier.com).

Neither Knock nor Novu documents a way to import past notifications: their messages come from triggering a workflow, stamped with the current time and unread. So moving is a forward cutover, and your `notification` table stays the archive.

| Here | Knock | Novu |
|------|-------|------|
| `user.id`, `user.email` | user `id`, `email` ([bulk identify](https://docs.knock.app/api-reference/users/bulk/identify), 1,000 per call) | subscriber `subscriberId`, `email` ([bulk create](https://docs.novu.co/platform/concepts/subscribers), 500 per call) |
| `organizationId` | [tenant](https://docs.knock.app/concepts/tenants) `id`, passed on each trigger | [tenant context](https://docs.novu.co/platform/concepts/tenants) `{ type: "tenant", id }` |
| `type` | [workflow](https://docs.knock.app/concepts/workflows) key | [`workflowId`](https://docs.novu.co/platform/concepts/workflows), conventionally lowercase with hyphens, so `billing.payment_failed` may need renaming |
| `title`, `body`, `href`, `data` | trigger `data`, rendered by the workflow's in-app template | trigger `payload` |
| `read`, `seenAt` | [message statuses](https://docs.knock.app/send-notifications/message-statuses), for messages it created | read and seen, for messages it created |
| `createdAt` | not settable | not settable |
| `notificationDelivery`, `inboxPresence` | no equivalent; stays here | no equivalent; stays here |

1. **Run both.** Keep calling `auth.api.notify`, and also trigger the new tool's workflow for one `type`, behind a flag.
2. **Backfill people.** Bulk-import users from better-auth's `user` table, and organizations as tenants from `organization`.
3. **Cut over one `type` at a time.** Check it in the tool's activity log, then stop calling `notify` for that type and point the bell at the tool's feed component.
4. **Keep history readable.** Leave the old inbox reachable (an "Earlier" tab, or an export into your own archive) for as long as people need it.
5. **Uninstall** once nothing calls `notify` and nothing reads the old inbox.

Knock is the more direct fit: its tenants take `organizationId` as-is, and it documents setting message status through its API. Novu's [in-house migration guide](https://docs.novu.co/guides/migrate-from-in-house-to-novu) covers moving triggers one workflow at a time.

## Uninstall

1. Remove `inbox()` from `betterAuth({ plugins })`, `inboxClient()` from your auth client, and `InboxButton` / `useInbox` from your UI.
2. Remove the Tailwind `@source` line and the cron that calls `processDeliveries`.
3. Drop the tables, the one with foreign keys to `notification` first: `notificationDelivery`, then `inboxPresence` and `notification`. Use the names your adapter or the `schema` option gave them.

The plugin adds no columns to better-auth's own tables (`user`, `organization`, `member`), so there's nothing else to clean up.

## License

MIT
