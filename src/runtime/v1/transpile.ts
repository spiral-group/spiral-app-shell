/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007 § 4.4. JSX -> JS, in memory, on the device.

The artifact is the source text the model wrote; nothing is built anywhere
(zero-build). So the transpile has to happen here, in the sandboxed frame,
every time an app starts. Two consequences drive the choice of tool:

  * it must be small, because it ships in every client release;
  * it must be fast, because it runs on the path to first paint.

Sucrase is the first candidate: it skips type-checking entirely and does a
handful of targeted transforms, which is exactly the job. Whether its size is
acceptable is notebook § 7 OPEN #2 and a measured item in the spike, so the
dependency is isolated behind this module — swapping it must not touch
`bootstrap.ts`.

Bare specifiers are rewritten here rather than via an import map: the map
would need its own CSP nonce in the synthesised document, and doing it in the
transform keeps the document's policy simple and the rewrite auditable.
*/

// The `/js` entry point is the asm.js build. The default export compiles a
// WebAssembly module, which needs `wasm-unsafe-eval` in `script-src` — and
// buying a faster lexer with a CSP relaxation is a bad trade when the
// artifact is a few KB. Keeping `script-src` free of every `*-eval` form
// makes the policy one line shorter to argue about.
import { init as initLexer, parse as parseModule } from "es-module-lexer/js";
import { transform } from "sucrase";

/**
 * What an artifact may import, and which runtime file each specifier
 * resolves to. Anything outside this table is refused: artifacts carry no
 * dependencies, so a stray specifier is either a hallucinated package or an
 * attempt to reach outside the runtime.
 */
const SPECIFIER_MAP: Readonly<Record<string, string>> = {
  react: "/runtime/v1/react.js",
  "react/jsx-runtime": "/runtime/v1/react.js",
  "react-dom": "/runtime/v1/react.js",
  "react-dom/client": "/runtime/v1/react.js",
  "@spiral/sdk": "/runtime/v1/sdk.js",
  "@spiral/ui": "/runtime/v1/ui.js",
  "@spiral/play": "/runtime/v1/play.js",
};

/**
 * Prefix that turns a runtime path into something a blob module can resolve.
 *
 * Compiled artifacts are executed via `import(blob:…)`, and a blob URL has an
 * opaque path — a root-relative specifier like `/runtime/v1/react.js` has no
 * base to resolve against and throws
 * "does not resolve to a valid URL". Absolute URLs do resolve, so the
 * rewrite emits `<origin>/runtime/v1/react.js`.
 *
 * Defaults to the document's own origin, which inside an artifact frame is
 * `spiral-app://a-<digest>`.
 */
const defaultRuntimeOrigin = (): string =>
  typeof location === "undefined" ? "" : location.origin;

export class TranspileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranspileError";
  }
}

/**
 * Rewrite every module specifier to a runtime path, rejecting anything the
 * runtime does not provide.
 *
 * Parsed with `es-module-lexer` rather than matched with a regular
 * expression. A regex over JavaScript cannot tell an import from a string
 * that merely looks like one — the first version of this function threw on
 * `.join(", ")` inside the probe, because `from "…"` appeared inside a
 * literal. The lexer returns exact specifier offsets for both static and
 * dynamic imports, so the rewrite is positional and cannot misfire.
 *
 * Relative specifiers are rejected too: v1 is one module per artifact
 * (ADR-0007 D4), so a relative import is always a mistake, and quietly
 * allowing it would half-support multi-file apps.
 */
const rewriteSpecifiers = (code: string, runtimeOrigin: string): string => {
  const [imports] = parseModule(code);

  let result = "";
  let cursor = 0;

  for (const record of imports) {
    // `import.meta` carries no specifier and nothing to rewrite. It is also
    // harmless: an opaque-origin frame's `import.meta.url` is a blob URL.
    if (record.type === "import-meta") continue;

    const specifier = record.specifier;

    // A dynamic import the lexer could not resolve statically — `import(x)`
    // or a concatenated expression. There is nothing to rewrite and no way
    // to know where it points, so it cannot be allowed. A template glob
    // (`glob: true`) is equally unusable: one module per artifact.
    if (specifier === undefined || (record.type === "dynamic" && record.glob)) {
      throw new TranspileError(
        "dynamic import with a computed specifier is not allowed in a Spiral app",
      );
    }

    const mapped = SPECIFIER_MAP[specifier];
    if (mapped === undefined && !specifier.startsWith("/runtime/v1/")) {
      throw new TranspileError(
        `import of "${specifier}" is not allowed; Spiral apps may import only ` +
          `${Object.keys(SPECIFIER_MAP).join(", ")}`,
      );
    }

    if (mapped !== undefined) {
      // `start`/`end` bound the specifier text itself, inside its quotes.
      result += code.slice(cursor, record.start) + runtimeOrigin + mapped;
      cursor = record.end;
    }
  }

  return result + code.slice(cursor);
};

/**
 * `es-module-lexer` needs its WASM initialised once before the first parse.
 * Awaited by the bootstrap before any artifact is compiled.
 */
export const initTranspiler = (): Promise<void> => initLexer();

/**
 * Compile artifact source to an ES module the frame can import.
 *
 * `jsx` and `typescript` transforms only — no type checking, no bundling.
 * The automatic JSX runtime means the artifact never has to import React
 * explicitly just to use JSX.
 */
export const transpile = (
  source: string,
  fileName: string,
  runtimeOrigin: string = defaultRuntimeOrigin(),
): string => {
  let result: string;
  try {
    result = transform(source, {
      transforms: ["jsx", "typescript"],
      jsxRuntime: "automatic",
      // Left at the default import source on purpose: it emits
      // `react/jsx-runtime`, which `SPECIFIER_MAP` already resolves to the
      // shipped runtime. Pointing it at a path here would emit
      // `/runtime/v1/jsx-runtime`, a URL nothing serves.
      filePath: fileName,
      production: true,
    }).code;
  } catch (error) {
    throw new TranspileError(
      error instanceof Error ? error.message : `could not compile ${fileName}`,
    );
  }

  return rewriteSpecifiers(result, runtimeOrigin);
};
