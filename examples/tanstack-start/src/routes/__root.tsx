/// <reference types="vite/client" />
import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import { InboxButton } from "@byo-oss/notifications/react";
import type { ReactNode } from "react";
import { authClient } from "../lib/auth-client";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "@byo-oss/notifications × TanStack Start" },
    ],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

// InboxButton lives in the root layout, which stays mounted across client-side
// navigations, so moving between pages doesn't refetch the inbox.
function RootLayout() {
  const router = useRouter();
  const { data: session } = authClient.useSession();

  return (
    <>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "12px 24px",
          borderBottom: "1px solid #e5e5e5",
        }}
      >
        <strong>@byo-oss/notifications × TanStack Start</strong>
        <nav style={{ display: "flex", gap: 12 }}>
          <Link to="/">Home</Link>
          <Link to="/settings">Settings</Link>
        </nav>
        <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
          {session ? (
            <>
              <span>{session.user.email}</span>
              {/* `href` takes the full string, query and hash included */}
              <InboxButton
                client={authClient}
                onNavigate={(href) => router.navigate({ href })}
              />
            </>
          ) : null}
        </div>
      </header>
      <main style={{ padding: 24 }}>
        <Outlet />
      </main>
    </>
  );
}
