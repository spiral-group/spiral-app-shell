import { useRef, useState, useEffect, useCallback, useSyncExternalStore } from "/runtime/v1/react.js";
const handshakeLanguage = () => {
  const init = globalThis.__spiralInit;
  if (typeof init?.language === "string" && init.language.length > 0) return init.language.toLowerCase();
  const nav = typeof navigator === "undefined" ? "" : navigator.language ?? "";
  return (nav.split("-")[0] || "en").toLowerCase();
};
const byUserId = (a, b) => a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
const isObject$4 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const asString = (value) => typeof value === "string" && value.length > 0 ? value : void 0;
const parseContext = (value) => {
  if (!isObject$4(value)) throw new Error("app.context.read: not an object");
  const userId = asString(value["userId"]);
  const roomId = asString(value["roomId"]);
  const postId = asString(value["postId"]);
  if (userId === void 0 || roomId === void 0 || postId === void 0) {
    throw new Error("app.context.read: missing userId, roomId or postId");
  }
  return { userId, roomId, postId, language: handshakeLanguage() };
};
const parseMembers = (value) => {
  if (!isObject$4(value)) throw new Error("members.basic.read: not an object");
  const members = value["members"];
  if (!Array.isArray(members)) throw new Error("members.basic.read: members is not a list");
  return members.flatMap((entry) => {
    if (!isObject$4(entry)) return [];
    const userId = asString(entry["userId"]);
    if (userId === void 0) return [];
    const displayName = asString(entry["displayName"]) ?? userId;
    const avatarUrl = asString(entry["avatarUrl"]);
    return [avatarUrl === void 0 ? { userId, displayName } : { userId, displayName, avatarUrl }];
  }).sort(byUserId);
};
class HostFacts {
  constructor(shared2) {
    this.shared = shared2;
  }
  shared;
  context;
  readContext() {
    this.context ??= this.shared.call("app.context.read").then(parseContext);
    return this.context;
  }
  /**
   * Not cached: someone can join or leave while a post is on screen, and a
   * poll showing "3 of 5" against a stale roster is wrong in a way nobody
   * would think to check.
   */
  readMembers() {
    return this.shared.call("members.basic.read").then(parseMembers);
  }
  /** The host's clock, in ms since the epoch. See `Spiral.time`. */
  readTime() {
    return this.shared.call("time.read").then((value) => {
      if (!isObject$4(value) || typeof value["now"] !== "number") {
        throw new Error("time.read: no now");
      }
      return value["now"];
    });
  }
}
const MAX_BATCH = 64;
const OPERATION_NAMES = ["set", "setIfAbsent", "del", "incr", "listAppend", "listRemove", "batch"];
const FLOAT_TAG = "f";
const encodeFloats = (value) => {
  if (typeof value === "number") {
    if (Number.isInteger(value)) return value;
    if (!Number.isFinite(value)) return 0;
    return `${FLOAT_TAG}${value}`;
  }
  if (Array.isArray(value)) return value.map(encodeFloats);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = encodeFloats(inner);
    }
    return out;
  }
  return value;
};
const decodeFloats = (value) => {
  if (typeof value === "string") {
    return value.startsWith(FLOAT_TAG) ? Number(value.slice(FLOAT_TAG.length)) : value;
  }
  if (Array.isArray(value)) return value.map(decodeFloats);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = decodeFloats(inner);
    }
    return out;
  }
  return value;
};
const normaliseOperation = (op) => {
  if (op === null || typeof op !== "object") return op;
  const keys = Object.keys(op).filter((key) => OPERATION_NAMES.includes(key));
  if (keys.length <= 1) return op;
  const ops = keys.map((key) => ({ [key]: op[key] }));
  return { batch: { ops } };
};
const isObject$3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isArray = (value) => Array.isArray(value);
const readOwn = (members, key) => Object.hasOwn(members, key) ? members[key] : void 0;
const putOwn = (members, key, value) => {
  Object.defineProperty(members, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
};
const OWNED_NAMESPACE = "by";
const mine = (userId, ...key) => [
  OWNED_NAMESPACE,
  userId,
  ...key
];
const samePath = (a, b) => {
  const left = pathComponents(a);
  const right = pathComponents(b);
  return left.length === right.length && left.every((component, i) => component === right[i]);
};
const coalesceGrouped = (items, opOf) => {
  const out = [];
  for (const item of items) {
    const op = opOf(item);
    const last = out[out.length - 1];
    if (last !== void 0 && "incr" in last.op && "incr" in op && samePath(last.op.incr.path, op.incr.path)) {
      last.op = { incr: { path: last.op.incr.path, by: last.op.incr.by + op.incr.by } };
      last.items.push(item);
      continue;
    }
    if (last !== void 0 && "set" in last.op && "set" in op && samePath(last.op.set.path, op.set.path)) {
      last.op = op;
      last.items.push(item);
      continue;
    }
    out.push({ op, items: [item] });
  }
  return out;
};
const pathComponents = (path) => {
  if (typeof path !== "string") {
    return path.length > 0 && path.every((component) => component.length > 0) ? path : [];
  }
  return path.split(".").filter((component) => component.length > 0);
};
const valueAt = (value, path) => {
  const head = path[0];
  if (head === void 0) return value;
  if (!isObject$3(value)) return void 0;
  const child = readOwn(value, head);
  if (child === void 0) return void 0;
  return valueAt(child, path.slice(1));
};
const settingAt = (value, path, newValue) => {
  const head = path[0];
  if (head === void 0) return newValue;
  const members = isObject$3(value) ? { ...value } : {};
  const existing = readOwn(members, head);
  putOwn(
    members,
    head,
    settingAt(existing === void 0 ? {} : existing, path.slice(1), newValue)
  );
  return members;
};
const removingAt = (value, path) => {
  const head = path[0];
  if (head === void 0) return value;
  if (!isObject$3(value)) return value;
  const members = { ...value };
  if (path.length === 1) {
    delete members[head];
  } else {
    const child = readOwn(members, head);
    if (child !== void 0) putOwn(members, head, removingAt(child, path.slice(1)));
  }
  return members;
};
const asState = (value) => value;
const applyOperation = (state, op) => {
  if ("set" in op) {
    const path2 = pathComponents(op.set.path);
    if (path2.length === 0) return state;
    return asState(settingAt(state, path2, op.set.value));
  }
  if ("setIfAbsent" in op) {
    const path2 = pathComponents(op.setIfAbsent.path);
    if (path2.length === 0) return state;
    const existing2 = valueAt(state, path2);
    if (existing2 !== void 0 && existing2 !== null) return state;
    return asState(settingAt(state, path2, op.setIfAbsent.value));
  }
  if ("batch" in op) {
    return op.batch.ops.reduce(applyOperation, state);
  }
  if ("del" in op) {
    const path2 = pathComponents(op.del.path);
    if (path2.length === 0) return state;
    return asState(removingAt(state, path2));
  }
  if ("incr" in op) {
    const path2 = pathComponents(op.incr.path);
    if (path2.length === 0) return state;
    const existing2 = valueAt(state, path2);
    const current = typeof existing2 === "number" ? existing2 : 0;
    return asState(settingAt(state, path2, current + op.incr.by));
  }
  if ("listAppend" in op) {
    const path2 = pathComponents(op.listAppend.path);
    if (path2.length === 0) return state;
    const existing2 = valueAt(state, path2);
    const items = isArray(existing2) ? [...existing2] : [];
    items.push(op.listAppend.item);
    return asState(settingAt(state, path2, items));
  }
  if (!("listRemove" in op)) return state;
  const path = pathComponents(op.listRemove.path);
  if (path.length === 0) return state;
  const existing = valueAt(state, path);
  if (!isArray(existing)) return state;
  const id = op.listRemove.id;
  const remaining = existing.filter((item) => {
    if (!isObject$3(item)) return true;
    const itemId = readOwn(item, "id");
    if (typeof itemId !== "string") return true;
    return itemId !== id;
  });
  return asState(settingAt(state, path, remaining));
};
const COALESCE_MS = 300;
const parseSnapshot = (data, source) => {
  if (typeof data !== "object" || data === null) {
    throw new Error(`${source}: no state`);
  }
  const candidate = data;
  const state = candidate["state"];
  const seq = candidate["seq"];
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    throw new Error(`${source}: state is not an object`);
  }
  if (typeof seq !== "number") {
    throw new Error(`${source}: no seq`);
  }
  return { state: decodeFloats(state), seq };
};
const inUserGesture = () => {
  const activation = globalThis.navigator?.userActivation;
  return activation?.isActive === true;
};
class SharedState {
  constructor(port, capabilities, options = {}) {
    this.port = port;
    this.capabilities = capabilities;
    this.coalesceMs = options.coalesceMs ?? COALESCE_MS;
    this.port.addEventListener("message", this.onMessage);
  }
  port;
  capabilities;
  /** The last state the host vouched for. */
  base = {};
  /**
   * `seq` of `base`. Starts below any the host can send, so the first read
   * always wins. Used ONLY to drop a stale read reply: § 5.2 defines `seq` as
   * the *sender's* view of the sequence, so two clients can legitimately
   * claim the same one and it cannot order two authoritative folds.
   */
  baseSeq = -1;
  /** `base` with `pending` replayed — what subscribers see. */
  view = {};
  pending = [];
  /** Set by the first state the host vouches for — a read or a push. */
  loaded = false;
  listeners = /* @__PURE__ */ new Set();
  /** Who wants to hear the roster change (`useRoomMembers`). */
  memberListeners = /* @__PURE__ */ new Set();
  inFlight = /* @__PURE__ */ new Map();
  nextId = 0;
  primed = false;
  outbox = [];
  quietUntil = 0;
  flushTimer;
  coalesceMs;
  /** Current guess. Stable between changes, as `useSyncExternalStore` requires. */
  snapshot() {
    return this.view;
  }
  /** Fresh read, then the guess built on it. */
  async get() {
    await this.read();
    return this.view;
  }
  /**
   * Apply locally, then send. The local half is the whole point: the host's
   * round trip is a Matrix event away, and a button that waits for it feels
   * broken.
   */
  apply(rawOp, summary2) {
    const op = normaliseOperation(rawOp);
    const entry = { op };
    this.pending.push(entry);
    try {
      this.refold();
    } catch (error) {
      this.pending.pop();
      this.refold();
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return new Promise((resolve, reject) => {
      this.outbox.push({ entry, summary: summary2, resolve, reject });
      this.scheduleFlush();
    });
  }
  /** Send now if the line is quiet, otherwise when the window closes. */
  scheduleFlush() {
    if (this.flushTimer !== void 0) return;
    const wait = Math.max(0, this.quietUntil - Date.now());
    if (wait === 0) {
      this.flush();
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = void 0;
      this.flush();
    }, wait);
  }
  /**
   * Send everything waiting as one action — or as few as the batch bound
   * allows. Each chunk carries the last summary among its members: what the
   * post says after a burst is what it says after the last tap.
   */
  flush() {
    const waiting = this.outbox;
    this.outbox = [];
    if (waiting.length === 0) return;
    this.quietUntil = Date.now() + this.coalesceMs;
    const grouped = coalesceGrouped(waiting, (item) => item.entry.op);
    const groups = grouped.flatMap((group) => {
      const op = group.op;
      if (!(typeof op === "object" && op !== null && "batch" in op)) return [group];
      const inner = op.batch.ops;
      return inner.map((sub, index) => ({
        op: sub,
        items: index === inner.length - 1 ? group.items : []
      }));
    });
    for (let start = 0; start < groups.length; start += MAX_BATCH) {
      const chunk = groups.slice(start, start + MAX_BATCH);
      const ops = chunk.map((group) => group.op);
      const op = ops.length === 1 ? ops[0] : { batch: { ops } };
      const members = chunk.flatMap((group) => group.items);
      const summary2 = [...members].reverse().find((item) => item.summary !== void 0)?.summary;
      const wire = encodeFloats(op);
      this.request("state.shared.write", summary2 ? { op: wire, summary: summary2 } : { op: wire }).then(
        () => {
          for (const item of members) item.resolve();
        },
        (error) => {
          for (const item of members) {
            const index = this.pending.indexOf(item.entry);
            if (index !== -1) this.pending.splice(index, 1);
          }
          this.refold();
          const failure = error instanceof Error ? error : new Error(String(error));
          for (const item of members) item.reject(failure);
        }
      );
    }
  }
  subscribe(listener) {
    this.listeners.add(listener);
    this.prime();
    return () => {
      this.listeners.delete(listener);
    };
  }
  prime() {
    if (this.primed) return;
    this.primed = true;
    void this.read().catch((error) => {
      this.report(`could not read the post's state: ${String(error)}`);
    });
  }
  async read() {
    const snapshot2 = parseSnapshot(
      await this.request("state.shared.read", null),
      "state.shared.read"
    );
    if (snapshot2.seq < this.baseSeq) return;
    this.adopt(snapshot2);
  }
  /**
   * Take the host's word for the state, and drop the guesses it may already
   * hold.
   *
   * The tempting refinement is to keep replaying operations the host has not
   * acknowledged yet, on the grounds that it cannot have folded in what it
   * has not answered for. That reasoning holds only if the host always writes
   * the event before it replies, which is a property of a native handler that
   * is not written yet — and if it is ever false, the replay double-counts an
   * `incr` that the pushed state already contains. A number that disagrees
   * with the room is a worse failure than a value that flickers back for one
   * round trip, so for what was SENT the authoritative state wins outright.
   *
   * What was never sent is another matter: it is still in the outbox, waiting
   * for the coalescing window, and the host cannot have folded what it has
   * not been given. Dropping it too made a tap vanish for up to 300 ms
   * whenever an earlier action came back — a seat claimed, then the move
   * that followed it gone from the board, long enough to let a second move
   * through; a sum being typed, fed back three digits short (§ 5.80). So the
   * unsent guesses are replayed over the new state.
   */
  adopt(snapshot2) {
    this.base = snapshot2.state;
    this.baseSeq = snapshot2.seq;
    const unsent = new Set(this.outbox.map((item) => item.entry));
    this.pending = this.pending.filter((entry) => unsent.has(entry));
    this.loaded = true;
    this.refold();
  }
  /**
   * Whether the host has vouched for a state yet. Until it has, the app is
   * looking at `{}` — not a post nobody has touched, but one whose state is
   * still on its way (`useChanged`).
   */
  isLoaded() {
    return this.loaded;
  }
  refold() {
    this.view = this.pending.reduce(
      (state, entry) => applyOperation(state, entry.op),
      this.base
    );
    for (const listener of this.listeners) listener(this.view);
  }
  /**
   * One call to the host, for a method that is not about state.
   *
   * Exposed so `context` and `members` do not each need their own port, id
   * sequence and in-flight map — there is one channel out of this frame and
   * everything must share it.
   */
  call(method, args = null) {
    return this.request(method, args);
  }
  request(method, args) {
    if (!this.capabilities.includes(method)) {
      return Promise.reject(new Error(`${method} was not granted to this app`));
    }
    const id = `sdk-${this.nextId++}`;
    const reply = new Promise((resolve, reject) => {
      this.inFlight.set(id, { resolve, reject });
    });
    const request = {
      id,
      method,
      args,
      userActivation: inUserGesture()
    };
    this.port.postMessage(request);
    return reply;
  }
  onMessage = (event) => {
    const data = event.data;
    if (typeof data !== "object" || data === null) return;
    const message = data;
    if (typeof message["kind"] === "string") {
      this.onPush(message);
      return;
    }
    if (typeof message["id"] === "string") {
      this.onReply(message["id"], message);
    }
  };
  /** Be told when the host says the room's people changed. */
  onMembersChanged(listener) {
    this.memberListeners.add(listener);
    return () => {
      this.memberListeners.delete(listener);
    };
  }
  onPush(message) {
    if (message["kind"] === "members.changed") {
      for (const listener of this.memberListeners) listener(message["data"]);
      return;
    }
    if (message["kind"] === "state.changed") {
      try {
        this.adopt(parseSnapshot(message, "state.changed"));
      } catch (error) {
        this.report(String(error));
      }
      return;
    }
    if (message["kind"] === "teardown") {
      const reason = message["reason"];
      const error = new Error(
        `the app was torn down: ${typeof reason === "string" ? reason : "no reason given"}`
      );
      for (const request of this.inFlight.values()) request.reject(error);
      this.inFlight.clear();
      if (this.flushTimer !== void 0) clearTimeout(this.flushTimer);
      this.flushTimer = void 0;
      const waiting = this.outbox;
      this.outbox = [];
      for (const item of waiting) {
        const index = this.pending.indexOf(item.entry);
        if (index !== -1) this.pending.splice(index, 1);
      }
      if (waiting.length > 0) this.refold();
      for (const item of waiting) item.reject(error);
    }
  }
  onReply(id, message) {
    const request = this.inFlight.get(id);
    if (request === void 0) return;
    this.inFlight.delete(id);
    if (message["ok"] === true) {
      request.resolve(message["data"] ?? null);
      return;
    }
    const code = message["code"];
    const detail = message["message"];
    request.reject(
      new Error(
        `${typeof code === "string" ? code : "unavailable"}: ${typeof detail === "string" ? detail : "the host refused the request"}`
      )
    );
  }
  /**
   * Say something the native log can actually see.
   *
   * The frame is opaque to the shell — no console relay reaches in, no DOM
   * read gets out — so `SpiralRuntimeError` is the only channel (protocol.ts).
   * A counter stuck at zero because its first read failed is exactly the
   * blank frame that channel exists to explain.
   */
  report(message) {
    console.error("[spiral-sdk]", message);
    const error = {
      kind: "runtime-error",
      message: `[spiral-sdk] ${message}`,
      stage: "unknown"
    };
    this.port.postMessage(error);
  }
}
const createSharedState = (port, capabilities, options = {}) => new SharedState(port, capabilities, options);
const isObject$2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
class PrivateStore {
  constructor(call) {
    this.call = call;
  }
  call;
  value;
  loading;
  writing = Promise.resolve();
  listeners = /* @__PURE__ */ new Set();
  /** What this phone keeps for the post; undefined until the host has answered. */
  snapshot() {
    return this.value;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    this.load().catch(() => void 0);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.value = void 0;
        this.loading = void 0;
      }
    };
  }
  load() {
    if (this.value !== void 0) return Promise.resolve(this.value);
    this.loading ??= this.call("state.private.read", null).then(
      (data) => {
        this.value ??= isObject$2(data) && isObject$2(data["state"]) ? data["state"] : {};
        this.notify();
        return this.value;
      },
      (error) => {
        this.loading = void 0;
        throw error;
      }
    );
    return this.loading;
  }
  /** Change what this phone keeps; resolves when the host has it. */
  async update(change) {
    const loaded = await this.load();
    const next = change(this.value ?? loaded);
    this.value = next;
    this.notify();
    const write = this.writing.then(() => this.call("state.private.write", { state: next }));
    this.writing = write.catch(() => void 0);
    await write;
  }
  notify() {
    for (const listener of this.listeners) listener();
  }
}
const stats = () => {
  const host = globalThis;
  return host["__spiralFrameStats"] ??= { fps: 0, worstMs: 0, frames: 0 };
};
let touched = false;
const touchListeners = /* @__PURE__ */ new Set();
const markTouched = () => {
  if (touched) return;
  touched = true;
  for (const listener of touchListeners) listener();
  touchListeners.clear();
};
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", markTouched, { capture: true, passive: true });
  document.addEventListener("keydown", markTouched, { capture: true, passive: true });
}
const useFrame = (callback, options = {}) => {
  const latest = useRef(callback);
  latest.current = callback;
  const { eager = false, running = true } = options;
  const [ready, setReady] = useState(() => eager || touched);
  useEffect(() => {
    if (ready) return;
    const wake = () => setReady(true);
    touchListeners.add(wake);
    return () => {
      touchListeners.delete(wake);
    };
  }, [ready]);
  useEffect(() => {
    if (ready && running) return;
    let handle = 0;
    const still = () => {
      if (handle !== 0) return;
      handle = requestAnimationFrame(() => {
        handle = 0;
        latest.current({ dt: 0, elapsed: 0, fps: 0 });
      });
    };
    const onVisibility = () => {
      if (!document.hidden) still();
    };
    still();
    window.addEventListener("resize", still);
    window.addEventListener("spiral-viewport", still);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (handle !== 0) cancelAnimationFrame(handle);
      window.removeEventListener("resize", still);
      window.removeEventListener("spiral-viewport", still);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ready, running]);
  useEffect(() => {
    if (!ready || !running) return;
    let handle = 0;
    let previous = performance.now();
    const started = previous;
    let frames = 0;
    let lastSecond = previous;
    let fps = 0;
    const tick = (now) => {
      handle = requestAnimationFrame(tick);
      const dt = Math.min(now - previous, 100);
      previous = now;
      frames += 1;
      const seen = stats();
      seen.frames += 1;
      if (dt > seen.worstMs) seen.worstMs = dt;
      if (now - lastSecond >= 1e3) {
        fps = Math.round(frames * 1e3 / (now - lastSecond));
        stats().fps = fps;
        frames = 0;
        lastSecond = now;
      }
      latest.current({ dt, elapsed: now - started, fps });
    };
    const start = () => {
      if (handle !== 0) return;
      previous = performance.now();
      lastSecond = previous;
      handle = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (handle === 0) return;
      cancelAnimationFrame(handle);
      handle = 0;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ready, running]);
};
const TONES = {
  tap: { type: "triangle", notes: [660], step: 0.045, gain: 0.16 },
  pick: { type: "triangle", notes: [520, 780], step: 0.055, gain: 0.18 },
  win: { type: "triangle", notes: [523, 659, 784, 1046], step: 0.085, gain: 0.2 },
  lose: { type: "sawtooth", notes: [300, 220, 160], step: 0.1, gain: 0.14 },
  pop: { type: "sine", notes: [880, 440], step: 0.04, gain: 0.18 },
  tick: { type: "square", notes: [1200], step: 0.02, gain: 0.08 }
};
let audio;
let wantsSound = false;
const context = () => {
  if (typeof window === "undefined") return void 0;
  const Ctor = window.AudioContext ?? window.webkitAudioContext;
  if (!Ctor) return void 0;
  audio ??= new Ctor();
  if (audio.state === "suspended") void audio.resume();
  return audio;
};
const unlock = () => {
  if (!wantsSound || audio && audio.state !== "suspended") return;
  context();
};
if (typeof document !== "undefined") {
  for (const type of ["pointerup", "touchend", "click", "keydown"]) {
    document.addEventListener(type, unlock, { capture: true, passive: true });
  }
}
const useSound = () => {
  wantsSound = true;
  return useCallback((name, volume = 1) => {
    if (!touched) return;
    const ctx = context();
    if (!ctx) return;
    const tone = TONES[name] ?? TONES.tap;
    const start = ctx.currentTime;
    tone.notes.forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tone.type;
      osc.frequency.value = frequency;
      const at = start + index * tone.step;
      const level = Math.max(0, Math.min(1, volume)) * tone.gain;
      gain.gain.setValueAtTime(1e-4, at);
      gain.gain.exponentialRampToValueAtTime(level, at + 8e-3);
      gain.gain.exponentialRampToValueAtTime(1e-4, at + tone.step * 0.98);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + tone.step);
    });
  }, []);
};
const useHaptic$1 = (shared2) => useCallback(
  (strength = "light") => {
    void shared2().call("ui.haptic", { strength }).catch(() => {
    });
  },
  [shared2]
);
const requestExpandWith = (shared2) => () => shared2().call("ui.expand", null).then(() => void 0);
const KINDS = ["result", "record", "challenge", "turn", "mention"];
const addressees = (value) => (typeof value === "string" ? [value] : value ?? []).filter(
  (id) => typeof id === "string" && id.length > 0
);
const summary = (input) => {
  const line = trimLine(input.line);
  const kind = KINDS.find((k) => addressees(input[k]).length > 0);
  const named = [...KINDS.flatMap((k) => addressees(input[k])), ...addressees(input.notify)];
  const users = [...new Set(named)];
  const notify = users.length > 0 ? "ping" : line !== void 0 ? "badge" : "none";
  return {
    ...line ? { line } : {},
    ...input.countdownTo ? { countdown_to: input.countdownTo.toISOString() } : {},
    notify,
    ...users.length > 0 ? { notify_users: users } : {},
    ...users.length > 0 && kind ? { notify_kind: kind } : {}
  };
};
const trimLine = (line) => {
  if (line === void 0) return void 0;
  if (typeof line === "string") return line.trim() || void 0;
  const kept2 = Object.entries(line).map(([language, text]) => [language, text.trim()]).filter(([, text]) => text.length > 0);
  return kept2.length > 0 ? Object.fromEntries(kept2) : void 0;
};
const isObject$1 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const nameOf = (members, id) => members?.find((m) => m.userId === id)?.displayName ?? id.replace(/^@/, "").split(":")[0] ?? id;
const useSeats = (seats) => {
  const [state] = useSharedState();
  const members = useRoomMembers();
  const me = Spiral.viewer;
  const taken = isObject$1(state["seats"]) ? state["seats"] : {};
  const invited = isObject$1(state["invited"]) ? state["invited"] : {};
  const who = {};
  for (const seat of seats) {
    const id = taken[seat];
    if (typeof id === "string" && id.length > 0) who[seat] = id;
  }
  const mine2 = seats.find((seat) => who[seat] === me);
  const ping = (seat) => {
    const person = who[seat];
    if (person !== void 0) return person === me ? {} : { turn: person };
    const asked = invited[seat];
    if (typeof asked === "string" && asked.length > 0 && asked !== me) return { challenge: asked };
    const people = members ?? [];
    if (people.length === 2 && people.some((m) => m.userId === me)) {
      const other = people.find((m) => m.userId !== me)?.userId;
      if (other !== void 0 && !Object.values(who).includes(other)) return { challenge: other };
    }
    return {};
  };
  return {
    who,
    mine: mine2,
    full: seats.every((seat) => who[seat] !== void 0),
    name: (seat) => who[seat] === void 0 ? void 0 : nameOf(members, who[seat]),
    sit: (seat, said) => Spiral.apply({ setIfAbsent: { path: ["seats", seat], value: me } }, said),
    leave: (said) => mine2 === void 0 ? Promise.resolve() : Spiral.apply({ batch: { ops: seats.filter((s) => who[s] === me).map((s) => ({ del: { path: ["seats", s] } })) } }, said),
    invite: (seat, userId, line) => Spiral.apply({ set: { path: ["invited", seat], value: userId } }, summary({ ...line !== void 0 ? { line } : {}, challenge: userId })),
    ping
  };
};
const WORDS = {
  uk: {
    record: (w, s) => `${w} — новий рекорд: ${s}`,
    personal: (w, s) => `${w}: ${s} — особистий рекорд`,
    played: (w, s) => `${w}: ${s}`
  },
  ru: {
    record: (w, s) => `${w} — новый рекорд: ${s}`,
    personal: (w, s) => `${w}: ${s} — личный рекорд`,
    played: (w, s) => `${w}: ${s}`
  },
  en: {
    record: (w, s) => `${w} — new record: ${s}`,
    personal: (w, s) => `${w}: ${s} — personal best`,
    played: (w, s) => `${w}: ${s}`
  }
};
const useLeaderboard = (options = {}) => {
  const [state] = useSharedState();
  const members = useRoomMembers();
  const me = Spiral.viewer;
  const higher = (options.better ?? "higher") === "higher";
  const format = options.format ?? ((n) => String(n));
  const beats = (a, b) => higher ? a > b : a < b;
  const by = isObject$1(state[OWNED_NAMESPACE]) ? state[OWNED_NAMESPACE] : {};
  const entries = [];
  for (const [userId, own] of Object.entries(by)) {
    if (!isObject$1(own) || typeof own["best"] !== "number") continue;
    const member = members?.find((m) => m.userId === userId);
    entries.push({
      userId,
      name: nameOf(members, userId),
      ...member?.avatarUrl !== void 0 ? { avatarUrl: member.avatarUrl } : {},
      best: own["best"],
      plays: typeof own["plays"] === "number" ? own["plays"] : 1
    });
  }
  entries.sort((a, b) => a.best === b.best ? a.name.localeCompare(b.name) : beats(a.best, b.best) ? -1 : 1);
  const leader = entries[0];
  const mine2 = entries.find((e) => e.userId === me);
  const submit = (score, line) => {
    const best = mine2 === void 0 || beats(score, mine2.best);
    const dethroned = best && leader !== void 0 && leader.userId !== me && beats(score, leader.best) ? leader.userId : void 0;
    const who = nameOf(members, me);
    const said = line ?? Object.fromEntries(
      Object.entries(WORDS).map(([language, w]) => {
        const shown = format(score, language);
        return [language, dethroned !== void 0 ? w.record(who, shown) : best ? w.personal(who, shown) : w.played(who, shown)];
      })
    );
    return Spiral.apply(
      {
        batch: {
          ops: [
            { incr: { path: Spiral.mine("plays"), by: 1 } },
            ...best ? [{ set: { path: Spiral.mine("best"), value: score } }] : []
          ]
        }
      },
      summary({ line: said, record: dethroned })
    );
  };
  return { entries, leader, mine: mine2, submit };
};
const K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
const rotr = (x, n) => x >>> n | x << 32 - n;
const sha256 = (text) => {
  const bytes = new TextEncoder().encode(text);
  const blocks = Math.ceil((bytes.length + 9) / 64);
  const padded = new Uint8Array(blocks * 64);
  padded.set(bytes);
  padded[bytes.length] = 128;
  const view = new DataView(padded.buffer);
  const bits = bytes.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 4294967296));
  view.setUint32(padded.length - 4, bits >>> 0);
  const h = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225]);
  const w = new Uint32Array(64);
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const a2 = w[i - 15], b2 = w[i - 2];
      const s0 = rotr(a2, 7) ^ rotr(a2, 18) ^ a2 >>> 3;
      const s1 = rotr(b2, 17) ^ rotr(b2, 19) ^ b2 >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
    for (let i = 0; i < 64; i += 1) {
      const t1 = k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + (e & f ^ ~e & g) + K[i] + w[i] >>> 0;
      const t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + (a & b ^ a & c ^ b & c) >>> 0;
      k = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    h[0] = h[0] + a >>> 0;
    h[1] = h[1] + b >>> 0;
    h[2] = h[2] + c >>> 0;
    h[3] = h[3] + d >>> 0;
    h[4] = h[4] + e >>> 0;
    h[5] = h[5] + f >>> 0;
    h[6] = h[6] + g >>> 0;
    h[7] = h[7] + k >>> 0;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
};
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};
const salt = () => {
  const bytes = new Uint8Array(16);
  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};
