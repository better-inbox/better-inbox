import type { DeliveryContext, InboxChannel } from "./delivery";
import { type RenderedEmail, renderEmail } from "./email";
import { PermanentDeliveryError } from "./permanent";

export { notificationUrl, renderEmail, type RenderedEmail } from "./email";

/** The part of `WrapsEmail` this channel uses, so tests can pass a fake. */
export type WrapsEmailSender = {
  send: (params: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
    replyTo?: string;
  }) => Promise<unknown>;
};

export type WrapsEmailChannelOptions = {
  /** Sender address, verified in your SES account: `"Acme <notify@acme.com>"`. */
  from: string;
  replyTo?: string;
  /**
   * A configured `new WrapsEmail({ ... })`. Defaults to `new WrapsEmail()`,
   * which resolves AWS credentials from the environment.
   */
  client?: WrapsEmailSender;
  /** Build the email yourself. The default renders the title, body and a link to `href`. */
  render?: (ctx: DeliveryContext) => RenderedEmail | Promise<RenderedEmail>;
};

/**
 * Email channel that sends through your own AWS SES account with
 * `@wraps.dev/email`. Install it alongside @byo-oss/notifications:
 * `npm install @wraps.dev/email`.
 *
 * @deprecated Use `mailerChannel` from `@byo-oss/notifications/mailer` with
 * `wrapsMailer` from `@byo-oss/mailer/wraps`. It sends through the same SDK and
 * works with any other `Mailer`. See Upgrading in the docs for the differences.
 */
export function wrapsEmail(options: WrapsEmailChannelOptions): InboxChannel {
  let client: Promise<WrapsEmailSender> | undefined = options.client
    ? Promise.resolve(options.client)
    : undefined;
  const getClient = () => {
    // imported on first send, so the peer dependency is only needed by apps
    // that use this channel
    client ??= import("@wraps.dev/email").then(
      ({ WrapsEmail }) => new WrapsEmail(),
    );
    return client;
  };

  return {
    async deliver(ctx) {
      const { subject, html, text } = await (options.render ?? renderEmail)(
        ctx,
      );
      try {
        await (await getClient()).send({
          from: options.from,
          to: ctx.user.email,
          subject,
          html,
          text,
          ...(options.replyTo ? { replyTo: options.replyTo } : {}),
        });
      } catch (error) {
        // a malformed recipient fails the same way every time. Everything else
        // (throttling, network, SES and account errors) rethrows and retries.
        if (isInvalidRecipient(error)) {
          throw new PermanentDeliveryError(
            error instanceof Error ? error.message : String(error),
            { cause: error },
          );
        }
        throw error;
      }
    },
  };
}

/**
 * True for the `ValidationError` that `@wraps.dev/email` throws before any
 * network call when `to` is missing or not an address. Matched on the name and
 * field because the SDK is loaded dynamically and may be a different copy.
 */
function isInvalidRecipient(error: unknown): boolean {
  const { name, field } = (error ?? {}) as { name?: unknown; field?: unknown };
  return (
    name === "ValidationError" &&
    typeof field === "string" &&
    /^to(\[\d+\])?$/.test(field)
  );
}
