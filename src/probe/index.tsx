/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007 § 6. The hostile artifact for the runtime spike.

This is the adversary, and it is deliberately shaped like a REAL artifact: a
single module with a default-exported React component. The spike host serves
the built file as `app.jsx`, so it travels the exact production path —
scheme handler -> fetch as text -> sucrase -> blob import -> React mount —
rather than a shortcut that would prove nothing about the real pipeline.

It must never ship to users; the iOS host refuses to serve it outside a debug
build.

Every check resolves to a verdict instead of throwing, so one blocked path
cannot hide the ones after it. The host reads `window.__spiralProbe` and
writes it into `docs/walkthroughs/0066-runtime-spike.md`.

PASS: every `network` and `escape` check reports `blocked`, and no `leak`
check reports `REACHED`.
*/

import { useEffect, useState } from "react";

import { runNetworkChecks } from "./attacks/network";
import { runEscapeChecks } from "./attacks/escape";
import { runResourceChecks } from "./attacks/resource";
import { runLeakChecks } from "./attacks/leak";
import { allViolations, collectViolations } from "./violations";

import type { CheckResult } from "./types";

export type { CheckResult, Verdict } from "./types";

export interface ProbeReport {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly userAgent: string;
  readonly network: readonly CheckResult[];
  readonly escape: readonly CheckResult[];
  readonly resource: readonly CheckResult[];
  readonly leak: readonly CheckResult[];
  /** True only when nothing reached the network and nothing leaked. */
  readonly pass: boolean;
}

const allBlocked = (results: readonly CheckResult[]): boolean =>
  results.every((result) => result.verdict === "blocked");

const runAll = async (): Promise<ProbeReport> => {
  const startedAt = new Date().toISOString();

  // Start listening before the first attack, so no refusal is missed.
  collectViolations();

  // Sequential on purpose: running these in parallel would muddy the CPU and
  // memory numbers the resource checks exist to measure.
  const network = await runNetworkChecks();
  const escape = await runEscapeChecks();
  const resource = await runResourceChecks();
  const leak = runLeakChecks();

  const report: ProbeReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    network,
    escape,
    resource,
    leak,
    pass: allBlocked(network) && allBlocked(escape) && allBlocked(leak),
  };

  (globalThis as { __spiralProbe?: ProbeReport }).__spiralProbe = report;
  console.log("[spiral-probe]", JSON.stringify(report, null, 2));
  console.info("[spiral-probe] CSP refusals:", JSON.stringify(allViolations()));

  // Hand the report to the host over the port.
  //
  // The obvious route — let the shell read `window.__spiralProbe` off the
  // frame — does not work, and the fact that it does not IS one of the
  // findings: the frame's opaque origin makes it unreadable from the shell,
  // which is exactly the isolation the spike is testing. So the report
  // leaves the same way every other message does.
  const port = (globalThis as { __spiralPort?: MessagePort }).__spiralPort;
  port?.postMessage({
    id: `probe-report-${startedAt}`,
    method: "spike.report",
    args: report,
    userActivation: false,
  });

  // Marker the NEXT app in this same pooled WKWebView looks for. Finding it
  // would mean iframe teardown did not discard the realm — spike item 9.
  try {
    (globalThis as Record<string, unknown>)["__spiralProbeWasHere"] = startedAt;
  } catch {
    // The leak check reports whatever it finds either way.
  }

  return report;
};

const Group = ({
  title,
  results,
}: {
  title: string;
  results: readonly CheckResult[];
}) => (
  <section style={{ margin: "0 0 10px" }}>
    <h2
      style={{
        font: "600 12px/1.3 -apple-system,system-ui,sans-serif",
        margin: "0 0 4px",
        color: "#49454f",
      }}
    >
      {title}
    </h2>
    {results.map((result) => (
      <div
        key={result.name}
        style={{
          font: "12px/1.5 ui-monospace,SFMono-Regular,monospace",
          color: result.verdict === "blocked" ? "#1d1b20" : "#b3261e",
        }}
      >
        {result.verdict === "blocked" ? "·" : "!"} {result.name} — {result.verdict} —{" "}
        {result.detail}
      </div>
    ))}
  </section>
);

export default function Probe() {
  const [report, setReport] = useState<ProbeReport | null>(null);

  useEffect(() => {
    void runAll().then(setReport);
  }, []);

  if (!report) {
    return (
      <div style={{ font: "14px/1.4 -apple-system,system-ui,sans-serif", padding: 12 }}>
        Running probe…
      </div>
    );
  }

  return (
    <div style={{ padding: 12 }}>
      <h1
        style={{
          font: "600 15px/1.3 -apple-system,system-ui,sans-serif",
          margin: "0 0 8px",
          color: report.pass ? "#0f7b3f" : "#b3261e",
        }}
      >
        {report.pass ? "PROBE: all blocked" : "PROBE: SOMETHING GOT THROUGH"}
      </h1>
      <Group title="network" results={report.network} />
      <Group title="escape" results={report.escape} />
      <Group title="resource" results={report.resource} />
      <Group title="leak" results={report.leak} />
    </div>
  );
}
