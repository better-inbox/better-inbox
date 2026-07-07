import { useCallback, useEffect, useRef, useState } from "react";

export type InboxNotification = {
  id: string;
  userId: string;
  organizationId?: string | null;
  type: string;
  title: string;
  body?: string | null;
  href?: string | null;
  data?: Record<string, unknown> | null;
  read: boolean;
  createdAt: Date | string;
};

type ListQuery = {
  limit?: number;
  offset?: number;
  filter?: "unread" | "all";
  organizationId?: string;
};

export type InboxFetchClient = {
  inbox: {
    list: (input: { query: ListQuery }) => Promise<{
      data: { notifications: InboxNotification[]; hasMore: boolean } | null;
      error: unknown;
    }>;
    unreadCount: (input?: { query?: { organizationId?: string } }) => Promise<{
      data: { count: number } | null;
      error: unknown;
    }>;
    markRead: (input: {
      id: string;
    }) => Promise<{ data: unknown; error: unknown }>;
    markAllRead: (input?: {
      organizationId?: string;
    }) => Promise<{ data: unknown; error: unknown }>;
  };
};

export type UseInboxOptions = {
  /** Poll interval for the unread count in ms. 0 disables polling. @default 30000 */
  pollInterval?: number;
  /** Page size for the notification list. @default 20 */
  pageSize?: number;
  /** Scope everything to one organization. */
  organizationId?: string;
};

export function useInbox(
  client: InboxFetchClient,
  options: UseInboxOptions = {},
) {
  const { pollInterval = 30_000, pageSize = 20, organizationId } = options;

  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const clientRef = useRef(client);
  clientRef.current = client;

  const listQuery = useCallback(
    (offset: number): ListQuery => ({
      limit: pageSize,
      offset,
      ...(organizationId ? { organizationId } : {}),
    }),
    [pageSize, organizationId],
  );

  const refreshUnreadCount = useCallback(async () => {
    const res = await clientRef.current.inbox.unreadCount(
      organizationId ? { query: { organizationId } } : undefined,
    );
    if (res.data) setUnreadCount(res.data.count);
  }, [organizationId]);

  const refresh = useCallback(async () => {
    const [list] = await Promise.all([
      clientRef.current.inbox.list({ query: listQuery(0) }),
      refreshUnreadCount(),
    ]);
    if (list.error) {
      setError(list.error);
    } else if (list.data) {
      setError(null);
      setNotifications(list.data.notifications);
      setHasMore(list.data.hasMore);
    }
    setIsLoading(false);
  }, [listQuery, refreshUnreadCount]);

  const notificationsRef = useRef(notifications);
  notificationsRef.current = notifications;

  const loadMore = useCallback(async () => {
    const res = await clientRef.current.inbox.list({
      query: listQuery(notificationsRef.current.length),
    });
    if (res.data) {
      setNotifications((prev) => [...prev, ...res.data!.notifications]);
      setHasMore(res.data.hasMore);
    }
  }, [listQuery]);

  const markRead = useCallback(async (id: string) => {
    const target = notificationsRef.current.find((n) => n.id === id);
    if (target && !target.read) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
      setUnreadCount((count) => Math.max(0, count - 1));
    }
    await clientRef.current.inbox.markRead({ id });
  }, []);

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    await clientRef.current.inbox.markAllRead(
      organizationId ? { organizationId } : undefined,
    );
  }, [organizationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (pollInterval <= 0) return;
    const interval = setInterval(() => void refreshUnreadCount(), pollInterval);
    return () => clearInterval(interval);
  }, [pollInterval, refreshUnreadCount]);

  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  return {
    notifications,
    unreadCount,
    isLoading,
    hasMore,
    error,
    refresh,
    loadMore,
    markRead,
    markAllRead,
  };
}
