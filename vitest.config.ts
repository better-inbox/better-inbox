import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // the dist test needs a build first: `bun run test:dist`
    exclude: [...configDefaults.exclude, "**/*.dist.test.ts"],
  },
});
