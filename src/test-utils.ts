import { getAuthTables } from "@better-auth/core/db";
import type { MemoryDB } from "@better-auth/memory-adapter";
import { memoryAdapter } from "@better-auth/memory-adapter";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { organization } from "better-auth/plugins";
import { inbox, type InboxOptions } from "./index";

const baseOptions = {
  baseURL: "http://localhost:3000",
  secret: "better-inbox-test-secret-0123456789",
  emailAndPassword: { enabled: true },
} satisfies Partial<BetterAuthOptions>;

function seededMemoryAdapter(options: BetterAuthOptions) {
  const tables = getAuthTables(options);
  const memoryDB = Object.keys(tables).reduce<MemoryDB>((db, table) => {
    db[table] = [];
    return db;
  }, {});
  return memoryAdapter(memoryDB);
}

export function createTestAuth(opts: InboxOptions = {}) {
  const plugins = [inbox(opts)];
  return betterAuth({
    ...baseOptions,
    plugins,
    database: seededMemoryAdapter({ ...baseOptions, plugins }),
  });
}

export function createTestAuthWithOrg(opts: InboxOptions = {}) {
  const plugins = [inbox(opts), organization()];
  return betterAuth({
    ...baseOptions,
    plugins,
    database: seededMemoryAdapter({ ...baseOptions, plugins }),
  });
}

export async function signUpUser(
  auth: { api: { signUpEmail: (input: any) => Promise<any> } },
  email: string,
) {
  const { headers, response } = await auth.api.signUpEmail({
    body: {
      email,
      password: "password-1234",
      name: email.split("@")[0] ?? email,
    },
    returnHeaders: true,
  });
  const cookie = (headers as Headers)
    .getSetCookie()
    .map((c: string) => c.split(";")[0])
    .join("; ");
  return { user: response.user, headers: new Headers({ cookie }) };
}
