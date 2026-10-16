/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 spike, matrix items 4, 7, 8. Can the app get out of its frame?

The sandbox rests on two things: `sandbox="allow-scripts"` without
`allow-same-origin` (opaque origin), and the native bridge living only in the
shell document. These checks confirm both — that the app cannot read or
navigate its parent, cannot find `window.webkit`, cannot open a window or a
nested frame, and cannot reach storage it should not have.
*/

import type { CheckResult } from "../types";

const blocked = (name: string, detail: string): CheckResult => ({
  name,
  verdict: "blocked",
  detail,
});

const reached = (name: string, detail: string): CheckResult => ({
  name,
  verdict: "REACHED",
  detail,
});

const checkParentAccess = (): CheckResult => {
  try {
    const href = window.parent.location.href;
    return reached("parent-location", `read parent href: ${href.slice(0, 60)}`);
  } catch (error) {
    return blocked("parent-location", String(error).slice(0, 120));
  }
};

const checkParentDocument = (): CheckResult => {
  try {
    const body = window.parent.document.body;
    return body
      ? reached("parent-document", "read parent document.body")
      : blocked("parent-document", "parent document.body was null");
  } catch (error) {
    return blocked("parent-document", String(error).slice(0, 120));
  }
};

/**
 * The bridge must be unreachable from here.
 *
 * Message handlers are registered per content world and WebKit exposes them
 * to every frame, so the bootstrap strips the reference before any artifact
 * code runs. This reports what actually survived, including the property
 * descriptor — guessing at why a delete failed cost an hour once.
 */
const checkNativeBridge = (): CheckResult => {
  let webkit: { messageHandlers?: unknown } | undefined;
  try {
    webkit = (globalThis as { webkit?: { messageHandlers?: unknown } }).webkit;
  } catch (error) {
    // A poisoned accessor throwing is a pass: nothing is reachable.
    return blocked("webkit-handlers", `access threw: ${String(error).slice(0, 80)}`);
  }

  if (!webkit?.messageHandlers) {
    return blocked("webkit-handlers", "window.webkit.messageHandlers absent");
  }

  const names = Object.keys(webkit.messageHandlers as Record<string, unknown>);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "webkit");
  const shape = descriptor
    ? `configurable=${descriptor.configurable} writable=${descriptor.writable} accessor=${descriptor.get !== undefined}`
    : "no own descriptor (inherited)";

  return reached("webkit-handlers", `visible: [${names.join(",") || "opaque"}] — ${shape}`);
};

/** Android's equivalent; checked now so the Android port has a baseline. */
const checkJavascriptInterface = (): CheckResult => {
  const suspects = ["elementX", "backHandler", "spiralApp", "Android"];
  const found = suspects.filter(
    (name) => typeof (globalThis as Record<string, unknown>)[name] === "object",
  );
  return found.length > 0
    ? reached("javascript-interface", `visible: ${found.join(",")}`)
    : blocked("javascript-interface", "no injected interface objects");
};

const checkShellGlobal = (): CheckResult =>
  (globalThis as { __spiralShell?: unknown }).__spiralShell
    ? reached("shell-global", "__spiralShell visible from the app realm")
    : blocked("shell-global", "__spiralShell not in this realm");

const checkTopNavigation = (): CheckResult => {
  try {
    // Would replace the whole WKWebView, taking the shell with it.
    window.top?.location.replace("https://probe.invalid/");
    return reached("top-navigation", "location.replace did not throw");
  } catch (error) {
    return blocked("top-navigation", String(error).slice(0, 120));
  }
};

const checkWindowOpen = (): CheckResult => {
  try {
    const opened = window.open("https://probe.invalid/", "_blank");
    if (opened) {
      opened.close();
      return reached("window-open", "window.open returned a handle");
    }
    return blocked("window-open", "window.open returned null (no allow-popups)");
  } catch (error) {
    return blocked("window-open", String(error).slice(0, 120));
  }
};

/** A nested frame would be a fresh realm where `harden.ts` never ran. */
const checkNestedFrame = (): CheckResult => {
  try {
    const frame = document.createElement("iframe");
    frame.src = "about:blank";
    document.body.appendChild(frame);
    const hasRtc =
      typeof (frame.contentWindow as unknown as Record<string, unknown> | null)?.[
        "RTCPeerConnection"
      ] === "function";
    frame.remove();
    return hasRtc
      ? reached("nested-frame", "child frame has a pristine RTCPeerConnection")
      : blocked("nested-frame", "child frame created but carries no RTC constructor");
  } catch (error) {
    return blocked("nested-frame", String(error).slice(0, 120));
  }
};

/**
 * Storage must be unreachable in an opaque origin.
 *
 * Tests whether each store can actually be USED, not whether its handle
 * exists. `window.indexedDB` is present in an opaque origin but `open()`
 * throws — reporting the handle as access produced a false alarm on the
 * first run.
 */
const checkStorage = async (): Promise<CheckResult> => {
  const reachable: string[] = [];

  try {
    localStorage.setItem("spiral-probe", "1");
    localStorage.removeItem("spiral-probe");
    reachable.push("localStorage");
  } catch {
    // Expected in an opaque origin.
  }

  try {
    document.cookie = "spiral-probe=1";
    if (document.cookie.includes("spiral-probe")) reachable.push("cookie");
  } catch {
    // Expected.
  }

  try {
    const request = indexedDB.open("spiral-probe");
    const opened = await new Promise<boolean>((resolve) => {
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
      request.onblocked = () => resolve(false);
      setTimeout(() => resolve(false), 500);
    });
    if (opened) reachable.push("indexedDB");
  } catch {
    // Expected: `open()` throws outright in an opaque origin.
  }

  return reachable.length > 0
    ? reached("storage", `usable: ${reachable.join(",")}`)
    : blocked("storage", "localStorage, cookies and indexedDB all unusable");
};

export const runEscapeChecks = async (): Promise<readonly CheckResult[]> => [
  checkParentAccess(),
  checkParentDocument(),
  checkNativeBridge(),
  checkJavascriptInterface(),
  checkShellGlobal(),
  checkTopNavigation(),
  checkWindowOpen(),
  checkNestedFrame(),
  await checkStorage(),
];
