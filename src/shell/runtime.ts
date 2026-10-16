/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007. One running app: the iframe, its port, its quotas.

This IS a security boundary. Everything arriving on the port comes from
untrusted generated code, so every message is parsed structurally, checked
against the granted capability set, counted against quotas and timed out.
The native host re-authorises independently — this layer exists to keep
obvious abuse off the bridge, not to be the only gate.

Teardown is the other half of the design: `destroy()` must leave nothing of
this app behind, because the WKWebView it ran in is pooled and the next app
gets the same one (ADR-0007 § 4.5). Removing the iframe drops its whole
JavaScript realm — globals, timers, listeners, module registry. Spike item 9
exists to prove exactly that.
*/

import { checkArguments } from "./arguments";
import {
  LIMITS,
  PROTOCOL_VERSION,
  failure,
  parseRequest,
  isRuntimePainted,
  parseRuntimeError,
  parseRuntimeLog,
  type SpiralInit,
  type SpiralMethod,
  type SpiralPush,
  type SpiralReply,
} from "./protocol";
import type { HostTransport } from "./transport";

/**
 * Why a mount stopped waiting without drawing.
 *
 * Named rather than anonymous because the host has to tell it apart from an
 * artifact that genuinely failed: a superseded mount is not an error anyone
 * can act on — the app that replaced it is the one that matters.
 */
export const ABANDONED = "spiral-mount-abandoned";

export interface AppRuntimeOptions {
  readonly instanceId: string;
  /** Path the scheme handler serves this artifact's synthesised document from. */
  readonly documentUrl: string;
  readonly capabilities: readonly SpiralMethod[];
  readonly runtimeVersion: string;
  readonly viewerId: string;
  /** The app's language, primary subtag; see `SpiralInit.language`. */
  readonly language?: string;
  readonly transport: HostTransport;
  /** Where the iframe is mounted. Owned by the caller. */
  readonly container: HTMLElement;
  readonly onError?: (message: string) => void;
}

/**
 * How long the host may be asked to hold a card over a post.
 *
 * Generous on purpose: it is the time a cold artifact needs to load, compile
 * and render on a slow device, and cutting it short reveals an empty frame —
 * which is the thing being avoided.
 */
const PAINT_TIMEOUT_MS = 5_000;

export class AppRuntime {
  private iframe: HTMLIFrameElement | undefined;
  private port: MessagePort | undefined;
  private inFlight = 0;
  private destroyed = false;
  private sawRuntimeBoot = false;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  /**
   * Resolves when the app has drawn, or when waiting stops being reasonable.
   *
   * The host covers a post with a card until this settles, so it must ALWAYS
   * settle: an artifact that never reports is late, not invisible. That is the
   * whole reason the timeout is here rather than in Swift — the promise is the
   * contract, so the promise carries the escape hatch.
   */
  readonly painted: Promise<void>;
  private reportPainted: () => void = () => {};
  private abandonPainted: (reason: Error) => void = () => {};

  private constructor(private readonly options: AppRuntimeOptions) {
    this.painted = new Promise((resolve, reject) => {
      this.reportPainted = resolve;
      this.abandonPainted = reject;
    });

    // Marks the promise as handled so an app that is torn down before anyone
    // awaits it does not surface as an unhandled rejection — which the console
    // relay would report to the host as an error in an app that did nothing
    // wrong. Awaiters attached later still receive the rejection.
    this.painted.catch(() => {});
  }

  static start(options: AppRuntimeOptions): AppRuntime {
    const runtime = new AppRuntime(options);
    runtime.mount();
    return runtime;
  }

  private mount(): void {
    const iframe = document.createElement("iframe");

    // `allow-scripts` WITHOUT `allow-same-origin`: the frame gets an opaque
    // origin whatever its URL is, which is what actually removes
    // localStorage, IndexedDB, cookies and any reach into this document.
    // Adding `allow-same-origin` here would defeat the entire design.
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.setAttribute("title", "Spiral app");
    iframe.style.cssText =
      "border:0;width:100%;height:100%;display:block;background:transparent";
    iframe.src = this.options.documentUrl;

    iframe.addEventListener("load", () => this.handshake(iframe), { once: true });
    iframe.addEventListener("error", () =>
      this.options.onError?.("the artifact frame failed to load"),
    );

    window.addEventListener("message", this.onBootMessage);

    this.options.container.appendChild(iframe);
    this.iframe = iframe;

    // The shell's console reaches the native log; the frame's does not, so
    // these three lines are the only visibility into whether an app started
    // at all. They cost nothing and have already paid for themselves once.
    console.info("[spiral-shell] frame appended for", this.options.instanceId);
  }

