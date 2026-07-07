import { describe, expect, it } from "vitest";
import { createTestAuthWithOrg, signUpUser } from "./test-utils";

async function setupOrg() {
  const auth = createTestAuthWithOrg();
  const alice = await signUpUser(auth, "alice@example.com");
  const bob = await signUpUser(auth, "bob@example.com");
  const carol = await signUpUser(auth, "carol@example.com");

  const org = await auth.api.createOrganization({
    headers: alice.headers,
    body: { name: "Acme", slug: "acme" },
  });
  if (!org) throw new Error("org creation failed");

  await auth.api.addMember({
    body: { userId: bob.user.id, organizationId: org.id, role: "admin" },
  });
  await auth.api.addMember({
    body: { userId: carol.user.id, organizationId: org.id, role: "member" },
  });

  return { auth, alice, bob, carol, org };
}

describe("org fan-out", () => {
  it("creates one notification per member, stamped with organizationId", async () => {
    const { auth, alice, bob, carol, org } = await setupOrg();

    const res = await auth.api.notify({
      body: {
        organizationId: org.id,
        type: "billing.payment_failed",
        title: "Payment failed",
      },
    });
    expect(res.count).toBe(3);

    for (const member of [alice, bob, carol]) {
      const list = await auth.api.listNotifications({
        headers: member.headers,
        query: {},
      });
      expect(list.notifications).toHaveLength(1);
      expect(list.notifications[0]).toMatchObject({
        userId: member.user.id,
        organizationId: org.id,
        type: "billing.payment_failed",
      });
    }
  });

  it("targets only members whose role matches the roles filter", async () => {
    const { auth, alice, bob, carol, org } = await setupOrg();

    const res = await auth.api.notify({
      body: {
        organizationId: org.id,
        roles: ["owner", "admin"],
        type: "billing.payment_failed",
        title: "Admins only",
      },
    });
    expect(res.count).toBe(2); // alice (owner) + bob (admin), not carol (member)

    const carols = await auth.api.listNotifications({
      headers: carol.headers,
      query: {},
    });
    expect(carols.notifications).toHaveLength(0);

    for (const member of [alice, bob]) {
      const list = await auth.api.listNotifications({
        headers: member.headers,
        query: {},
      });
      expect(list.notifications).toHaveLength(1);
    }
  });

  it("errors cleanly on bad addressing", async () => {
    const { auth, org } = await setupOrg();

    // no matching members
    await expect(
      auth.api.notify({
        body: {
          organizationId: org.id,
          roles: ["superadmin"],
          type: "t",
          title: "x",
        },
      }),
    ).rejects.toThrow(/no matching members/);

    // neither userId nor organizationId
    await expect(
      auth.api.notify({ body: { type: "t", title: "x" } }),
    ).rejects.toThrow();

    // both userId and organizationId
    await expect(
      auth.api.notify({
        body: { userId: "u1", organizationId: org.id, type: "t", title: "x" },
      }),
    ).rejects.toThrow();
  });

  it("refuses fan-out beyond maxFanout and writes zero rows", async () => {
    const auth = createTestAuthWithOrg({ maxFanout: 2 });
    const alice = await signUpUser(auth, "alice@example.com");
    const bob = await signUpUser(auth, "bob@example.com");
    const carol = await signUpUser(auth, "carol@example.com");
    const org = await auth.api.createOrganization({
      headers: alice.headers,
      body: { name: "Acme", slug: "acme" },
    });
    if (!org) throw new Error("org creation failed");
    await auth.api.addMember({
      body: { userId: bob.user.id, organizationId: org.id, role: "member" },
    });
    await auth.api.addMember({
      body: { userId: carol.user.id, organizationId: org.id, role: "member" },
    });

    await expect(
      auth.api.notify({
        body: { organizationId: org.id, type: "t", title: "too many" },
      }),
    ).rejects.toThrow(/maxFanout/);

    for (const member of [alice, bob, carol]) {
      const list = await auth.api.listNotifications({
        headers: member.headers,
        query: {},
      });
      expect(list.notifications).toHaveLength(0);
    }
  });

  it("filters the list by organizationId", async () => {
    const { auth, alice, org } = await setupOrg();

    await auth.api.notify({
      body: { userId: alice.user.id, type: "t", title: "personal" },
    });
    await auth.api.notify({
      body: { organizationId: org.id, type: "t", title: "org-wide" },
    });

    const all = await auth.api.listNotifications({
      headers: alice.headers,
      query: {},
    });
    expect(all.notifications).toHaveLength(2);

    const orgOnly = await auth.api.listNotifications({
      headers: alice.headers,
      query: { organizationId: org.id },
    });
    expect(orgOnly.notifications).toHaveLength(1);
    expect(orgOnly.notifications[0]).toMatchObject({
      title: "org-wide",
      organizationId: org.id,
    });
  });
});
