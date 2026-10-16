/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007 § 5.6. Closing the gap CSP leaves open.

`connect-src 'none'` stops fetch, XHR, WebSocket, EventSource and sendBeacon
below the JavaScript layer, so hostile code cannot talk its way past it. CSP
does **not** cover WebRTC: `RTCPeerConnection` can reach a STUN/TURN server
and exfiltrate through connectivity checks without ever issuing a "request".
That is spike item 5, and it is the one network path a JS-only attacker could
otherwise still take on iOS.

So the realm is stripped of those constructors before any artifact code runs.
This only holds because `frame-src 'none'` and `child-src 'none'` forbid the
app from creating a nested frame — a fresh realm would arrive with pristine
constructors and undo all of it.

This is defence in depth inside an already-sandboxed frame, not the primary
control. If the spike shows WebRTC reaching the network despite this, the
feature does not ship on iOS in this shape (ADR-0007 kill criteria).
*/

const WEBRTC_GLOBALS = [
  "RTCPeerConnection",
  "webkitRTCPeerConnection",
  "mozRTCPeerConnection",
  "RTCDataChannel",
  "RTCSessionDescription",
  "RTCIceCandidate",
  "RTCCertificate",
] as const;

/** Names whose mere presence would let an app phone home or probe the host. */
const OTHER_GLOBALS = [
  // No app has a reason to open a socket; CSP blocks it, but removing the
  // constructor makes failures loud and immediate instead of asynchronous.
  "WebSocket",
  "EventSource",
] as const;

const remove = (name: string): void => {
  try {
    Reflect.deleteProperty(globalThis, name);
    // Some engines keep the own property non-configurable; poison it instead
    // so a call throws rather than silently succeeding.
    if (name in globalThis) {
      Object.defineProperty(globalThis, name, {
        configurable: false,
        get() {
          throw new Error(`${name} is not available to Spiral apps`);
        },
      });
    }
  } catch {
    // A non-configurable accessor that cannot be replaced is acceptable:
    // CSP still blocks the transport for everything except WebRTC, and the
    // spike measures WebRTC directly rather than trusting this.
  }
};

/**
 * The native bridge is NOT stripped here, because it is not in this world.
 *
 * The first version of this file tried to delete `window.webkit`. That was
 * guesswork, and it failed: WebKit installs the property non-configurably,
 * so neither `delete` nor a re-`defineProperty` removed it. The correct fix
 * turned out to be on the host side — the handlers are registered in an
 * isolated `WKContentWorld`, so page-world code has no `window.webkit` for
 * them at all, and the relay that bridges worlds is injected into the main
 * frame only.
 *
 * The probe's `webkit-handlers` check reports what is actually reachable, so
 * a regression that moved the handlers back into the page world would show
 * up as `REACHED` rather than as a comment nobody re-read.
 */

let hardened = false;

export const hardenRealm = (): void => {
  if (hardened) return;
  hardened = true;

  for (const name of WEBRTC_GLOBALS) remove(name);
  for (const name of OTHER_GLOBALS) remove(name);

  // `navigator.sendBeacon` is covered by `connect-src`, but it is the one
  // API that deliberately survives page teardown, so it is worth denying
  // outright rather than relying on the policy alone.
  try {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: false,
      value: () => false,
    });
  } catch {
    // Already locked down or not present.
  }
};
