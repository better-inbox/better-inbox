"use client";
import { useRouter } from "next/navigation";
import { InboxButton } from "better-inbox/react";
import { authClient } from "@/lib/auth-client";

export function Navbar({ email }: { email: string }) {
  const router = useRouter();
  return (
    <nav className="flex items-center justify-between border-b border-border px-6 py-3">
      <span className="font-semibold">better-inbox demo</span>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">{email}</span>
        <InboxButton client={authClient} onNavigate={(href) => router.push(href)} />
        <button
          type="button"
          onClick={async () => {
            await authClient.signOut();
            router.push("/sign-in");
          }}
          className="rounded-md border border-border px-3 py-1 text-sm hover:bg-accent hover:text-accent-foreground"
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
