import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "../src/lib/auth-options.ts";

const { runMigrations, toBeCreated, toBeAdded } = await getMigrations(authOptions);
await runMigrations();
console.log(
  `migrated: ${toBeCreated.length} tables created, ${toBeAdded.length} altered`,
);
