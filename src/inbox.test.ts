import { describe, expect, it } from "vitest";
import { createTestAuth, signUpUser } from "./test-utils";

describe("notify + listNotifications", () => {
  it("delivers a notification to the addressed user's inbox", async () => {
    const auth = createTestAuth();
    const { user, headers } = await signUpUser(auth, "alice@example.com");

    await auth.api.notify({
      body: {
        userId: user.id,
        type: "test.hello",
        title: "Hello Alice",
        href: "/welcome",
      },
    });

    const res = await auth.api.listNotifications({ headers, query: {} });
    expect(res.notifications).toHaveLength(1);
    expect(res.notifications[0]).toMatchObject({
      userId: user.id,
      type: "test.hello",
      title: "Hello Alice",
      href: "/welcome",
      read: false,
    });
    expect(res.hasMore).toBe(false);
  });

  it("never returns another user's notifications", async () => {
    const auth = createTestAuth();
    const alice = await signUpUser(auth, "alice@example.com");
    const bob = await signUpUser(auth, "bob@example.com");

    await auth.api.notify({
      body: { userId: alice.user.id, type: "test", title: "For Alice" },
    });

    const bobsInbox = await auth.api.listNotifications({
      headers: bob.headers,
      query: {},
    });
    expect(bobsInbox.notifications).toHaveLength(0);
  });
});

describe("markRead", () => {
  it("marks the caller's own notification read; foreign ids are not found", async () => {
    const auth = createTestAuth();
    const alice = await signUpUser(auth, "alice@example.com");
    const bob = await signUpUser(auth, "bob@example.com");

    const created = await auth.api.notify({
      body: { userId: alice.user.id, type: "test", title: "Read me" },
    });
    const id = created.notifications[0]!.id;

    await auth.api.markRead({ headers: alice.headers, body: { id } });
    const list = await auth.api.listNotifications({
      headers: alice.headers,
      query: {},
    });
    expect(list.notifications[0]).toMatchObject({ id, read: true });

    const created2 = await auth.api.notify({
      body: { userId: alice.user.id, type: "test", title: "Not Bob's" },
    });
    const foreignId = created2.notifications[0]!.id;
    await expect(
      auth.api.markRead({ headers: bob.headers, body: { id: foreignId } }),
    ).rejects.toThrow(/Notification not found/);

    const after = await auth.api.listNotifications({
      headers: alice.headers,
      query: {},
    });
    const untouched = after.notifications.find((n) => n.id === foreignId);
    expect(untouched?.read).toBe(false);
  });
});

describe("list filtering + pagination", () => {
  it("filters unread and paginates with offset/hasMore", async () => {
    const auth = createTestAuth();
    const alice = await signUpUser(auth, "alice@example.com");

    const ids: string[] = [];
    for (const title of ["one", "two", "three"]) {
      const res = await auth.api.notify({
        body: { userId: alice.user.id, type: "test", title },
      });
      ids.push(res.notifications[0]!.id);
    }
    await auth.api.markRead({
      headers: alice.headers,
      body: { id: ids[0]! },
    });

    const unread = await auth.api.listNotifications({
      headers: alice.headers,
      query: { filter: "unread" },
    });
    expect(unread.notifications).toHaveLength(2);
    expect(unread.notifications.every((n) => n.read === false)).toBe(true);

    const page1 = await auth.api.listNotifications({
      headers: alice.headers,
      query: { limit: 2 },
    });
    expect(page1.notifications).toHaveLength(2);
    expect(page1.hasMore).toBe(true);

    const page2 = await auth.api.listNotifications({
      headers: alice.headers,
      query: { limit: 2, offset: 2 },
    });
    expect(page2.notifications).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
  });
});

describe("markAllRead", () => {
  it("marks all of the caller's unread, and only theirs", async () => {
    const auth = createTestAuth();
    const alice = await signUpUser(auth, "alice@example.com");
    const bob = await signUpUser(auth, "bob@example.com");

    for (const title of ["a", "b", "c"]) {
      await auth.api.notify({
        body: { userId: alice.user.id, type: "test", title },
      });
    }
    await auth.api.notify({
      body: { userId: bob.user.id, type: "test", title: "bob's" },
    });

    await auth.api.markAllRead({ headers: alice.headers, body: {} });

    const alices = await auth.api.listNotifications({
      headers: alice.headers,
      query: {},
    });
    expect(alices.notifications.every((n) => n.read === true)).toBe(true);

    const bobs = await auth.api.listNotifications({
      headers: bob.headers,
      query: {},
    });
    expect(bobs.notifications[0]?.read).toBe(false);
  });
});

describe("unreadCount", () => {
  it("counts only the caller's unread notifications", async () => {
    const auth = createTestAuth();
    const alice = await signUpUser(auth, "alice@example.com");
    const bob = await signUpUser(auth, "bob@example.com");

    let firstId = "";
    for (const title of ["a", "b"]) {
      const res = await auth.api.notify({
        body: { userId: alice.user.id, type: "test", title },
      });
      firstId = res.notifications[0]!.id;
    }
    await auth.api.notify({
      body: { userId: bob.user.id, type: "test", title: "bob's" },
    });

    const before = await auth.api.unreadCount({ headers: alice.headers });
    expect(before.count).toBe(2);

    await auth.api.markRead({
      headers: alice.headers,
      body: { id: firstId },
    });
    const after = await auth.api.unreadCount({ headers: alice.headers });
    expect(after.count).toBe(1);
  });
});

describe("authentication", () => {
  it("rejects all inbox endpoints without a session", async () => {
    const auth = createTestAuth();
    const noSession = new Headers();

    await expect(
      auth.api.listNotifications({ headers: noSession, query: {} }),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
    await expect(
      auth.api.markRead({ headers: noSession, body: { id: "x" } }),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
    await expect(
      auth.api.markAllRead({ headers: noSession, body: {} }),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
    await expect(
      auth.api.unreadCount({ headers: noSession }),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
  });
});
