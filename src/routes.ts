import type { Where } from "better-auth";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import * as z from "zod";
import { INBOX_ERROR_CODES } from "./error-codes";
import type { Notification } from "./schema";

export type ResolvedInboxOptions = {
  maxFanout: number;
};

const notifyBodySchema = z
  .object({
    userId: z.string().optional(),
    organizationId: z.string().optional(),
    roles: z.array(z.string()).optional(),
    type: z.string(),
    title: z.string(),
    body: z.string().optional(),
    href: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((body) => !!body.userId !== !!body.organizationId, {
    message: INBOX_ERROR_CODES.USER_OR_ORGANIZATION_REQUIRED.message,
  });

export const notify = (options: ResolvedInboxOptions) =>
  createAuthEndpoint.serverOnly(
    {
      method: "POST",
      body: notifyBodySchema,
    },
    async (ctx) => {
      const { userId, organizationId, roles, ...payload } = ctx.body;
      const notification = await ctx.context.adapter.create<
        Omit<Notification, "id">,
        Notification
      >({
        model: "notification",
        data: {
          userId: userId!,
          ...payload,
          read: false,
          createdAt: new Date(),
        },
      });
      return { count: 1, notifications: [notification] };
    },
  );

const listQuerySchema = z
  .object({
    filter: z.enum(["unread", "all"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    organizationId: z.string().optional(),
  })
  .optional();

export const listNotifications = () =>
  createAuthEndpoint(
    "/inbox/list",
    {
      method: "GET",
      query: listQuerySchema,
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const { filter = "all", limit = 20, offset = 0 } = ctx.query ?? {};
      const where: Where[] = [
        { field: "userId", value: ctx.context.session.user.id },
      ];
      if (filter === "unread") {
        where.push({ field: "read", value: false });
      }
      const rows = await ctx.context.adapter.findMany<Notification>({
        model: "notification",
        where,
        limit: limit + 1,
        offset,
        sortBy: { field: "createdAt", direction: "desc" },
      });
      return {
        notifications: rows.slice(0, limit),
        hasMore: rows.length > limit,
      };
    },
  );

export const markRead = () =>
  createAuthEndpoint(
    "/inbox/mark-read",
    {
      method: "POST",
      body: z.object({ id: z.string() }),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const updated = await ctx.context.adapter.update<Notification>({
        model: "notification",
        where: [
          { field: "id", value: ctx.body.id },
          { field: "userId", value: ctx.context.session.user.id },
        ],
        update: { read: true },
      });
      if (!updated) {
        throw APIError.from(
          "NOT_FOUND",
          INBOX_ERROR_CODES.NOTIFICATION_NOT_FOUND,
        );
      }
      return { notification: updated };
    },
  );

export const markAllRead = () =>
  createAuthEndpoint(
    "/inbox/mark-all-read",
    {
      method: "POST",
      body: z.object({ organizationId: z.string().optional() }).optional(),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const where: Where[] = [
        { field: "userId", value: ctx.context.session.user.id },
        { field: "read", value: false },
      ];
      if (ctx.body?.organizationId) {
        where.push({ field: "organizationId", value: ctx.body.organizationId });
      }
      const count = await ctx.context.adapter.updateMany({
        model: "notification",
        where,
        update: { read: true },
      });
      return { count };
    },
  );

export const unreadCount = () =>
  createAuthEndpoint(
    "/inbox/unread-count",
    {
      method: "GET",
      query: z.object({ organizationId: z.string().optional() }).optional(),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const where: Where[] = [
        { field: "userId", value: ctx.context.session.user.id },
        { field: "read", value: false },
      ];
      if (ctx.query?.organizationId) {
        where.push({
          field: "organizationId",
          value: ctx.query.organizationId,
        });
      }
      const count = await ctx.context.adapter.count({
        model: "notification",
        where,
      });
      return { count };
    },
  );
