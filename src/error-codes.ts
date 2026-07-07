import { defineErrorCodes } from "better-auth";

export const INBOX_ERROR_CODES = defineErrorCodes({
  NOTIFICATION_NOT_FOUND: "Notification not found",
  USER_OR_ORGANIZATION_REQUIRED:
    "Provide exactly one of userId or organizationId",
  ORGANIZATION_PLUGIN_REQUIRED:
    "organizationId requires the organization plugin",
  ORGANIZATION_HAS_NO_MEMBERS: "Organization has no matching members",
  FAN_OUT_LIMIT_EXCEEDED: "Organization member count exceeds maxFanout",
});
