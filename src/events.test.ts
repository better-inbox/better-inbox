import { readFileSync } from "node:fs";
import { runWithTransaction } from "@better-auth/core/context";
import type { ByoEvent, ByoEventHandler, ByoSweepResult } from "@byo-oss/core";
import type { BetterAuthOptions } from "better-auth";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { DeliveryContext, InboxChannel, SweepResult } from "./delivery";
import {
  type DeliveryFailedEvent,
  inbox,
  type InboxOptions,
  NOTIFICATIONS_EVENT_TYPES,
  type NotificationCreatedEvent,
  type NotificationsEvent,
  PermanentDeliveryError,
} from "./index";
import type { Notification, NotificationDelivery } from "./schema";
import {
  createTestAuth,
  createTestAuthWithOrg,
  signUpUser,
} from "./test-utils";

const MINUTE = 60_000;

type AnyAuth = { $context: Promise<any>; api: any };

const inTransaction = async (auth: AnyAuth, fn: () => Promise<unknown>) =>
  runWithTransaction((await auth.$context).adapter, fn);

/** onEvent that records every event, plus a shared order log. */
function recorder(order: string[] = []) {
  const events: NotificationsEvent[] = [];
  const onEvent = vi.fn(async (event: ByoEvent) => {
    events.push(event as NotificationsEvent);
    order.push("handler");
  });
  return { events, onEvent, order };
}

/** better-auth logger options that capture every line. */
function captureLogs() {
  const lines: string[] = [];
  const logger = {
    log: (_level: string, message: string) => {
      lines.push(message);
    },
  } satisfies BetterAuthOptions["logger"];
  const onEventFailures = (type?: string) =>
    lines.filter((line) =>
      line.includes(`onEvent failed${type ? ` for ${type}` : ""}`),
    ).length;
  return { lines, logger, onEventFailures };
}

function fakeChannel(error?: Error) {
  const sent: DeliveryContext[] = [];
  const channel = {
    deliver: vi.fn(async (ctx: DeliveryContext) => {
      if (error) throw error;
      sent.push(ctx);
    }),
  } satisfies InboxChannel;
  return { channel, sent };
}

const shipped = { type: "order.shipped", title: "Your order shipped" };

/** Email on every order.shipped, sent by the sweep (no background handler). */
const emailOptions = (
  channel: InboxChannel,
  extra: Partial<InboxOptions> = {},
): InboxOptions => ({
  channels: { email: channel },
  routes: { "order.shipped": [{ channel: "email" }] },
  ...extra,
});

async function rows<T>(auth: AnyAuth, model: string): Promise<T[]> {
  return (await auth.$context).adapter.findMany({ model });
}

async function orgWithMembers(
  auth: AnyAuth,
  emails: string[],
): Promise<{
  org: { id: string };
  users: Awaited<ReturnType<typeof signUpUser>>[];
}> {
  const users = [];
  for (const email of emails) users.push(await signUpUser(auth, email));
  const org = await auth.api.createOrganization({
    headers: users[0]!.headers,
    body: { name: "Acme", slug: `acme-${Math.random().toString(36).slice(2)}` },
  });
  for (const user of users.slice(1)) {
    await auth.api.addMember({
      body: { userId: user.user.id, organizationId: org.id, role: "member" },
    });
  }
  return { org, users };
}

/** Puts every delivery into "sending" with a lease older than five minutes. */
async function makeStale(auth: AnyAuth, attempts: number) {
  const { adapter } = await auth.$context;
  await adapter.updateMany({
    model: "notificationDelivery",
    where: [],
    update: {
      status: "sending",
      claimedAt: new Date(Date.now() - 6 * MINUTE),
      attempts,
    },
  });
}

describe("types", () => {
  it("onEvent is a ByoEventHandler and every event is a ByoEvent", () => {
    expectTypeOf<InboxOptions["onEvent"]>().toEqualTypeOf<
      ByoEventHandler | undefined
    >();
    expectTypeOf<NotificationCreatedEvent>().toExtend<ByoEvent>();
    expectTypeOf<DeliveryFailedEvent>().toExtend<ByoEvent>();
    expectTypeOf<NotificationsEvent>().toExtend<ByoEvent>();
    expectTypeOf<SweepResult>().toExtend<ByoSweepResult>();
    expectTypeOf(NOTIFICATIONS_EVENT_TYPES).toEqualTypeOf<
      readonly [
        "notifications.notification.created",
        "notifications.delivery.failed",
      ]
    >();
    expectTypeOf<NotificationsEvent["type"]>().toEqualTypeOf<
      (typeof NOTIFICATIONS_EVENT_TYPES)[number]
    >();
  });
});

