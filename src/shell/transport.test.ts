// @vitest-environment happy-dom

/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066. What the bridge does with a reply, and with one that never comes.

The transport is built ONCE, at module scope, and `unmount` does not replace
it — so a pooled web view keeps the same one across every app it ever hosts.
Anything it forgets to clean up is not forgotten for the length of a post; it
is forgotten for the length of the process. That is what makes a listener per
call a leak rather than an inefficiency, and it is why the shape is pinned
here.

The third case is the one that used to be unreachable: WebKit does drop
replies — it says so, "completion handler is no longer reachable" — and the
waiter for such a call was kept for ever, because it was only ever removed
when a reply with a matching id arrived.
*/

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTransport, HOST_REQUEST_EVENT, HOST_REPLY_EVENT } from "./transport";

/** Answer whatever the transport last asked, as the native relay would. */
const answer = (id: string, payload: unknown): void => {
  document.dispatchEvent(new CustomEvent(HOST_REPLY_EVENT, { detail: { id, payload } }));
};

/** The ids of every request the transport has dispatched, in order. */
const watchRequests = (): string[] => {
  const ids: string[] = [];
  document.addEventListener(HOST_REQUEST_EVENT, (event) => {
    ids.push(((event as CustomEvent).detail as { id: string }).id);
  });
  return ids;
};

afterEach(() => {
  vi.useRealTimers();
});

describe("the bridge to native", () => {
  it("routes each reply to the call that asked, whatever the order", async () => {
    const transport = createTransport();
    const ids = watchRequests();

    const first = transport.call("time.read", null, false);
    const second = transport.call("app.context.read", null, false);

    // Answered back to front, which is allowed: nothing orders host replies.
    answer(ids[1]!, '{"ok":true,"data":"second"}');
    answer(ids[0]!, '{"ok":true,"data":"first"}');

    expect(await first).toBe('{"ok":true,"data":"first"}');
    expect(await second).toBe('{"ok":true,"data":"second"}');
  });

  it("listens once however many calls are in flight", async () => {
    const transport = createTransport();
    const ids = watchRequests();
    const listen = vi.spyOn(document, "addEventListener");

    const calls = [
      transport.call("time.read", null, false),
      transport.call("time.read", null, false),
      transport.call("time.read", null, false),
    ];

    const replyListeners = listen.mock.calls.filter(([name]) => name === HOST_REPLY_EVENT);
    expect(replyListeners).toHaveLength(1);

    ids.forEach((id) => answer(id, '{"ok":true,"data":null}'));
    await Promise.all(calls);
    listen.mockRestore();
  });

  it("gives up on a call the host never answers, instead of remembering it for ever", async () => {
    vi.useFakeTimers();
    const transport = createTransport();
    const pending = transport.call("time.read", null, false);
    const settled = expect(pending).rejects.toThrow(/never answered/);

    await vi.advanceTimersByTimeAsync(31_000);
    await settled;
  });

  it("refuses a reply that is not a string rather than passing it on", async () => {
    const transport = createTransport();
    const ids = watchRequests();
    const pending = transport.call("time.read", null, false);

    answer(ids[0]!, { ok: true });

    await expect(pending).rejects.toThrow(/non-string reply/);
  });
});
