import { getAuthTables } from "@better-auth/core/db";
import { memoryAdapter, type MemoryDB } from "@better-auth/memory-adapter";
import { betterAuth } from "better-auth";
import { describe, expect, it } from "vitest";
import {
  deleteMemberData,
  deleteOrganizationData,
  type ExportedNotification,
  exportNotificationsData,
} from "./data";
import type { Notification, NotificationDelivery } from "./schema";
import { createTestAuthWithOrg, signUpUser } from "./test-utils";

// every notification gets a held email delivery, so cleanup has rows to orphan
const withDeliveries = {
  channels: { email: { deliver: async () => {} } },
  routes: {
    "*": [
      {
        channel: "email",
        ifUnreadAfter: { minutes: 10 },
        sendNowIfAway: false,
      },
    ],
  },
};

async function setup() {
  const auth = createTestAuthWithOrg(withDeliveries);
  const alice = await signUpUser(auth, "alice@example.com");
  const bob = await signUpUser(auth, "bob@example.com");
  const carol = await signUpUser(auth, "carol@example.com");

  const createOrg = async (slug: string) => {
    const org = await auth.api.createOrganization({
      headers: alice.headers,
      body: { name: slug, slug },
    });
    if (!org) throw new Error("org creation failed");
    for (const member of [bob, carol]) {
      await auth.api.addMember({
        body: { userId: member.user.id, organizationId: org.id, role: "member" },
      });
    }
    await auth.api.notify({
      body: { organizationId: org.id, type: "org.update", title: slug },
    });
    return org;
  };
  const acme = await createOrg("acme");
  const globex = await createOrg("globex");
  // a personal notification, outside any organization
  await auth.api.notify({
    body: { userId: bob.user.id, type: "personal", title: "hi" },
  });

  const rows = async () => {
    const { adapter } = await auth.$context;
    const notifications = await adapter.findMany<Notification>({
      model: "notification",
    });
    const deliveries = await adapter.findMany<NotificationDelivery>({
      model: "notificationDelivery",
    });
    const ids = new Set(notifications.map((n) => n.id));
    return {
      notifications,
      orphans: deliveries.filter((d) => !ids.has(d.notificationId)),
      deliveries,
      of: (orgId: string, userId?: string) =>
        notifications.filter(
          (n) =>
            n.organizationId === orgId && (!userId || n.userId === userId),
        ),
    };
  };
  return { auth, alice, bob, carol, acme, globex, rows };
}

describe("organization cleanup", () => {
  it("deleting an organization drops its notifications and deliveries", async () => {
    const { auth, alice, acme, globex, rows } = await setup();
    expect((await rows()).deliveries).toHaveLength(7);

    await auth.api.deleteOrganization({
      headers: alice.headers,
      body: { organizationId: acme.id },
    });

    const after = await rows();
    expect(after.of(acme.id)).toHaveLength(0);
    expect(after.of(globex.id)).toHaveLength(3);
    expect(after.notifications.filter((n) => !n.organizationId)).toHaveLength(1);
    expect(after.deliveries).toHaveLength(4);
    expect(after.orphans).toEqual([]);
  });

  it("removing a member drops only their notifications in that org", async () => {
    const { auth, alice, bob, acme, globex, rows } = await setup();

    await auth.api.removeMember({
      headers: alice.headers,
      body: { memberIdOrEmail: "bob@example.com", organizationId: acme.id },
    });

    const after = await rows();
    expect(after.of(acme.id, bob.user.id)).toHaveLength(0);
    expect(after.of(acme.id)).toHaveLength(2);
    expect(after.of(globex.id, bob.user.id)).toHaveLength(1);
    expect(after.notifications.filter((n) => !n.organizationId)).toHaveLength(1);
    expect(after.orphans).toEqual([]);
  });

  it("leaving an organization drops the leaver's notifications in it", async () => {
    const { auth, carol, acme, globex, rows } = await setup();

    await auth.api.leaveOrganization({
      headers: carol.headers,
      body: { organizationId: acme.id },
    });

    const after = await rows();
    expect(after.of(acme.id, carol.user.id)).toHaveLength(0);
    expect(after.of(acme.id)).toHaveLength(2);
    expect(after.of(globex.id, carol.user.id)).toHaveLength(1);
    expect(after.orphans).toEqual([]);
  });

  it("leaves everything alone when the org endpoint fails", async () => {
    const { auth, bob, acme, rows } = await setup();

    // bob is a plain member, so he may not delete the org
    await expect(
      auth.api.deleteOrganization({
        headers: bob.headers,
        body: { organizationId: acme.id },
      }),
    ).rejects.toThrow();

    expect((await rows()).of(acme.id)).toHaveLength(3);
  });
});

describe("deleteOrganizationData / deleteMemberData", () => {
  it("delete an org's or one member's rows without touching the rest", async () => {
    const { auth, bob, acme, globex, rows } = await setup();

    expect(
      await deleteMemberData(auth, {
        userId: bob.user.id,
        organizationId: globex.id,
      }),
    ).toEqual({ notifications: 1 });
    expect(await deleteOrganizationData(auth, acme.id)).toEqual({
      notifications: 3,
    });

    const after = await rows();
    expect(after.of(acme.id)).toHaveLength(0);
    expect(after.of(globex.id)).toHaveLength(2);
    expect(after.notifications.filter((n) => !n.organizationId)).toHaveLength(1);
    expect(after.orphans).toEqual([]);
  });

  it("throws when the inbox plugin isn't installed", async () => {
    const options = {
      baseURL: "http://localhost:3000",
      secret: "test-secret-0123456789-0123456789",
    };
    const db = Object.keys(getAuthTables(options)).reduce<MemoryDB>(
      (acc, table) => ({ ...acc, [table]: [] }),
      {},
    );
    const auth = betterAuth({ ...options, database: memoryAdapter(db) });

    await expect(deleteOrganizationData(auth, "org")).rejects.toThrow(
      /needs the inbox plugin/,
    );
  });
});

describe("exportNotificationsData", () => {
  it("pages through every notification with deliveries and the user's email", async () => {
    const { auth, rows } = await setup();
    const exported: ExportedNotification[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await exportNotificationsData(auth, { cursor, limit: 2 });
      exported.push(...page.notifications);
      cursor = page.cursor;
      pages++;
    } while (cursor);

    const { notifications, deliveries } = await rows();
    expect(pages).toBe(4);
    expect(exported.map((n) => n.id).sort()).toEqual(
      notifications.map((n) => n.id).sort(),
    );
    expect(exported.flatMap((n) => n.deliveries)).toHaveLength(
      deliveries.length,
    );
    const bobs = exported.find((n) => n.type === "personal");
    expect(bobs).toMatchObject({
      userEmail: "bob@example.com",
      title: "hi",
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      deliveries: [
        {
          channel: "email",
          status: "pending",
          scheduledFor: expect.stringMatching(/^\d{4}-/),
        },
      ],
    });
    // plain JSON: nothing is lost in a round trip
    expect(JSON.parse(JSON.stringify(exported))).toEqual(exported);
  });

  it("exports one organization's notifications", async () => {
    const { auth, acme } = await setup();

    const page = await exportNotificationsData(auth, {
      organizationId: acme.id,
    });

    expect(page.cursor).toBeNull();
    expect(page.notifications).toHaveLength(3);
    expect(
      page.notifications.every((n) => n.organizationId === acme.id),
    ).toBe(true);
    expect(page.notifications.map((n) => n.userEmail).sort()).toEqual([
      "alice@example.com",
      "bob@example.com",
      "carol@example.com",
    ]);
  });
});