describe("after commit", () => {
  it("never calls the handler when the caller's transaction rolls back (single)", async () => {
    const { onEvent } = recorder();
    const auth = createTestAuth({ onEvent });
    const alice = await signUpUser(auth, "alice@example.com");

    await expect(
      inTransaction(auth, async () => {
        await auth.api.notify({ body: { userId: alice.user.id, ...shipped } });
        throw new Error("checkout failed");
      }),
    ).rejects.toThrow("checkout failed");

    expect(onEvent).not.toHaveBeenCalled();
    expect(await rows(auth, "notification")).toHaveLength(0);
  });

  it("never calls the handler when the caller's transaction rolls back (org fan-out)", async () => {
    const { onEvent } = recorder();
    const auth = createTestAuthWithOrg({ onEvent });
    const { org } = await orgWithMembers(auth, [
      "alice@example.com",
      "bob@example.com",
    ]);

    await expect(
      inTransaction(auth, async () => {
        await auth.api.notify({ body: { organizationId: org.id, ...shipped } });
        throw new Error("checkout failed");
      }),
    ).rejects.toThrow("checkout failed");

    expect(onEvent).not.toHaveBeenCalled();
    expect(await rows(auth, "notification")).toHaveLength(0);
  });

  it("calls the handler once, after a committed transaction resolves", async () => {
    const order: string[] = [];
    let found: Notification | null = null;
    const events: NotificationsEvent[] = [];
    let auth: ReturnType<typeof createTestAuth>;
    const onEvent = vi.fn(async (event: ByoEvent) => {
      events.push(event as NotificationsEvent);
      order.push("handler");
      // a base-adapter read: the row is visible only once committed
      found = await (await auth.$context).adapter.findOne<Notification>({
        model: "notification",
        where: [{ field: "id", value: event.subject.id }],
      });
    });
    auth = createTestAuth({ onEvent });
    const alice = await signUpUser(auth, "alice@example.com");

    await inTransaction(auth, async () => {
      await auth.api.notify({ body: { userId: alice.user.id, ...shipped } });
      expect(onEvent).toHaveBeenCalledTimes(0);
      order.push("fn-end");
    });
    expect(order).toEqual(["fn-end", "handler"]);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(found).toMatchObject({ id: events[0]!.subject.id, ...shipped });
  });

  it("calls the handler before notify returns outside a transaction", async () => {
    const { onEvent, order } = recorder();
    const auth = createTestAuth({ onEvent });
    const alice = await signUpUser(auth, "alice@example.com");

    await auth.api.notify({ body: { userId: alice.user.id, ...shipped } });
    order.push("returned");

    expect(order).toEqual(["handler", "returned"]);
  });

  it("reports a permanent failure before processDeliveries returns", async () => {
    const { onEvent, events, order } = recorder();
    const { channel } = fakeChannel(new PermanentDeliveryError("hard bounce"));
    const auth = createTestAuth(emailOptions(channel, { onEvent }));
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.notify({ body: { userId: alice.user.id, ...shipped } });
    order.length = 0;

    expect(await auth.api.processDeliveries({})).toMatchObject({ failed: 1 });
    order.push("returned");

    expect(order).toEqual(["handler", "returned"]);
    const failed = events.filter(
      (e) => e.type === "notifications.delivery.failed",
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]!.data).toMatchObject({
      reason: "permanent",
      attempts: 1,
      channel: "email",
    });
  });

  it("reports a failure that ran out of attempts", async () => {
    const { onEvent, events } = recorder();
    const { channel } = fakeChannel(new Error("smtp down"));
    const auth = createTestAuth(
      emailOptions(channel, { onEvent, maxAttempts: 1 }),
    );
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.notify({ body: { userId: alice.user.id, ...shipped } });

    await auth.api.processDeliveries({});

    const failed = events.filter(
      (e) => e.type === "notifications.delivery.failed",
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]!.data).toMatchObject({
      reason: "max_attempts",
      attempts: 1,
    });
  });
});