const checked = /* @__PURE__ */ new Map();
const matches = (seal, value, s) => {
  const text = `${canonical(value)}|${s}`;
  const key = `${seal}|${text}`;
  let ok = checked.get(key);
  if (ok === void 0) {
    ok = sha256(text) === seal;
    if (checked.size > 500) checked.clear();
    checked.set(key, ok);
  }
  return ok;
};
const subscribe = (listener) => privateStore().subscribe(listener);
const snapshot = () => privateStore().snapshot();
const useSealed = (key, options = {}) => {
  const [state] = useSharedState();
  const secrets = useSyncExternalStore(subscribe, snapshot);
  const me = Spiral.viewer;
  const by = isObject(state[OWNED_NAMESPACE]) ? state[OWNED_NAMESPACE] : {};
  const sealed = [];
  const opened = {};
  const broken = [];
  const seals = {};
  for (const [user, own] of Object.entries(by)) {
    if (!isObject(own)) continue;
    const seal2 = isObject(own["sealed"]) ? own["sealed"][key] : void 0;
    if (typeof seal2 !== "string") continue;
    sealed.push(user);
    seals[user] = seal2;
    const opening2 = isObject(own["opened"]) ? own["opened"][key] : void 0;
    if (!isObject(opening2) || typeof opening2["s"] !== "string" || opening2["v"] === void 0) continue;
    if (matches(seal2, opening2["v"], opening2["s"])) opened[user] = opening2["v"];
    else broken.push(user);
  }
  const secret = isObject(secrets?.["sealed"]) ? secrets["sealed"][key] : void 0;
  const kept2 = isObject(secret) && typeof secret["s"] === "string" && secret["v"] !== void 0 ? secret : void 0;
  const mySeal = seals[me];
  const mine2 = kept2 !== void 0 && (mySeal === void 0 || matches(mySeal, kept2["v"], kept2["s"])) ? kept2["v"] : void 0;
  const openOp = (value, s) => ({ set: { path: Spiral.mine("opened", key), value: { v: value, s } } });
  const seal = async (value, said) => {
    if (mySeal !== void 0) throw new Error(`«${key}» is already sealed — a seal is final`);
    const s = salt();
    await privateStore().update((current) => ({
      ...current,
      sealed: { ...isObject(current["sealed"]) ? current["sealed"] : {}, [key]: { v: value, s } }
    }));
    const hash = sha256(`${canonical(value)}|${s}`);
    const others = sealed.filter((user) => user !== me);
    const openNow = options.openWhen?.([...others, me]) === true;
    const sealOp = { set: { path: Spiral.mine("sealed", key), value: hash } };
    await Spiral.apply(openNow ? { batch: { ops: [sealOp, openOp(value, s)] } } : sealOp, said);
  };
  const open = async (said) => {
    if (mySeal === void 0 || kept2 === void 0 || mine2 === void 0) {
      throw new Error(`«${key}» was not sealed on this phone`);
    }
    await Spiral.apply(openOp(kept2["v"], kept2["s"]), said);
  };
  const opening = useRef(void 0);
  const ready = options.openWhen !== void 0 && mine2 !== void 0 && mySeal !== void 0 && opened[me] === void 0 && !broken.includes(me) && options.openWhen(sealed);
  useEffect(() => {
    if (!ready || opening.current === key) return;
    opening.current = key;
    open(options.said?.()).catch(() => {
      opening.current = void 0;
    });
  });
  return { mine: mine2, sealed, opened, broken, seal, open };
};
let bound;
let facts;
let viewer;
const shared = () => {
  if (bound !== void 0) return bound;
  const handshake = globalThis;
  const port = handshake.__spiralPort;
  const init = handshake.__spiralInit;
  if (port === void 0 || init === void 0) {
    throw new Error("@spiral/sdk was loaded outside a Spiral app frame");
  }
  bound = createSharedState(port, init.capabilities);
  viewer = init.viewerId;
  return bound;
};
const viewerId = () => {
  shared();
  return viewer ?? "";
};
const hostFacts = () => facts ??= new HostFacts(shared());
let kept;
const privateStore = () => kept ??= new PrivateStore((method, args) => shared().call(method, args ?? null));
const Spiral = {
  state: {
    /** The post's current shared state, read through the host. */
    get: () => shared().get(),
    /**
     * Send one operation.
     *
     * Resolves when the host has accepted it, NOT when everyone else has seen
     * it — the Matrix event still has to land. Rejects when the host refuses,
     * having first put the optimistic change back; an app that ignores the
     * rejection will show a number the room does not agree with.
     */
    apply: (op, said) => shared().apply(op, said),
    /** Fires on every change, optimistic or authoritative. */
    subscribe: (listener) => shared().subscribe(listener)
  },
  /**
   * `Spiral.state.apply`, one level up.
   *
   * The name a model reaches for first: 1 of 20 generated posts called
   * `Spiral.apply(...)` and its tap did nothing (harness, 2026-09-17).
   * Cheaper to answer to the obvious name than to teach every model not
   * to use it.
   */
  apply: (op, said) => shared().apply(op, said),
  /** Who is looking at this post, and where. Fixed for a mounted app. */
  context: () => hostFacts().readContext(),
  /**
   * Whether the phone asked for less motion.
   *
   * DECORATION should honour it — a looping float, a shimmer, a card that
   * keeps breathing. Gameplay should not: someone who turned it on still
   * wants their snake to move.
   */
  get reducedMotion() {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  },
  /** Ask the host for the whole screen — a row-sized board becomes a game. */
  expand: () => requestExpandWith(shared)(),
  /**
   * The clock, as the host sees it.
   *
   * Never `Date.now()` in a post. Two phones disagree about the time, and
   * a countdown or a deadline that reads its own clock shows them two
   * different answers. The host's clock is at least never earlier than the
   * room's newest event, so a phone running behind cannot reopen something
   * that has closed. `now()` asks once; `useNow` keeps a local clock in step
   * with it.
   */
  time: {
    now: () => hostFacts().readTime()
  },
  /** The viewer's user ID. Synchronous: it came with the handshake. */
  get viewer() {
    return viewerId();
  },
  /**
   * The language the viewer's app is shown in — "uk", "ru", "en". Also
   * synchronous, from the handshake: a template's own words can follow it
   * from the first frame (§ 5.60).
   */
  get language() {
    return handshakeLanguage();
  },
  /**
   * The path to `key` in the viewer's OWN namespace, `by.<viewer>.<key>`.
   *
   * Only the viewer can write there, and the host folds it only from the
   * viewer's own actions — so a vote, a confirmation, a score kept here is
   * genuinely theirs. Read anyone's with `state.by?.[userId]`.
   */
  mine: (...key) => mine(viewerId(), ...key),
  /**
   * Display names and avatars of the room's members.
   *
   * Not cached, because someone can join or leave while a post is on screen
   * and "3 of 5" against a stale roster is wrong in a way nobody would think
   * to check.
   */
  members: () => hostFacts().readMembers()
};
const subscribeToState = (onChange) => shared().subscribe(onChange);
const readState = () => shared().snapshot();
const useSharedState = () => [useSyncExternalStore(subscribeToState, readState), Spiral.state.apply];
const readLoaded = () => shared().isLoaded();
const useChanged = (value, onChange) => {
  const loaded = useSyncExternalStore(subscribeToState, readLoaded);
  const before = useRef(void 0);
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    if (!loaded) return;
    const previous = before.current;
    before.current = { value };
    if (previous !== void 0 && !Object.is(previous.value, value)) latest.current(value, previous.value);
  }, [loaded, value]);
};
const useOwnState = () => {
  const [state, apply] = useSharedState();
  const by = state[OWNED_NAMESPACE_KEY];
  const own = typeof by === "object" && by !== null && !Array.isArray(by) ? by[Spiral.viewer] : void 0;
  const ownObject = typeof own === "object" && own !== null && !Array.isArray(own) ? own : {};
  return [ownObject, (key, value, said) => apply({ set: { path: Spiral.mine(key), value } }, said)];
};
const OWNED_NAMESPACE_KEY = "by";
const readViewport = () => ({
  mode: document.documentElement.dataset["spiralViewport"] === "expanded" ? "expanded" : "row",
  width: window.innerWidth,
  height: window.innerHeight
});
const useViewport = () => {
  const [viewport, setViewport] = useState(readViewport);
  useEffect(() => {
    const update = () => setViewport(readViewport());
    window.addEventListener("resize", update);
    window.addEventListener("spiral-viewport", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("spiral-viewport", update);
    };
  }, []);
  return viewport;
};
const useHaptic = () => useHaptic$1(shared);
const useExpand = () => {
  const request = requestExpandWith(shared);
  return useCallback(() => request(), [request]);
};
const useNow = (everyMs = 1e3) => {
  const [offset, setOffset] = useState();
  const [now, setNow] = useState();
  useEffect(() => {
    let live = true;
    void Spiral.time.now().then((hostNow) => {
      if (!live) return;
      const delta = hostNow - Date.now();
      setOffset(delta);
      setNow(hostNow);
    }).catch(() => {
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (offset === void 0) return void 0;
    const tick = setInterval(() => setNow(Date.now() + offset), everyMs);
    return () => clearInterval(tick);
  }, [offset, everyMs]);
  return now;
};
const useRoomMembers = () => {
  const [members, setMembers] = useState();
  useEffect(() => {
    let live = true;
    void Spiral.members().then((value) => {
      if (live) setMembers(value);
    }).catch(() => {
      if (live) setMembers([]);
    });
    const stop = shared().onMembersChanged((value) => {
      try {
        if (live) setMembers(parseMembers(value));
      } catch {
      }
    });
    return () => {
      live = false;
      stop();
    };
  }, []);
  return members;
};
const useSpiralContext = () => {
  const [context2, setContext] = useState(() => ({
    userId: Spiral.viewer,
    roomId: "",
    postId: "",
    language: Spiral.language
  }));
  useEffect(() => {
    let live = true;
    void Spiral.context().then((value) => {
      if (live) setContext(value);
    }).catch(() => void 0);
    return () => {
      live = false;
    };
  }, []);
  return context2;
};
export {
  OWNED_NAMESPACE,
  Spiral,
  privateStore,
  summary,
  useChanged,
  useExpand,
  useFrame,
  useHaptic,
  useLeaderboard,
  useNow,
  useOwnState,
  useRoomMembers,
  useSealed,
  useSeats,
  useSharedState,
  useSound,
  useSpiralContext,
  useViewport
};
//# sourceMappingURL=runtime-v1-sdk.js.map
