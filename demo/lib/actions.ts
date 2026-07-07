"use server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export async function notifyMe() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not authenticated");

  await auth.api.notify({
    body: {
      userId: session.user.id,
      type: "demo.ping",
      title: "Hello from the demo",
      href: "/",
    },
  });
}

export async function simulateBillingFailure() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not authenticated");

  const orgs = await auth.api.listOrganizations({ headers: await headers() });
  const org = orgs?.[0];
  if (!org) throw new Error("No organization found for user");

  await auth.api.notify({
    body: {
      organizationId: org.id,
      roles: ["owner", "admin"],
      type: "billing.payment_failed",
      title: "Payment failed — update your card",
      href: "/",
    },
  });
}
