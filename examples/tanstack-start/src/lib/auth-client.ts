import { createAuthClient } from "better-auth/react";
import { inboxClient } from "@byo-oss/notifications/client";

export const authClient = createAuthClient({
  plugins: [inboxClient()],
});
