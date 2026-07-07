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
      createdAt: {
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
  createdAt: Date;
};
