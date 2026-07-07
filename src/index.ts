import type { BetterAuthPlugin, InferOptionSchema } from "better-auth";
import { mergeSchema } from "better-auth/db";
import { INBOX_ERROR_CODES } from "./error-codes";
import {
  listNotifications,
  markAllRead,
  markRead,
  notify,
  unreadCount,
} from "./routes";
import { schema } from "./schema";

export type InboxOptions = {
  /**
   * Maximum number of members an organization notify may fan out to.
   * @default 1000
   */
  maxFanout?: number;
  schema?: InferOptionSchema<typeof schema>;
};

export const inbox = (options: InboxOptions = {}) => {
  const opts = { maxFanout: options.maxFanout ?? 1000 };
  return {
    id: "inbox",
    schema: mergeSchema(schema, options.schema),
    endpoints: {
      notify: notify(opts),
      listNotifications: listNotifications(),
      markRead: markRead(),
      markAllRead: markAllRead(),
      unreadCount: unreadCount(),
    },
    $ERROR_CODES: INBOX_ERROR_CODES,
    options,
  } satisfies BetterAuthPlugin;
};

export { INBOX_ERROR_CODES } from "./error-codes";
export type { Notification } from "./schema";
