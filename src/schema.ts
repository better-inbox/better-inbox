import type { BetterAuthPlugin } from "better-auth";

export const schema = {
  notification: {
    fields: {
      userId: {
        type: "string",
        required: true,
        references: { model: "user", field: "id" },
      },
      organizationId: {
        type: "string",
        required: false,
      },
      type: {
        type: "string",
        required: true,
      },
      title: {
        type: "string",
        required: true,
      },
      body: {
        type: "string",
        required: false,
      },
      href: {
        type: "string",
        required: false,
      },
      data: {
        type: "json",
        required: false,
      },
      read: {
        type: "boolean",
        required: true,
        defaultValue: false,
      },
      seenAt: {
        type: "date",
        required: false,
      },
      createdAt: {
        type: "date",
        required: true,
      },
    },
  },
  notificationDelivery: {
    fields: {
      notificationId: {
        type: "string",
        required: true,
        references: { model: "notification", field: "id" },
      },
      userId: {
        type: "string",
        required: true,
        references: { model: "user", field: "id" },
      },
      channel: {
        type: "string",
        required: true,
      },
      status: {
        type: "string",
        required: true,
      },
      scheduledFor: {
        type: "date",
        required: true,
      },
      attempts: {
        type: "number",
        required: true,
        defaultValue: 0,
      },
      claimedAt: {
        type: "date",
        required: false,
      },
      sentAt: {
        type: "date",
        required: false,
      },
      detail: {
        type: "string",
        required: false,
      },
      createdAt: {
        type: "date",
        required: true,
      },
    },
  },
  inboxPresence: {
    fields: {
      userId: {
        type: "string",
        required: true,
        unique: true,
        references: { model: "user", field: "id" },
      },
      lastSeenAt: {
        type: "date",
        required: true,
      },
    },
  },
} satisfies NonNullable<BetterAuthPlugin["schema"]>;

export type Notification = {
  id: string;
  userId: string;
  organizationId?: string | null;
  type: string;
  title: string;
  body?: string | null;
  href?: string | null;
  data?: Record<string, unknown> | null;
  read: boolean;
  seenAt?: Date | null;
  createdAt: Date;
};

export type DeliveryStatus = "pending" | "sending" | "sent" | "skipped" | "failed";

export type NotificationDelivery = {
  id: string;
  notificationId: string;
  userId: string;
  channel: string;
  status: DeliveryStatus;
  scheduledFor: Date;
  attempts: number;
  claimedAt?: Date | null;
  sentAt?: Date | null;
  /** Why a delivery was skipped, or the last error for a retry or failure. */
  detail?: string | null;
  createdAt: Date;
};

export type InboxPresence = {
  id: string;
  userId: string;
  lastSeenAt: Date;
};
