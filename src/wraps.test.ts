import { describe, expect, it, vi } from "vitest";
import type { DeliveryContext } from "./delivery";
import { createTestAuth, signUpUser } from "./test-utils";
import { testChannel } from "./testing";
import { notificationUrl, renderEmail, wrapsEmail } from "./wraps";

function context(overrides: Partial<DeliveryContext["notification"]> = {}) {
  return {
    notification: {
      id: "n1",
      userId: "u1",
      type: "billing.payment_failed",
      title: "Payment <failed>",
      body: "Update your card",
      href: "/settings/billing",
      read: false,
      createdAt: new Date(),
      ...overrides,
    },
    user: {
      id: "u1",
      email: "alice@example.com",
      name: "alice",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    appUrl: "https://app.acme.test",
  } satisfies DeliveryContext;
}

testChannel(
  () =>
    wrapsEmail({ from: "notify@acme.test", client: { send: async () => ({}) } }),
  {
    failing: () =>
      wrapsEmail({
        from: "notify@acme.test",
        client: {
          send: async () => {
            throw new Error("MessageRejected");
          },
        },
      }),
  },
);

describe("wrapsEmail", () => {
  it("sends the rendered notification to the user's address", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "m1", requestId: "r1" });
    const channel = wrapsEmail({
      from: "Acme <notify@acme.test>",
      replyTo: "help@acme.test",
      client: { send },
    });

    await channel.deliver(context());

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Acme <notify@acme.test>",
        to: "alice@example.com",
        replyTo: "help@acme.test",
        subject: "Payment <failed>",
      }),
    );
    const { html, text } = send.mock.calls[0]![0];
    expect(html).toContain("Payment &lt;failed&gt;");
    expect(html).toContain('href="https://app.acme.test/settings/billing"');
    expect(text).toContain("https://app.acme.test/settings/billing");
  });

  it("lets a send error through so the delivery retries", async () => {
    const channel = wrapsEmail({
      from: "notify@acme.test",
      client: { send: vi.fn().mockRejectedValue(new Error("MessageRejected")) },
    });
    await expect(channel.deliver(context())).rejects.toThrow("MessageRejected");
  });

  it("uses a custom render", async () => {
    const send = vi.fn().mockResolvedValue({});
    const channel = wrapsEmail({
      from: "notify@acme.test",
      client: { send },
      render: ({ notification }) => ({
        subject: `[Acme] ${notification.title}`,
        html: "<p>hi</p>",
        text: "hi",
      }),
    });
    await channel.deliver(context());
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "[Acme] Payment <failed>", text: "hi" }),
    );
  });

  it("delivers end to end through processDeliveries", async () => {
    const send = vi.fn().mockResolvedValue({});
    const auth = createTestAuth({
      appUrl: "https://app.acme.test/",
      channels: { email: wrapsEmail({ from: "notify@acme.test", client: { send } }) },
      routes: { "*": [{ channel: "email" }] },
    });
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.notify({
      body: { userId: alice.user.id, type: "x", title: "Hi", href: "/x" },
    });
    await auth.api.processDeliveries({});
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "alice@example.com", subject: "Hi" }),
    );
    expect(send.mock.calls[0]![0].text).toContain("https://app.acme.test/x");
  });
});

describe("notificationUrl", () => {
  it("joins a relative href onto appUrl and keeps absolute ones", () => {
    expect(notificationUrl(context())).toBe(
      "https://app.acme.test/settings/billing",
    );
    expect(notificationUrl(context({ href: "billing" }))).toBe(
      "https://app.acme.test/billing",
    );
    expect(notificationUrl(context({ href: "https://status.acme.test" }))).toBe(
      "https://status.acme.test",
    );
    expect(notificationUrl(context({ href: null }))).toBe(
      "https://app.acme.test",
    );
    expect(notificationUrl({ ...context(), appUrl: undefined })).toBeUndefined();
  });

  it("leaves the button out when there is no link", () => {
    const { html } = renderEmail({ ...context(), appUrl: undefined });
    expect(html).not.toContain("<a ");
  });
});
