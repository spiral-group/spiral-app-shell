/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007 § 4.1, § 4.3.

React ships in the CLIENT RELEASE, not in the artifact. An artifact that
writes `import { useState } from "react"` gets its specifier rewritten to
`/runtime/v1/react.js`, which is this file. That is what keeps artifacts at a
few KB, keeps every post on one React version per `runtime_version`, and
stops an app from smuggling its own framework in.

The JSX runtime is re-exported too, because the transpiler emits
`jsx`/`jsxs` calls against `react/jsx-runtime`.
*/

// `@types/react` is an `export =` module, so `export *` is not allowed. The
// namespace re-export gives artifacts the same surface (`React.useState`,
// and every named hook via the explicit list below).
import * as React from "react";

export { React };

/**
 * The namespace, again, as the default export.
 *
 * `import React from "react"` is what half the JavaScript world writes —
 * every third-party module bundled into `@spiral/play` does, and so does a
 * model quoting a tutorial. Without a default they all get `undefined` and
 * every hook inside them reads off nothing (2026-09-19).
 */
export default React;
export {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useReducer,
  useContext,
  useId,
  useSyncExternalStore,
  useTransition,
  useDeferredValue,
  createContext,
  createElement,
  memo,
  forwardRef,
  Fragment,
  StrictMode,
  Suspense,
} from "react";
export { jsx, jsxs, Fragment as JsxFragment } from "react/jsx-runtime";
export { createRoot } from "react-dom/client";
