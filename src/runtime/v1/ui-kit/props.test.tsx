// @vitest-environment happy-dom

/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

The props a model writes reach the DOM (§ 5.57).

The kit's text and layout components once dropped everything but their own
few props, silently: generated code is never type-checked. An owner asked for
a card's text centred, the model wrote `textAlign: "center"` three times out
of three, and nothing moved. These pin the props the corpus actually uses.
*/

import { type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Avatar, decorativeIndex, List, Meta, Row, Stack, Text } from "./index";

let host: HTMLDivElement;

const render = async (node: ReactNode): Promise<HTMLElement> => {
  host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  return host.firstElementChild as HTMLElement;
};

afterEach(() => {
  host?.remove();
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Text", () => {
  it("takes the style the model writes", async () => {
    const el = await render(<Text variant="caption" style={{ textAlign: "center", fontWeight: 700 }}>Тепло з України</Text>);
    expect(el.style.textAlign).toBe("center");
    expect(el.style.fontWeight).toBe("700");
    expect(el.className).toContain("s-text--caption");
  });

  it("takes align", async () => {
    const el = await render(<Text align="center">Вітаємо</Text>);
    expect(el.className).toContain("s-align--center");
  });
});

describe("Meta", () => {
  // A flex row: `textAlign` alone would leave its text at the start, so the
  // alignment is carried to the row.
  it("centres when the model centres its text", async () => {
    const el = await render(<Meta style={{ textAlign: "center" }}>Торкніться, щоб запалити салют</Meta>);
    expect(el.className).toContain("s-align--center");
    expect(el.style.textAlign).toBe("center");
  });

  it("takes align", async () => {
    const el = await render(<Meta align="end">3 учасники</Meta>);
    expect(el.className).toContain("s-align--end");
  });
});

describe("Row and Stack", () => {
  it("take the gap the model writes", async () => {
    const row = await render(<Row gap={8}>a</Row>);
    expect(row.style.gap).toBe("8px");
    const stack = await render(<Stack gap={6}>b</Stack>);
    expect(stack.style.gap).toBe("6px");
  });

  it("take align, and a style wins over it", async () => {
    const stack = await render(<Stack align="center">c</Stack>);
    expect(stack.className).toContain("s-align--center");
    const row = await render(<Row align="start" style={{ alignItems: "stretch" }}>d</Row>);
    expect(row.style.alignItems).toBe("stretch");
  });

  it("stay as they were when nothing is asked", async () => {
    const row = await render(<Row between>e</Row>);
    expect(row.getAttribute("style") ?? "").toBe("");
    expect(row.className).toBe("s-row s-row--between");
  });
});

describe("the kit's own words (§ 5.60)", () => {
  const init = (language?: string): void => {
    (globalThis as { __spiralInit?: unknown }).__spiralInit = language === undefined ? undefined : { language };
  };
  afterEach(() => init(undefined));

  it("count the rest of a list in the viewer's language", async () => {
    const people = ["a", "b", "c", "d"];
    for (const [language, text] of [["uk", "ще 2"], ["ru", "ещё 2"], ["en", "+2 more"], ["de", "+2 more"]] as const) {
      init(language);
      const list = await render(<List items={people} keyOf={(p) => p} max={2}>{(p) => p}</List>);
      const more = list.querySelector(".s-list__more");
      expect(more?.textContent, language).toBe(text);
      expect(more?.getAttribute("aria-label"), language).toBeTruthy();
    }
  });
});

describe("Avatar (§ 5.64)", () => {
  it("colours the placeholder as the messenger colours the same person", async () => {
    // Compound: sum of code points mod 6. "@emmm:spiral.md" sums to 1456 → 1456 % 6 = 4 → decorative-5.
    // The Swift side pins the same number (SpiralAppPostSessionTests).
    expect(decorativeIndex("@emmm:spiral.md")).toBe(5);
    const el = await render(<Avatar name="emmm" userId="@emmm:spiral.md" />);
    expect(el.style.background).toContain("--cpd-color-bg-decorative-5");
    expect(el.style.color).toContain("--cpd-color-text-decorative-5");
    expect(el.textContent).toBe("E");
  });

  it("shows the picture when it is a data: URL, and no colour then", async () => {
    const el = await render(<Avatar name="A" userId="@a:h" src="data:image/jpeg;base64,/9j/" />);
    expect(el.querySelector("img")?.getAttribute("src")).toMatch(/^data:/);
    expect(el.style.background).toBe("");
  });

  it("falls back to the initial for an mxc: URI, coloured by the name without an id", async () => {
    const el = await render(<Avatar name="Olena" src="mxc://spiral.md/abc" />);
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toBe("O");
    expect(el.style.background).toContain(`decorative-${decorativeIndex("Olena")}`);
  });
});
