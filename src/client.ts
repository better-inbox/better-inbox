import type { BetterAuthClientPlugin } from "better-auth/client";
import type { inbox } from "./index";

export const inboxClient = () => {
  return {
    id: "inbox",
    $InferServerPlugin: {} as ReturnType<typeof inbox>,
    pathMethods: {
      "/inbox/list": "GET",
      "/inbox/unread-count": "GET",
      "/inbox/mark-read": "POST",
      "/inbox/mark-all-read": "POST",
    },
  } satisfies BetterAuthClientPlugin;
};

export type { Notification } from "./schema";
