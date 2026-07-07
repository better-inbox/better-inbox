# Feature: better-inbox v0.1 — in-app notifications as a better-auth plugin

## Problem
Every app with users eventually needs in-app notifications (bell + inbox panel). The incumbent solutions are platforms (Novu: 6 services, Mongo, Redis; Notifuse: a container to run), not libraries. Nothing exists in the shape better-auth proved wins: a plugin that lives in your repo, owns a table in *your* database, and is scaffoldable by an LLM in one shot. Teams hand-roll this feature repeatedly.

## Solution
`better-inbox`: a better-auth plugin. One plugin registration, one migration (via the user's existing `better-auth` CLI workflow), one React component. Notifications are rows in the app's own database, addressed to better-auth user ids, optionally org-scoped via the better-auth organization plugin (fan-out on write, role targeting). Polling for freshness — no realtime infra in v0.1.

Published as `better-inbox` on npm (name already reserved at 0.0.1) with exports:
- `better-inbox` — server plugin `inbox()`
- `better-inbox/client` — client plugin `inboxClient()`
- `better-inbox/react` — `<InboxButton />`, `useInbox()`

## User Stories
- As an app developer, I want to add `inbox()` to my better-auth plugins and get a `notification` table from my existing migrate workflow, so that adding notifications takes minutes not days.
- As an app developer, I want to call `auth.api.notify(...)` from any server code (server action, webhook handler, cron) to create a notification for a user.
- As a SaaS developer, I want to notify all members of an organization (optionally filtered by role, e.g. billing failure → owners/admins), so multi-tenant notifications work without my own fan-out code.
- As an end user, I want a bell with an unread badge and a panel where I can read, click through, and mark notifications read.

## Scope
### In Scope (v0.1)
- `notification` table via plugin schema (user-scoped, nullable org scope)
- Server: `notify` (server-only; single user OR org fan-out with `roles` filter, hard cap 1000 members), `listNotifications` (cursor pagination, unread filter, org filter defaulting to active org), `markRead`, `markAllRead`, `unreadCount` — all session-guarded, self-only
- Client plugin with typed methods + unread-count atom
- React: `useInbox()` hook, `<InboxButton />` (bell + badge + popover panel: All/Unread tabs, infinite scroll, click-through marks read, mark-all-read, empty state), styled against shadcn CSS variables with no hard shadcn dependency
- Polling: unread count on interval (default 30s) + window-focus refetch
- Works with zero org plugin present (org features error cleanly)
- Tests against better-auth memory adapter; README quickstart; publish 0.1.0 over the 0.0.1 stub

### Out of Scope (explicit)
- Email or any other channel; preferences; digests; archive; admin send UI
- Websockets/SSE realtime; org-addressed single-row notifications (shared read state)
- Vue/Svelte/Solid components; shadcn registry distribution; webhooks; approvals
- Backfill for members joining an org after a notification was sent

## Open Questions
- Does better-auth plugin schema support a JSON field type for the `data` payload, or do we store a stringified column? (research)
- Exact mechanism for client-plugin atoms → React hooks (`atomListeners`?) (research)
- How a plugin detects/uses another plugin's tables (organization `member` model) at runtime (research)
- Test harness: how better-auth's own plugins instantiate an auth server against the memory adapter (research)

## Validation Gate (pre-committed)
Launch posts (X, r/nextjs, better-auth Discord showcase) with org-fan-out demo GIF. Two-week window. Continue only on genuine usage signals (real-user issues, apps in the wild, unprompted mentions) — stars alone don't count. No second weekend before the gate.

## Status
- Created: 2026-07-07
- Phase: idea
