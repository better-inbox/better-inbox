import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      client: "src/client.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    external: ["react", "better-auth", "zod"],
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