  /**
   * The frame says its runtime module evaluated — or that it died trying.
   *
   * Boot is distinct from the frame's `load`: a module that throws while
   * evaluating still lets `load` fire, so without this the shell cannot tell
   * a broken runtime from a missed handshake.
   *
   * Errors arrive here too, because the ones raised BEFORE the handshake have
   * no port to travel on and the window is their only way out.
   */
  private onBootMessage = (event: MessageEvent): void => {
    const data = event.data as { kind?: string } | undefined;

    const runtimeError = parseRuntimeError(data);
    if (runtimeError) {
      this.options.onError?.(`[${runtimeError.stage}] ${runtimeError.message}`);
      return;
    }

    if (isRuntimePainted(data)) {
      this.reportPainted();
      return;
    }

    if (data?.kind !== "runtime-boot") return;
    console.info("[spiral-shell] runtime booted in the frame");
    this.sawRuntimeBoot = true;
  };

  private handshake(iframe: HTMLIFrameElement): void {
    if (this.destroyed) return;
    console.info("[spiral-shell] frame loaded, sending spiral-init");

    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = (event) => void this.onAppMessage(event.data);
    this.port.start();

    const init: SpiralInit = {
      kind: "spiral-init",
      protocol: PROTOCOL_VERSION,
      instanceId: this.options.instanceId,
      capabilities: this.options.capabilities,
      runtimeVersion: this.options.runtimeVersion,
      viewerId: this.options.viewerId,
      ...(this.options.language ? { language: this.options.language } : {}),
    };

    // `"*"` is correct and unavoidable: the frame's origin is opaque, so
    // there is no specific origin to target. Handing over port2 is what
    // makes this the app's ONLY channel out.
    iframe.contentWindow?.postMessage(init, "*", [channel.port2]);

    // Waiting for a paint cannot be waiting for ever: the host covers the post
    // until this settles, and an app that never reports should arrive late
    // rather than never arrive at all.
    const paintCheck = setTimeout(() => {
      this.timers.delete(paintCheck);
      this.reportPainted();
    }, PAINT_TIMEOUT_MS);
    this.timers.add(paintCheck);

    // If the module never evaluated, nothing will ever answer. Say so
    // rather than leaving the host to guess from a blank frame.
    const bootCheck = setTimeout(() => {
      this.timers.delete(bootCheck);
      if (!this.sawRuntimeBoot && !this.destroyed) {
        this.options.onError?.("the runtime module never evaluated in the frame");
      }
    }, 3_000);
    this.timers.add(bootCheck);
  }

