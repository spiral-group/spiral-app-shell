/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 § 6. The browser's own account of what it refused.

Several attacks cannot be judged from their return value. `new Worker(url)`
returns an object even when CSP forbids the worker from ever loading;
`form.submit()` returns nothing either way; an `<img>` with a blocked source
fires `error` exactly like an image that 404s. Reading those as "REACHED"
produced three false alarms on the first honest run, which is worse than no
probe at all — a report that cries wolf gets ignored on the day it matters.

`securitypolicyviolation` is the authoritative answer: the engine reports
which directive refused which URI. Collecting the events and consulting them
turns a guess into a citation.
*/

export interface Violation {
  readonly directive: string;
  readonly blockedURI: string;
}

const violations: Violation[] = [];
let listening = false;

/** Start recording. Safe to call more than once. */
export const collectViolations = (): void => {
  if (listening) return;
  listening = true;
  document.addEventListener("securitypolicyviolation", (event) => {
    violations.push({
      directive: event.violatedDirective,
      blockedURI: event.blockedURI,
    });
  });
};

/**
 * Wait for the engine to get around to reporting.
 *
 * Violations are dispatched asynchronously, so a check that fires an attack
 * and asks immediately will usually see nothing.
 */
export const settle = (ms = 250): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Did anything get refused by this directive? */
export const blockedBy = (directive: string): Violation | undefined =>
  violations.find((violation) => violation.directive.startsWith(directive));

/** Was this specific URI refused, by any directive? */
export const blockedURI = (fragment: string): Violation | undefined =>
  violations.find((violation) => violation.blockedURI.includes(fragment));

export const allViolations = (): readonly Violation[] => violations;
