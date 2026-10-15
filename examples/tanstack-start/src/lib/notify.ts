import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "./auth";

// The href carries a query string and a hash on purpose: onNavigate has to
// hand the whole thing to the router, not just the path.
export const notifyMe = createServerFn({ method: "POST" }).handler(async () => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() });
  if (!session) throw new Error("Not authenticated");

  await auth.api.notify({
    body: {
      userId: session.user.id,
      type: "billing.payment_failed",
      title: "Payment failed — update your card",
      href: "/settings?tab=billing#card",
    },
  });
});