  private async onAppMessage(raw: unknown): Promise<void> {
    if (this.destroyed || !this.port) return;

    // A fatal error from the bootstrap, not a request. Checked first
    // because the frame is opaque to us: this is the only way we learn that
    // an artifact failed to start.
    const runtimeError = parseRuntimeError(raw);
    if (runtimeError) {
      this.options.onError?.(`[${runtimeError.stage}] ${runtimeError.message}`);
      return;
    }

    const line = parseRuntimeLog(raw);
    if (line) {
      // The app's own words, on the shell's console so the host can see
      // them. Prefixed so a reader can tell the app from the shell.
      (line.level === "error" ? console.error : line.level === "warn" ? console.warn : console.info)(
        "[spiral-app]",
        line.message,
      );
      return;
    }

    if (isRuntimePainted(raw)) {
      this.reportPainted();
      return;
    }

    const parsed = parseRequest(raw);
    if ("error" in parsed) {
      // No id to correlate, so there is nobody to answer. Surface it for the
      // spike log and drop it.
      this.options.onError?.(`malformed request: ${parsed.error}`);
      return;
    }

    if (!this.options.capabilities.includes(parsed.method)) {
      this.reply(failure(parsed.id, "rejected", `capability not granted: ${parsed.method}`));
      return;
    }

    let encoded: string;
    try {
      encoded = JSON.stringify(parsed.args ?? null);
    } catch {
      this.reply(failure(parsed.id, "rejected", "arguments are not serialisable"));
      return;
    }
    if (encoded.length > LIMITS.maxRequestBytes) {
      this.reply(failure(parsed.id, "rejected", "request exceeds size limit"));
      return;
    }

    if (this.inFlight >= LIMITS.maxInFlight) {
      this.reply(failure(parsed.id, "rejected", "too many requests in flight"));
      return;
    }

    // Deliberately AFTER the limits. The cheap questions — is it too big, is
    // there room for it — must be answered first, both because inspecting a
    // huge message is itself the work we are refusing, and because a message
    // refused for its shape would otherwise mask whether the size limit works
    // at all.
    //
    // Before the round trip, though, not instead of the host's own check:
    // refusing here costs a message, refusing natively costs a process hop
    // into the code that writes to a room.
    const badArguments = checkArguments(parsed.method, parsed.args);
    if (badArguments) {
      this.reply(failure(parsed.id, "rejected", badArguments));
      return;
    }

    this.inFlight += 1;
    try {
      const rawReply = await this.withTimeout(
        this.options.transport.call(parsed.method, parsed.args, parsed.userActivation),
      );
      this.reply(this.decodeHostReply(parsed.id, rawReply));
    } catch (error) {
      const message = error instanceof Error ? error.message : "host call failed";
      this.reply(failure(parsed.id, "unavailable", message));
    } finally {
      this.inFlight -= 1;
    }
  }

  /**
   * The host's reply is a JSON string in the Element Call envelope shape.
   * A reply we cannot parse is reported as `unavailable` rather than passed
   * through: the app must never see half-decoded host output.
   */
  private decodeHostReply(id: string, rawReply: string): SpiralReply {
    try {
      const parsed = JSON.parse(rawReply) as Record<string, unknown>;
      if (parsed["ok"] === true) {
        return { id, ok: true, data: parsed["data"] ?? null };
      }
      const code = parsed["code"];
      const message = parsed["message"];
      return failure(
        id,
        code === "conflict" || code === "gone" || code === "rejected" ? code : "unavailable",
        typeof message === "string" ? message : "host refused the request",
      );
    } catch {
      return failure(id, "unavailable", "host reply was not valid JSON");
    }
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        reject(new Error("host did not answer in time"));
      }, LIMITS.requestTimeoutMs);
      this.timers.add(timer);

      promise.then(
        (value) => {
          clearTimeout(timer);
          this.timers.delete(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          this.timers.delete(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  private reply(reply: SpiralReply): void {
    if (this.destroyed) return;
    this.port?.postMessage(reply);
  }

  /** Unsolicited shell -> app message (state changed, teardown warning). */
  push(message: SpiralPush): void {
    if (this.destroyed) return;
    this.port?.postMessage(message);
  }

  /**
   * Remove the app completely. Dropping the iframe discards its realm, which
   * is what makes the WKWebView safe to reuse for a different, equally
   * untrusted app.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    window.removeEventListener("message", this.onBootMessage);

    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();

    // SETTLE THE PROMISE. The timers just cleared are the escape hatch that
    // `painted` promises to carry, so clearing them without settling leaves a
    // caller waiting for a paint that can no longer happen. Measured on a
    // simulator: 411 mounts, 356 painted, 20 failed — and 35 that returned
    // NOTHING, each one a suspended task on the native side and a post that
    // kept its card for ever, with no error anywhere to say so.
    //
    // Rejecting rather than resolving, because a destroyed app has not drawn:
    // resolving would tell the host to lift the card off an empty frame.
    this.abandonPainted(new Error(ABANDONED));

    if (this.port) {
      this.port.onmessage = null;
      this.port.close();
      this.port = undefined;
    }

    this.iframe?.remove();
    this.iframe = undefined;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }
}
