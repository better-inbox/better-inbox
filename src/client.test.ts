import { createAuthClient } from "better-auth/client";
import { describe, expect, it } from "vitest";
import { inboxClient } from "./client";
import { createTestAuth, signUpUser } from "./test-utils";

function createTestClient(
  auth: ReturnType<typeof createTestAuth>,
  headers: Headers,
) {
  return createAuthClient({
    baseURL: "http://localhost:3000",
    plugins: [inboxClient()],
    fetchOptions: {
      customFetchImpl: (input, init) =>
        auth.handler(new Request(input, init)),
      headers,
    },
  });
}

describe("inboxClient", () => {
  it("lists notifications through the real handler with typed methods", async () => {
    const auth = createTestAuth();
    const alice = await signUpUser(auth, "alice@example.com");
    await auth.api.notify({
      body: { userId: alice.user.id, type: "test", title: "Via HTTP" },
    });

    const client = createTestClient(auth, alice.headers);
    const { data, error } = await client.inbox.list({ query: {} });

    expect(error).toBeNull();
    expect(data?.notifications).toHaveLength(1);
    expect(data?.notifications[0]).toMatchObject({
      title: "Via HTTP",
      read: false,
    });
    expect(data?.hasMore).toBe(false);
  });

  it("markRead round-trip drops the unread count", async () => {
    const auth = createTestAuth();
    const alice = await signUpUser(auth, "alice@example.com");
    const created = await auth.api.notify({
      body: { userId: alice.user.id, type: "test", title: "Unread" },
    });
    const id = created.notifications[0]!.id;

    const client = createTestClient(auth, alice.headers);

    const before = await client.inbox.unreadCount();
    expect(before.data?.count).toBe(1);

    const marked = await client.inbox.markRead({ id });
    expect(marked.error).toBeNull();

    const after = await client.inbox.unreadCount();
    expect(after.data?.count).toBe(0);
  });

  it("markAllRead round-trip zeroes the unread count", async () => {
    const auth = createTestAuth();
    const alice = await signUpUser(auth, "alice@example.com");
    for (const title of ["a", "b"]) {
      await auth.api.notify({
        body: { userId: alice.user.id, type: "test", title },
      });
    }

    const client = createTestClient(auth, alice.headers);
    const marked = await client.inbox.markAllRead({});
    expect(marked.error).toBeNull();

    const after = await client.inbox.unreadCount();
    expect(after.data?.count).toBe(0);
  });
});
