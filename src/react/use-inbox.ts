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
    markAllRead: (input: {
      organizationId?: string;
    }) => Promise<{ data: unknown; error: unknown }>;
  };
};

export type UseInboxOptions = {
  /** Poll interval for the unread count in ms. 0 disables polling. @default 30000 */
  pollInterval?: number;
  /** Page size for the notification list. @default 20 */
  pageSize?: number;
  /** Only fetch unread notifications, so a page is a full page. @default "all" */
  filter?: "unread" | "all";
  /** Scope everything to one organization. */
  organizationId?: string;
};

export function useInbox(
  client: InboxFetchClient,
  options: UseInboxOptions = {},
) {
  const {
    pollInterval = 30_000,
    pageSize = 20,
    filter = "all",
    organizationId,
  } = options;

  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const clientRef = useRef(client);
  clientRef.current = client;

  // Every request belongs to the scope it was made for. When the scope changes
  // mid-flight (an organizationId that resolves after mount, a tab switch), the
  // old response can land after the new one; applying it would show another
  // scope's count and rows. Callbacks capture their scope and drop stale results.
  const scope = `${organizationId ?? ""}|${filter}|${pageSize}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const listQuery = useCallback(
    (offset: number): ListQuery => ({
      limit: pageSize,
      offset,
      ...(filter === "unread" ? { filter } : {}),
      ...(organizationId ? { organizationId } : {}),
    }),
    [pageSize, filter, organizationId],
  );

  const refreshUnreadCount = useCallback(async () => {
    const res = await clientRef.current.inbox.unreadCount(
      organizationId ? { query: { organizationId } } : undefined,
    );
    if (res.data && scopeRef.current === scope) setUnreadCount(res.data.count);
  }, [organizationId, scope]);

  const refresh = useCallback(async () => {
    try {
      const [list] = await Promise.all([
        clientRef.current.inbox.list({ query: listQuery(0) }),
        refreshUnreadCount(),
      ]);
      if (scopeRef.current !== scope) return;
      if (list.error) {
        setError(list.error);
      } else if (list.data) {
        setError(null);
        setNotifications(list.data.notifications);
        setHasMore(list.data.hasMore);
      }
    } finally {
      // a transport failure still ends the initial load, otherwise a client
      // that mounts while offline renders a spinner forever
      if (scopeRef.current === scope) setIsLoading(false);
    }
  }, [listQuery, refreshUnreadCount, scope]);

  const notificationsRef = useRef(notifications);
  notificationsRef.current = notifications;

  const loadMore = useCallback(async () => {
    // Under the unread filter the server's result set shrinks as we mark things
    // read, so paging by list length would skip that many rows. The unread
    // notifications we hold are still the head of that set — count only those.
    const loaded =
      filter === "unread"
        ? notificationsRef.current.filter((n) => !n.read).length
        : notificationsRef.current.length;
    const res = await clientRef.current.inbox.list({
      query: listQuery(loaded),
    });
    if (res.data && scopeRef.current === scope) {
      const page = res.data.notifications;
      setNotifications((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...page.filter((n) => !seen.has(n.id))];
      });
      setHasMore(res.data.hasMore);
    }
  }, [listQuery, filter, scope]);

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
      organizationId ? { organizationId } : {},
    );
  }, [organizationId]);

  // These three triggers fire on their own, so nothing is awaiting them. The
  // transport rejects (rather than resolving to { error }) when the request
  // never reaches the server — an offline or backgrounded tab — and without a
  // catch that surfaces as an unhandled rejection in the consumer's app.
  const captureBackgroundError = useCallback((reason: unknown) => {
    setError(() => reason);
  }, []);

  useEffect(() => {
    refresh().catch(captureBackgroundError);
  }, [refresh, captureBackgroundError]);

  useEffect(() => {
    if (pollInterval <= 0) return;
    const interval = setInterval(() => {
      refreshUnreadCount().catch(captureBackgroundError);
    }, pollInterval);
    return () => clearInterval(interval);
  }, [pollInterval, refreshUnreadCount, captureBackgroundError]);

  useEffect(() => {
    const onFocus = () => {
      refresh().catch(captureBackgroundError);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh, captureBackgroundError]);

  return {
    notifications,
    unreadCount,
    isLoading,
    hasMore,
    error,
    filter,
    refresh,
    loadMore,
    markRead,
    markAllRead,
  };
}
