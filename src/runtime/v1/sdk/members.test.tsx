// @vitest-environment happy-dom
/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

The roster follows the room (§ 5.67): a post that has read the members
once is told when they change, and shows the change without a remount.
*/
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { installMockHost, pushToMockApp } from "../mock";
import { useRoomMembers } from "./index";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

describe("useRoomMembers follows members.changed", () => {
  it("re-renders with the new roster", async () => {
    const teardown = installMockHost({ userId: "@a:h", members: [{ userId: "@a:h", displayName: "A" }, { userId: "@b:h", displayName: "B" }] });
    const el = document.createElement("div"); document.body.append(el);
    const App = () => { const m = useRoomMembers(); return createElement("div", null, (m ?? []).map((x) => x.displayName).join(",")); };
    const root = createRoot(el);
    await act(async () => { root.render(createElement(App)); });
    await flush();
    expect(el.textContent).toBe("A,B");
    await act(async () => { pushToMockApp({ kind: "members.changed", data: { members: [{ userId: "@a:h", displayName: "A" }] } }); });
    await flush();
    expect(el.textContent).toBe("A");
    await act(async () => { root.unmount(); });
    teardown();
  });
});
