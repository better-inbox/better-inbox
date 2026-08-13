// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InboxButton } from "./inbox-button";
import type { InboxFetchClient } from "./use-inbox";

function makeMockClient(): InboxFetchClient {
  const notifications = [
    {
      id: "n1",
      userId: "u1",
      type: "test",
      title: "First notification",
      read: false,
      createdAt: new Date().toISOString(),
    },
    {
      id: "n2",
      userId: "u1",
      type: "test",
      title: "Second notification",
      read: false,
      createdAt: new Date().toISOString(),
    },
  ];
  return {
    inbox: {
      list: vi.fn().mockResolvedValue({
        data: { notifications, hasMore: false },
        error: null,
      }),
      unreadCount: vi
        .fn()
        .mockResolvedValue({ data: { count: 2 }, error: null }),
      markRead: vi.fn().mockResolvedValue({ data: {}, error: null }),
      markAllRead: vi
        .fn()
        .mockResolvedValue({ data: { count: 2 }, error: null }),
    },
  };
}

describe("InboxButton", () => {
  // vitest runs without globals, so RTL never auto-cleans between tests
  afterEach(cleanup);

  it("shows the unread badge, opens the panel, and marks all read", async () => {
    const client = makeMockClient();
    render(<InboxButton client={client} />);

    await waitFor(() => expect(screen.getByText("2")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await waitFor(() =>
      expect(screen.getByText("First notification")).toBeTruthy(),
    );
    expect(screen.getByText("Second notification")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /mark all read/i }));
    expect(client.inbox.markAllRead).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("2")).toBeNull());
  });

  it("fetches only unread rows and drops the tabs when filtered", async () => {
    const client = makeMockClient();
    render(<InboxButton client={client} filter="unread" />);

    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await waitFor(() =>
      expect(screen.getByText("First notification")).toBeTruthy(),
    );

    expect(client.inbox.list).toHaveBeenCalledWith({
      query: { limit: 20, offset: 0, filter: "unread" },
    });
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });
});
