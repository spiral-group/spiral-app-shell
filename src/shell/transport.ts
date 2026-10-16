/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007. The shell's link to the native host.

Kept behind an interface with one implementation on purpose: Android is
deferred (ADR-0007 D10), and when it arrives it should slot in here rather
than force a rewrite of `runtime.ts`. The iOS implementation mirrors the
retired Element Call bridge — a reply-style `WKScriptMessageHandlerWithReply`
whose `postMessage` returns a Promise — because that shape is already proven
on this platform and the team reads its errors.

Only the SHELL ever touches this. The sandboxed iframe has no access to
`window.webkit` (opaque origin, `sandbox="allow-scripts"`), which is the
whole point of the two-document design.
*/

import type { SpiralMethod } from "./protocol";

/** What the host returns for a request. Raw JSON string, parsed by the caller. */
export interface HostTransport {
  /** Send a method call to the native host and await its JSON reply. */
  call(method: SpiralMethod, args: unknown, userActivation: boolean): Promise<string>;
  /** True when a host is actually attached (false in browser dev). */
  readonly available: boolean;
}

/**
 * DOM events that cross the content-world boundary.
 *
 * The native handlers deliberately do NOT live in the page world: a script
 * message handler is visible "in all frames in the specified content world",
 * so leaving them in the page world would hand an artifact's frame a direct
 * line to native. They live in an isolated world instead, and since worlds
 * share the DOM but not globals, a `CustomEvent` is the sanctioned way
 * across. The relay on the other side is injected into the main frame only,
 * so an artifact's frame has no bridge to abuse even by name.
 *
 * Must stay in sync with `SpiralAppContentWorld` on the Swift side.
 */
export const HOST_REQUEST_EVENT = "spiral-host-request";
export const HOST_REPLY_EVENT = "spiral-host-reply";

/**
 * How long a waiter is kept before it is given up on.
 *
 * Longer than the runtime's own `LIMITS.requestTimeoutMs`, on purpose: the
 * runtime is the one that answers the app, and this only decides when a
 * waiter that will never be answered stops being remembered.
 */
const FORGET_WAITER_MS = 30_000;

class IosTransport implements HostTransport {
  readonly available = true;
  private nextId = 0;

  /**
   * ONE listener for every call in flight, not one listener per call.
   *
   * Each call used to register its own listener and remove it only on an id
   * MATCH — so every reply woke every outstanding listener to compare
   * strings, and any request that was never answered left its listener
   * attached for good. Both mattered more than they look: the transport is
   * built once at module scope and is never reset by `unmount`, so a pooled
   * web view carried the leak across every app it ever hosted, and WebKit
   * does drop replies ("completion handler is no longer reachable") often
   * enough for that to accumulate rather than stay theoretical.
   */
  private readonly waiting = new Map<
    string,
    { resolve: (value: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  private listening = false;

  private readonly onReply = (event: Event): void => {
    const detail = (event as CustomEvent).detail as { id?: string; payload?: unknown } | undefined;
    if (typeof detail?.id !== "string") return;

    const waiter = this.waiting.get(detail.id);
    if (!waiter) return;

    this.waiting.delete(detail.id);
    clearTimeout(waiter.timer);

    if (typeof detail.payload !== "string") {
      waiter.reject(new Error("host returned a non-string reply"));
      return;
    }
    waiter.resolve(detail.payload);
  };

  async call(
    method: SpiralMethod,
    args: unknown,
    userActivation: boolean,
  ): Promise<string> {
    const id = `host-${this.nextId++}`;

    if (!this.listening) {
      document.addEventListener(HOST_REPLY_EVENT, this.onReply);
      this.listening = true;
    }

    const reply = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error("host never answered"));
      }, FORGET_WAITER_MS);
      this.waiting.set(id, { resolve, reject, timer });
    });

    // The host answers with a JSON string so the shell owns parsing and the
    // bridge stays a dumb byte pipe — the Element Call bridge did the same.
    document.dispatchEvent(
      new CustomEvent(HOST_REQUEST_EVENT, {
        detail: {
          id,
          body: { method, args: JSON.stringify(args ?? null), userActivation },
        },
      }),
    );

    return reply;
  }
}

/**
 * Whether the DOM primitives the relay needs exist at all.
 *
 * Deliberately not a check for the relay itself: the isolated world is
 * invisible from here, which is the entire point of putting the handlers
 * there. Outside a browser (unit tests, Node) there is no document and the
 * detached transport is correct.
 */
const canReachRelay = (): boolean =>
  typeof document !== "undefined" && typeof CustomEvent !== "undefined";

/**
 * Stands in for the host when the shell runs in a plain browser (design work,
 * unit tests, Storybook-style previews). Fails every call rather than
 * inventing data: a silent fake would let a broken app look healthy.
 */
class DetachedTransport implements HostTransport {
  readonly available = false;

  async call(method: SpiralMethod): Promise<string> {
    return JSON.stringify({
      ok: false,
      code: "unavailable",
      message: `no native host attached (method: ${method})`,
    });
  }
}

/**
 * The shell cannot tell whether a native relay is listening — the isolated
 * world is invisible from here, which is the point. So a host is assumed
 * whenever the DOM primitives exist, and a request that nobody answers ends
 * as the shell's own `unavailable` timeout rather than as a silent hang.
 */
export const createTransport = (): HostTransport =>
  canReachRelay() ? new IosTransport() : new DetachedTransport();
