import {
  getCurrentAdapter,
  runWithTransaction,
} from "@better-auth/core/context";
import { getAuthTables } from "@better-auth/core/db";
import { memoryAdapter, type MemoryDB } from "@better-auth/memory-adapter";
import { betterAuth } from "better-auth";
import { describe, expect, it } from "vitest";
import {
  type AuthWithContext,
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

type Fixture = Awaited<ReturnType<typeof setup>>;

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

  // how SCIM deprovisioning calls them: the member row is deleted inside the
  // directory's transaction, and the cleanup has to ride along with it
  describe("inside a better-auth transaction", () => {
    const removeBobFromAcme = async ({ auth, bob, acme }: Fixture) => {
      const trx = await getCurrentAdapter((await auth.$context).adapter);
      await trx.deleteMany({
        model: "member",
        where: [
          { field: "userId", value: bob.user.id },
          { field: "organizationId", value: acme.id },
        ],
      });
      await deleteMemberData(auth, {
        userId: bob.user.id,
        organizationId: acme.id,
      });
    };
    const bobInAcme = async ({ auth, bob, acme }: Fixture) => {
      const { adapter } = await auth.$context;
      return adapter.count({
        model: "member",
        where: [
          { field: "userId", value: bob.user.id },
          { field: "organizationId", value: acme.id },
        ],
      });
    };

    it("commits with the caller's transaction", async () => {
      const fixture = await setup();
      const { auth, bob, acme, rows } = fixture;

      await runWithTransaction((await auth.$context).adapter, () =>
        removeBobFromAcme(fixture),
      );

      expect(await bobInAcme(fixture)).toBe(0);
      const after = await rows();
      expect(after.of(acme.id, bob.user.id)).toHaveLength(0);
      expect(after.of(acme.id)).toHaveLength(2);
      expect(after.orphans).toEqual([]);
    });

    it("rolls back with the caller's transaction", async () => {
      const fixture = await setup();
      const { auth, bob, acme, rows } = fixture;

      await expect(
        runWithTransaction((await auth.$context).adapter, async () => {
          await removeBobFromAcme(fixture);
          throw new Error("directory write failed");
        }),
      ).rejects.toThrow("directory write failed");

      expect(await bobInAcme(fixture)).toBe(1);
      const after = await rows();
      expect(after.of(acme.id, bob.user.id)).toHaveLength(1);
      expect(after.deliveries).toHaveLength(7);
    });

    it("rolls back an organization's delete too", async () => {
      const { auth, acme, rows } = await setup();

      await expect(
        runWithTransaction((await auth.$context).adapter, async () => {
          await deleteOrganizationData(auth, acme.id);
          throw new Error("delete failed");
        }),
      ).rejects.toThrow("delete failed");

      const after = await rows();
      expect(after.of(acme.id)).toHaveLength(3);
      expect(after.deliveries).toHaveLength(7);
    });
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

describe("exportNotificationsData paging", () => {
  // localeCompare puts "a" before "B"; code-point order puts "B" first. The
  // cursor must not depend on which one the adapter uses.
  const ids = [
    "b", "A", "a_1", "a-1", "Z", "a", "B2", "b10", "_x", "-y", "c", "C",
  ];
  // four rows share each timestamp, so pages end inside a tie
  const at = (i: number) =>
    new Date(Date.UTC(2026, 0, 1, 0, 0, 0, Math.floor(i / 4)));

  async function seed(
    auth: Awaited<ReturnType<typeof setup>>["auth"],
    userId: string,
  ) {
    const { adapter } = await auth.$context;
    for (const [i, id] of ids.entries()) {
      await adapter.create({
        model: "notification",
        forceAllowId: true,
        data: {
          id,
          userId,
          organizationId: "paging",
          type: "bulk",
          title: id,
          read: false,
          createdAt: at(i),
        },
      });
    }
  }

  async function exportAll(
    auth: AuthWithContext,
    limit: number,
    afterFirstPage?: (exported: string[]) => Promise<void>,
  ) {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await exportNotificationsData(auth, {
        organizationId: "paging",
        cursor,
        limit,
      });
      seen.push(...page.notifications.map((n) => n.id));
      cursor = page.cursor;
      if (++pages === 1) await afterFirstPage?.(seen);
    } while (cursor);
    return { seen, pages };
  }

  it("sorts the test ids differently under localeCompare and code-point order", () => {
    expect([...ids].sort((a, b) => a.localeCompare(b))).not.toEqual(
      [...ids].sort(),
    );
  });

  it("does not skip a row when one is deleted between pages", async () => {
    const { auth, alice } = await setup();
    await seed(auth, alice.user.id);
    const { adapter } = await auth.$context;

    const { seen, pages } = await exportAll(auth, 2, async (exported) => {
      // a row on the first page goes; an offset cursor would now skip one
      await adapter.deleteMany({
        model: "notification",
        where: [{ field: "id", value: exported[0] ?? "" }],
      });
    });

    expect(pages).toBeGreaterThan(1);
    // the deleted row was exported before it went, so it appears once
    expect(seen.sort()).toEqual([...ids].sort());
  });

  it("exports every id once, across pages of any size", async () => {
    const { auth, alice } = await setup();
    await seed(auth, alice.user.id);

    for (const limit of [1, 3, 5, ids.length]) {
      const { seen } = await exportAll(auth, limit);
      expect(seen.sort()).toEqual([...ids].sort());
    }
  });

  it("rejects an offset cursor from 0.8.x", async () => {
    const { auth, alice } = await setup();
    await seed(auth, alice.user.id);

    await expect(
      exportNotificationsData(auth, { organizationId: "paging", cursor: "4" }),
    ).rejects.toThrow(/earlier release/);
  });
});

describe("edges", () => {
  it("rejects an empty organizationId, a bad limit and a bad cursor", async () => {
    const { auth } = await setup();
    await expect(
      exportNotificationsData(auth, { organizationId: "" }),
    ).rejects.toThrow(/organizationId is empty/);
    for (const limit of [0, -1, 1.5, 1001]) {
      await expect(exportNotificationsData(auth, { limit })).rejects.toThrow(
        /limit must be/,
      );
    }
    await expect(
      exportNotificationsData(auth, { cursor: "abc" }),
    ).rejects.toThrow(/invalid cursor/);
  });

  it("deletes and exports past one page of ids", async () => {
    const { auth, alice, rows } = await setup();
    const { adapter } = await auth.$context;
    for (let i = 0; i < 200; i++) {
      const n = await adapter.create<any, { id: string }>({
        model: "notification",
        data: {
          userId: alice.user.id,
          organizationId: "bulk",
          type: "bulk",
          title: `n${i}`,
          read: false,
          createdAt: new Date(),
        },
      });
      await adapter.create({
        model: "notificationDelivery",
        data: {
          notificationId: n.id,
          userId: alice.user.id,
          type: "bulk",
          channel: "email",
          status: "pending",
          scheduledFor: new Date(),
          attempts: 0,
          createdAt: new Date(),
        },
      });
    }

    const page = await exportNotificationsData(auth, {
      organizationId: "bulk",
      limit: 1000,
    });
    expect(page.notifications).toHaveLength(200);
    expect(page.notifications.every((n) => n.deliveries.length === 1)).toBe(
      true,
    );

    expect(await deleteOrganizationData(auth, "bulk")).toEqual({
      notifications: 200,
    });
    const after = await rows();
    expect(after.of("bulk")).toHaveLength(0);
    expect(after.orphans).toEqual([]);
  });

  it("removes a deleted user's rows on an adapter without foreign keys", async () => {
    const { auth, bob, rows } = await setup();
    const context = await auth.$context;
    await auth.api.unreadCount({ headers: bob.headers, query: {} });

    await context.internalAdapter.deleteUser(bob.user.id);

    const after = await rows();
    expect(after.notifications.filter((n) => n.userId === bob.user.id)).toEqual(
      [],
    );
    expect(after.deliveries.filter((d) => d.userId === bob.user.id)).toEqual([]);
    expect(
      await context.adapter.findMany({
        model: "inboxPresence",
        where: [{ field: "userId", value: bob.user.id }],
      }),
    ).toEqual([]);
  });

  it("keeps a leaver's notifications with organizationCleanup: false", async () => {
    const auth = createTestAuthWithOrg({ organizationCleanup: false });
    const alice = await signUpUser(auth, "alice@example.com");
    const bob = await signUpUser(auth, "bob@example.com");
    const org = await auth.api.createOrganization({
      headers: alice.headers,
      body: { name: "Acme", slug: "acme" },
    });
    await auth.api.addMember({
      body: { userId: bob.user.id, organizationId: org!.id, role: "member" },
    });
    await auth.api.notify({
      body: { organizationId: org!.id, type: "x", title: "x" },
    });

    await auth.api.leaveOrganization({
      headers: bob.headers,
      body: { organizationId: org!.id },
    });

    const list = await auth.api.listNotifications({
      headers: bob.headers,
      query: {},
    });
    expect(list.notifications).toHaveLength(1);
  });
});
