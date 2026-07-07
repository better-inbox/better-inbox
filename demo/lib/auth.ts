import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { inbox } from "better-inbox";
import Database from "better-sqlite3";

export const auth = betterAuth({
  database: new Database("./demo.db"),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [organization(), inbox()],
});
