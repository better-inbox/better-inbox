import type { AuthContext, Where } from "better-auth";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import type { Notification } from "./schema";

/**
 * Any better-auth instance (your `auth`). Loose on purpose: a typed instance's
 * `$context` doesn't assign to the generic `AuthContext`.
 */
export type AuthWithContext = { $context: Promise<object> };

// ids per delete, so an org with many notifications doesn't build one huge `in`
const DELETE_PAGE = 500;

async function inboxContext(auth: AuthWithContext, caller: string) {
  const context = (await auth.$context) as AuthContext;
  if (!context.options.plugins?.some((plugin) => plugin.id === "inbox")) {
    throw new Error(
      `[@byo-oss/notifications] ${caller} needs the inbox plugin installed on this auth instance`,
    );
  }
  return context;
}

// deliveries go first: adapters without foreign keys (memory, MongoDB) don't
// cascade, and a delivery must never outlive its notification
async function deleteNotifications(context: AuthContext, where: Where[]) {
  let deleted = 0;
  for (;;) {
    const page = await context.adapter.findMany<Pick<Notification, "id">>({
      model: "notification",
      where,
      limit: DELETE_PAGE,
      select: ["id"],
    });
    if (page.length === 0) return deleted;
    const ids = page.map((row) => row.id);
    await context.adapter.deleteMany({
      model: "notificationDelivery",
      where: [{ field: "notificationId", operator: "in", value: ids }],
    });
    await context.adapter.deleteMany({
      model: "notification",
      where: [{ field: "id", operator: "in", value: ids }],
    });
    deleted += ids.length;
  }
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
 * endpoints. Deletes made any other way need the exported functions.
 */
export const organizationCleanupHook = {
  matcher: (ctx: { path?: string }) => !!ctx.path && ctx.path in orgCleanup,
  handler: createAuthMiddleware(async (ctx) => {
    const returned = ctx.context.returned;
    if (!ctx.path || isAPIError(returned)) return;
    const where = orgCleanup[ctx.path]?.(returned);
    if (!where) return;
    try {
      await deleteNotifications(ctx.context, where);
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
 * call it for organizations deleted any other way.
 */
export async function deleteOrganizationData(
  auth: AuthWithContext,
  organizationId: string,
): Promise<{ notifications: number }> {
  const context = await inboxContext(auth, "deleteOrganizationData");
  const notifications = await deleteNotifications(context, [
    { field: "organizationId", value: organizationId },
  ]);
  return { notifications };
}

/**
 * Deletes one person's notifications (and deliveries) in one organization, for
 * when they leave it or are removed. Their other notifications stay. The
 * plugin already does this after `/organization/remove-member` and
 * `/organization/leave`.
 */
export async function deleteMemberData(
  auth: AuthWithContext,
  { userId, organizationId }: { userId: string; organizationId: string },
): Promise<{ notifications: number }> {
  const context = await inboxContext(auth, "deleteMemberData");
  const notifications = await deleteNotifications(context, [
    { field: "userId", value: userId },
    { field: "organizationId", value: organizationId },
  ]);
  return { notifications };
}
