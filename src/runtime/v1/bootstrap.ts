/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007 § 4.4. What the SANDBOXED iframe runs first.

This file is OURS but it executes in the same realm as the untrusted app, so
it is not a security boundary — it is the app's launcher. It:

  1. hardens the realm against the one network path CSP does not cover
     (WebRTC), before any artifact code exists;
  2. waits for the shell's `spiral-init` and takes the MessagePort;
  3. fetches `app.jsx` as TEXT and transpiles it in memory;
  4. imports the result via a blob URL and mounts the default export.

Nothing is written to disk or storage: the frame has an opaque origin, so
there is no storage to write to. Every byte it can fetch comes from the
scheme handler, which serves only this artifact's files and the shipped
runtime.
*/

import { hardenRealm } from "./harden";
import { correctPlatform } from "./platform";
import { formatReport, measureLayout } from "./measure";
import { initTranspiler, transpile } from "./transpile";
import type { SpiralInit } from "../../shell/protocol";

const ROOT_ID = "root";

/**
 * CSP (`script-src 'self' blob:`) allows the blob import that the zero-build
 * design needs. `frame-src 'none'` prevents the app from opening a fresh,
 * un-hardened realm to undo `hardenRealm()`. Spike item 6 verifies that
 * `blob:` opens no network path; if it turns out to, the fallback is to
 * transpile in the shell and post the JS in (notebook § 7 OPEN #3).
 */
const importModule = async (source: string): Promise<{ default?: unknown }> => {
  const blob = new Blob([source], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    return (await import(/* @vite-ignore */ url)) as { default?: unknown };
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** The port, once the handshake has handed it over. */
let hostPort: MessagePort | undefined;

type Stage = "load" | "compile" | "import" | "render" | "live";

/**
 * Tell the shell something went wrong, by whichever channel is open.
 *
 * Before the handshake there is no port, so the parent window is the only way
 * out; after it, the port is. Both are needed: the failures worth hearing
 * about most are the early ones.
 */
const report = (message: string, stage: Stage): void => {
  const payload = { kind: "runtime-error", message, stage };
  if (hostPort) {
    hostPort.postMessage(payload);
    return;
  }
  try {
    window.parent.postMessage(payload, "*");
  } catch {
    // Nothing left to try; the shell's boot timeout is the last resort.
  }
};

/**
 * Tell the shell the app has drawn something.
 *
 * Not an error, so it does not travel on the error channel. It is what lets
 * the host stop covering a frame with a card: until this arrives, "mounted"
 * only means the shell accepted the artifact, and the frame may still be
 * fetching, compiling or rendering.
 */
const announcePainted = (): void => {
  const payload = { kind: "runtime-painted" };
  if (hostPort) {
    hostPort.postMessage(payload);
    return;
  }
  try {
    window.parent.postMessage(payload, "*");
  } catch {
    // The shell's timeout is the backstop.
  }
};

/**
 * The frame's console, relayed to the shell (protocol `runtime-log`).
 *
 * The frame is opaque: nothing written here reaches a log a person can
 * read. So `console.log/warn/error` are wrapped to ALSO travel the port —
 * the original still runs for a desktop devtools session. Bounded per
 * line and per minute so an app that logs in a loop cannot flood the host.
 */
const relayConsole = (): void => {
  let budget = 200;
  setInterval(() => {
    budget = 200;
  }, 60_000);
  const forward = (level: "log" | "warn" | "error", args: unknown[]): void => {
    if (!hostPort || budget <= 0) return;
    budget -= 1;
    const message = args
      .map((a) => (typeof a === "string" ? a : a instanceof Error ? a.message : JSON.stringify(a)))
      .join(" ")
      .slice(0, 2000);
    hostPort.postMessage({ kind: "runtime-log", level, message });
  };
  for (const level of ["log", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      forward(level, args);
    };
  }
};

/**
 * Measure the layout and say what is wrong with it, after the first paint
 * and after every viewport change. Silent when clean. This is the ruler the
 * pipeline never had (see `measure.ts`).
 */
const scheduleMeasure = (): void => {
  const run = () => {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const mode = document.documentElement.dataset["spiralViewport"] === "expanded" ? "expanded" : "row";
    const report = measureLayout(root, mode);
    if (report.problems.length > 0) console.warn(formatReport(report));
    else console.log(formatReport(report));
  };
  // Two frames after paint: fonts and container queries have settled. Then
  // once more three seconds later, but ONLY for a post that turned out to
  // move — that second line is where a game's frame rate is recorded, and a
  // still post has nothing to add (step 6.12).
  const soon = () =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setTimeout(run, 150);
        setTimeout(() => {
          const stats = (globalThis as { __spiralFrameStats?: { frames: number } }).__spiralFrameStats;
          if (stats && stats.frames > 0) run();
        }, 3000);
      }),
    );
  soon();
  window.addEventListener("spiral-viewport", soon);
  // The lab asks for another pass after it changes page.
  window.addEventListener("spiral-measure", soon);
};

