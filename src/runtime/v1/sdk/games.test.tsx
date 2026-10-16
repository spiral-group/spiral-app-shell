// @vitest-environment happy-dom
/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Games, as the SDK knows them (§ 5.75): who plays which seat, whom a move
tells, and a chat's table of best scores — played against the mock host,
one viewer, with the other side's moves landing as state.
*/
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { installMockHost, mockWrites, resetMockState, setMockState } from "../mock";
import { useLeaderboard, useSeats, type SpiralLeaderboard, type SpiralSeats } from "./index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const A = "@a:spiral.md", B = "@b:spiral.md", C = "@c:spiral.md";
const teardown = installMockHost({ userId: A, members: [{ userId: A, displayName: "Andrii" }, { userId: B, displayName: "Bohdan" }] });
afterAll(() => teardown());

/** Mount a hook, hand back its latest value. */
const mount = async <T,>(hook: () => T): Promise<{ current: () => T; root: Root }> => {
  let latest: T | undefined;
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  const Probe = (): null => { latest = hook(); return null; };
  await act(async () => { root.render(createElement(Probe)); });
  await settle();
  return { current: () => latest as T, root };
};

describe("useSeats", () => {
  beforeEach(() => resetMockState());

  it("reaches the only possible opponent on the first move of a two-person chat", async () => {
    const seats = await mount(() => useSeats(["X", "O"]));
    expect(seats.current().ping("O")).toEqual({ challenge: B });
    await act(async () => { await seats.current().sit("X"); });
    await settle();
    expect(seats.current().mine).toBe("X");
    expect(seats.current().ping("X")).toEqual({}); // never oneself
    seats.root.unmount();
  });

  it("tells whoever sits on the seat to move that it is their turn", async () => {
    await act(async () => { setMockState({ seats: { X: A, O: B } }); });
    await settle();
    const seats = await mount(() => useSeats(["X", "O"]));
    expect(seats.current().ping("O")).toEqual({ turn: B });
    expect(seats.current().name("O")).toBe("Bohdan");
    expect(seats.current().full).toBe(true);
    seats.root.unmount();
  });

  it("calls a chosen person to a free seat, and tells them so", async () => {
    const seats = await mount((): SpiralSeats<"X" | "O"> => useSeats(["X", "O"]));
    await act(async () => { await seats.current().invite("O", C); });
    await settle();
    expect(seats.current().ping("O")).toEqual({ challenge: C });
    expect(mockWrites().at(-1)?.summary).toMatchObject({ notify_users: [C], notify_kind: "challenge" });
    seats.root.unmount();
  });
});

describe("useLeaderboard", () => {
  beforeEach(() => resetMockState());

  it("keeps a best in the player's own name and pings whoever it knocked off first place", async () => {
    await act(async () => { setMockState({ by: { [B]: { best: 10, plays: 3 } } }); });
    await settle();
    const board = await mount((): SpiralLeaderboard => useLeaderboard());
    expect(board.current().leader?.userId).toBe(B);

    await act(async () => { await board.current().submit(12); });
    await settle();
    const write = mockWrites().at(-1);
    expect(write?.summary).toMatchObject({ notify_users: [B], notify_kind: "record" });
    expect((write?.summary as { line: Record<string, string> }).line["uk"]).toBe("Andrii — новий рекорд: 12");
    expect(board.current().leader).toMatchObject({ userId: A, best: 12, plays: 1 });
    expect(board.current().entries.map((e) => e.userId)).toEqual([A, B]);
    board.root.unmount();
  });

  it("pings nobody for a game that beats no one, and keeps the best when a game is worse", async () => {
    await act(async () => { setMockState({ by: { [A]: { best: 20, plays: 1 }, [B]: { best: 10, plays: 1 } } }); });
    await settle();
    const board = await mount((): SpiralLeaderboard => useLeaderboard());
    await act(async () => { await board.current().submit(15); });
    await settle();
    expect(mockWrites().at(-1)?.summary).toMatchObject({ notify: "badge" });
    expect(board.current().mine).toMatchObject({ best: 20, plays: 2 });
    board.root.unmount();
  });

  it("ranks times the other way round", async () => {
    await act(async () => { setMockState({ by: { [A]: { best: 9.5, plays: 1 }, [B]: { best: 8.1, plays: 1 } } }); });
    await settle();
    const board = await mount((): SpiralLeaderboard => useLeaderboard({ better: "lower" }));
    expect(board.current().leader?.userId).toBe(B);
    await act(async () => { await board.current().submit(7.9); });
    await settle();
    expect(mockWrites().at(-1)?.summary).toMatchObject({ notify_users: [B], notify_kind: "record" });
    board.root.unmount();
  });

  it("writes a time's unit in each reader's language", async () => {
    await act(async () => { setMockState({}); }); // nobody has played
    await settle();
    const board = await mount((): SpiralLeaderboard =>
      useLeaderboard({ better: "lower", format: (n, language) => `${n} ${language === "en" ? "ms" : "мс"}` }));
    await act(async () => { await board.current().submit(243); });
    await settle();
    const line = (mockWrites().at(-1)?.summary as { line: Record<string, string> }).line;
    expect(line["uk"]).toBe("Andrii: 243 мс — особистий рекорд");
    expect(line["en"]).toBe("Andrii: 243 ms — personal best");
    board.root.unmount();
  });
});
