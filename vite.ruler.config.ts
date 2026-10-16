/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Builds `eval/ruler-entry.ts` into one file a Playwright page can load, so
the ruler the gate uses can also be called per post by a generating agent.
Its own config because the main build ships the runtime, and this is a
tool.
*/
import { resolve } from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  publicDir: false,
  build: {
    outDir: ".ruler",
    emptyOutDir: true,
    target: "es2022",
    minify: false,
    lib: { entry: resolve(__dirname, "eval/ruler-entry.ts"), formats: ["es"], fileName: () => "ruler.js" },
  },
});