/**
 * Everything the four start-up stages cannot see.
 *
 * `main()` covers only the path to the first render. An artifact that mounted
 * and then threw — in a click handler, in an effect, in a rejected promise —
 * had no way to say so: the frame is opaque, its console is relayed nowhere
 * (the forwarding script is main-frame only), and `main()` had long returned.
 * It looked exactly like an app sitting there doing nothing, which is the
 * hardest shape of bug to find and cost this project two days of it.
 *
 * Installed at module scope, before `hardenRealm` and before the first await,
 * so it covers the runtime's own start-up too.
 *
 * Deliberately does NOT draw over the app: a live error is often survivable,
 * and replacing a working counter with a red box because one handler threw
 * would be a worse bug than the one being reported.
 */
window.addEventListener("error", (event) => {
  report(`uncaught error: ${String(event.message)}`, "live");
});

window.addEventListener("unhandledrejection", (event) => {
  report(`unhandled rejection: ${String((event as PromiseRejectionEvent).reason)}`, "live");
});

/**
 * Report a fatal error and stop.
 *
 * Draws something for the user AND tells the shell, because the shell cannot
 * see in here: the frame is opaque, so neither a console relay nor a DOM read
 * reaches it. Before this channel existed, an artifact that failed to compile
 * looked exactly like one that rendered nothing.
 */
const showFailure = (message: string, stage: "load" | "compile" | "import" | "render"): void => {
  const root = document.getElementById(ROOT_ID) ?? document.body;
  root.textContent = "";
  const box = document.createElement("div");
  box.setAttribute("role", "alert");
  box.style.cssText =
    "font:14px/1.4 -apple-system,system-ui,sans-serif;padding:12px;color:#b3261e";
  box.textContent = message;
  root.appendChild(box);
  console.error("[spiral-app]", message);

  report(message, stage);
};

const awaitInit = (): Promise<{ init: SpiralInit; port: MessagePort }> =>
  new Promise((resolve) => {
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as Partial<SpiralInit> | undefined;
      if (data?.kind !== "spiral-init") return;
      const port = event.ports[0];
      if (!port) return;
      window.removeEventListener("message", onMessage);
      resolve({ init: data as SpiralInit, port });
    };
    window.addEventListener("message", onMessage);
  });

