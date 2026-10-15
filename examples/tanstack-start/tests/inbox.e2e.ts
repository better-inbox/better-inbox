import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("settings renders on the server with its search params", async ({
  app,
  screen,
}) => {
  // the raw HTML, before any client JavaScript runs
  const res = await fetch(new URL("/settings?tab=billing", app.baseUrl));
  const html = await res.text();
  expect(html).toContain("Settings</h1>");
  expect(html).toContain('data-testid="tab">billing</span>');

  await app.open("/settings?tab=billing");
  await expect(screen.getByRole("heading", "Settings")).toBeVisible();
  await expect(screen.getByTestId("tab")).toHaveText("billing");
});

test(
  "a notification's href navigates client-side, query and hash intact",
  { timeout: 60_000 },
  async ({ app, screen, browser }) => {
    let listCalls = 0;
    await browser.route("**/api/auth/inbox/list**", async (route) => {
      listCalls++;
      await route.continue();
    });

    await app.open("/");
    await screen.getByLabel("Email").fill(`user-${Date.now()}@example.dev`);
    await screen.getByLabel("Password").fill("example-password-123");
    await screen.getByRole("button", "Create account").tap();

    await screen.getByRole("button", "Send me a notification").tap();
    await expect(screen.getByRole("status")).toHaveText("Sent 1");

    // opening the bell fetches, so a notification sent seconds after mount
    // shows up without a reload
    const bell = screen.getByRole("button", "Notifications");

    // survives only if the next navigation is client-side, not a page load
    await browser.evaluate(() => {
      (window as unknown as { __marker: string }).__marker = "alive";
      return null;
    });

    await bell.tap();
    await screen.getByText("Payment failed — update your card").tap();

    await expect(browser).toHaveURL("/settings?tab=billing#card");
    await expect(screen.getByTestId("tab")).toHaveText("billing");
    await expect(screen.getByTestId("section")).toHaveText("#card");
    expect(
      await browser.evaluate(
        () => (window as unknown as { __marker?: string }).__marker ?? null,
      ),
    ).toBe("alive");

    // InboxButton sits in the root layout, so route changes don't remount it
    // and don't refetch the list (#5)
    await bell.press("Escape");
    const before = listCalls;
    expect(before).toBeGreaterThan(0); // the route really is counting
    for (let i = 0; i < 3; i++) {
      await screen.getByRole("link", "Home").tap();
      await expect(screen.getByRole("heading", "Home")).toBeVisible();
      await screen.getByRole("link", "Settings").tap();
      await expect(screen.getByRole("heading", "Settings")).toBeVisible();
    }
    expect(listCalls).toBe(before);
  },
);
