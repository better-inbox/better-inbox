import type { BetterAuthOptions } from "better-auth";
import { inbox } from "better-inbox";
import Database from "better-sqlite3";

// Shared with scripts/migrate.ts, which runs under plain Node and so can't
// import the TanStack cookie plugin.
export const authOptions = {
  database: new Database(process.env.DB_PATH ?? "./example.db"),
  emailAndPassword: { enabled: true },
  plugins: [inbox()],
} satisfies BetterAuthOptions;