const main = async (): Promise<void> => {
  // Announce that the module evaluated, before anything else can fail.
  // `postMessage` to the parent is the only channel available this early —
  // the port has not arrived yet, and the frame's console does not reach the
  // native log. Without this, "the module threw on evaluation" and "the
  // handshake never arrived" look identical from outside.
  try {
    window.parent.postMessage({ kind: "runtime-boot" }, "*");
  } catch {
    // Nothing to do; the shell will time out and say so.
  }

  hardenRealm();
  // Before any post code: a canvas drawn with the platform's quirks would be
  // wrong only on the phone, where nothing measures it (§ 5.57).
  correctPlatform();

  const { init, port } = await awaitInit();
  port.start();
  hostPort = port;
  relayConsole();

  // Where the app is shown, as a document attribute so the kit's CSS can
  // read it: `html[data-spiral-viewport="expanded"] #root` may scroll, the
  // row never does. The SDK's `useViewport` reads the same attribute.
  port.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { kind?: unknown; mode?: unknown } | undefined;
    if (data?.kind !== "viewport.changed") return;
    const mode = data.mode === "expanded" ? "expanded" : "row";
    document.documentElement.dataset["spiralViewport"] = mode;
    window.dispatchEvent(new CustomEvent("spiral-viewport", { detail: mode }));
  });

  // Handed to the SDK once it exists; for the spike the probe reads them off
  // the global to exercise the port directly.
  Object.defineProperty(globalThis, "__spiralPort", { value: port, writable: false });
  Object.defineProperty(globalThis, "__spiralInit", { value: init, writable: false });

  // The document is synthesised as `lang="en"`; the viewer's language, now
  // that the host says it (§ 5.60), is what VoiceOver reads a post's words
  // in and what `hyphens: auto` breaks them by.
  if (typeof init.language === "string" && /^[a-z]{2,3}$/.test(init.language)) {
    document.documentElement.lang = init.language;
  }

  // The source travels INSIDE the document, in a JSON script block the host
  // synthesised. It is not fetched: `connect-src 'none'` forbids every
  // request, with no exception carved out for "the app's own code", and
  // keeping that line absolute is worth more than the convenience of a
  // fetch. See the note on `embeddedSource` in SpiralAppSchemeHandler.swift.
  let source: string;
  try {
    const block = document.getElementById("spiral-artifact-source");
    if (!block?.textContent) {
      showFailure("This app shipped without any source.", "load");
      return;
    }
    source = JSON.parse(block.textContent) as string;
  } catch (error) {
    showFailure(`Could not read the app's source: ${String(error)}`, "load");
    return;
  }

  let compiled: string;
  try {
    await initTranspiler();
    compiled = transpile(source, "app.jsx");
  } catch (error) {
    showFailure(`This app could not be compiled: ${String(error)}`, "compile");
    return;
  }

  let module: { default?: unknown };
  try {
    module = await importModule(compiled);
  } catch (error) {
    showFailure(`This app failed to start: ${String(error)}`, "import");
    return;
  }

  const Component = module.default;
  if (typeof Component !== "function") {
    showFailure("This app has no default export to render.", "render");
    return;
  }

  try {
    // Absolute path, not a relative import: the bundler would rewrite a
    // relative specifier to its own emitted filename
    // (`./runtime-v1-react.js`), which is not a path the scheme handler
    // publishes. `/runtime/v1/react.js` is.
    const runtimeUrl = `${location.origin}/runtime/v1/react.js`;
    const { createRoot, jsx, useEffect } = (await import(/* @vite-ignore */ runtimeUrl)) as typeof import(
      "./react-entry"
    );
    const host = document.getElementById(ROOT_ID);
    if (!host) {
      showFailure("Missing render root.", "render");
      return;
    }

    /*
    Says when the app is actually on screen, so the host can stop covering it.

    An effect is the right hook and the only reliable one: `root.render()` is
    concurrent and returns before React has committed anything, and React 18
    removed the render callback for exactly that reason. React's own guidance
    is a ref callback (fires at commit) or an effect — and an effect fires
    AFTER the browser has painted, which is the question being asked.

    A frame or a timer would be a guess about how long a commit takes, and
    would be wrong on the devices that need this most.
    */
    const ReportsWhenPainted = ({ children }: { children: unknown }) => {
      useEffect(() => {
        announcePainted();
        scheduleMeasure();
      }, []);
      return children;
    };

    createRoot(host).render(
      jsx(ReportsWhenPainted as never, { children: jsx(Component as never, {}) }),
    );
  } catch (error) {
    showFailure(`This app crashed while rendering: ${String(error)}`, "render");
  }
};

void main();
