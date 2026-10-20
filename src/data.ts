import {
  type AuthContext,
  type DBTransactionAdapter,
  getCurrentAdapter,
  type Where,
} from "better-auth";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { findManyIn, IN_CHUNK } from "./adapter";
import type { Notification, NotificationDelivery } from "./schema";

/**
 * Any better-auth instance (your `auth`). Loose on purpose: a typed instance's
 * `$context` doesn't assign to the generic `AuthContext`.
 */
export type AuthWithContext = { $context: Promise<object> };

const EXPORT_LIMIT_MAX = 1000;

async function inboxContext(auth: AuthWithContext, caller: string) {
  const context = (await auth.$context) as AuthContext;
  if (!context.options.plugins?.some((plugin) => plugin.id === "inbox")) {
    throw new Error(
      `[@byo-oss/notifications] ${caller} needs the inbox plugin installed on this auth instance`,
    );
  }
  return context;
}

// inside a better-auth transaction (runWithTransaction, e.g. SCIM
// deprovisioning) this is that transaction, so our writes commit and roll back
// with the caller's; the outer adapter would wait on it, or deadlock on one
// connection
const currentAdapter = (context: AuthContext) =>
  getCurrentAdapter(context.adapter);

// deliveries go first: adapters without foreign keys (memory, MongoDB) don't
// cascade, and a delivery must never outlive its notification
async function deleteNotifications(
  adapter: DBTransactionAdapter,
  where: Where[],
) {
  let deleted = 0;
  for (;;) {
    const page = await adapter.findMany<Pick<Notification, "id">>({
      model: "notification",
      where,
      limit: IN_CHUNK,
      select: ["id"],
    });
    if (page.length === 0) return deleted;
    const ids = page.map((row) => row.id);
    await adapter.deleteMany({
      model: "notificationDelivery",
      where: [{ field: "notificationId", operator: "in", value: ids }],
    });
    const removed = await adapter.deleteMany({
      model: "notification",
      where: [{ field: "id", operator: "in", value: ids }],
    });
    // a delete that matched rows but removed none (row-level security, a
    // trigger) would otherwise loop forever
    if (removed === 0) {
      throw new Error(
        `[@byo-oss/notifications] found ${ids.length} notifications to delete but deleted none`,
      );
    }
    deleted += removed;
  }
}

/**
 * Removes everything held about a user. Foreign keys cascade this on SQL;
 * adapters without them (memory, MongoDB) rely on this running after the
 * user row is deleted.
 */
export async function deleteUserRows(context: AuthContext, userId: string) {
  const adapter = await currentAdapter(context);
  await deleteNotifications(adapter, [{ field: "userId", value: userId }]);
  // deliveries carry userId too, so none can be left behind
  await adapter.deleteMany({
    model: "notificationDelivery",
    where: [{ field: "userId", value: userId }],
  });
  await adapter.deleteMany({
    model: "inboxPresence",
    where: [{ field: "userId", value: userId }],
  });
}

// what each organization endpoint returns says whose notifications to drop
const orgCleanup: Record<string, (returned: any) => Where[] | undefined> = {
  "/organization/delete": (org) =>
    org?.id ? [{ field: "organizationId", value: org.id }] : undefined,
  "/organization/remove-member": (body) => memberWhere(body?.member),
  // leaving fires no organizationHooks, so an app couldn't wire this one itself
  "/organization/leave": (member) => memberWhere(member),
};

const memberWhere = (member: any): Where[] | undefined =>
  member?.userId && member?.organizationId
    ? [
        { field: "userId", value: member.userId },
        { field: "organizationId", value: member.organizationId },
      ]
    : undefined;

/**
 * Cleans up after the organization plugin's delete, remove-member and leave
 * endpoints. Deletes made any other way need the exported functions, and so
 * does a delete whose own organizationHooks threw: that error replaces the
 * response this hook reads.
 */
export const organizationCleanupHook = {
  matcher: (ctx: { path?: string }) => !!ctx.path && ctx.path in orgCleanup,
  handler: createAuthMiddleware(async (ctx) => {
    const returned = ctx.context.returned;
    if (!ctx.path || isAPIError(returned)) return;
    const where = orgCleanup[ctx.path]?.(returned);
    if (!where) return;
    try {
      await deleteNotifications(await currentAdapter(ctx.context), where);
    } catch (error) {
      // the org change already happened; failing the response wouldn't undo it
      ctx.context.logger.error(
        `[@byo-oss/notifications] cleanup after ${ctx.path} failed`,
        error,
      );
    }
  }),
};

/**
 * Deletes every notification (and its deliveries) stamped with this
 * organization. The plugin already does this after `/organization/delete`;
 * call it for organizations deleted any other way. Inside a better-auth
 * transaction (`runWithTransaction`) it runs in that transaction and rolls
 * back with it.
 */
