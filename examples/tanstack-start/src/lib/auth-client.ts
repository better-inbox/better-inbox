import { createAuthClient } from "better-auth/react";
import { inboxClient } from "better-inbox/client";

export const authClient = createAuthClient({
  plugins: [inboxClient()],
});
