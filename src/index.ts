import type { BetterAuthPlugin, InferOptionSchema } from "better-auth";
import { mergeSchema } from "better-auth/db";
import { organizationCleanupHook } from "./data";
import type { DeliveryRule, InboxChannel, ShouldDeliver } from "./delivery";
import { INBOX_ERROR_CODES } from "./error-codes";
import {
  listNotifications,
  markAllRead,
  markRead,
  markSeen,
  notify,
  processDeliveries,
  unreadCount,
} from "./routes";
import { schema } from "./schema";

export type InboxOptions<Channel extends string = string> = {
  /**
   * Maximum number of members an organization notify may fan out to.
   * @default 1000
   */
  maxFanout?: number;
  /**
   * Your app's origin, e.g. `https://app.acme.com`. Channels use it to turn a
   * notification's relative `href` into a link.
   */
  appUrl?: string;
  /** Delivery channels beyond the in-app inbox, by name. */
  channels?: Record<Channel, InboxChannel>;
  /**
   * Which channels each notification type goes to, keyed by `type`. `"*"` is
   * the fallback for types without an entry. Types with no rule stay in-app.
   */
  routes?: Record<string, DeliveryRule<NoInfer<Channel>>[]>;
  /** Return false to skip a delivery, e.g. from your own preferences store. */
  shouldDeliver?: ShouldDeliver;
  /**
   * How recently a user must have polled the inbox to count as in the app, in ms.
   * @default 120000
   */
  presenceWindow?: number;
  /**
   * Attempts per delivery before it is marked failed. Retries back off from
   * one minute, doubling, up to an hour.
   * @default 5
   */
  maxAttempts?: number;
  /**
   * Deliveries attempted per `processDeliveries` call.
   * @default 100
   */
  batchSize?: number;
  schema?: InferOptionSchema<typeof schema>;
};

export const inbox = <Channel extends string = string>(
  options: InboxOptions<Channel> = {},
) => {
  const channels: Record<string, InboxChannel> = options.channels ?? {};
  const routes = options.routes ?? {};
  for (const [type, rules] of Object.entries(routes)) {
    const seen = new Set<string>();
    for (const rule of rules) {
      if (!channels[rule.channel]) {
        throw new Error(
          `[@byo-oss/notifications] routes["${type}"] uses channel "${rule.channel}", which is not in channels`,
        );
      }
      if (seen.has(rule.channel)) {
        throw new Error(
          `[@byo-oss/notifications] routes["${type}"] lists channel "${rule.channel}" more than once`,
        );
      }
      seen.add(rule.channel);
    }
  }
  const opts = {
    maxFanout: options.maxFanout ?? 1000,
    appUrl: options.appUrl?.replace(/\/+$/, ""),
    channels,
    routes,
    shouldDeliver: options.shouldDeliver,
    presenceWindow: options.presenceWindow ?? 120_000,
    maxAttempts: options.maxAttempts ?? 5,
    batchSize: options.batchSize ?? 100,
    // a send that outlives this is presumed dead and its row is retried
    leaseMs: 5 * 60_000,
    // above this many due-now deliveries, notify leaves them to the sweep
    immediateLimit: 25,
  };
  return {
    id: "inbox",
    schema: mergeSchema(schema, options.schema),
    endpoints: {
      notify: notify(opts),
      processDeliveries: processDeliveries(opts),
      listNotifications: listNotifications(),
      markRead: markRead(),
      markSeen: markSeen(),
      markAllRead: markAllRead(),
      unreadCount: unreadCount(opts),
    },
    hooks: { after: [organizationCleanupHook] },
    $ERROR_CODES: INBOX_ERROR_CODES,
    options,
  } satisfies BetterAuthPlugin;
};

export type {
  DeliveryContext,
  DeliveryRule,
  Duration,
  InboxChannel,
  ShouldDeliver,
  SweepResult,
} from "./delivery";
export {
  type AuthWithContext,
  deleteMemberData,
  deleteOrganizationData,
} from "./data";
export { INBOX_ERROR_CODES } from "./error-codes";
export type { DeliveryStatus, Notification, NotificationDelivery } from "./schema";