export async function deleteOrganizationData(
  auth: AuthWithContext,
  organizationId: string,
): Promise<{ notifications: number }> {
  const context = await inboxContext(auth, "deleteOrganizationData");
  const adapter = await currentAdapter(context);
  const notifications = await deleteNotifications(adapter, [
    { field: "organizationId", value: organizationId },
  ]);
  return { notifications };
}

/**
 * Deletes one person's notifications (and deliveries) in one organization, for
 * when they leave it or are removed. Their other notifications stay. The
 * plugin already does this after `/organization/remove-member` and
 * `/organization/leave`. Inside a better-auth transaction
 * (`runWithTransaction`, as in SCIM deprovisioning) it runs in that
 * transaction and rolls back with it.
 */
export async function deleteMemberData(
  auth: AuthWithContext,
  { userId, organizationId }: { userId: string; organizationId: string },
): Promise<{ notifications: number }> {
  const context = await inboxContext(auth, "deleteMemberData");
  const adapter = await currentAdapter(context);
  const notifications = await deleteNotifications(adapter, [
    { field: "userId", value: userId },
    { field: "organizationId", value: organizationId },
  ]);
  return { notifications };
}

type Serialized<T> = {
  [K in keyof T]: T[K] extends Date
    ? string
    : T[K] extends Date | null | undefined
      ? string | Exclude<T[K], Date>
      : T[K];
};

export type ExportedDelivery = Serialized<NotificationDelivery>;

/** One notification as exported: the documented schema, dates as ISO strings. */
export type ExportedNotification = Serialized<Notification> & {
  /** The user's email, to match them in the tool you're moving to. */
  userEmail: string | null;
  /** Its email (or other channel) deliveries. */
  deliveries: ExportedDelivery[];
};

export type ExportNotificationsDataOptions = {
  /** Only this organization's notifications. Omit for all of them. */
  organizationId?: string;
  /** `cursor` from the previous page. Omit for the first page. */
  cursor?: string | null;
  /**
   * Notifications per page, 1 to 1000.
   * @default 500
   */
  limit?: number;
};

const serialize = <T extends object>(row: T): Serialized<T> =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  ) as Serialized<T>;

/**
 * Exports every notification (or one organization's) with its deliveries and
 * the user's email, a page at a time, as plain JSON. Server-only; for moving
 * to another tool or keeping an archive. Pages run in id order, and the cursor
 * is opaque. A row deleted mid-export (a member leaving, say) shifts later
 * rows back a page, so one can be skipped: export with writes stopped, or
 * export twice and compare.
 * Presence (`inboxPresence`) isn't exported; it's a minute-level heartbeat.
 */
export async function exportNotificationsData(
  auth: AuthWithContext,
  options: ExportNotificationsDataOptions = {},
): Promise<{ notifications: ExportedNotification[]; cursor: string | null }> {
  const context = await inboxContext(auth, "exportNotificationsData");
  const adapter = await currentAdapter(context);
  const fail = (message: string) =>
    new Error(`[@byo-oss/notifications] exportNotificationsData: ${message}`);
  const limit = options.limit ?? 500;
  if (!Number.isInteger(limit) || limit < 1 || limit > EXPORT_LIMIT_MAX) {
    throw fail(`limit must be an integer from 1 to ${EXPORT_LIMIT_MAX}`);
  }
  const where: Where[] = [];
  // an empty organizationId must not fall through to "every organization"
  if (options.organizationId !== undefined) {
    if (!options.organizationId) throw fail("organizationId is empty");
    where.push({ field: "organizationId", value: options.organizationId });
  }
  // an offset, not "id > last": adapters disagree on how strings sort (the
  // memory adapter sorts with localeCompare but compares with >)
  const offset = options.cursor ? Number.parseInt(options.cursor, 10) : 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw fail(`invalid cursor: ${options.cursor}`);
  }
  const page = await adapter.findMany<Notification>({
    model: "notification",
    where,
    limit: limit + 1,
    offset,
    sortBy: { field: "id", direction: "asc" },
  });
  const rows = page.slice(0, limit);
  if (rows.length === 0) return { notifications: [], cursor: null };

  const [users, deliveries] = await Promise.all([
    findManyIn<{ id: string; email: string }>(adapter, {
      model: "user",
      field: "id",
      values: rows.map((n) => n.userId),
      select: ["id", "email"],
    }),
    findManyIn<NotificationDelivery>(adapter, {
      model: "notificationDelivery",
      field: "notificationId",
      values: rows.map((n) => n.id),
    }),
  ]);
  const emails = new Map(users.map((user) => [user.id, user.email]));

  return {
    notifications: rows.map((notification) => ({
      ...serialize(notification),
      userEmail: emails.get(notification.userId) ?? null,
      deliveries: deliveries
        .filter((d) => d.notificationId === notification.id)
        .map(serialize),
    })),
    cursor: page.length > limit ? String(offset + limit) : null,
  };
}
