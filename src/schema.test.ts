import { getAuthTables } from "@better-auth/core/db";
import { describe, expect, it } from "vitest";
import { inbox } from "./index";

describe("schema", () => {
  // migration generators don't all default to cascade, so every reference says it
  it("cascades every reference on delete", () => {
    const tables = getAuthTables({ plugins: [inbox()] });
    const models = ["notification", "notificationDelivery", "inboxPresence"];
    const references = models.flatMap((model) =>
      Object.entries(tables[model]?.fields ?? {})
        .filter(([, field]) => field.references)
        .map(([name, field]) => [
          `${model}.${name}`,
          field.references?.onDelete,
        ]),
    );
    expect(references).toEqual([
      ["notification.userId", "cascade"],
      ["notificationDelivery.notificationId", "cascade"],
      ["notificationDelivery.userId", "cascade"],
      ["inboxPresence.userId", "cascade"],
    ]);
  });
});
