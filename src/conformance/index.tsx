/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007 § 5.9. App 0: the conformance harness.

First-party, and the regression suite for everything after step 5 — when the
agent starts generating apps (step 6) and the runtime moves into the timeline
(step 7), this is what says whether the contract still holds on a device.

It is also the first artifact written the way a generated one will be: one
module, default export, React and the runtime packages resolved by the
runtime, rendered through `@spiral/ui`. If the kit is awkward to write
against, this is where that shows up first.

Read the details, not the verdicts. A check that passes for the wrong reason
is the failure mode this whole file exists to avoid, and the only defence is
that each line says what it actually saw.
*/

import { useCallback, useState } from "react";
import { Button, List, Meta, Row, Text } from "@spiral/ui";

import { runConformance, type CheckGroup } from "./checks";

type Phase = { readonly kind: "idle" } | { readonly kind: "running" } | {
  readonly kind: "done";
  readonly groups: readonly CheckGroup[];
};

export default function Conformance() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const run = useCallback(() => {
    setPhase({ kind: "running" });
    void runConformance()
      .then((groups) => setPhase({ kind: "done", groups }))
      .catch((error: unknown) => {
        // A throw here is itself a finding — it means a check could not even
        // ask its question — so it is shown rather than swallowed.
        setPhase({
          kind: "done",
          groups: [
            {
              group: "harness",
              results: [{ name: "run", verdict: "fail", detail: String(error) }],
            },
          ],
        });
      });
  }, []);

  const failures =
    phase.kind === "done"
      ? phase.groups.flatMap((group) => group.results).filter((r) => r.verdict === "fail").length
      : 0;

  return (
    <div className="s-root" style={{ padding: 16, display: "grid", gap: 12 }}>
      <Row between>
        <Text variant="title">Conformance</Text>
        {phase.kind === "done" && (
          <Text variant="caption">{failures === 0 ? "all passed" : `${failures} failed`}</Text>
        )}
      </Row>

      <Row>
        <Button onPress={run} disabled={phase.kind === "running"}>
          {phase.kind === "running" ? "Running…" : "Run"}
        </Button>
      </Row>

      {phase.kind === "idle" && (
        <Meta>Writes real actions into this post. Every check is a Matrix event.</Meta>
      )}

      {phase.kind === "done" &&
        phase.groups.map((group) => (
          <div key={group.group} style={{ display: "grid", gap: 4 }}>
            <Text variant="caption">{group.group}</Text>
            <List items={group.results} keyOf={(result) => result.name} separated>
              {(result) => (
                <div style={{ padding: "6px 0" }}>
                  <Row between>
                    <Text>{result.name}</Text>
                    <Text variant="caption">{result.verdict}</Text>
                  </Row>
                  <Text variant="caption">{result.detail}</Text>
                </div>
              )}
            </List>
          </div>
        ))}
    </div>
  );
}
