# better-inbox demo

Next.js + better-auth (SQLite) + organization plugin + better-inbox.

```
bun install
bun run seed     # alice@demo.dev / bob@demo.dev, password: demo-password-123, org "Acme"
bun run dev
```

Sign in as alice, then use "Notify me" (personal notification) or "Simulate billing failure" (org fan-out to owners/admins — sign in as bob in a second browser to watch his badge tick up).

Note: `seed` runs under Node (`node seed.ts`), not Bun — better-sqlite3's native module doesn't load in the Bun runtime (oven-sh/bun#4290). The Next.js app itself runs on Node and is unaffected.
