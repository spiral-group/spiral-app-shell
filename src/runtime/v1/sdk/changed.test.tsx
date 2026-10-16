// @vitest-environment happy-dom
/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

`useChanged` (§ 5.77): what happens while a post is on screen, as opposed to
the state it opens with. Its own file, because the SDK's store is one per
frame: this post must be the first thing in it to read the state.
*/
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, expect, it } from "vitest";

import { installMockHost, setMockState } from "../mock";
import { Spiral, useChanged, useSharedState } from "./index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const A = "@a:spiral.md";
const teardown = installMockHost({ userId: A, members: [{ userId: A, displayName: "Andrii" }], state: { presses: 16 } });
afterAll(() => teardown());

it("hears a press that lands while the post is open — this viewer's or anyone's — and not the state it opened with", async () => {
  const heard: [number, number][] = [];
  const seen: number[] = [];
  const Post = (): null => {
    const [state] = useSharedState();
    const presses = Number(state["presses"]) || 0;
    seen.push(presses);
    useChanged(presses, (n, before) => { heard.push([n, before]); });
    return null;
  };
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  await act(async () => { root.render(createElement(Post)); });
  await settle();

  // It rendered with nothing and then with the post's own sixteen: arriving
  // is not happening.
  expect(seen[0]).toBe(0);
  expect(seen.at(-1)).toBe(16);
  expect(heard).toEqual([]);

  // Someone else presses.
  await act(async () => { setMockState({ presses: 17 }); });
  await settle();
  expect(heard).toEqual([[17, 16]]);

  // This viewer presses: heard at once, from the optimistic fold, and not
  // again when the host echoes it.
  await act(async () => { await Spiral.state.apply({ incr: { path: "presses", by: 1 } }); });
  await settle();
  expect(heard).toEqual([[17, 16], [18, 17]]);
  root.unmount();
});
