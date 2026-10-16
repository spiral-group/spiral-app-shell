/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007 § 6. Shared vocabulary for the spike probe.

Kept apart from `index.tsx` so the attack modules do not import the component
that imports them.
*/

/**
 * `blocked` — the attempt failed in a way that cannot have produced a request
 *   or leaked state. This is the only verdict that counts as a pass.
 * `REACHED` — bytes could have left the device, or a previous app was
 *   visible. Any single one of these fails the spike.
 * `inconclusive` — the API could not distinguish "policy refused" from
 *   "server refused". Resolved with a packet capture, never by assumption.
 */
export type Verdict = "blocked" | "REACHED" | "inconclusive";

export interface CheckResult {
  readonly name: string;
  readonly verdict: Verdict;
  readonly detail: string;
}
