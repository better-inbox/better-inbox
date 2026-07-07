// @vitest-environment happy-dom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useInbox, type InboxFetchClient } from "./use-inbox";

function makeNotification(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: "u1",
    type: "test",
    title: `Notification ${id}`,
    read: false,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeMockClient(
  notifications = [makeNotification("n1"), makeNotification("n2")],
) {
  const client = {
    inbox: {
      list: vi.fn().mockResolvedValue({
        data: { notifications, hasMore: false },
        error: null,
      }),
      unreadCount: vi.fn().mockResolvedValue({
        data: { count: notifications.filter((n) => !n.read).length },
        error: null,
      }),
      markRead: vi.fn().mockResolvedValue({ data: {}, error: null }),
      markAllRead: vi.fn().mockResolvedValue({ data: { count: 0 }, error: null }),
    },
  } satisfies InboxFetchClient;
  return client;
}

describe("useInbox", () => {
  it("loads notifications and unread count on mount", async () => {
    const client = makeMockClient();
    const { result } = renderHook(() => useInbox(client));

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.notifications).toHaveLength(2);
    expect(result.current.unreadCount).toBe(2);
    expect(result.current.hasMore).toBe(false);
    expect(client.inbox.list).toHaveBeenCalledWith({
      query: { limit: 20, offset: 0 },
    });
  });

  it("polls the unread count on the interval and refreshes on window focus", async () => {
    vi.useFakeTimers();
    try {
      const client = makeMockClient();
      renderHook(() => useInbox(client, { pollInterval: 1000 }));

      await vi.advanceTimersByTimeAsync(0);
      expect(client.inbox.unreadCount).toHaveBeenCalledTimes(1);
      expect(client.inbox.list).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(client.inbox.unreadCount).toHaveBeenCalledTimes(2);
      expect(client.inbox.list).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
      expect(client.inbox.list).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("optimistically marks read and decrements the unread count", async () => {
    const client = makeMockClient();
    let resolveMarkRead: (v: { data: unknown; error: null }) => void;
    client.inbox.markRead.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMarkRead = resolve;
        }),
    );

    const { result } = renderHook(() => useInbox(client));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.unreadCount).toBe(2);

    // state updates before the server responds
    result.current.markRead("n1");
    await waitFor(() => {
      expect(
        result.current.notifications.find((n) => n.id === "n1")?.read,
      ).toBe(true);
      expect(result.current.unreadCount).toBe(1);
    });
    expect(client.inbox.markRead).toHaveBeenCalledWith({ id: "n1" });
    resolveMarkRead!({ data: {}, error: null });
  });
});
