/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007. Three independent entry points, all served to the
WKWebView by one WKURLSchemeHandler under `spiral-app://`:

  shell/      the TRUSTED document. Owns the native bridge and hosts the
              untrusted app in a sandboxed iframe. Loaded once per pooled
              WKWebView and reused across apps.
  runtime/v1  what the SANDBOXED iframe loads: bootstrap, React, the SDK and
              the UI Kit. Shipped in the client release, never in an artifact.
              React is bundled into `runtime-v1-react` and externalised out of
              `runtime-v1-sdk`, so that the two files and every artifact share
              one React instance — see `externalReact` below.
Artifacts (the spike probe, later the conformance harness) are NOT built
here — they build through `vite.artifact.config.ts`, which keeps React
external so they look exactly like a generated artifact.

`base: "./"` so every emitted URL is relative and the scheme handler decides
what the bytes are. No hashed filenames: the host maps exact paths, and the
artifact digest — not a bundler hash — is what identifies content.
*/

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";


/**
 * React is external for the SDK and bundled everywhere else.
 *
 * `runtime-v1-react` IS the shipped copy of React, so it has to contain one.
 * `runtime-v1-sdk`, `runtime-v1-ui` and `runtime-v1-play` must not: `useSharedState` calls a hook, and a hook only
 * works against the dispatcher of the React instance that is rendering.
 * A second bundled copy would give the SDK its own, and every artifact using
 * the hook would fail with the "invalid hook call" that means exactly this.
 *
 * The import is left as a bare `react` and pointed at the served path by
 * `output.paths`, which is the same resolution `transpile.ts` performs for an
 * artifact's own imports.
 */
const REACT_ENTRY = resolve(__dirname, "src/runtime/v1/react-entry.ts");

const externalReact = (id: string, importer: string | undefined): boolean =>
  (id === "react" || id === "react/jsx-runtime") &&
  importer !== undefined &&
  // Everyone but the copy itself. Naming our own sources was enough while
  // the runtime only imported React from files we wrote; `@spiral/play`
  // bundles third-party hooks whose OWN import of React is what has to be
  // externalised, and those importers live in node_modules (2026-09-19).
  // A second copy is not a size problem, it is an "invalid hook call" —
  // a hook only works against the dispatcher of the instance that renders.
  importer !== REACT_ENTRY;

/**
 * One stylesheet for the UI kit: Compound's tokens, then our rules.
 *
 * Concatenated rather than `@import`ed because an app's frame would otherwise
 * make a request per file, each of which the scheme handler has to publish
 * and the CSP has to name — for values that never change at runtime.
 *
 * Emitted here rather than let Vite process it as a CSS entry, because the
 * tokens file is generated and already final: running it through the asset
 * pipeline would rewrite URLs it does not contain and rename a file the
 * synthesised document links by name.
 */
const uiStylesheet = (): Plugin => ({
  name: "spiral-ui-stylesheet",
  generateBundle() {
    const tokens = readFileSync(resolve(__dirname, "src/runtime/v1/ui-kit/tokens.generated.css"));
    const kit = readFileSync(resolve(__dirname, "src/runtime/v1/ui-kit/kit.css"));
    this.emitFile({
      type: "asset",
      fileName: "runtime-v1-ui.css",
      source: `${tokens}\n${kit}`,
    });
  },
});

export default defineConfig({
  base: "./",
  publicDir: false,
  plugins: [uiStylesheet()],
  test: {
    // The layout run needs an engine that lays out, so it has its own
    // config and its own browser. Left in here it would be collected by
    // the default run and fail on `node:fs` before it could say why.
    // The layout run needs an engine that lays out, and the edits run needs
    // a trial corpus to point at — neither is a standing gate, and collected
    // by the default run they fail for reasons that say nothing about the
    // code.
    exclude: ["node_modules/**", "eval/layout.test.tsx", "eval/edits.test.tsx"],
  },
  build: {
    target: "es2022",
    // The shell is served from the app bundle, not over a network; readable
    // output is worth more than bytes while the spike is running.
    minify: false,
    sourcemap: true,
    rollupOptions: {
      external: externalReact,
      // `runtime-v1-react` exists ONLY to be imported by a compiled
      // artifact, so its named exports are its entire reason to exist.
      // Without this Rollup treats every entry as an application, sees that
      // nothing local imports them, and emits a module with no exports —
      // which surfaced as "Importing binding name 'jsxs' is not found" at
      // the moment an artifact tried to render.
      preserveEntrySignatures: "allow-extension",
      input: {
        // Real document: ours, trusted, loaded once per pooled WKWebView.
        // Only an ARTIFACT's document is synthesised by the scheme handler.
        shell: resolve(__dirname, "shell.html"),
        "runtime-v1-bootstrap": resolve(__dirname, "src/runtime/v1/bootstrap.ts"),
        "runtime-v1-react": resolve(__dirname, "src/runtime/v1/react-entry.ts"),
        "runtime-v1-sdk": resolve(__dirname, "src/runtime/v1/sdk/index.ts"),
        "runtime-v1-ui": resolve(__dirname, "src/runtime/v1/ui-kit/index.tsx"),
        "runtime-v1-play": resolve(__dirname, "src/runtime/v1/play/index.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
        // Root-relative, not absolute: the SDK is fetched from the artifact's
        // own origin, so this resolves against it the way the scheme handler
        // already serves `/runtime/v1/react.js` there. The absolute form
        // `transpile.ts` emits is needed only because a compiled artifact is
        // imported from a `blob:` URL, which has no base to resolve against.
        paths: {
          react: "/runtime/v1/react.js",
          "react/jsx-runtime": "/runtime/v1/react.js",
        },
      },
    },
  },
});