describe("a failing handler", () => {
  const handlers: [string, ByoEventHandler][] = [
    [
      "throws",
      () => {
        throw new Error("handler threw");
      },
    ],
    [
      "rejects",
      async () => {
        throw new Error("handler rejected");
      },
    ],
  ];

  async function notifyFlow(onEvent: ByoEventHandler, transaction: boolean) {
    const logs = captureLogs();
    const auth = createTestAuth({ onEvent }, { logger: logs.logger });
    const alice = await signUpUser(auth, "alice@example.com");
    const send = () =>
      auth.api.notify({ body: { userId: alice.user.id, ...shipped } });
    if (transaction) await inTransaction(auth, send);
    else await send();
    expect(await rows(auth, "notification")).toHaveLength(1);
    expect(logs.onEventFailures("notifications.notification.created")).toBe(1);
  }

  async function sweepFlow(onEvent: ByoEventHandler, transaction: boolean) {
    const logs = captureLogs();
    const { channel } = fakeChannel(new PermanentDeliveryError("hard bounce"));
    const auth = createTestAuth(emailOptions(channel, { onEvent }), {
      logger: logs.logger,
    });
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.notify({ body: { userId: alice.user.id, ...shipped } });
    const sweep = () => auth.api.processDeliveries({});
    const result = transaction
      ? await inTransaction(auth, sweep)
      : await sweep();
    expect(result).toMatchObject({ failed: 1 });
    expect(await rows(auth, "notificationDelivery")).toMatchObject([
      { status: "failed" },
    ]);
    expect(logs.onEventFailures("notifications.delivery.failed")).toBe(1);
  }

  it.each(handlers)("that %s never fails notify outside a transaction", async (_, h) =>
    notifyFlow(h, false),
  );
  it.each(handlers)("that %s never fails notify in a committed transaction", async (_, h) =>
    notifyFlow(h, true),
  );
  it.each(handlers)("that %s never fails processDeliveries outside a transaction", async (_, h) =>
    sweepFlow(h, false),
  );
  it.each(handlers)("that %s never fails processDeliveries in a committed transaction", async (_, h) =>
    sweepFlow(h, true),
  );

  it("never fails notify or a sweep when the logger throws too", async () => {
    const onEvent = () => {
      throw new Error("handler threw");
    };
    // throws only on emit's report, so the rest of the plugin logs as usual
    const logger = {
      log: (_level: string, message: string) => {
        if (message.includes("onEvent failed")) throw new Error("logger threw");
      },
    } satisfies BetterAuthOptions["logger"];
    const { channel } = fakeChannel(new PermanentDeliveryError("hard bounce"));
    const auth = createTestAuth(emailOptions(channel, { onEvent }), { logger });
    const alice = await signUpUser(auth, "alice@example.com");

    await auth.api.notify({ body: { userId: alice.user.id, ...shipped } });
    await inTransaction(auth, () =>
      auth.api.notify({ body: { userId: alice.user.id, ...shipped } }),
    );
    expect(await auth.api.processDeliveries({})).toMatchObject({ failed: 2 });
    expect(await rows(auth, "notification")).toHaveLength(2);
  });
});

