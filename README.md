# better-inbox

In-app notifications for [better-auth](https://better-auth.com) apps. One plugin, one migration, one component — notifications live in **your** database, addressed to **your** users.

```
npm install better-inbox
```

![Stripe webhook fires, the bell rings, and the inbox panel opens with the payment-failed notification](https://raw.githubusercontent.com/better-inbox/better-inbox/main/.github/demo.gif)

- **A better-auth plugin, not a platform.** No services to deploy, no dashboard SaaS. The `notification` table lives in your own database via better-auth's adapter (drizzle, prisma, kysely — whatever you already use).
- **Addressed to users, not email addresses.** `notify({ userId })` uses your better-auth user ids. Delete a user, their notifications cascade.
- **Organization-aware.** Notify a whole org — optionally filtered by role — via the better-auth organization plugin: `notify({ organizationId, roles: ["owner", "admin"] })`.
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

Fan-out is capped at 1,000 members by default (`inbox({ maxFanout })` to change). Over the cap, `notify` throws instead of hammering your database.

## API

### Server (`better-inbox`)

| Endpoint | Access | Description |
|----------|--------|-------------|
| `auth.api.notify({ body })` | server-only | Create notification(s). Exactly one of `userId` / `organizationId`; optional `roles`, `body`, `href`, `data` (JSON) |
| `auth.api.listNotifications({ query })` | session | `{ filter?: "unread"\|"all", limit? (≤100), offset?, organizationId? }` → `{ notifications, hasMore }` |
| `auth.api.markRead({ body: { id } })` | session | Marks one of the caller's notifications read |
| `auth.api.markAllRead({ body })` | session | Optional `{ organizationId }` scope |
| `auth.api.unreadCount({ query })` | session | → `{ count }` |

Every session endpoint is scoped to the caller — users can only ever see and mutate their own notifications.

### React (`better-inbox/react`)

- `<InboxButton client={authClient} />` — bell + badge + panel. Props: `onNavigate`, `renderItem`, `pollInterval` (default 30s; unread count only, full refresh on window focus and panel open), `organizationId`, `className`.
- `useInbox(client, options)` — build your own UI: `{ notifications, unreadCount, isLoading, hasMore, loadMore, markRead, markAllRead, refresh }`.
- `<InboxPanel inbox={useInbox(...)} />` — the panel without the bell.

## Performance note

Add an index for the list query once you have real traffic — plugin schemas can't declare indexes, so it's one manual line, e.g. drizzle:

```ts
index("notification_user_created_idx").on(table.userId, table.createdAt)
```

## What this is not (yet)

Email/push channels, preferences, digests, realtime websockets — out of scope for v0.1 by design. Polling + focus refetch covers the badge honestly. If you need multi-channel delivery pipelines, look at [Novu](https://novu.co) or [betternotify](https://github.com/better-notify/better-notify); better-inbox is the thin, DB-owned layer for the in-app half.

## License

MIT
