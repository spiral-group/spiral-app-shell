/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007. Entry point of the TRUSTED shell document.

One shell per pooled WKWebView. It is loaded once, kept warm, and reused for
one untrusted app after another (ADR-0007 § 4.5) — so this document must never
execute artifact code itself and must hold no per-app state outside the
`AppRuntime` it can destroy.

The native host drives it through `window.__spiralShell`. That global is
reachable only from THIS document; the app lives in a sandboxed opaque-origin
iframe and cannot see it.
*/

import { ABANDONED, AppRuntime } from "./runtime";
import type { SpiralMethod, SpiralPush } from "./protocol";
import { createTransport } from "./transport";

interface MountRequest {
  readonly instanceId: string;
  readonly documentUrl: string;
  readonly capabilities: readonly SpiralMethod[];
  readonly runtimeVersion: string;
  readonly viewerId: string;
  readonly language?: string;
}

interface ShellApi {
  /**
   * Replace whatever is running with a fresh app.
   *
   * Resolves when the app has DRAWN, not when the artifact was accepted — the
   * host covers the post with a card until then, and "accepted" would reveal
   * an empty frame that is still compiling.
   */
  mount(request: MountRequest): Promise<void>;
  /** Destroy the current app; the shell stays warm for the next one. */
  unmount(): void;
  /** Deliver an unsolicited message (state changed, teardown warning). */
  push(message: SpiralPush): void;
  /** Diagnostics for the spike host. */
  status(): { mounted: boolean; instanceId: string | null };
  readonly protocolVersion: number;
}

const transport = createTransport();
let current: AppRuntime | undefined;
let currentInstanceId: string | null = null;
/**
 * Which mount is the live one.
 *
 * The host pools its web views, so `mount` is called again on a shell that is
 * still starting the previous app — and before this, the older call awaited a
 * runtime that the newer one had already destroyed, so it waited for ever.
 * Counting them makes "you were replaced" a thing a caller can be told.
 */
let generation = 0;

const container = (): HTMLElement => {
  const existing = document.getElementById("spiral-app-root");
  if (existing) return existing;
  const created = document.createElement("div");
  created.id = "spiral-app-root";
  created.style.cssText = "position:absolute;inset:0;overflow:hidden";
  document.body.appendChild(created);
  return created;
};

const reportError = (message: string): void => {
  // Console is the spike's evidence channel; the iOS host mirrors it into
  // MXLog through the WKWebView console delegate.
  console.error("[spiral-shell]", message);
};

const unmount = (): void => {
  current?.destroy();
  current = undefined;
  currentInstanceId = null;
};

const shell: ShellApi = {
  async mount(request) {
    const mine = ++generation;
    unmount();
    currentInstanceId = request.instanceId;
    const runtime = AppRuntime.start({
      instanceId: request.instanceId,
      documentUrl: request.documentUrl,
      capabilities: request.capabilities,
      runtimeVersion: request.runtimeVersion,
      viewerId: request.viewerId,
      ...(request.language ? { language: request.language } : {}),
      transport,
      container: container(),
      onError: reportError,
    });
    current = runtime;

    try {
      await runtime.painted;
    } catch (error) {
      // Superseded while starting: `unmount` in the newer call destroyed this
      // runtime, which settles its promise. Say so in the one word the host
      // checks for, rather than letting a replaced app look like a broken one.
      if (mine !== generation) throw new Error(ABANDONED);
      throw error;
    }

    // Painted, but for an app that has since been replaced. Revealing it would
    // uncover the newer app's frame under the older app's name.
    if (mine !== generation) throw new Error(ABANDONED);
  },

  unmount,

  push(message) {
    current?.push(message);
  },

  status() {
    return {
      mounted: current !== undefined && !current.isDestroyed,
      instanceId: currentInstanceId,
    };
  },

  protocolVersion: 1,
};

declare global {
  // eslint-disable-next-line no-var
  var __spiralShell: ShellApi | undefined;
}

globalThis.__spiralShell = shell;

// Tell the host the shell is warm and can accept a mount. The pool waits for
// this before handing the WebView to a post.
window.dispatchEvent(new CustomEvent("spiral-shell-ready"));
