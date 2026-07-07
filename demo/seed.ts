import Database from "better-sqlite3";
import { auth } from "./lib/auth.ts";

const PASSWORD = "demo-password-123";
const db = new Database("./demo.db");

function userByEmail(email: string): { id: string } | undefined {
  return db.prepare("SELECT id FROM user WHERE email = ?").get(email) as
    | { id: string }
    | undefined;
}

async function ensureUser(email: string, name: string): Promise<string> {
  const existing = userByEmail(email);
  if (existing) {
    console.log(`user ${email} exists (${existing.id})`);
    return existing.id;
  }
  const res = await auth.api.signUpEmail({
    body: { email, password: PASSWORD, name },
  });
  console.log(`created user ${email} (${res.user.id})`);
  return res.user.id;
}

async function main() {
  const aliceId = await ensureUser("alice@demo.dev", "Alice");
  const bobId = await ensureUser("bob@demo.dev", "Bob");

  const existingOrg = db
    .prepare("SELECT id FROM organization WHERE slug = ?")
    .get("acme") as { id: string } | undefined;

  if (existingOrg) {
    console.log(`org Acme exists (${existingOrg.id})`);
    return;
  }

  const org = await auth.api.createOrganization({
    body: { name: "Acme", slug: "acme", userId: aliceId },
  });
  if (!org) throw new Error("createOrganization returned null");
  console.log(`created org Acme (${org.id}), owner alice`);

  await auth.api.addMember({
    body: { userId: bobId, organizationId: org.id, role: "admin" },
  });
  console.log(`added bob as admin`);
}

main()
  .then(() => {
    console.log("seed complete");
    process.exit(0);
  })
  .catch((err) => {
    console.error("seed failed:", err);
    process.exit(1);
  });
