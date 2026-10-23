import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      client: "src/client.ts",
      wraps: "src/wraps.ts",
      mailer: "src/mailer.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    // clean is done in the build script — with two parallel configs, tsup's
    // own clean races the other config's output and can delete emitted files
    clean: false,
    external: ["react", "better-auth", "zod", "@wraps.dev/email", "@byo-oss/mailer"],
  },
  {
    // ESM only: vitest throws when it's require()d
    entry: { testing: "src/testing.ts" },
    format: ["esm"],
    dts: true,
    clean: false,
    external: ["better-auth", "vitest"],
  },
  {
    entry: {
      "react/index": "src/react/index.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    external: ["react", "better-auth", "zod"],
    banner: { js: '"use client";' },
  },
]);
