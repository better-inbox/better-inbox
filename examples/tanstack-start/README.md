# better-inbox × TanStack Start

TanStack Start + better-auth (SQLite) + better-inbox, with an end-to-end suite
that proves the wiring.

```
bun install
node scripts/migrate.ts   # creates example.db
bun run dev               # http://localhost:3000
```

Sign up, press **Send me a notification**, reload, and open the bell.

## The parts that are TanStack-specific

- **`onNavigate`**: pass the href to the router whole. `router.navigate({ href })`
  takes it as a built URL, so `/settings?tab=billing#card` keeps its query
  and hash and stays a client-side navigation (`{ to: href }` works too).
  ```tsx
  const router = useRouter(); // @tanstack/react-router
  <InboxButton client={authClient} onNavigate={(href) => router.navigate({ href })} />
  ```
- **Mount it in the root layout** (`src/routes/__root.tsx`). The layout stays
  mounted across navigations, so moving between pages doesn't refetch the
  inbox. Inside a route component it remounts, and refetches, on every visit.
- **Auth handler** at `src/routes/api/auth/$.ts`, with `tanstackStartCookies()`
  as the last better-auth plugin so server functions can set cookies.

`InboxButton` and `InboxPanel` are styled with Tailwind and shadcn tokens; this
example doesn't set those up, so the panel renders unstyled.

## End-to-end tests

`tests/inbox.e2e.ts` runs on [e2e](https://www.npmjs.com/package/e2e), with no
agent steps, so it needs no model or API key:

```
npx e2e-web install chromium   # once
bun run test:e2e
```

The runner starts the app on a free port against a fresh `e2e.db`. It checks:

- `/settings?tab=billing` renders with its search params
- sign up → notification created by a server function → badge shows `1`
- clicking the notification lands on exactly `/settings?tab=billing#card`,
  without a page load (a `window` marker set before the click survives)
- hopping between routes afterwards makes no new `inbox/list` requests

e2e needs Node 22.22.3+ or 24.8+.

`better-sqlite3` is a native module, so the dev server and `migrate` run under
Node, not the Bun runtime.
