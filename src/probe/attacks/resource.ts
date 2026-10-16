/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 spike, performance half. What an app costs the host.

These are MEASUREMENTS, not pass/fail gates — the thresholds live on the iOS
side, which can see real memory and frame timing. The verdicts here are
always `blocked` (meaning "the host survived and stayed in control"); the
numbers in `detail` are what goes into the walkthrough.

Deliberately bounded: an unbounded CPU loop would be a more honest adversary
but would also hang the device the spike is trying to measure. The bounded
version answers the question that matters — does the host stay responsive and
can it still tear the app down.
*/

import type { CheckResult } from "../types";

const result = (name: string, detail: string): CheckResult => ({
  name,
  verdict: "blocked",
  detail,
});

/** Busy-loop for a fixed slice; the host watches frame timing during it. */
const checkCpuBurn = async (): Promise<CheckResult> => {
  const budgetMs = 750;
  const started = performance.now();
  let iterations = 0;
  while (performance.now() - started < budgetMs) {
    iterations += 1;
    Math.sqrt(iterations);
  }
  const elapsed = Math.round(performance.now() - started);
  return result("cpu-burn", `${iterations} iterations in ${elapsed}ms on the main thread`);
};

/** Allocate a bounded chunk so the host can watch the memory curve. */
const checkMemory = async (): Promise<CheckResult> => {
  const chunks: Uint8Array[] = [];
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

/**
 * A message far over the shell's 64 KiB limit must be refused, not forwarded.
 *
 * The operation is deliberately WELL FORMED and merely enormous. A malformed
 * one would also be refused — for its shape — and the verdict would read the
 * same while proving nothing about the size limit.
 */
const checkOversizedMessage = async (): Promise<CheckResult> => {
  const port = (globalThis as { __spiralPort?: MessagePort }).__spiralPort;
  if (!port) return result("oversized-message", "no port in this realm (probe ran standalone)");

  const payload = "x".repeat(128 * 1024);
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { id?: string; ok?: boolean; code?: string } | undefined;
      if (data?.id !== "probe-oversized") return;
      port.removeEventListener("message", onMessage);
      resolve(
        result(
          "oversized-message",
          data.ok === false ? `refused with code=${data.code}` : "SHELL ACCEPTED AN OVERSIZED MESSAGE",
        ),
      );
    };
    port.addEventListener("message", onMessage);
    port.postMessage({
      id: "probe-oversized",
      method: "state.shared.write",
      args: { op: { set: { path: "oversized", value: payload } } },
      userActivation: false,
    });
    setTimeout(() => {
      port.removeEventListener("message", onMessage);
      resolve(result("oversized-message", "no reply within 3s"));
    }, 3_000);
  });
};

/** More concurrent calls than the shell allows; the excess must be refused. */
const checkFlood = async (): Promise<CheckResult> => {
  const port = (globalThis as { __spiralPort?: MessagePort }).__spiralPort;
  if (!port) return result("request-flood", "no port in this realm (probe ran standalone)");

  const total = 128;
  let refused = 0;
  let answered = 0;

  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { id?: string; ok?: boolean } | undefined;
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
        userActivation: false,
      });
    }

    setTimeout(() => {
      port.removeEventListener("message", onMessage);
      resolve(result("request-flood", `${answered}/${total} answered, ${refused} refused within 4s`));
    }, 4_000);
  });
};

/**
 * An operation this runtime cannot carry out must be refused by the SHELL.
 *
 * The host refuses it too, and would be right to. The point of checking here
 * is that a message which cannot possibly succeed should never have reached
 * the code that writes into a room in the first place.
 */
const checkUnknownOperation = async (): Promise<CheckResult> => {
  const port = (globalThis as { __spiralPort?: MessagePort }).__spiralPort;
  if (!port) return result("unknown-operation", "no port in this realm (probe ran standalone)");

  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { id?: string; ok?: boolean; message?: string } | undefined;
      if (data?.id !== "probe-bad-op") return;
      port.removeEventListener("message", onMessage);
      resolve(
        result(
          "unknown-operation",
          data.ok === false
            ? `refused by the shell: ${data.message}`
            : "SHELL FORWARDED AN OPERATION IT CANNOT CARRY OUT",
        ),
      );
    };
    port.addEventListener("message", onMessage);
    port.postMessage({
      id: "probe-bad-op",
      method: "state.shared.write",
      args: { op: { exfiltrate: { path: "anything", to: "https://probe.invalid" } } },
      userActivation: false,
    });
    setTimeout(() => {
      port.removeEventListener("message", onMessage);
      resolve(result("unknown-operation", "no reply within 3s"));
    }, 3_000);
  });
};

export const runResourceChecks = async (): Promise<readonly CheckResult[]> => [
  await checkCpuBurn(),
  await checkMemory(),
  await checkOversizedMessage(),
  await checkUnknownOperation(),
  await checkFlood(),
];
