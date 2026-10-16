/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007 § 4.1, § 4.4. How an ARTIFACT is built.

Artifacts are not shipped code — they are the source text a model wrote,
stored in Matrix media and transpiled on the device. First-party artifacts
(the spike probe, and later the conformance harness) are the exception: they
are ours, so we build them, but they must come out looking exactly like a
generated one or they would test a path that does not exist in production.

That means React is **external**. An artifact emits

    import { useState } from "react";

and `runtime/v1/transpile.ts` rewrites that specifier to
`/runtime/v1/react.js` at load time. Bundling React in instead would give the
artifact its own copy of the framework, break the one-React-per-runtime rule,
and skip the rewrite the spike needs to exercise.

Output is a single ES module, unminified, served to the host as `app.jsx`.
*/

import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * ADR-0007 D4: an artifact is ONE module.
 *
 * The scheme handler publishes a single file per artifact, so a shared chunk
 * or a split-out dynamic import does not 404 until the device tries to load
 * it. `inlineDynamicImports` covered half of this while there was one
 * artifact to build; Rollup refuses that option once there are two, and it
 * never covered the other half — two artifacts sharing a module. Failing on
 * any chunk that is not an entry covers both, at build time.
 */
const oneModulePerArtifact = (): Plugin => ({
  name: "spiral-one-module-per-artifact",
  generateBundle(_options, bundle) {
    const split = Object.values(bundle).filter(
      (item) => item.type === "chunk" && !item.isEntry,
    );
    if (split.length > 0) {
      this.error(
        `artifacts must be a single module; the build split out ` +
          split.map((chunk) => chunk.fileName).join(", "),
      );
    }
  },
});

/** Exactly what `SPECIFIER_MAP` in `transpile.ts` knows how to resolve. */
const RUNTIME_PROVIDED = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "@spiral/sdk",
  "@spiral/ui",
  "@spiral/play",
];

export default defineConfig({
  base: "./",
  publicDir: false,
  plugins: [oneModulePerArtifact()],
  build: {
    outDir: "dist/artifacts",
    emptyOutDir: true,
    target: "es2022",
    // Readable on purpose: an artifact is what a moderator would read, and
    // the spike's evidence is easier to trust when the bytes are legible.
    minify: false,
    sourcemap: false,
    rollupOptions: {
      external: RUNTIME_PROVIDED,
      // Without this Rollup treats the entry as an application, sees that
      // nothing imports the default export, and tree-shakes the component
      // away — leaving two bare imports. An artifact IS its exports.
      preserveEntrySignatures: "exports-only",
      input: {
        probe: resolve(__dirname, "src/probe/index.tsx"),
        // Throwaway for the step 5.1 device proof. Built the same way as the
        // probe — externals and all — because the thing it proves is that the
        // production path carries an app's state, and a counter that reached
        // React or the SDK by any other route would prove nothing about it.
        counter: resolve(__dirname, "src/counter/index.tsx"),
        // App 0. The regression suite for steps 6-8: when the agent starts
        // generating apps and the runtime moves into the timeline, this is
        // what says whether the contract still holds on a device.
        conformance: resolve(__dirname, "src/conformance/index.tsx"),
        // Step 6.10 — what WebKit does with a spin, a spinner and rAF in a row.
        motion: resolve(__dirname, "src/motion/index.tsx"),
        lab: resolve(__dirname, "src/lab/index.tsx"),
      },
      output: {
        format: "es",
        // `.jsx` because that is the filename the scheme handler serves and
        // the bootstrap fetches. The contents are already plain JS; sucrase
        // passes them through unchanged, which is itself worth proving.
        entryFileNames: "[name].jsx",
      },
    },
  },
});
