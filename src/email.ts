import type { DeliveryContext } from "./delivery";

export type RenderedEmail = { subject: string; html: string; text: string };

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function notificationUrl({ notification, appUrl }: DeliveryContext) {
  const { href } = notification;
  if (!href) return appUrl;
  if (/^https?:\/\//i.test(href)) return href;
  return appUrl ? `${appUrl}${href.startsWith("/") ? "" : "/"}${href}` : undefined;
}

/** The default email: title as subject and heading, body, and a View button. */
export function renderEmail(ctx: DeliveryContext): RenderedEmail {
  const { title, body } = ctx.notification;
  const url = notificationUrl(ctx);
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6f6f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px">
      <tr>
        <td style="padding:24px">
          <h1 style="margin:0 0 12px;font-size:18px;line-height:1.4">${escapeHtml(title)}</h1>
          ${body ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#52525b">${escapeHtml(body)}</p>` : ""}
          ${url ? `<a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 16px;border-radius:6px;background:#18181b;color:#ffffff;font-size:14px;text-decoration:none">View</a>` : ""}
        </td>
      </tr>
    </table>
  </body>
</html>`;
  const text = [title, body, url].filter(Boolean).join("\n\n");
  return { subject: title, html, text };
}
