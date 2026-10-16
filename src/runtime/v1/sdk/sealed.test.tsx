// @vitest-environment happy-dom
/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Hidden moves (§ 5.78): a hash in the room, the move on the phone. Played
against the mock host as the viewer, A; B's moves land as state, the way
another phone's would. Its own file, because the SDK's store is one per frame.
*/
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { installMockHost, mockWrites, resetMockState, setMockPrivate, setMockState } from "../mock";
import type { SpiralSealed } from "./index";
import { useSealed } from "./index";
import { canonical } from "./sealed";
import { sha256 } from "./sha256";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Longer than the SDK's coalescing window (300 ms): a write made inside it
// waits for it to close, and would otherwise land in the next test.
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 350)); });
const unmount = (root: Root) => act(async () => { root.unmount(); });

const A = "@a:spiral.md", B = "@b:spiral.md";
const teardown = installMockHost({ userId: A, members: [{ userId: A, displayName: "Andrii" }, { userId: B, displayName: "Bohdan" }] });
afterAll(() => teardown());

const mount = async (key: string, pair = true): Promise<{ current: () => SpiralSealed<string>; root: Root }> => {
  let latest: SpiralSealed<string> | undefined;
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  const Probe = (): null => {
    latest = useSealed<string>(key, pair ? { openWhen: (sealed) => sealed.length === 2 } : {});
    return null;
  };
  await act(async () => { root.render(createElement(Probe)); });
  await settle();
  return { current: () => latest as SpiralSealed<string>, root };
};

/** B's seal and opening, as B's phone would write them. */
const fromB = (key: string, move: string, salt = "b0b0b0b0") => ({
  sealed: { [key]: sha256(`${canonical(move)}|${salt}`) },
  opened: { [key]: { v: move, s: salt } },
});

const lastOp = (): unknown => mockWrites().at(-1)?.op;

describe("useSealed", () => {
  beforeEach(async () => {
    resetMockState();
    setMockPrivate({});
    await act(async () => { setMockState({}); });
    await settle();
  });

  it("puts only the hash in the room and keeps the move on the phone; the first player's phone opens by itself when the other has moved", async () => {
    const round = await mount("r1");
    await act(async () => { await round.current().seal("rock"); });
    await settle();

    const op = lastOp() as { set: { path: string[]; value: string } };
    expect(op.set.path).toEqual(["by", A, "sealed", "r1"]);
    expect(op.set.value).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(mockWrites())).not.toContain("rock");
    expect(round.current().mine).toBe("rock");
    expect(round.current().sealed).toEqual([A]);
    expect(round.current().opened).toEqual({});

    // B moves: sealed and opened at once, as the second player does.
    const mySeal = op.set.value;
    await act(async () => { setMockState({ by: { [A]: { sealed: { r1: mySeal } }, [B]: fromB("r1", "scissors") } }); });
    await settle();
    await settle();

    const opening = lastOp() as { set: { path: string[]; value: { v: string; s: string } } };
    expect(opening.set.path).toEqual(["by", A, "opened", "r1"]);
    expect(opening.set.value.v).toBe("rock");
    expect(round.current().opened).toEqual({ [A]: "rock", [B]: "scissors" });
    expect(round.current().broken).toEqual([]);
    await unmount(round.root);
  });

  it("seals and opens in one action when the viewer is the last to move", async () => {
    await act(async () => { setMockState({ by: { [B]: { sealed: fromB("r2", "paper").sealed } } }); });
    await settle();
    const round = await mount("r2");
    expect(round.current().sealed).toEqual([B]);
    expect(round.current().opened).toEqual({});

    const before = mockWrites().length;
    await act(async () => { await round.current().seal("scissors"); });
    await settle();
    expect(mockWrites().length).toBe(before + 1);
    const ops = (lastOp() as { batch: { ops: { set: { path: string[] } }[] } }).batch.ops;
    expect(ops.map((o) => o.set.path.join("."))).toEqual([`by.${A}.sealed.r2`, `by.${A}.opened.r2`]);
    expect(round.current().opened[A]).toBe("scissors");
    await unmount(round.root);
  });

  it("catches a move that is not the one that was sealed", async () => {
    const forged = { sealed: fromB("r3", "rock").sealed, opened: { r3: { v: "paper", s: "b0b0b0b0" } } };
    await act(async () => { setMockState({ by: { [B]: forged } }); });
    await settle();
    const round = await mount("r3", false);
    expect(round.current().broken).toEqual([B]);
    expect(round.current().opened).toEqual({});
    await unmount(round.root);
  });

  it("will not seal twice, and cannot open a move it does not hold", async () => {
    const round = await mount("r4", false);
    await act(async () => { await round.current().seal("paper"); });
    await settle();
    await expect(round.current().seal("rock")).rejects.toThrow(/final/);

    // The same seal, on a phone that does not hold the move.
    const seal = (lastOp() as { set: { value: string } }).set.value;
    await unmount(round.root);
    setMockPrivate({});
    await act(async () => { setMockState({ by: { [A]: { sealed: { r4: seal } } } }); });
    await settle();
    const elsewhere = await mount("r4", false);
    expect(elsewhere.current().sealed).toEqual([A]);
    expect(elsewhere.current().mine).toBeUndefined();
    await expect(elsewhere.current().open()).rejects.toThrow(/not sealed on this phone/);
    await unmount(elsewhere.root);
  });
});
