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

function makeMockClient(
  notifications = [
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
  ],
): InboxFetchClient {
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

  // A parent re-rendering — a new inline onNavigate, a client object rebuilt
  // each render — must not refetch; only a scope change should (#5).
  it("does not refetch when the parent re-renders", async () => {
    const client = makeMockClient();
    const { rerender } = render(
      <InboxButton client={{ ...client }} onNavigate={() => {}} />,
    );
    await waitFor(() => expect(screen.getByText("2")).toBeTruthy());

    for (let i = 0; i < 10; i++) {
      rerender(<InboxButton client={{ ...client }} onNavigate={() => {}} />);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(client.inbox.list).toHaveBeenCalledTimes(1);
    expect(client.inbox.unreadCount).toHaveBeenCalledTimes(1);
  });

  // Opening the bell is a deliberate look: it must show what arrived since
  // mount, even seconds later, not skip as fresh (0.4.0 regression).
  it("refetches when the panel opens right after mount", async () => {
    const client = makeMockClient();
    render(<InboxButton client={client} />);
    await waitFor(() => expect(screen.getByText("2")).toBeTruthy());
    expect(client.inbox.list).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await waitFor(() => expect(client.inbox.list).toHaveBeenCalledTimes(2));
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

  it("opens on the unread tab, first, and fetches unread rows", async () => {
    const client = makeMockClient();
    render(<InboxButton client={client} />);

    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await waitFor(() =>
      expect(screen.getByText("First notification")).toBeTruthy(),
    );

    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "unread",
      "all",
    ]);
    expect(
      screen
        .getByRole("tab", { name: /unread/i })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(client.inbox.list).toHaveBeenCalledWith({
      query: { limit: 20, offset: 0, filter: "unread" },
    });
  });

  it("switching to all refetches without the unread filter", async () => {
    const client = makeMockClient();
    render(<InboxButton client={client} />);

    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await waitFor(() =>
      expect(screen.getByText("First notification")).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("tab", { name: /all/i }));

    await waitFor(() =>
      expect(client.inbox.list).toHaveBeenCalledWith({
        query: { limit: 20, offset: 0 },
      }),
    );
    expect(
      screen.getByRole("tab", { name: /all/i }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("a controlled unread view does not hide rows the server returned", async () => {
    const client = makeMockClient([
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
        read: true,
        createdAt: new Date().toISOString(),
      },
    ]);
    render(<InboxButton client={client} />);

    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await waitFor(() =>
      expect(screen.getByText("First notification")).toBeTruthy(),
    );

    expect(screen.getByText("Second notification")).toBeTruthy();
  });
});
