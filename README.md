# spiral-app-shell

Trusted shell and runtime for **Spiral Interactive Posts** — Brief 0066,
ADR-0007.

An Interactive Post is a message whose content is a vibe-coded React
mini-app. The generated code is untrusted. This repository is everything that
stands between it and the device: the trusted document that owns the native
bridge, the sandboxed frame the app runs in, and the runtime (React, the SDK,
the UI Kit, the transpiler) that ships in the client release rather than in
every artifact.

Our own code, not a fork.

## Layout

```
src/shell/           the TRUSTED document: bridge, pool, quotas, teardown
src/runtime/v1/      what the SANDBOXED frame loads: harden, transpile, bootstrap,
                     React entry, `platform` (viewport, language, haptics, sound),
                     `measure` (the layout ruler), `mock` (a host for tests)
src/runtime/v1/sdk/  `@spiral/sdk` — shared state, optimistic apply, summary,
                     hooks (useSeats, useLeaderboard, useChanged, useSealed …)
src/runtime/v1/ui-kit/  `@spiral/ui` — Scene, the controls, Board, Leaderboard, kit.css
src/runtime/v1/play/ `@spiral/play` — useFrame, fitCanvas, strokePath, sounds
src/artifact/        the module an artifact is compiled into
src/conformance/     the SDK conformance harness
src/lab/, src/motion/  the device lab pages (layout, scenes)
src/probe/, src/counter/  the Brief 0066 spike's hostile artifact and the
                     step 5.1 counter — never shipped
catalog/             the 25 catalogue templates (`*.jsx`) + `index.json`
scripts/             catalog-pack (→ ../matrix-agent-platform/deploy/config/catalog),
                     check-capabilities, ruler, tokens
ios/                 SwiftPM wrapper carrying dist/ (sibling path dependency)
android/             reserved and empty; see android/README.md for why
```

## Commands

| Command | What it does |
|---|---|
| `pnpm build` | typecheck, build the runtime, build artifacts, pack them |
| `pnpm build:ios` | build, then refresh `ios/Sources/dist` (commit the result) |
| `pnpm test` | `check-capabilities` (the SDK's exports held equal to the orchestrator's) + every vitest suite — transpile, SDK, fold, pipeline, the catalogue test |
| `pnpm lint:types` | `tsc --noEmit` |
| `pnpm verify:layout` | the WebKit layout ruler over the corpus (108 cases) |
| `pnpm catalog:pack` | measure every template in three languages and pack the catalogue into the platform's `deploy/config/catalog` |

The published repository leaves out Spiral's generator harness (`eval/`:
the layout corpus, the catalogue test and recorded model outputs) and the
scripts that drive Spiral's closed backend prompts. `pnpm build` and
`pnpm build:ios` need neither. `pnpm test`, `pnpm verify:layout` and
`pnpm catalog:pack` read `eval/` or the closed backend, so they do not run
from the published tree.

`ios/Sources/dist` is generated **and committed**, so an iOS build works from
a fresh clone with no Node toolchain — the same arrangement
`compound-design-tokens` and the retired `element-call-swift` wrapper used.
Never hand-edit it: run `pnpm build:ios` and commit the result. The root
`dist/` is intermediate and ignored.

## How an app actually runs

```
WKURLSchemeHandler  spiral-app://
  /shell/index.html        → real file (ours)
  /runtime/v1/*.js         → real files (ours, shipped in the release)
  /a-<digest>/index.html   → SYNTHESISED by the host, with CSP + nonce
  /a-<digest>/app.jsx      → artifact text, digest-verified before serving
  anything else            → refused

shell (trusted)
  └── iframe sandbox="allow-scripts"   ← opaque origin, no same-origin
        └── bootstrap: harden → take MessagePort → fetch app.jsx as TEXT
              → sucrase → rewrite specifiers → import(blob:) → React mount
```

The app's only channel out is one `MessagePort` to the shell. It never sees
`window.webkit`, credentials, storage or the network.

## Two things that are easy to get wrong

**The iframe must not have `allow-same-origin`.** Without it the frame gets an
opaque origin whatever its URL is, which is what actually removes
`localStorage`, cookies and any reach into the shell. Adding it to "fix" a
storage error defeats the whole design.

**Artifacts import bare specifiers, never bundled React.** `transpile.ts`
rewrites `react` to `/runtime/v1/react.js` at load time. That is why
`vite.artifact.config.ts` marks React external — an artifact that carries its
own copy breaks the one-React-per-runtime rule and skips the rewrite path.

## Status

Brief 0066 v1, merged (2026-10-01; this repo's `main`). The runtime spike
ran on a physical iPhone on 2026-09-14 and every attack was `blocked` — the
evidence is `~/Projects/docs/walkthroughs/0066-runtime-spike.md`; the design
and every step since are in `~/Projects/docs/DESIGNS/spiral-app-runtime.md`
(§ 5.85 is the pre-merge audit). The runtime is `1` / `1.1`; every catalogue
template is `1.1`. Gates at the merge: 380 tests, types, layout 108/108,
catalogue 25/25 in three languages.

## Licence

AGPL-3.0-or-later. See `LICENSE`. `NOTICE` adds a section 7 permission to convey the code through app stores.
