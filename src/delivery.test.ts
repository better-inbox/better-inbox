import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeliveryContext, InboxChannel } from "./delivery";
import { inbox, type InboxOptions } from "./index";
import type { NotificationDelivery } from "./schema";
import {
  createTestAuth,
  createTestAuthWithOrg,
  signUpUser,
} from "./test-utils";

const MINUTE = 60_000;

function fakeChannel() {
  const sent: DeliveryContext[] = [];
  const channel = {
    deliver: vi.fn(async (ctx: DeliveryContext) => {
      sent.push(ctx);
    }),
  } satisfies InboxChannel;
  return { channel, sent };
}

function emailAfter15(extra: Partial<InboxOptions> = {}) {
  const email = fakeChannel();
  const options = {
    appUrl: "https://app.acme.test",
    channels: { email: email.channel },
    routes: {
      "billing.payment_failed": [
        { channel: "email", ifUnreadAfter: { minutes: 15 } },
      ],
    },
    ...extra,
  } satisfies InboxOptions;
  return { email, options };
}

async function deliveries(auth: { $context: Promise<any> }) {
  const ctx = await auth.$context;
  return ctx.adapter.findMany({
    model: "notificationDelivery",
  }) as Promise<NotificationDelivery[]>;
}

const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

beforeEach(() => {
  // only Date: better-auth and the memory adapter still need real timers
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("email if unread", () => {
  it("sends on the first sweep when the user is not in the app", async () => {
    const { email, options } = emailAfter15();
    const auth = createTestAuth(options);
    const alice = await signUpUser(auth, "alice@example.com");

    await auth.api.notify({
      body: {
        userId: alice.user.id,
        type: "billing.payment_failed",
        title: "Payment failed",
        href: "/settings/billing",
      },
    });
    // no background task handler, so notify leaves the send to the sweep
    expect(email.sent).toHaveLength(0);

    const res = await auth.api.processDeliveries({});
    expect(res).toMatchObject({ sent: 1, skipped: 0, hasMore: false });
    expect(email.sent[0]).toMatchObject({
      user: { email: "alice@example.com" },
      notification: { title: "Payment failed", href: "/settings/billing" },
      appUrl: "https://app.acme.test",
    });
    expect(await deliveries(auth)).toMatchObject([
      { status: "sent", attempts: 1, channel: "email" },
    ]);
  });

  it("waits 15 minutes when the user is in the app", async () => {
    const { email, options } = emailAfter15();
    const auth = createTestAuth(options);
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.unreadCount({ headers: alice.headers, query: {} });

    await auth.api.notify({
      body: {
        userId: alice.user.id,
        type: "billing.payment_failed",
        title: "Payment failed",
      },
    });

    expect(await auth.api.processDeliveries({})).toMatchObject({ sent: 0 });
    advance(14 * MINUTE);
    expect(await auth.api.processDeliveries({})).toMatchObject({ sent: 0 });
    advance(1 * MINUTE);
    expect(await auth.api.processDeliveries({})).toMatchObject({ sent: 1 });
    expect(email.sent).toHaveLength(1);
  });

  it("treats a user whose last poll is older than the presence window as away", async () => {
    const { email, options } = emailAfter15();
    const auth = createTestAuth(options);
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.unreadCount({ headers: alice.headers, query: {} });
    advance(3 * MINUTE);

    await auth.api.notify({
      body: { userId: alice.user.id, type: "billing.payment_failed", title: "x" },
    });
    expect(await auth.api.processDeliveries({})).toMatchObject({ sent: 1 });
    expect(email.sent).toHaveLength(1);
  });

  it("skips the email when the notification is read first", async () => {
    const { email, options } = emailAfter15();
    const auth = createTestAuth(options);
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.unreadCount({ headers: alice.headers, query: {} });

    const { notifications } = await auth.api.notify({
      body: { userId: alice.user.id, type: "billing.payment_failed", title: "x" },
    });
    advance(5 * MINUTE);
    await auth.api.markRead({
      headers: alice.headers,
      body: { id: notifications[0]!.id },
    });
    advance(10 * MINUTE);

    expect(await auth.api.processDeliveries({})).toMatchObject({
      sent: 0,
      skipped: 1,
    });
    expect(email.sent).toHaveLength(0);
    expect(await deliveries(auth)).toMatchObject([
      { status: "skipped", detail: "read" },
    ]);
  });

  it("skips the email when the notification is seen first", async () => {
    const { email, options } = emailAfter15();
    const auth = createTestAuth(options);
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.unreadCount({ headers: alice.headers, query: {} });

    const { notifications } = await auth.api.notify({
      body: { userId: alice.user.id, type: "billing.payment_failed", title: "x" },
    });
    await auth.api.markSeen({
      headers: alice.headers,
      body: { ids: [notifications[0]!.id] },
    });
    advance(15 * MINUTE);

    expect(await auth.api.processDeliveries({})).toMatchObject({ skipped: 1 });
    expect(email.sent).toHaveLength(0);
    expect(await deliveries(auth)).toMatchObject([
      { status: "skipped", detail: "seen" },
    ]);
  });

  it("leaves types without a route in-app only, and falls back to \"*\"", async () => {
    const email = fakeChannel();
    const auth = createTestAuth({
      channels: { email: email.channel },
      routes: { "security.new_login": [{ channel: "email" }] },
    });
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.notify({
      body: { userId: alice.user.id, type: "comment.reply", title: "x" },
    });
    expect(await deliveries(auth)).toHaveLength(0);

    const withFallback = createTestAuth({
      channels: { email: email.channel },
      routes: { "*": [{ channel: "email" }] },
    });
    const bob = await signUpUser(withFallback, "bob@example.com");
    await withFallback.api.notify({
      body: { userId: bob.user.id, type: "comment.reply", title: "x" },
    });
    expect(await deliveries(withFallback)).toHaveLength(1);
  });

  it("sends right away, even to a present user, when the rule has no delay", async () => {
    const email = fakeChannel();
    const auth = createTestAuth({
      channels: { email: email.channel },
      routes: { "security.new_login": [{ channel: "email" }] },
    });
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.unreadCount({ headers: alice.headers, query: {} });
    await auth.api.notify({
      body: { userId: alice.user.id, type: "security.new_login", title: "x" },
    });
    expect(await auth.api.processDeliveries({})).toMatchObject({ sent: 1 });
  });

  it("waits for an away user too when sendNowIfAway is false", async () => {
    const email = fakeChannel();
    const auth = createTestAuth({
      channels: { email: email.channel },
      routes: {
        digestable: [
          { channel: "email", ifUnreadAfter: { minutes: 15 }, sendNowIfAway: false },
        ],
      },
    });
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.notify({
      body: { userId: alice.user.id, type: "digestable", title: "x" },
    });
    expect(await auth.api.processDeliveries({})).toMatchObject({ sent: 0 });
    advance(15 * MINUTE);
    expect(await auth.api.processDeliveries({})).toMatchObject({ sent: 1 });
  });

  it("skips deliveries shouldDeliver rejects", async () => {
    const shouldDeliver = vi.fn(() => false);
    const { email, options } = emailAfter15({ shouldDeliver });
    const auth = createTestAuth(options);
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.notify({
      body: { userId: alice.user.id, type: "billing.payment_failed", title: "x" },
    });

    expect(await auth.api.processDeliveries({})).toMatchObject({ skipped: 1 });
    expect(email.sent).toHaveLength(0);
    expect(shouldDeliver).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "email",
        user: expect.objectContaining({ id: alice.user.id }),
      }),
    );
    expect(await deliveries(auth)).toMatchObject([
      { status: "skipped", detail: "opted out" },
    ]);
  });

  it("sends inside notify when better-auth has a background task handler", async () => {
    const tasks: Promise<unknown>[] = [];
    const { email, options } = emailAfter15();
    const auth = createTestAuth(options, {
      advanced: { backgroundTasks: { handler: (p) => void tasks.push(p) } },
    });
    const alice = await signUpUser(auth, "alice@example.com");
    tasks.length = 0;

    await auth.api.notify({
      body: { userId: alice.user.id, type: "billing.payment_failed", title: "x" },
    });
    await Promise.all(tasks);
    expect(email.sent).toHaveLength(1);
    expect(await auth.api.processDeliveries({})).toMatchObject({ sent: 0 });
  });
});

