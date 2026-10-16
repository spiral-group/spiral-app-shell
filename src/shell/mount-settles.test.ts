/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066. The property `painted.test.ts` named and did not test.

That file's own header says it: "it has to happen EVERY time, because a promise
that never settles is a post that stays a card for ever." It then tested the
wire format of the paint signal — which is worth testing, and is not that.

The property went untested and duly broke. Measured on a simulator: 411 mounts,
356 painted, 20 failed, and **35 that returned nothing at all** — no success, no
error, no log line. Each one was a suspended task on the native side and a post
stuck behind its card, invisible to every instrument we had, because nothing
had gone wrong; something had simply never finished.

The cause was two lines apart: `mount` awaited `runtime.painted`, and `destroy`
cleared the timers that promise relies on as its escape hatch without settling
it. A newer mount destroyed the older one's runtime, and the older caller waited
for a paint that could no longer happen.

So this file tests the one sentence that matters: **a mount always settles.**

@vitest-environment happy-dom
*/

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ABANDONED } from "./runtime";
import { RUNTIME_PAINTED } from "./protocol";

interface MountRequestUnderTest {
  instanceId: string;
  documentUrl: string;
  capabilities: never[];
  runtimeVersion: string;
  viewerId: string;
}

/** A mount request with the shape the host sends. */
const request = (instanceId: string): MountRequestUnderTest => ({
  instanceId,
  documentUrl: "spiral-app://a-test/index.html",
  capabilities: [],
  runtimeVersion: "1",
  viewerId: "@viewer:example.org",
});

/**
 * The shell installs itself on `window` at import time, so it is imported
 * fresh per test — the module holds the current runtime and the generation
 * counter, and a test that inherited them would be testing the previous one.
 */
const loadShell = async () => {
  document.body.innerHTML = "";
  vi.resetModules();
  await import("./main");
  return (window as unknown as { __spiralShell: ShellUnderTest }).__spiralShell;
};

interface ShellUnderTest {
  mount(request: MountRequestUnderTest): Promise<void>;
  unmount(): void;
  status(): { mounted: boolean; instanceId: string | null };
}

/**
 * Settle or fail — never hang.
 *
 * Without this the suite REPRODUCES the bug instead of reporting it: an
 * unsettled mount makes the test wait until the runner gives up minutes later,
 * which reads as a broken harness rather than as the defect it is. A promise
 * that has not settled by now is the failure, and it should say so.
 */
const settles = async (promise: Promise<unknown>, what: string) => {
  const verdict = await Promise.race([
    promise.then(() => "resolved" as const, () => "rejected" as const),
    new Promise<"never">((resolve) => setTimeout(() => resolve("never"), 500)),
  ]);
  expect(verdict, `${what} never settled — a post would keep its card for ever`).not.toBe("never");
  return verdict;
};

/**
 * Pretend the app in the newest frame has drawn.
 *
 * The real signal comes from the artifact over `postMessage`; the frame never
 * loads under a test DOM, so this plays the same note by hand.
 */
const reportPainted = () => {
  window.dispatchEvent(new MessageEvent("message", { data: { kind: RUNTIME_PAINTED } }));
};

describe("a mount always settles", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("resolves when the app draws", async () => {
    const shell = await loadShell();
    const mounted = shell.mount(request("a"));
    reportPainted();
    expect(await settles(mounted, "a mount that painted")).toBe("resolved");
    expect(shell.status()).toEqual({ mounted: true, instanceId: "a" });
  });

  it("settles the mount that a newer mount replaces, rather than leaving it to wait", async () => {
    const shell = await loadShell();

    // Never painted: the first app is still starting when the second arrives.
    const first = shell.mount(request("first"));
    const second = shell.mount(request("second"));
    reportPainted();

    // THE bug: before this, `first` was a promise nobody would ever settle.
    expect(await settles(first, "a mount that was replaced")).toBe("rejected");
    await expect(first).rejects.toThrow(ABANDONED);
    expect(await settles(second, "the mount that replaced it")).toBe("resolved");
    expect(shell.status().instanceId).toBe("second");
  });

  it("settles a mount that unmount cuts short", async () => {
    const shell = await loadShell();
    const mounted = shell.mount(request("a"));

    shell.unmount();

    expect(await settles(mounted, "a mount that unmount cut short")).toBe("rejected");
    expect(shell.status()).toEqual({ mounted: false, instanceId: null });
  });

  it("settles every mount in a burst, not only the last", async () => {
    const shell = await loadShell();

    // What a fast scroll does to a pooled web view.
    const mounts = ["a", "b", "c", "d", "e"].map((id) => shell.mount(request(id)));
    reportPainted();

    // Each one individually, so a burst where ONE hangs names which.
    const verdicts = [];
    for (const [index, mount] of mounts.entries()) {
      verdicts.push(await settles(mount, `mount ${index} of a burst of five`));
    }

    // The last one owns the shell; every earlier one was told it was replaced.
    expect(verdicts.slice(0, 4)).toEqual(["rejected", "rejected", "rejected", "rejected"]);
    expect(verdicts[4]).toBe("resolved");
    expect(shell.status().instanceId).toBe("e");
  });

  it("does not reveal an app that was replaced after it drew", async () => {
    const shell = await loadShell();

    const first = shell.mount(request("first"));
    // It draws — but by the time the paint lands, a newer mount owns the shell.
    const second = shell.mount(request("second"));
    reportPainted();

    expect(await settles(first, "a mount replaced after it drew")).toBe("rejected");
    await expect(first).rejects.toThrow(ABANDONED);
    expect(await settles(second, "the mount that replaced it")).toBe("resolved");
  });
});
