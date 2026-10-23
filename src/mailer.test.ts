import { memoryMailer, type Mailer, type MailMessage, PermanentMailError } from "@byo-oss/mailer";
import { describe, expect, it, vi } from "vitest";
import { mailerChannel } from "./mailer";
import { isPermanent, PermanentDeliveryError } from "./permanent";
import { createTestAuth, signUpUser } from "./test-utils";
import { deliveryContext, testChannel } from "./testing";

// a PermanentMailError from another installed copy of @byo-oss/mailer: the
// class differs, the brand (a shared Symbol.for) is the same. No `permanent`
// field on purpose: only the brand identifies it, so a check on `permanent`
// alone would miss it.
class ForeignPermanentMailError extends Error {
  constructor(message: string) {
    super(message);
    Object.defineProperty(this, Symbol.for("@byo-oss/mailer/permanent"), {
      value: true,
    });
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

async function deliveries(auth: { $context: Promise<any> }) {
  const ctx = await auth.$context;
  return ctx.adapter.findMany({ model: "notificationDelivery" }) as Promise<
    { status: string; attempts: number; channel: string }[]
  >;
}

// T1: the InboxChannel contract, on the real memoryMailer
testChannel(() => mailerChannel({ mailer: memoryMailer() }), {
  failing: () =>
    mailerChannel({ mailer: memoryMailer({ fail: "retry" }) }),
  permanentlyFailing: () =>
    mailerChannel({ mailer: memoryMailer({ fail: "permanent" }) }),
});

describe("mailerChannel message", () => {
  // T2: what the mailer is handed
  it("sends to the user's email with the title as the subject", async () => {
    const mailer = memoryMailer();
    const channel = mailerChannel({ mailer });
    await channel.deliver(deliveryContext());

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({
      to: "alice@example.com",
      subject: "Payment failed",
    });
  });

  it("puts the title and the absolute link in html and text", async () => {
    const mailer = memoryMailer();
    const channel = mailerChannel({ mailer });
    await channel.deliver(deliveryContext());

    const [message] = mailer.sent;
    expect(message!.html).toContain("Payment failed");
    expect(message!.text).toContain("Payment failed");
    expect(message!.html).toContain("https://app.acme.test/settings/billing");
    expect(message!.text).toContain("https://app.acme.test/settings/billing");
  });

  it("sets neither from nor headers: the mailer owns the sender", async () => {
    const mailer = memoryMailer();
    await mailerChannel({ mailer }).deliver(deliveryContext());

    expect(mailer.sent[0]).not.toHaveProperty("from");
    expect(mailer.sent[0]).not.toHaveProperty("headers");
  });

  it("omits replyTo when none is configured", async () => {
    const mailer = memoryMailer();
    await mailerChannel({ mailer }).deliver(deliveryContext());

    expect(mailer.sent[0]).not.toHaveProperty("replyTo");
  });

  it("passes replyTo through when configured", async () => {
    const mailer = memoryMailer();
    await mailerChannel({ mailer, replyTo: "support@acme.test" }).deliver(
      deliveryContext(),
    );

    expect(mailer.sent[0]).toMatchObject({ replyTo: "support@acme.test" });
  });

  // T3: the render override
  it("uses a synchronous render override", async () => {
    const mailer = memoryMailer();
    const render = vi.fn(() => ({
      subject: "Custom subject",
      html: "<p>custom html</p>",
      text: "custom text",
    }));
    await mailerChannel({ mailer, render }).deliver(deliveryContext());

    expect(render).toHaveBeenCalledTimes(1);
    expect(mailer.sent[0]).toMatchObject({
      subject: "Custom subject",
      html: "<p>custom html</p>",
      text: "custom text",
    });
  });

  it("uses an asynchronous render override", async () => {
    const mailer = memoryMailer();
    const render = vi.fn(async () => ({
      subject: "Async subject",
      html: "<p>async html</p>",
      text: "async text",
    }));
    await mailerChannel({ mailer, render }).deliver(deliveryContext());

    expect(render).toHaveBeenCalledTimes(1);
    expect(mailer.sent[0]).toMatchObject({
      subject: "Async subject",
      html: "<p>async html</p>",
      text: "async text",
    });
  });
});

describe("mailerChannel errors", () => {
  // T4: permanent errors from another copy of the package
  it("maps a foreign-copy PermanentMailError to PermanentDeliveryError with cause", async () => {
    const foreign = new ForeignPermanentMailError("address rejected");
    const channel = mailerChannel({
      mailer: {
        send: async () => {
          throw foreign;
        },
      },
    });

    const error = (await channel
      .deliver(deliveryContext())
      .catch((e: unknown) => e)) as PermanentDeliveryError;
    expect(error).toBeInstanceOf(PermanentDeliveryError);
    expect(error.message).toBe("address rejected");
    expect(error.cause).toBe(foreign);
  });

  it("gives a branded non-Error a message instead of an empty one", async () => {
    const branded = Object.defineProperty({}, Symbol.for("@byo-oss/mailer/permanent"), {
      value: true,
    });
    const channel = mailerChannel({
      mailer: {
        send: async () => {
          throw branded;
        },
      },
    });

    const error = (await channel
      .deliver(deliveryContext())
      .catch((e: unknown) => e)) as PermanentDeliveryError;
    expect(error).toBeInstanceOf(PermanentDeliveryError);
    expect(error.message).toBe("Send rejected");
    expect(error.cause).toBe(branded);
  });

  it("retries an unbranded error marked permanent, since only a PermanentMailError means fail", async () => {
    // the sweep fails anything with `permanent: true`, so the channel
    // rewraps it without the mark, keeping the message and the cause
    const unbranded = Object.assign(new Error("odd"), { permanent: true });
    const channel = mailerChannel({
      mailer: {
        send: async () => {
          throw unbranded;
        },
      },
    });

    const error = (await channel
      .deliver(deliveryContext())
      .catch((e: unknown) => e)) as Error;
    expect(error).not.toBe(unbranded);
    expect(error).not.toBeInstanceOf(PermanentDeliveryError);
    expect(isPermanent(error)).toBe(false);
    expect(error.message).toBe("odd");
    expect(error.cause).toBe(unbranded);
  });

  it("maps a PermanentMailError from this copy to PermanentDeliveryError", async () => {
    const original = new PermanentMailError("message rejected");
    const channel = mailerChannel({
      mailer: {
        send: async () => {
          throw original;
        },
      },
    });

    const error = (await channel
      .deliver(deliveryContext())
      .catch((e: unknown) => e)) as PermanentDeliveryError;
    expect(error).toBeInstanceOf(PermanentDeliveryError);
    expect(error.message).toBe("message rejected");
    expect(error.cause).toBe(original);
  });

  it("rethrows any other error unchanged, so the delivery retries", async () => {
    const timeout = new Error("socket timeout");
    const channel = mailerChannel({
      mailer: {
        send: async () => {
          throw timeout;
        },
      },
    });

    await expect(channel.deliver(deliveryContext())).rejects.toBe(timeout);
  });

  // T6: neither the context nor the rendered email may change
  it("doesn't change the context: notification and user are deep-equal before and after", async () => {
    const mailer = memoryMailer();
    const channel = mailerChannel({ mailer });
    const ctx = deliveryContext();
    const before = structuredClone(ctx);

    await channel.deliver(ctx);

    expect(ctx.notification).toEqual(before.notification);
    expect(ctx.user).toEqual(before.user);
  });

  it("doesn't change a frozen context, or a frozen rendered email", async () => {
    const mailer = memoryMailer();
    const channel = mailerChannel({
      mailer,
      // frozen: a write in strict mode throws, which fails the send
      render: () =>
        Object.freeze({
          subject: "Frozen",
          html: "<p>frozen</p>",
          text: "frozen",
        }),
    });
    const ctx = deepFreeze(deliveryContext());

    await expect(channel.deliver(ctx)).resolves.not.toThrow();
    expect(mailer.sent[0]).toMatchObject({ subject: "Frozen" });
  });
});

describe("mailerChannel end to end", () => {
  // T5: notify -> processDeliveries -> the mailer, on the real plugin
  function emailAuth(mailer: Mailer) {
    return createTestAuth({
      appUrl: "https://app.acme.test",
      channels: { email: mailerChannel({ mailer }) },
      routes: { "*": [{ channel: "email" }] },
    });
  }

  it("sends one message and marks the delivery sent", async () => {
    const mailer = memoryMailer();
    const auth = emailAuth(mailer);
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.notify({
      body: {
        userId: alice.user.id,
        type: "billing.payment_failed",
        title: "Payment failed",
        href: "/settings/billing",
      },
    });

    expect(await auth.api.processDeliveries({})).toMatchObject({ sent: 1 });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({
      to: "alice@example.com",
      subject: "Payment failed",
    });
    expect(await deliveries(auth)).toMatchObject([
      { status: "sent", attempts: 1, channel: "email" },
    ]);
  });

  it("marks a permanent failure failed after one attempt, with nothing sent", async () => {
    const mailer = memoryMailer({ fail: "permanent" });
    const auth = emailAuth(mailer);
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.notify({
      body: { userId: alice.user.id, type: "x", title: "Hi" },
    });

    expect(await auth.api.processDeliveries({})).toMatchObject({
      failed: 1,
      retrying: 0,
    });
    expect(mailer.sent).toHaveLength(0);
    expect(await deliveries(auth)).toMatchObject([
      { status: "failed", attempts: 1 },
    ]);
  });

  it("leaves a plain failure retrying with one attempt", async () => {
    const mailer = memoryMailer({ fail: "retry" });
    const auth = emailAuth(mailer);
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.notify({
      body: { userId: alice.user.id, type: "x", title: "Hi" },
    });

    expect(await auth.api.processDeliveries({})).toMatchObject({
      retrying: 1,
      failed: 0,
    });
    expect(mailer.sent).toHaveLength(0);
    expect(await deliveries(auth)).toMatchObject([
      { status: "pending", attempts: 1 },
    ]);
  });
});

// T7: the same suite, against a hand-written Mailer with nothing but send()
describe("mailerChannel with a hand-written minimal Mailer", () => {
  const minimal: Mailer = {
    async send(_message: MailMessage) {
      return { id: "minimal-1" };
    },
  };

  testChannel(() => mailerChannel({ mailer: minimal }), {
    failing: () =>
      mailerChannel({
        mailer: {
          async send() {
            throw new Error("connection reset");
          },
        },
      }),
    permanentlyFailing: () =>
      mailerChannel({
        mailer: {
          async send() {
            throw new PermanentMailError("address rejected");
          },
        },
      }),
  });
});