describe("processDeliveries", () => {
  it("sends once when sweeps overlap", async () => {
    const { email, options } = emailAfter15();
    const auth = createTestAuth(options);
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.notify({
      body: { userId: alice.user.id, type: "billing.payment_failed", title: "x" },
    });

    const results = await Promise.all([
      auth.api.processDeliveries({}),
      auth.api.processDeliveries({}),
    ]);
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(await auth.api.processDeliveries({})).toMatchObject({ sent: 0 });
    expect(email.sent).toHaveLength(1);
  });

  it("retries a throwing channel with backoff, then marks it failed", async () => {
    const deliver = vi.fn(async () => {
      throw new Error("SES throttled");
    });
    const auth = createTestAuth({
      channels: { email: { deliver } },
      routes: { "*": [{ channel: "email" }] },
      maxAttempts: 2,
    });
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.notify({
      body: { userId: alice.user.id, type: "x", title: "x" },
    });

    expect(await auth.api.processDeliveries({})).toMatchObject({ retrying: 1 });
    const [retry] = await deliveries(auth);
    expect(retry).toMatchObject({
      status: "pending",
      attempts: 1,
      detail: "SES throttled",
    });
    expect(new Date(retry!.scheduledFor).getTime()).toBe(Date.now() + MINUTE);

    expect(await auth.api.processDeliveries({})).toMatchObject({ retrying: 0 });
    advance(MINUTE);
    expect(await auth.api.processDeliveries({})).toMatchObject({ failed: 1 });
    expect(await deliveries(auth)).toMatchObject([
      { status: "failed", attempts: 2, detail: "SES throttled" },
    ]);
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it("reclaims a delivery whose worker died mid-send", async () => {
    const { email, options } = emailAfter15();
    const auth = createTestAuth(options);
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.notify({
      body: { userId: alice.user.id, type: "billing.payment_failed", title: "x" },
    });
    const ctx = await auth.$context;
    const [row] = await deliveries(auth);
    await ctx.adapter.update({
      model: "notificationDelivery",
      where: [{ field: "id", value: row!.id }],
      update: { status: "sending", claimedAt: new Date(), attempts: 1 },
    });

    expect(await auth.api.processDeliveries({})).toMatchObject({ sent: 0 });
    advance(6 * MINUTE);
    expect(await auth.api.processDeliveries({})).toMatchObject({ sent: 1 });
    expect(email.sent).toHaveLength(1);
    expect(await deliveries(auth)).toMatchObject([
      { status: "sent", attempts: 2 },
    ]);
  });

  it("fails a delivery whose sends keep dying once attempts run out", async () => {
    const { email, options } = emailAfter15({ maxAttempts: 2 });
    const auth = createTestAuth(options);
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.notify({
      body: { userId: alice.user.id, type: "billing.payment_failed", title: "x" },
    });
    const ctx = await auth.$context;
    const [row] = await deliveries(auth);
    await ctx.adapter.update({
      model: "notificationDelivery",
      where: [{ field: "id", value: row!.id }],
      update: { status: "sending", claimedAt: new Date(), attempts: 2 },
    });

    advance(6 * MINUTE);
    expect(await auth.api.processDeliveries({})).toMatchObject({ sent: 0 });
    expect(email.sent).toHaveLength(0);
    expect(await deliveries(auth)).toMatchObject([
      { status: "failed", detail: "send did not finish" },
    ]);
  });

  it("works through an org fan-out across batches", async () => {
    const { email, options } = emailAfter15({ batchSize: 2 });
    const auth = createTestAuthWithOrg(options);
    const alice = await signUpUser(auth, "alice@example.com");
    const bob = await signUpUser(auth, "bob@example.com");
    const carol = await signUpUser(auth, "carol@example.com");
    const org = await auth.api.createOrganization({
      headers: alice.headers,
      body: { name: "Acme", slug: "acme" },
    });
    for (const user of [bob, carol]) {
      await auth.api.addMember({
        body: { userId: user.user.id, organizationId: org!.id, role: "member" },
      });
    }
    // carol is in the app, so hers waits
    await auth.api.unreadCount({ headers: carol.headers, query: {} });

    await auth.api.notify({
      body: {
        organizationId: org!.id,
        type: "billing.payment_failed",
        title: "Payment failed",
      },
    });

    expect(await auth.api.processDeliveries({})).toMatchObject({
      sent: 2,
      hasMore: false,
    });
    expect(email.sent.map((s) => s.user.email).sort()).toEqual([
      "alice@example.com",
      "bob@example.com",
    ]);
    advance(15 * MINUTE);
    expect(await auth.api.processDeliveries({})).toMatchObject({ sent: 1 });
  });

  it("reports hasMore when more deliveries are due than the batch holds", async () => {
    const email = fakeChannel();
    const auth = createTestAuth({
      channels: { email: email.channel },
      routes: { "*": [{ channel: "email" }] },
      batchSize: 2,
    });
    const alice = await signUpUser(auth, "alice@example.com");
    for (const title of ["a", "b", "c"]) {
      await auth.api.notify({
        body: { userId: alice.user.id, type: "x", title },
      });
    }
    expect(await auth.api.processDeliveries({})).toMatchObject({
      sent: 2,
      hasMore: true,
    });
    expect(await auth.api.processDeliveries({})).toMatchObject({
      sent: 1,
      hasMore: false,
    });
  });
});

describe("markSeen", () => {
  it("only marks the caller's own notifications", async () => {
    const auth = createTestAuth();
    const alice = await signUpUser(auth, "alice@example.com");
    const bob = await signUpUser(auth, "bob@example.com");
    const { notifications } = await auth.api.notify({
      body: { userId: alice.user.id, type: "x", title: "x" },
    });

    const res = await auth.api.markSeen({
      headers: bob.headers,
      body: { ids: [notifications[0]!.id] },
    });
    expect(res.count).toBe(0);
    const list = await auth.api.listNotifications({
      headers: alice.headers,
      query: {},
    });
    expect(list.notifications[0]!.seenAt ?? null).toBeNull();
  });
});

describe("options", () => {
  it("type-checks routes against the configured channel names", () => {
    const email = fakeChannel().channel;
    // the README shape, inline, so the channel names infer as literals
    inbox({
      channels: { email },
      routes: {
        "billing.payment_failed": [
          { channel: "email", ifUnreadAfter: { minutes: 15 } },
        ],
      },
    });
    expect(() =>
      inbox({
        channels: { email },
        // @ts-expect-error "sms" is not a configured channel
        routes: { x: [{ channel: "sms" }] },
      }),
    ).toThrow(/channel "sms"/);
  });

  it("rejects a route that names an unknown channel", () => {
    expect(() =>
      inbox({
        channels: {},
        routes: { x: [{ channel: "sms" as never }] },
      }),
    ).toThrow(/channel "sms"/);
  });

  it("records presence from unread-count only, at most once a minute", async () => {
    const { options } = emailAfter15();
    const auth = createTestAuth(options);
    const alice = await signUpUser(auth, "alice@example.com");
    const ctx = await auth.$context;
    const presence = () =>
      ctx.adapter.findMany<{ lastSeenAt: Date }>({ model: "inboxPresence" });

    await auth.api.listNotifications({ headers: alice.headers, query: {} });
    expect(await presence()).toHaveLength(0);

    await auth.api.unreadCount({ headers: alice.headers, query: {} });
    const [first] = await presence();
    advance(30_000);
    await auth.api.unreadCount({ headers: alice.headers, query: {} });
    expect((await presence())[0]!.lastSeenAt).toEqual(first!.lastSeenAt);
    advance(30_000);
    await auth.api.unreadCount({ headers: alice.headers, query: {} });
    const rows = await presence();
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0]!.lastSeenAt).getTime()).toBe(Date.now());
  });

  it("does not record presence when no channels are configured", async () => {
    const auth = createTestAuth();
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.unreadCount({ headers: alice.headers, query: {} });
    const ctx = await auth.$context;
    expect(await ctx.adapter.findMany({ model: "inboxPresence" })).toHaveLength(0);
  });
});
