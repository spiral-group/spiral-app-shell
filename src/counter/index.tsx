/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 step 5.1. THROWAWAY artifact for the device proof: a counter
increments on one phone and appears on a second, in an E2EE room.

One button, one number, one `incr`. It is the smallest thing that can fail
informatively — every layer of the slice (port, capability check, host fold,
Matrix event, relations read, push) is on the path between the tap and the
digit, so a wrong digit means one of them is wrong. It is deleted when the
conformance harness (step 5.5) exists.

Since step 5.4 it also renders through `@spiral/ui`, which makes it the only
thing exercising the kit end to end on a device: the stylesheet the host links
into the synthesised document, the tokens resolving, and dark mode following
the phone. A hand-styled counter would have proved none of that.

Shaped like a generated artifact — one module, default-exported React
component, React and the runtime packages resolved by the runtime rather than
bundled — because a shortcut here would prove something about a path that does
not exist in production.
*/

import { useState } from "react";
import { useNow, useRoomMembers, useSharedState, type SpiralState } from "@spiral/sdk";
import { Button, Input, Meta, Row, Text } from "@spiral/ui";

/** The host vouches for the state, not for its shape: another client's app
 * version may have written anything at this path. */
const countIn = (state: SpiralState): number =>
  typeof state["count"] === "number" ? state["count"] : 0;

export default function Counter() {
  const [state, apply] = useSharedState();
  const members = useRoomMembers();
  // The host's clock, ticking: what a countdown would be built on. Shown
  // here so a device run proves the clock reaches the frame and moves.
  const now = useNow();
  const [refusal, setRefusal] = useState<string | null>(null);
  // Typed, local, never shared: the step is this reader's, the count is the
  // room's. The field is also what proves typing works inside a post at all —
  // a host that turns text interaction off to kill the selection magnifier
  // kills the keyboard with it.
  const [step, setStep] = useState("1");
  const by = Number.parseInt(step, 10) || 1;

  // The rejection is caught rather than left to float: an unhandled rejection
  // inside the frame goes to a console the shell cannot read, so a refused
  // write would look exactly like a tap that did nothing.
  const increment = (): void => {
    setRefusal(null);
    void apply({ incr: { path: "count", by } }).catch((error: unknown) => {
      setRefusal(String(error));
    });
  };

  // Ten applies in one frame — the clicker pattern. The SDK sends the first
  // at once and the other nine as one batch, so a room sees two events, not
  // ten. It is here to prove that on a device; an app would just tap.
  const burst = (): void => {
    for (let i = 0; i < 10; i += 1) increment();
  };

  return (
    <div className="s-root" style={{ padding: 16 }}>
      <Text variant="title">{countIn(state)}</Text>
      <Row>
        <Button onPress={increment}>+{by}</Button>
        <Button variant="secondary" onPress={burst}>×10</Button>
        <Input kind="number" value={step} onChange={setStep} placeholder="step" />
      </Row>
      <Meta>
        {/* undefined while the roster is still arriving, which is not the
            same as a room with nobody in it. */}
        {members === undefined ? "counting the room…" : `${members.length} here`}
        {now !== undefined && ` · ${new Date(now).toLocaleTimeString()}`}
      </Meta>
      {refusal !== null && <Text variant="caption">{refusal}</Text>}
    </div>
  );
}