describe("event shape", () => {
  it("emits one event per row, addressed to the recipient, with no content", async () => {
    const { onEvent, events } = recorder();
    const { channel } = fakeChannel(
      new PermanentDeliveryError("mailbox carol-secret@example.com unknown"),
    );
    const auth = createTestAuthWithOrg(emailOptions(channel, { onEvent }));
    const { org, users } = await orgWithMembers(auth, [
      "alice@example.com",
      "bob@example.com",
    ]);
    const [alice, bob] = users;
    const secret = {
      title: "title-secret",
      body: "body-secret",
      href: "/reset?token=href-secret",
      data: { token: "data-secret" },
    };

    await auth.api.notify({
      body: { userId: alice!.user.id, type: "order.shipped", ...secret },
    });
    await auth.api.notify({
      body: {
        userId: bob!.user.id,
        organizationId: org.id,
        type: "order.shipped",
        ...secret,
      },
    });
    await auth.api.notify({
      body: { organizationId: org.id, type: "order.shipped", ...secret },
    });
    await auth.api.processDeliveries({});

    const notifications = await rows<Notification>(auth, "notification");
    const created = events.filter(
      (e) => e.type === "notifications.notification.created",
    );
    // user, member of org, and a two-member fan-out
    expect(created).toHaveLength(4);
    expect(created.map((e) => e.subject.id).sort()).toEqual(
      notifications.map((n) => n.id).sort(),
    );
    for (const event of created) {
      const row = notifications.find((n) => n.id === event.subject.id)!;
      expect(event).toEqual({
        type: "notifications.notification.created",
        occurredAt: new Date(row.createdAt),
        actorId: null,
        userId: row.userId,
        ...(row.organizationId ? { organizationId: row.organizationId } : {}),
        subject: { type: "notification", id: row.id },
        data: { notificationId: row.id, notificationType: "order.shipped" },
      });
    }
    expect(created.filter((e) => e.organizationId === org.id)).toHaveLength(3);
    expect(created.filter((e) => e.organizationId === undefined)).toHaveLength(1);

    const deliveries = await rows<NotificationDelivery>(
      auth,
      "notificationDelivery",
    );
    const failed = events.filter(
      (e): e is DeliveryFailedEvent => e.type === "notifications.delivery.failed",
    );
    expect(failed).toHaveLength(4);
    for (const event of failed) {
      const delivery = deliveries.find((d) => d.id === event.subject.id)!;
      const row = notifications.find((n) => n.id === delivery.notificationId)!;
      expect(event).toMatchObject({
        actorId: null,
        userId: delivery.userId,
        subject: { type: "notificationDelivery", id: delivery.id },
        data: {
          deliveryId: delivery.id,
          notificationId: row.id,
          notificationType: "order.shipped",
          channel: "email",
          attempts: 1,
          reason: "permanent",
        },
      });
      expect(event.organizationId).toBe(row.organizationId ?? undefined);
    }

    const json = JSON.stringify(events);
    for (const leaked of [
      "title-secret",
      "body-secret",
      "href-secret",
      "data-secret",
      "carol-secret",
    ]) {
      expect(json).not.toContain(leaked);
    }
  });
});

describe("stale leases", () => {
  async function seed(count: number, extra: Partial<InboxOptions> = {}) {
    const { onEvent, events } = recorder();
    const { channel } = fakeChannel();
    const auth = createTestAuthWithOrg(
      emailOptions(channel, { onEvent, maxAttempts: 2, ...extra }),
    );
    const { org, users } = await orgWithMembers(auth, ["alice@example.com"]);
    for (let i = 0; i < count; i++) {
      await auth.api.notify({
        body: { userId: users[0]!.user.id, organizationId: org.id, ...shipped },
      });
    }
    events.length = 0;
    return { auth, org, events, onEvent };
  }
  const unfinished = (events: NotificationsEvent[]) =>
    events.filter(
      (e) =>
        e.type === "notifications.delivery.failed" &&
        e.data.reason === "unfinished",
    );

  it("fails an exhausted stale lease once, with an event", async () => {
    const { auth, org, events } = await seed(1);
    await makeStale(auth, 2);

    expect(await auth.api.processDeliveries({})).toMatchObject({
      hasMore: false,
    });
    expect(unfinished(events)).toHaveLength(1);
    expect(events[0]).toMatchObject({
      organizationId: org.id,
      data: { attempts: 2, reason: "unfinished" },
    });
    expect(await rows(auth, "notificationDelivery")).toMatchObject([
      { status: "failed", detail: "send did not finish" },
    ]);

    await auth.api.processDeliveries({});
    expect(events).toHaveLength(1);
    expect(await rows(auth, "notificationDelivery")).toMatchObject([
      { status: "failed" },
    ]);
  });

  it("re-pends a stale lease with attempts left, without an event", async () => {
    const { auth, events } = await seed(1);
    await makeStale(auth, 1);

    const { adapter } = await auth.$context;
    // re-pended, then claimed and sent by the same sweep
    const sweep = await auth.api.processDeliveries({});
    expect(unfinished(events)).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(sweep).toMatchObject({ sent: 1 });
    expect(
      await adapter.findMany({ model: "notificationDelivery" }),
    ).toMatchObject([{ status: "sent", attempts: 2 }]);
  });

  it("examines at most `limit` exhausted leases per sweep", async () => {
    const { auth, events } = await seed(3);
    await makeStale(auth, 2);

    expect(await auth.api.processDeliveries({ body: { limit: 2 } })).toMatchObject(
      { hasMore: true },
    );
    expect(unfinished(events)).toHaveLength(2);
    const statuses = (await rows<NotificationDelivery>(auth, "notificationDelivery"))
      .map((d) => d.status)
      .sort();
    // the third stays "sending", never re-pended past maxAttempts
    expect(statuses).toEqual(["failed", "failed", "sending"]);

    expect(await auth.api.processDeliveries({ body: { limit: 2 } })).toMatchObject(
      { hasMore: false },
    );
    expect(unfinished(events)).toHaveLength(3);
  });

  it("doesn't report hasMore when the capped page moved nothing", async () => {
    const { auth, events } = await seed(3, { batchSize: 2 });
    await makeStale(auth, 2);
    const { adapter } = await auth.$context;
    // row-level security, say: the guarded update matches nothing
    const updateMany = adapter.updateMany;
    adapter.updateMany = async () => 0;
    try {
      expect(await auth.api.processDeliveries({})).toMatchObject({
        hasMore: false,
      });
    } finally {
      adapter.updateMany = updateMany;
    }
    expect(events).toHaveLength(0);
    expect(
      (await rows<NotificationDelivery>(auth, "notificationDelivery")).map(
        (d) => d.status,
      ),
    ).toEqual(["sending", "sending", "sending"]);
  });

  it("emits once when two sweeps race for one exhausted lease", async () => {
    const { auth, events } = await seed(1);
    await makeStale(auth, 2);
    const { adapter } = await auth.$context;
    // hold both sweeps after they've read the stale row, so both try to move it
    const findMany = adapter.findMany;
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    adapter.findMany = (async (args: any) => {
      const result = await findMany(args);
      const exhaustedQuery =
        args.model === "notificationDelivery" &&
        args.where?.some(
          (w: { field: string; operator?: string }) =>
            w.field === "attempts" && w.operator === "gte",
        );
      if (exhaustedQuery && arrived < 2) {
        arrived++;
        if (arrived === 2) release();
        await barrier;
      }
      return result;
    }) as typeof findMany;
    try {
      await Promise.all([
        auth.api.processDeliveries({}),
        auth.api.processDeliveries({}),
      ]);
    } finally {
      adapter.findMany = findMany;
    }
    expect(arrived).toBe(2);
    expect(unfinished(events)).toHaveLength(1);
  });
});

