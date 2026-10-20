import { describe, expect, it } from "vitest";
import type { DeliveryContext, InboxChannel } from "./delivery";

export type TestChannelOptions = {
  /**
   * The same channel wired to a transport that fails (a fake client that
   * rejects, a fetch that returns 500). Checks that `deliver` throws, which is
   * what makes the delivery retry. Without it, that case is skipped.
   */
  failing?: () => InboxChannel | Promise<InboxChannel>;
};

/** A delivery context with every optional field set. Pass overrides to vary it. */
export function deliveryContext(
  overrides: {
    notification?: Partial<DeliveryContext["notification"]>;
    user?: Partial<DeliveryContext["user"]>;
    appUrl?: string | undefined;
  } = {},
): DeliveryContext {
  const createdAt = new Date("2026-01-01T00:00:00Z");
  return {
    notification: {
      id: "notification-1",
      userId: "user-1",
      organizationId: "org-1",
      type: "billing.payment_failed",
      title: "Payment failed",
      body: "Update your card to keep your plan.",
      href: "/settings/billing",
      data: { invoiceId: "in_1" },
      read: false,
      seenAt: null,
      createdAt,
      ...overrides.notification,
    },
    user: {
      id: "user-1",
      email: "alice@example.com",
      name: "Alice",
      emailVerified: true,
      image: null,
      createdAt,
      updatedAt: createdAt,
      ...overrides.user,
    },
    appUrl: "appUrl" in overrides ? overrides.appUrl : "https://app.acme.test",
  };
}

/**
 * The `InboxChannel` contract as a vitest suite. Call it at the top level of a
 * test file with a factory that builds your channel on a fake transport:
 *
 * ```ts
 * import { testChannel } from "@byo-oss/notifications/testing"
 * testChannel(() => myChannel({ client: fakeClient }), {
 *   failing: () => myChannel({ client: rejectingClient }),
 * })
 * ```
 *
 * It checks what the inbox relies on: `deliver` resolves for any valid
 * context (with or without `body`, `href` and `appUrl`, relative or absolute
 * `href`), doesn't change its input, and throws when the send fails. Channels
 * aren't required to be idempotent: a delivery can be retried after a send
 * that succeeded but whose worker died, so the inbox promises at-least-once.
 */
export function testChannel(
  create: () => InboxChannel | Promise<InboxChannel>,
  options: TestChannelOptions = {},
) {
  describe("InboxChannel contract", () => {
    it("has a deliver function", async () => {
      const channel = await create();
      expect(typeof channel.deliver).toBe("function");
    });

    it("delivers a notification with every field set", async () => {
      const channel = await create();
      await expect(channel.deliver(deliveryContext())).resolves.not.toThrow();
    });

    it("delivers a notification with only the required fields", async () => {
      const channel = await create();
      await expect(
        channel.deliver(
          deliveryContext({
            notification: {
              organizationId: null,
              body: null,
              href: null,
              data: null,
            },
            appUrl: undefined,
          }),
        ),
      ).resolves.not.toThrow();
    });

    it("delivers relative and absolute links, with or without appUrl", async () => {
      const channel = await create();
      for (const href of ["/inbox", "inbox", "https://elsewhere.test/x"]) {
        for (const appUrl of ["https://app.acme.test", undefined]) {
          await expect(
            channel.deliver(deliveryContext({ notification: { href }, appUrl })),
          ).resolves.not.toThrow();
        }
      }
    });

    it("doesn't change the context it's given", async () => {
      const channel = await create();
      const ctx = deliveryContext();
      const before = structuredClone(ctx);
      await channel.deliver(ctx);
      expect(ctx).toEqual(before);
    });

    it.skipIf(!options.failing)(
      "throws when the send fails, so the delivery retries",
      async () => {
        const channel = await options.failing!();
        await expect(channel.deliver(deliveryContext())).rejects.toThrow();
      },
    );
  });
}
