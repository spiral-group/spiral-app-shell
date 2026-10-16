/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

The mock is a development convenience, so the risk is not that it breaks —
it is that it lies. These pin the places where a difference from the real host
would let an app look finished in a browser and fail on a phone.
*/

import { describe, expect, it } from "vitest";

import { installMockHost, setMockLanguage } from "./mock";
import { handshakeLanguage } from "./sdk/context";
import type { SpiralInit } from "../../shell/protocol";

const globals = () =>
  globalThis as { __spiralPort?: MessagePort; __spiralInit?: SpiralInit };

const ask = async (method: string, args: unknown = null): Promise<unknown> => {
  const port = globals().__spiralPort;
  if (port === undefined) throw new Error("no mock host installed");

  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { id?: string };
      if (data.id !== "t") return;
      port.removeEventListener("message", onMessage);
      resolve(event.data);
    };
    port.addEventListener("message", onMessage);
    port.postMessage({ id: "t", method, args, userActivation: false });
  });
};

describe("what an app can read", () => {
  it("names the viewer, the room and the post", async () => {
    const teardown = installMockHost({ userId: "@a:example.org", postId: "$p" });
    const reply = (await ask("app.context.read")) as { data: Record<string, string> };

    expect(reply.data["userId"]).toBe("@a:example.org");
    expect(reply.data["postId"]).toBe("$p");
    teardown();
  });

  it("always includes the viewer in the roster", async () => {
    // An app that draws "you" from the member list would otherwise work in a
    // browser only when the fixture happened to list them.
    const teardown = installMockHost({ userId: "@a:example.org", members: [] });
    const reply = (await ask("members.basic.read")) as {
      data: { members: { userId: string }[] };
    };

    expect(reply.data.members.map((m) => m.userId)).toEqual(["@a:example.org"]);
    teardown();
  });

  it("does not list the viewer twice when the fixture names them", async () => {
    const teardown = installMockHost({
      userId: "@a:example.org",
      members: [{ userId: "@a:example.org" }, { userId: "@b:example.org" }],
    });
    const reply = (await ask("members.basic.read")) as {
      data: { members: { userId: string }[] };
    };

    expect(reply.data.members).toHaveLength(2);
    teardown();
  });
});

describe("the viewer's language (§ 5.60)", () => {
  it("is in the handshake, Ukrainian unless the room says otherwise", () => {
    const teardown = installMockHost({ userId: "@a:example.org" });
    expect(globals().__spiralInit?.language).toBe("uk");
    teardown();

    const english = installMockHost({ userId: "@a:example.org", language: "en" });
    expect(handshakeLanguage()).toBe("en");
    english();
  });

  it("can change between mounts, which is how the ruler reads a template as each reader would", () => {
    const teardown = installMockHost({ userId: "@a:example.org" });
    const port = globals().__spiralPort;
    setMockLanguage("ru");
    expect(handshakeLanguage()).toBe("ru");
    expect(globals().__spiralInit?.viewerId, "the rest of the handshake stays").toBe("@a:example.org");
    expect(globals().__spiralPort, "and so does the channel").toBe(port);
    teardown();
  });
});

describe("what an app can change", () => {
  it("folds the operation the way the native session would", async () => {
    const teardown = installMockHost();
    await ask("state.shared.write", { op: { incr: { path: "count", by: 2 } } });
    const reply = (await ask("state.shared.read")) as { data: { state: unknown; seq: number } };

    expect(reply.data.state).toEqual({ count: 2 });
    expect(reply.data.seq).toBe(1);
    teardown();
  });

  it("pushes the authoritative state after acknowledging, not instead of it", async () => {
    // Order matters: an app that folds the push must not receive it before
    // the write resolves, or the device's sequence would surprise it.
    const teardown = installMockHost();
    const port = globals().__spiralPort;
    const seen: string[] = [];

    port?.addEventListener("message", (event: MessageEvent) => {
      const data = event.data as { id?: string; kind?: string };
      seen.push(data.id ?? data.kind ?? "?");
    });

    await ask("state.shared.write", { op: { incr: { path: "count", by: 1 } } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen).toEqual(["t", "state.changed"]);
    teardown();
  });

  it("refuses a method it does not stand in for, rather than answering ok", async () => {
    const teardown = installMockHost();
    const reply = (await ask("spike.report")) as { ok: boolean; message: string };

    expect(reply.ok).toBe(false);
    expect(reply.message).toMatch(/not mocked/);
    teardown();
  });
});

describe("teardown", () => {
  it("removes the globals so a second install starts clean", () => {
    const teardown = installMockHost({ state: { count: 9 } });
    expect(globals().__spiralPort).toBeDefined();

    teardown();
    expect(globals().__spiralPort).toBeUndefined();
    expect(globals().__spiralInit).toBeUndefined();
  });
});

describe("owned paths", () => {
  it("hands the viewer's id to the SDK in the handshake", () => {
    const teardown = installMockHost({ userId: "@a:example.org" });
    expect(globals().__spiralInit?.viewerId).toBe("@a:example.org");
    teardown();
  });

  it("refuses a write into someone else's namespace, as the host does", async () => {
    const teardown = installMockHost({ userId: "@a:example.org" });
    const reply = (await ask("state.shared.write", {
      op: { set: { path: ["by", "@b:example.org", "vote"], value: "A" } },
    })) as { ok: boolean; code?: string };

    expect(reply.ok).toBe(false);
    expect(reply.code).toBe("rejected");
    teardown();
  });

  it("accepts a write into the viewer's own namespace", async () => {
    const teardown = installMockHost({ userId: "@a:example.org" });
    const reply = (await ask("state.shared.write", {
      op: { set: { path: ["by", "@a:example.org", "vote"], value: "A" } },
    })) as { ok: boolean };
    const read = (await ask("state.shared.read")) as { data: { state: Record<string, unknown> } };

    expect(reply.ok).toBe(true);
    expect(read.data.state).toEqual({ by: { "@a:example.org": { vote: "A" } } });
    teardown();
  });
});
