// @byo-oss/core reaching the plugin through its `byo` hooks, on a real
// betterAuth with the memory adapter.
import { getAuthTables } from "@better-auth/core/db";
import { type MemoryDB, memoryAdapter } from "@better-auth/memory-adapter";
import {
  deleteMemberData,
  deleteOrganizationData,
  listByoPlugins,
  sweepAll,
} from "@byo-oss/core";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { describe, expect, it, vi } from "vitest";
import type { DeliveryContext, InboxChannel } from "./delivery";
import { inbox, type InboxOptions } from "./index";
import type { Notification, NotificationDelivery } from "./schema";
import { signUpUser } from "./test-utils";

const base = {
  baseURL: "http://localhost:3000",
  secret: "better-inbox-test-secret-0123456789",
  emailAndPassword: { enabled: true },
} satisfies Partial<BetterAuthOptions>;

function emailChannel() {
  const sent: DeliveryContext[] = [];
  const channel = {
    deliver: vi.fn(async (ctx: DeliveryContext) => {
      sent.push(ctx);
    }),
  } satisfies InboxChannel;
  return { channel, sent };
}

/**
 * inbox + organization. With `wired`, the app's organizationHooks call core's
 * fan-out, as core's README sets it up, on top of the plugin's own cleanup.
 */
function createAppAuth(options: InboxOptions = {}, wired = false) {
  const lines: string[] = [];
  const fanOuts = { organization: 0, member: 0 };
  // base-adapter reads of `notification` (counted once a test installs the
  // spy), and how many there were when each fan-out finished
  const probe = { reads: 0, atFanOutEnd: { organization: -1, member: -1 } };
  const plugins = [
    inbox(options),
    organization(
      wired
        ? {
            organizationHooks: {
              afterDeleteOrganization: async ({ organization }) => {
                fanOuts.organization++;
                await deleteOrganizationData(auth, organization.id);
                probe.atFanOutEnd.organization = probe.reads;
              },
              afterRemoveMember: async ({ member }) => {
                fanOuts.member++;
                await deleteMemberData(auth, {
                  userId: member.userId,
                  organizationId: member.organizationId,
                });
                probe.atFanOutEnd.member = probe.reads;
              },
            },
          }
        : {},
    ),
  ];
  const tables = getAuthTables({ ...base, plugins });
  const db = Object.keys(tables).reduce<MemoryDB>((acc, table) => {
    acc[table] = [];
    return acc;
  }, {});
  const auth = betterAuth({
    ...base,
    plugins,
    database: memoryAdapter(db),
    logger: { log: (_level, message) => void lines.push(message) },
  });
  return { auth, lines, fanOuts, probe };
}

type App = ReturnType<typeof createAppAuth>["auth"];

/** An org of owner + member, each with one notification and pending email. */
async function seed(auth: App) {
  const owner = await signUpUser(auth, "owner@example.com");
  const member = await signUpUser(auth, "member@example.com");
  const org = await auth.api.createOrganization({
    headers: owner.headers,
    body: { name: "Acme", slug: "acme" },
  });
  if (!org) throw new Error("no org");
  await auth.api.addMember({
    body: { userId: member.user.id, organizationId: org.id, role: "member" },
  });
  await auth.api.notify({
    body: { organizationId: org.id, type: "order.shipped", title: "Shipped" },
  });
  // and one outside the org, which no org cleanup may touch
  await auth.api.notify({
    body: { userId: member.user.id, type: "order.shipped", title: "Personal" },
  });
  return { owner, member, org };
}

async function counts(auth: App, organizationId: string) {
  const { adapter } = await auth.$context;
  const notifications = await adapter.findMany<Notification>({
    model: "notification",
  });
  const deliveries = await adapter.findMany<NotificationDelivery>({
    model: "notificationDelivery",
  });
  const inOrg = new Set(
    notifications
      .filter((n) => n.organizationId === organizationId)
      .map((n) => n.id),
  );
  return {
    org: inOrg.size,
    orgDeliveries: deliveries.filter((d) => inOrg.has(d.notificationId)).length,
    total: notifications.length,
    of: (userId: string) =>
      notifications.filter(
        (n) => n.organizationId === organizationId && n.userId === userId,
      ).length,
  };
}

const withEmail = (channel: InboxChannel): InboxOptions => ({
  channels: { email: channel },
  routes: { "order.shipped": [{ channel: "email" }] },
});

