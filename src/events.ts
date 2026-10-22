import { queueAfterTransactionHook } from "@better-auth/core/context";
import type { ByoEvent, ByoEventHandler } from "@byo-oss/core";
import type { Notification, NotificationDelivery } from "./schema";

/** Every event type this package emits, for routing on an event bus. */
export const NOTIFICATIONS_EVENT_TYPES = [
  "notifications.notification.created",
  "notifications.delivery.failed",
] as const;

export type NotificationsEventType = (typeof NOTIFICATIONS_EVENT_TYPES)[number];

type Base = Omit<ByoEvent, "type" | "subject" | "data" | "actorId" | "userId"> & {
  /** Always `null`: `notify` is server-only and has no caller identity. */
  actorId: null;
  /** The recipient. */
  userId: string;
};

/** One notification row was created (one per recipient of an org fan-out). */
export type NotificationCreatedEvent = Base & {
  type: "notifications.notification.created";
  subject: { type: "notification"; id: string };
  data: { notificationId: string; notificationType: string };
};

/** A delivery (an email, say) was marked failed and won't be retried. */
export type DeliveryFailedEvent = Base & {
  type: "notifications.delivery.failed";
  subject: { type: "notificationDelivery"; id: string };
  data: {
    deliveryId: string;
    notificationId: string;
    notificationType: string;
    channel: string;
    attempts: number;
    /**
     * `"permanent"`: the channel threw a `PermanentDeliveryError` (or
     * `permanent: true`). `"max_attempts"`: it kept failing. `"unfinished"`: a
     * send outlived its lease with no attempts left.
     */
    reason: "permanent" | "max_attempts" | "unfinished";
  };
};

export type NotificationsEvent = NotificationCreatedEvent | DeliveryFailedEvent;

export const notificationCreated = (
  notification: Notification,
): NotificationCreatedEvent => ({
  type: "notifications.notification.created",
  occurredAt: new Date(notification.createdAt),
  actorId: null,
  userId: notification.userId,
  ...(notification.organizationId
    ? { organizationId: notification.organizationId }
    : {}),
  subject: { type: "notification", id: notification.id },
  // no title, body, href or data: href can carry tokens, data is the app's
  data: { notificationId: notification.id, notificationType: notification.type },
});

export const deliveryFailed = (
  delivery: Pick<
    NotificationDelivery,
    "id" | "notificationId" | "userId" | "type" | "channel"
  >,
  {
    organizationId,
    attempts,
    reason,
  }: {
    organizationId: string | null | undefined;
    attempts: number;
    reason: DeliveryFailedEvent["data"]["reason"];
  },
): DeliveryFailedEvent => ({
  type: "notifications.delivery.failed",
  occurredAt: new Date(),
  actorId: null,
  userId: delivery.userId,
  ...(organizationId ? { organizationId } : {}),
  subject: { type: "notificationDelivery", id: delivery.id },
  // no detail: provider errors can contain addresses
  data: {
    deliveryId: delivery.id,
    notificationId: delivery.notificationId,
    notificationType: delivery.type,
    channel: delivery.channel,
    attempts,
    reason,
  },
});

/**
 * Hands `event` to `onEvent` once the write it describes has committed. A
 * write through the base adapter (`writeAdapter === context.adapter`) already
 * has, so the handler runs now. A write that joined a caller's
 * `runWithTransaction` is held until that transaction commits and dropped if
 * it rolls back. Never throws: handler and logger errors are logged or
 * swallowed.
 */
export async function emit(
  onEvent: ByoEventHandler | undefined,
  context: {
    adapter: unknown;
    logger: { error: (message: string, ...args: unknown[]) => void };
  },
  // the adapter the write used
  writeAdapter: unknown,
  // built at write time, so occurredAt is when the write happened
  event: NotificationsEvent,
): Promise<void> {
  if (!onEvent) return;
  const report = (error: unknown) => {
    try {
      context.logger.error(
        `[@byo-oss/notifications] onEvent failed for ${event.type}`,
        error,
      );
    } catch {
      // a throwing logger must not fail the write that caused the event
    }
  };
  const run = async () => {
    try {
      await onEvent(event);
    } catch (error) {
      report(error);
    }
  };
  try {
    if (writeAdapter === context.adapter) await run();
    else await queueAfterTransactionHook(run, { onError: async (error) => report(error) });
  } catch (error) {
    report(error);
  }
}