describe("loop guard", () => {
  it("rejects a forwarder that sends the plugin's own events back into notify", async () => {
    const logs = captureLogs();
    let auth: ReturnType<typeof createTestAuth>;
    const onEvent = vi.fn(async (event: ByoEvent) => {
      await auth.api.notify({
        body: { userId: event.userId!, type: event.type, title: "x" },
      });
    });
    auth = createTestAuth({ onEvent }, { logger: logs.logger });
    const alice = await signUpUser(auth, "alice@example.com");

    await auth.api.notify({ body: { userId: alice.user.id, ...shipped } });

    expect(await rows(auth, "notification")).toHaveLength(1);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(logs.onEventFailures()).toBe(1);
  });

  it("rejects a notifications.* type in notify", async () => {
    const auth = createTestAuth();
    const alice = await signUpUser(auth, "alice@example.com");
    await expect(
      auth.api.notify({
        body: { userId: alice.user.id, type: "notifications.x", title: "x" },
      }),
    ).rejects.toMatchObject({
      status: "BAD_REQUEST",
      body: { code: "RESERVED_NOTIFICATION_TYPE" },
    });
  });

  it("rejects a notifications.* route at boot", () => {
    const { channel } = fakeChannel();
    expect(() =>
      inbox({
        channels: { email: channel },
        routes: { "notifications.x": [{ channel: "email" }] },
      }),
    ).toThrow(
      '[@byo-oss/notifications] routes["notifications.x"] uses a reserved type',
    );
  });
});

describe("event types", () => {
  it("a flow emits exactly NOTIFICATIONS_EVENT_TYPES", async () => {
    const { onEvent, events } = recorder();
    const { channel } = fakeChannel(new PermanentDeliveryError("hard bounce"));
    const auth = createTestAuth(emailOptions(channel, { onEvent }));
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.notify({ body: { userId: alice.user.id, ...shipped } });
    await auth.api.processDeliveries({});

    expect(new Set(events.map((e) => e.type))).toEqual(
      new Set(NOTIFICATIONS_EVENT_TYPES),
    );
  });

  it.each(["README.md", "AGENTS.md", "llms.txt"])(
    "%s lists every event type",
    (file) => {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      for (const type of NOTIFICATIONS_EVENT_TYPES) {
        expect(text).toContain(type);
      }
    },
  );
});
