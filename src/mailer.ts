import { type Mailer, isPermanentMailError } from "@byo-oss/mailer";
import type { DeliveryContext, InboxChannel } from "./delivery";
import { type RenderedEmail, renderEmail } from "./email";
import { PermanentDeliveryError } from "./permanent";

export type { Mailer, MailMessage, MailResult } from "@byo-oss/mailer";
export { notificationUrl, renderEmail, type RenderedEmail } from "./email";

export type MailerChannelOptions = {
  /**
   * Any `Mailer`: `wrapsMailer`, `sesMailer`, `emailSdkMailer`, `memoryMailer`,
   * or a community adapter. It owns the sender address, so there's no `from`.
   */
  mailer: Mailer;
  replyTo?: string;
  /** Build the email yourself. The default renders the title, body and a link to `href`. */
  render?: (ctx: DeliveryContext) => RenderedEmail | Promise<RenderedEmail>;
};

/**
 * Email channel that sends through any `Mailer` from `@byo-oss/mailer`.
 * Install `@byo-oss/mailer` in the app and import an adapter from its subpath.
 */
export function mailerChannel(options: MailerChannelOptions): InboxChannel {
  return {
    async deliver(ctx) {
      const { subject, html, text } = await (options.render ?? renderEmail)(
        ctx,
      );
      try {
        await options.mailer.send({
          to: ctx.user.email,
          subject,
          html,
          text,
          ...(options.replyTo ? { replyTo: options.replyTo } : {}),
        });
      } catch (error) {
        // the mailer marks sends that can never succeed (a bad address, a
        // rejected message). Everything else rethrows and retries.
        if (isPermanentMailError(error)) {
          throw new PermanentDeliveryError(
            error instanceof Error && error.message ? error.message : "Send rejected",
            { cause: error },
          );
        }
        throw error;
      }
    },
  };
}