describe("byo hooks", () => {
  it("reach the plugin through sweepAll, deleteMemberData and deleteOrganizationData", async () => {
    const email = emailChannel();
    const { auth } = createAppAuth(withEmail(email.channel));
    const { member, org } = await seed(auth);

    expect(listByoPlugins(auth)).toEqual([
      {
        id: "inbox",
        hooks: ["sweep", "deleteOrganizationData", "deleteMemberData"],
      },
    ]);

    const swept = await sweepAll(auth);
    expect(swept.results[0]).toMatchObject({
      pluginId: "inbox",
      runs: 1,
      last: { sent: 3, skipped: 0, retrying: 0, failed: 0, hasMore: false },
    });
    expect(swept.hasMore).toBe(false);
    expect(email.sent).toHaveLength(3);

    expect(await counts(auth, org.id)).toMatchObject({ org: 2, orgDeliveries: 2 });
    await deleteMemberData(auth, {
      userId: member.user.id,
      organizationId: org.id,
    });
    const afterMember = await counts(auth, org.id);
    expect(afterMember).toMatchObject({ org: 1, orgDeliveries: 1, total: 2 });
    expect(afterMember.of(member.user.id)).toBe(0);

    await deleteOrganizationData(auth, org.id);
    // the member's personal notification stays
    expect(await counts(auth, org.id)).toMatchObject({
      org: 0,
      orgDeliveries: 0,
      total: 1,
    });
  });

  it("the plugin's own cleanup and core's fan-out both running is safe", async () => {
    const { auth, lines, fanOuts, probe } = createAppAuth(
      withEmail(emailChannel().channel),
      true,
    );
    const { owner, member, org } = await seed(auth);
    const { adapter } = await auth.$context;
    const findMany = adapter.findMany;
    adapter.findMany = ((args: { model: string }) => {
      if (args.model === "notification") probe.reads++;
      return findMany(args as Parameters<typeof findMany>[0]);
    }) as typeof findMany;

    await auth.api.removeMember({
      headers: owner.headers,
      body: { memberIdOrEmail: member.user.email, organizationId: org.id },
    });
    const readsAfterRemove = probe.reads;
    expect((await counts(auth, org.id)).of(member.user.id)).toBe(0);

    await auth.api.deleteOrganization({
      headers: owner.headers,
      body: { organizationId: org.id },
    });
    const readsAtEnd = probe.reads;
    expect(await counts(auth, org.id)).toMatchObject({
      org: 0,
      orgDeliveries: 0,
      total: 1,
    });
    // core's fan-out ran from the organizationHooks, then the plugin's own
    // hook: it read notifications after each fan-out had finished
    expect(fanOuts).toEqual({ organization: 1, member: 1 });
    expect(probe.atFanOutEnd.member).toBeGreaterThanOrEqual(0);
    expect(readsAfterRemove).toBeGreaterThan(probe.atFanOutEnd.member);
    expect(probe.atFanOutEnd.organization).toBeGreaterThanOrEqual(0);
    expect(readsAtEnd).toBeGreaterThan(probe.atFanOutEnd.organization);
    adapter.findMany = findMany;
    expect(lines.filter((line) => line.includes("cleanup after"))).toEqual([]);
  });

  it("calling core's cleanups twice is a no-op the second time", async () => {
    const { auth } = createAppAuth(withEmail(emailChannel().channel));
    const { member, org } = await seed(auth);
    const input = { userId: member.user.id, organizationId: org.id };

    await deleteMemberData(auth, input);
    await expect(deleteMemberData(auth, input)).resolves.toBeUndefined();
    await deleteOrganizationData(auth, org.id);
    await expect(deleteOrganizationData(auth, org.id)).resolves.toBeUndefined();
    expect(await counts(auth, org.id)).toMatchObject({ org: 0, total: 1 });
  });

  it("organizationCleanup: false leaves the cleanups out of core's fan-out", async () => {
    const { auth } = createAppAuth({
      ...withEmail(emailChannel().channel),
      organizationCleanup: false,
    });
    const { member, org } = await seed(auth);

    expect(listByoPlugins(auth)).toEqual([{ id: "inbox", hooks: ["sweep"] }]);
    await deleteMemberData(auth, {
      userId: member.user.id,
      organizationId: org.id,
    });
    await deleteOrganizationData(auth, org.id);
    expect(await counts(auth, org.id)).toMatchObject({ org: 2, total: 3 });
  });
});
