# better-inbox

In-app notifications for [better-auth](https://better-auth.com) apps. One plugin, one migration, one component — notifications live in **your** database, addressed to **your** users.

```
npm install better-inbox
```

![Stripe webhook fires, the bell rings, and the inbox panel opens with the payment-failed notification](https://raw.githubusercontent.com/better-inbox/better-inbox/main/.github/demo.gif)

- **A better-auth plugin, not a platform.** No services to deploy, no dashboard SaaS. The `notification` table lives in your own database via better-auth's adapter (drizzle, prisma, kysely — whatever you already use).
- **Addressed to users, not email addresses.** `notify({ userId })` uses your better-auth user ids. Delete a user, their notifications cascade.
- **Organization-aware.** Notify a whole org — optionally filtered by role — via the better-auth organization plugin: `notify({ organizationId, roles: ["owner", "admin"] })`.
- **Email when it matters.** Route a notification type to email and it goes out only if the notification is still unread after a delay, or right away if the user isn't in the app. [Wraps](https://wraps.dev) sends it through your own AWS SES account.
- **One React component.** `<InboxButton />` gives you the bell, unread badge, and inbox panel, styled with shadcn CSS variables (works with any shadcn theme, zero runtime dependencies, no shadcn required).

> Community plugin — not affiliated with the better-auth team.

## Quickstart

**1. Add the plugin** to your better-auth config:

```ts
// lib/auth.ts
import { betterAuth } from "better-auth";
import { inbox } from "better-inbox";

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
import { inboxClient } from "better-inbox/client";

export const authClient = createAuthClient({
  plugins: [inboxClient()],
});
```

**4. Drop in the component** (any client component, e.g. your navbar):

```tsx
"use client";
import { InboxButton } from "better-inbox/react";
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
@source "../node_modules/better-inbox/dist"; /* path relative to this CSS file */
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

## Email if unread

Route a notification type to email, and better-inbox emails it only if nobody has read or seen it in the app first. The in-app row is always written; email is a follow-up to it.

```
npm install @wraps.dev/email
```

```ts
import { inbox } from "better-inbox";
import { wrapsEmail } from "better-inbox/wraps";

inbox({
  appUrl: "https://app.acme.com", // turns href "/settings/billing" into a link
  channels: {
    email: wrapsEmail({ from: "Acme <notify@acme.com>" }),
  },
  routes: {
    // in-app now; email after 15 minutes if still unread, or right away if the user isn't in the app
    "billing.payment_failed": [{ channel: "email", ifUnreadAfter: { minutes: 15 } }],
    // in-app and email, both right away
    "security.new_login": [{ channel: "email" }],
    // "*": [...] would apply to every type without its own entry; types with no rule stay in-app
  },
});
```

`wrapsEmail` sends through [`@wraps.dev/email`](https://wraps.dev) from your own AWS SES account, resolving credentials from the environment. Pass `client: new WrapsEmail({ region, ... })` to configure it, and `render: ({ notification, user, appUrl }) => ({ subject, html, text })` to replace the default email (title, body and a View button). A channel is any `{ deliver({ notification, user, appUrl }) }` that throws on failure, so other providers are a few lines.

**Read and seen both cancel it.** Clicking a notification marks it read. Opening the panel marks the unread rows it shows as *seen* (`seenAt`), which doesn't touch the badge or `read` but does cancel a pending email.

**"In the app" is a heartbeat.** `<InboxButton>` polls the unread count every 30 seconds while the tab is visible, and each poll records the user as present. A user with no poll in the last 2 minutes (`presenceWindow`) is away, so an `ifUnreadAfter` email goes out right away instead of waiting. Set `sendNowIfAway: false` on a rule to always wait. With `pollInterval: 0`, or on pages without the inbox mounted, users count as away.

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

Every delivery is a row in the `notificationDelivery` table (`status`: `pending`, `sending`, `sent`, `skipped`, `failed`, with the reason or last error in `detail`), so you can query what went out.

## API

### Server (`better-inbox`)

| Endpoint | Access | Description |
|----------|--------|-------------|
| `auth.api.notify({ body })` | server-only | Create notification(s). `userId`, `organizationId`, or both (one member's row, stamped with the org; the user must be a member). Org fan-out takes optional `roles` and `excludeUserIds`; `body`, `href`, `data` (JSON) |
| `auth.api.processDeliveries({ body? })` | server-only | Sends due email deliveries; call from a cron. Optional `{ limit }` overrides `batchSize` → `{ sent, skipped, retrying, failed, hasMore }` |
| `auth.api.listNotifications({ query })` | session | `{ filter?: "unread"\|"all", limit? (≤100), offset?, organizationId? }` → `{ notifications, hasMore }` |
| `auth.api.markRead({ body: { id } })` | session | Marks one of the caller's notifications read |
| `auth.api.markSeen({ body: { ids } })` | session | Stamps `seenAt` on up to 100 of the caller's notifications, cancelling pending emails. The panel calls it on open |
| `auth.api.markAllRead({ body })` | session | Optional `{ organizationId }` scope |
| `auth.api.unreadCount({ query })` | session | → `{ count }` |

Every session endpoint is scoped to the caller — users can only ever see and mutate their own notifications.

### React (`better-inbox/react`)

- `<InboxButton client={authClient} />` — bell + badge + panel. Props: `onNavigate`, `renderItem`, `pollInterval` (default 30s; unread count only, paused while the tab is hidden), `refreshOnFocus` (default `true`; full refresh when the tab becomes visible), `filter`, `organizationId`, `className` (the wrapper), `buttonClassName` (replaces the trigger's default classes). The visibility refresh is skipped when the data is under 5s old; opening the panel always refreshes. Opens on an **Unread** tab (fetched server-side with `filter: "unread"`) with **All** second; passing `filter` locks the list and hides the tabs.
- `useInbox(client, options)` — build your own UI: `{ notifications, unreadCount, isLoading, hasMore, loadMore, markRead, markSeen, markAllRead, refresh, refreshIfStale }`. In a custom UI, call `markSeen(ids)` for the rows you put on screen so they cancel pending emails. Options: `pollInterval`, `pageSize`, `filter`, `organizationId`, `refreshOnFocus`. `refresh()` always fetches (concurrent calls share one request); `refreshIfStale()` skips if the data is under 5s old.
- `filter: "unread"` fetches only unread rows, so a page is a full page — `useInbox(authClient, { filter: "unread", pageSize: 5 })` yields five unread notifications instead of five rows you then filter down to however many are unread. Rows you mark read stay in the list until the next `refresh()`, and `loadMore()` accounts for them when paging.
- `<InboxPanel inbox={useInbox(...)} />` — the panel without the bell. Pass `view` + `onViewChange` to control its tabs; uncontrolled it defaults to Unread.

## Performance note

Add an index for the list query once you have real traffic — plugin schemas can't declare indexes, so it's one manual line, e.g. drizzle:

```ts
index("notification_user_created_idx").on(table.userId, table.createdAt)
```

With email routes, the sweep queries `notificationDelivery` by status and due time:

```ts
index("notification_delivery_due_idx").on(table.status, table.scheduledFor)
```

## Upgrading to 0.6

0.6 adds a `seenAt` column to `notification` and two tables, `notificationDelivery` and `inboxPresence`. Re-run `migrate` (or `generate`) after upgrading, even if you don't use email.

## What this is not (yet)

In-app first: email follows a notification that went unread, and it uses the inbox's own read state to decide. Notification preferences, push, SMS, digests and realtime websockets aren't here yet. Polling + refetch on tab visibility covers the badge honestly. If you need full multi-channel delivery pipelines today, look at [Novu](https://novu.co) or [betternotify](https://github.com/better-notify/better-notify).

## License

MIT
