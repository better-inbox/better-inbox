import { web } from "@e2e-dev/web";
import type { E2EConfig } from "e2e";

// No agent steps, so no model: every check is a locator or URL assertion.
export default {
  targets: [
    {
      engine: web(),
      app: {
        // port 0: the runner picks a free port and fills in {port}
        url: "http://127.0.0.1:0",
        command: {
          executable: "npm",
          args: ["run", "e2e:serve", "--", "--host", "127.0.0.1", "--port", "{port}"],
          env: { DB_PATH: "./e2e.db" },
          log: ".e2e/logs/app.log",
        },
      },
    },
  ],
} satisfies E2EConfig;
