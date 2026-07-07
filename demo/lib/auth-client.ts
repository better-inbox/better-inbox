"use client";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { inboxClient } from "better-inbox/client";

export const authClient = createAuthClient({
  plugins: [organizationClient(), inboxClient()],
});
