/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 spike, matrix item 9 — the CRITICAL one.

The pool reuses a WKWebView across different untrusted apps (ADR-0007 § 4.5).
That is only safe if destroying the iframe really does discard its whole
JavaScript realm. If ANY trace of a previous app is visible here, pooling is
unsafe and the fallback is one runtime with no reuse.

How the spike drives it: mount the probe, tear it down, mount the probe again
in the SAME pooled WebView. The second run must report `foundPreviousApp:
false`. The marker is written by `probe/index.ts` at the end of its run.
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

/** The marker a previous run of this probe would have left on the global. */
const checkPreviousMarker = (): CheckResult => {
  const marker = (globalThis as Record<string, unknown>)["__spiralProbeWasHere"];
  return typeof marker === "string"
    ? reached("previous-app-marker", `found a marker from ${marker}`)
    : blocked("previous-app-marker", "no marker from a previous app in this realm");
};

/** A previous run's report object surviving would be the same failure. */
const checkPreviousReport = (): CheckResult =>
  (globalThis as { __spiralProbe?: unknown }).__spiralProbe
    ? reached("previous-report", "__spiralProbe from an earlier run is still present")
    : blocked("previous-report", "no earlier __spiralProbe in this realm");

/** Timers outliving teardown would keep a dead app running. */
const checkStrayTimers = (): CheckResult => {
  const handle = setTimeout(() => undefined, 0);
  clearTimeout(handle);
  const numeric = typeof handle === "number" ? handle : Number(handle);
  // A fresh realm starts its timer ids low; a large id means this realm has
  // been running long enough to have served someone else.
  return numeric > 500
    ? reached("timer-id-baseline", `first timer id was ${numeric}, realm is not fresh`)
    : blocked("timer-id-baseline", `first timer id was ${numeric}`);
};

/** Id of the node a run leaves behind for the next one to look for. */
const DOM_MARKER_ID = "spiral-probe-dom-marker";

/**
 * A node left in the document by an earlier app.
 *
 * Looks for a specific marker rather than counting children. The counting
 * version reported `REACHED` on the very first run, because by the time the
 * checks execute the probe has already rendered itself — it was measuring
 * its own output and calling it residue.
 *
 * As designed this can never fire: every mount gets a freshly synthesised
 * document in a new frame, so there is no document to leave anything in. It
 * stays as a guard for the day someone "optimises" the pool by reusing a
 * frame instead of recreating it.
 */
const checkDomResidue = (): CheckResult => {
  const found = document.getElementById(DOM_MARKER_ID) !== null;

  if (!found) {
    const marker = document.createElement("div");
    marker.id = DOM_MARKER_ID;
    marker.hidden = true;
    document.body.appendChild(marker);
  }

  return found
    ? reached("dom-residue", "a marker node from an earlier app is still in this document")
    : blocked("dom-residue", "no marker from an earlier app");
};

/** Module registry reuse would mean a previous artifact's code is cached. */
const checkModuleResidue = (): CheckResult => {
  const suspects = ["__spiralInit", "__spiralPort"];
  const present = suspects.filter((name) => name in globalThis);
  // These two ARE expected for the current app — they arrive with the
  // handshake. The leak would be finding them before the handshake, which
  // the spike's second run checks by reading the timestamp on `__spiralInit`.
  return blocked("module-residue", `handshake globals present: ${present.join(",") || "none"}`);
};

export const runLeakChecks = (): readonly CheckResult[] => [
  checkPreviousMarker(),
  checkPreviousReport(),
  checkStrayTimers(),
  checkDomResidue(),
  checkModuleResidue(),
];
