(function polyfill() {
  const relList = document.createElement("link").relList;
  if (relList && relList.supports && relList.supports("modulepreload")) return;
  for (const link of document.querySelectorAll('link[rel="modulepreload"]')) processPreload(link);
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== "childList") continue;
      for (const node of mutation.addedNodes) if (node.tagName === "LINK" && node.rel === "modulepreload") processPreload(node);
    }
  }).observe(document, {
    childList: true,
    subtree: true
  });
  function getFetchOpts(link) {
    const fetchOpts = {};
    if (link.integrity) fetchOpts.integrity = link.integrity;
    if (link.referrerPolicy) fetchOpts.referrerPolicy = link.referrerPolicy;
    if (link.crossOrigin === "use-credentials") fetchOpts.credentials = "include";
    else if (link.crossOrigin === "anonymous") fetchOpts.credentials = "omit";
    else fetchOpts.credentials = "same-origin";
    return fetchOpts;
  }
  function processPreload(link) {
    if (link.ep) return;
    link.ep = true;
    const fetchOpts = getFetchOpts(link);
    fetch(link.href, fetchOpts);
  }
})();
const PROTOCOL_VERSION = 1;
const KNOWN_METHODS = [
  "app.context.read",
  "members.basic.read",
  "state.shared.read",
  "state.shared.write",
  "state.private.read",
  "state.private.write",
  "time.read",
  "ui.haptic",
  "ui.expand",
  "spike.report"
];
const parseRuntimeLog = (value) => {
  if (typeof value !== "object" || value === null) return void 0;
  const candidate = value;
  if (candidate["kind"] !== "runtime-log") return void 0;
  if (typeof candidate["message"] !== "string") return void 0;
  const level = candidate["level"];
  return {
    kind: "runtime-log",
    level: level === "warn" || level === "error" ? level : "log",
    message: candidate["message"].slice(0, 4e3)
  };
};
const RUNTIME_PAINTED = "runtime-painted";
const isRuntimePainted = (value) => typeof value === "object" && value !== null && value["kind"] === RUNTIME_PAINTED;
const parseRuntimeError = (value) => {
  if (typeof value !== "object" || value === null) return void 0;
  const candidate = value;
  if (candidate["kind"] !== "runtime-error") return void 0;
  if (typeof candidate["message"] !== "string") return void 0;
  const stage = candidate["stage"];
  const known = stage === "load" || stage === "compile" || stage === "import" || stage === "render" || stage === "live";
  return {
    kind: "runtime-error",
    message: candidate["message"],
    stage: known ? stage : "unknown"
  };
};
const LIMITS = {
  /** Largest request the shell will forward, in bytes of JSON. */
  maxRequestBytes: 64 * 1024,
  /**
   * Largest private state a post may keep on a phone, in bytes of JSON. A
   * sealed move is tens of bytes and a fleet a few hundred; this is room for
   * a game's worth of them, not a place to store a post's data.
   */
  maxPrivateBytes: 8 * 1024,
  /** Concurrent un-answered requests per app. */
  maxInFlight: 32,
  /** How long the shell waits for the host before replying `unavailable`. */
  requestTimeoutMs: 5e3
};
const parseRequest = (value) => {
  if (typeof value !== "object" || value === null) {
    return { error: "not an object" };
  }
  const candidate = value;
  if (typeof candidate["id"] !== "string" || candidate["id"].length === 0) {
    return { error: "missing id" };
  }
  if (typeof candidate["method"] !== "string") {
    return { error: "missing method" };
  }
  if (!KNOWN_METHODS.includes(candidate["method"])) {
    return { error: `unknown method: ${candidate["method"]}` };
  }
  if (typeof candidate["userActivation"] !== "boolean") {
    return { error: "missing userActivation" };
  }
  return {
    id: candidate["id"],
    method: candidate["method"],
    args: candidate["args"] ?? null,
    userActivation: candidate["userActivation"]
  };
};
const failure = (id, code, message) => ({ id, ok: false, code, message });
const OPERATIONS = ["set", "setIfAbsent", "del", "incr", "listAppend", "listRemove"];
const MAX_BATCH = 64;
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isPath = (value) => {
  if (typeof value === "string") return value.length > 0;
  if (!Array.isArray(value)) return false;
  return value.length > 0 && value.every((part) => typeof part === "string" && part.length > 0);
};
const checkOperation = (value, nested = false) => {
  if (!isObject(value)) return "op must be an object";
  const names = Object.keys(value);
  if (names.length !== 1) return `op must carry exactly one operation, saw ${names.length}`;
  if (names[0] === "batch") {
    if (nested) return "batch cannot nest";
    const body2 = value["batch"];
    if (!isObject(body2) || !Array.isArray(body2["ops"])) return "batch needs ops";
    const ops = body2["ops"];
    if (ops.length === 0) return "batch needs at least one op";
    if (ops.length > MAX_BATCH) return `batch carries ${ops.length} ops, at most ${MAX_BATCH}`;
    for (const op of ops) {
      const problem = checkOperation(op, true);
      if (problem) return `batch: ${problem}`;
    }
    return void 0;
  }
  const name = names[0];
  if (!OPERATIONS.includes(name)) return `unknown operation: ${name}`;
  const body = value[name];
  if (!isObject(body)) return `${name} must carry an object`;
  if (!isPath(body["path"])) return `${name} needs a non-empty path`;
  switch (name) {
    case "set":
    case "setIfAbsent":
      return "value" in body ? void 0 : `${name} needs a value`;
    case "del":
      return void 0;
    case "incr":
      return typeof body["by"] === "number" && Number.isFinite(body["by"]) ? void 0 : "incr needs a finite number to add";
    case "listAppend":
      return "item" in body ? void 0 : "listAppend needs an item";
    case "listRemove":
      return typeof body["id"] === "string" ? void 0 : "listRemove needs an id";
  }
};
const NOTIFY = ["none", "badge", "ping"];
const NOTIFY_KIND = ["turn", "challenge", "record", "result", "mention"];
const checkSummary = (value) => {
  if (value === void 0 || value === null) return void 0;
  if (!isObject(value)) return "summary must be an object";
  if ("line" in value) {
    const line = value["line"];
    const perLanguage = isObject(line) && Object.entries(line).every(([k, v]) => /^[a-z]{2,3}$/.test(k) && typeof v === "string") && Object.keys(line).length > 0;
    if (typeof line !== "string" && !perLanguage) {
      return "summary.line must be a string, or {language: string}";
    }
  }
  if ("countdown_to" in value) {
    const countdown = value["countdown_to"];
    if (typeof countdown !== "string" || Number.isNaN(Date.parse(countdown))) {
      return "summary.countdown_to must be an ISO-8601 date";
    }
  }
  const users = value["notify_users"];
  if (users !== void 0) {
    if (!Array.isArray(users) || users.some((id) => typeof id !== "string" || id.length === 0)) {
      return "summary.notify_users must be a list of user ids";
    }
  }
  const notify = value["notify"];
  if (notify !== void 0) {
    if (typeof notify !== "string" || !NOTIFY.includes(notify)) {
      return `summary.notify must be one of ${NOTIFY.join(", ")}`;
    }
    if (notify === "ping" && (!Array.isArray(users) || users.length === 0)) {
      return "summary.notify ping must name who to ping";
    }
  }
  const kind = value["notify_kind"];
  if (kind !== void 0 && (typeof kind !== "string" || !NOTIFY_KIND.includes(kind))) {
    return `summary.notify_kind must be one of ${NOTIFY_KIND.join(", ")}`;
  }
  return void 0;
};
const checkArguments = (method, args) => {
  switch (method) {
    case "state.shared.write": {
      if (!isObject(args)) return "state.shared.write needs an object";
      return checkOperation(args["op"]) ?? checkSummary(args["summary"]);
    }
    // The phone's own corner of the post (§ 5.78): replaced whole, an object,
    // and small — it holds a sealed move, not the post's data.
    case "state.private.write": {
      if (!isObject(args) || !isObject(args["state"])) return "state.private.write needs { state: {…} }";
      const bytes = new TextEncoder().encode(JSON.stringify(args["state"])).length;
      if (bytes > LIMITS.maxPrivateBytes) {
        return `private state is ${bytes} bytes; a post may keep ${LIMITS.maxPrivateBytes} on a phone`;
      }
      return void 0;
    }
    // Readers take no arguments, but `null` and an empty object both arrive
    // from honest callers, so neither is worth refusing over.
    case "app.context.read":
    case "members.basic.read":
    case "state.shared.read":
    case "state.private.read":
      return void 0;
    // The spike channel carries whatever the probe found. Shaping it here
    // would mean this file had to change every time an attack was added, and
    // production never grants it anyway.
    case "spike.report":
      return void 0;
  }
};
const ABANDONED = "spiral-mount-abandoned";
const PAINT_TIMEOUT_MS = 5e3;
class AppRuntime {
  constructor(options) {
    this.options = options;
    this.painted = new Promise((resolve, reject) => {
      this.reportPainted = resolve;
      this.abandonPainted = reject;
    });
    this.painted.catch(() => {
    });
  }
  options;
  iframe;
  port;
  inFlight = 0;
  destroyed = false;
  sawRuntimeBoot = false;
  timers = /* @__PURE__ */ new Set();
  /**
   * Resolves when the app has drawn, or when waiting stops being reasonable.
   *
   * The host covers a post with a card until this settles, so it must ALWAYS
   * settle: an artifact that never reports is late, not invisible. That is the
   * whole reason the timeout is here rather than in Swift — the promise is the
   * contract, so the promise carries the escape hatch.
   */
  painted;
  reportPainted = () => {
  };
  abandonPainted = () => {
  };
  static start(options) {
    const runtime = new AppRuntime(options);
    runtime.mount();
    return runtime;
  }
  mount() {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.setAttribute("title", "Spiral app");
    iframe.style.cssText = "border:0;width:100%;height:100%;display:block;background:transparent";
    iframe.src = this.options.documentUrl;
    iframe.addEventListener("load", () => this.handshake(iframe), { once: true });
    iframe.addEventListener(
      "error",
      () => this.options.onError?.("the artifact frame failed to load")
    );
    window.addEventListener("message", this.onBootMessage);
    this.options.container.appendChild(iframe);
    this.iframe = iframe;
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
  onBootMessage = (event) => {
    const data = event.data;
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
  handshake(iframe) {
    if (this.destroyed) return;
    console.info("[spiral-shell] frame loaded, sending spiral-init");
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = (event) => void this.onAppMessage(event.data);
    this.port.start();
    const init = {
      kind: "spiral-init",
      protocol: PROTOCOL_VERSION,
      instanceId: this.options.instanceId,
      capabilities: this.options.capabilities,
      runtimeVersion: this.options.runtimeVersion,
      viewerId: this.options.viewerId,
      ...this.options.language ? { language: this.options.language } : {}
    };
    iframe.contentWindow?.postMessage(init, "*", [channel.port2]);
    const paintCheck = setTimeout(() => {
      this.timers.delete(paintCheck);
      this.reportPainted();
    }, PAINT_TIMEOUT_MS);
    this.timers.add(paintCheck);
    const bootCheck = setTimeout(() => {
      this.timers.delete(bootCheck);
      if (!this.sawRuntimeBoot && !this.destroyed) {
        this.options.onError?.("the runtime module never evaluated in the frame");
      }
    }, 3e3);
    this.timers.add(bootCheck);
  }
  async onAppMessage(raw) {
    if (this.destroyed || !this.port) return;
    const runtimeError = parseRuntimeError(raw);
    if (runtimeError) {
      this.options.onError?.(`[${runtimeError.stage}] ${runtimeError.message}`);
      return;
    }
    const line = parseRuntimeLog(raw);
    if (line) {
      (line.level === "error" ? console.error : line.level === "warn" ? console.warn : console.info)(
        "[spiral-app]",
        line.message
      );
      return;
    }
    if (isRuntimePainted(raw)) {
      this.reportPainted();
      return;
    }
    const parsed = parseRequest(raw);
    if ("error" in parsed) {
      this.options.onError?.(`malformed request: ${parsed.error}`);
      return;
    }
    if (!this.options.capabilities.includes(parsed.method)) {
      this.reply(failure(parsed.id, "rejected", `capability not granted: ${parsed.method}`));
      return;
    }
    let encoded;
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
    const badArguments = checkArguments(parsed.method, parsed.args);
    if (badArguments) {
      this.reply(failure(parsed.id, "rejected", badArguments));
      return;
    }
    this.inFlight += 1;
    try {
      const rawReply = await this.withTimeout(
        this.options.transport.call(parsed.method, parsed.args, parsed.userActivation)
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
  decodeHostReply(id, rawReply) {
    try {
      const parsed = JSON.parse(rawReply);
      if (parsed["ok"] === true) {
        return { id, ok: true, data: parsed["data"] ?? null };
      }
      const code = parsed["code"];
      const message = parsed["message"];
      return failure(
        id,
        code === "conflict" || code === "gone" || code === "rejected" ? code : "unavailable",
        typeof message === "string" ? message : "host refused the request"
      );
    } catch {
      return failure(id, "unavailable", "host reply was not valid JSON");
    }
  }
  withTimeout(promise) {
    return new Promise((resolve, reject) => {
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
        (error) => {
          clearTimeout(timer);
          this.timers.delete(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });
  }
  reply(reply) {
    if (this.destroyed) return;
    this.port?.postMessage(reply);
  }
  /** Unsolicited shell -> app message (state changed, teardown warning). */
  push(message) {
    if (this.destroyed) return;
    this.port?.postMessage(message);
  }
  /**
   * Remove the app completely. Dropping the iframe discards its realm, which
   * is what makes the WKWebView safe to reuse for a different, equally
   * untrusted app.
   */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener("message", this.onBootMessage);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.abandonPainted(new Error(ABANDONED));
    if (this.port) {
      this.port.onmessage = null;
      this.port.close();
      this.port = void 0;
    }
    this.iframe?.remove();
    this.iframe = void 0;
  }
  get isDestroyed() {
    return this.destroyed;
  }
}
const HOST_REQUEST_EVENT = "spiral-host-request";
const HOST_REPLY_EVENT = "spiral-host-reply";
const FORGET_WAITER_MS = 3e4;
class IosTransport {
  available = true;
  nextId = 0;
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
  waiting = /* @__PURE__ */ new Map();
  listening = false;
  onReply = (event) => {
    const detail = event.detail;
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
  async call(method, args, userActivation) {
    const id = `host-${this.nextId++}`;
    if (!this.listening) {
      document.addEventListener(HOST_REPLY_EVENT, this.onReply);
      this.listening = true;
    }
    const reply = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error("host never answered"));
      }, FORGET_WAITER_MS);
      this.waiting.set(id, { resolve, reject, timer });
    });
    document.dispatchEvent(
      new CustomEvent(HOST_REQUEST_EVENT, {
        detail: {
          id,
          body: { method, args: JSON.stringify(args ?? null), userActivation }
        }
      })
    );
    return reply;
  }
}
const canReachRelay = () => typeof document !== "undefined" && typeof CustomEvent !== "undefined";
class DetachedTransport {
  available = false;
  async call(method) {
    return JSON.stringify({
      ok: false,
      code: "unavailable",
      message: `no native host attached (method: ${method})`
    });
  }
}
const createTransport = () => canReachRelay() ? new IosTransport() : new DetachedTransport();
const transport = createTransport();
let current;
let currentInstanceId = null;
let generation = 0;
const container = () => {
  const existing = document.getElementById("spiral-app-root");
  if (existing) return existing;
  const created = document.createElement("div");
  created.id = "spiral-app-root";
  created.style.cssText = "position:absolute;inset:0;overflow:hidden";
  document.body.appendChild(created);
  return created;
};
const reportError = (message) => {
  console.error("[spiral-shell]", message);
};
const unmount = () => {
  current?.destroy();
  current = void 0;
  currentInstanceId = null;
};
const shell = {
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
      ...request.language ? { language: request.language } : {},
      transport,
      container: container(),
      onError: reportError
    });
    current = runtime;
    try {
      await runtime.painted;
    } catch (error) {
      if (mine !== generation) throw new Error(ABANDONED);
      throw error;
    }
    if (mine !== generation) throw new Error(ABANDONED);
  },
  unmount,
  push(message) {
    current?.push(message);
  },
  status() {
    return {
      mounted: current !== void 0 && !current.isDestroyed,
      instanceId: currentInstanceId
    };
  },
  protocolVersion: 1
};
globalThis.__spiralShell = shell;
window.dispatchEvent(new CustomEvent("spiral-shell-ready"));
//# sourceMappingURL=shell.js.map
