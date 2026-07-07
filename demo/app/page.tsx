import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ActionsPanel } from "@/components/actions-panel";
import { Navbar } from "@/components/navbar";
import { auth } from "@/lib/auth";

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  return (
    <div>
      <Navbar email={session.user.email} />
      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-2xl font-semibold">Welcome, {session.user.email}</h1>
        <p className="mt-2 text-muted-foreground">
          Click a button, then open the bell in the navbar to see the notification.
        </p>
        <div className="mt-8">
          <ActionsPanel />
        </div>
      </main>
    </div>
  );
}
