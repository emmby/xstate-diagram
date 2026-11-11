# xstate-diagram

Convert **XState v5** state machines (raw JSON/TypeScript machine configs or instantiated `StateMachine` objects from `createMachine`) into clean, compact, publication-quality **SVG statechart diagrams**—powered by `elkjs` and verified by a 4-gate closed-loop AST & browser-geometry harness.

## Try It Now

- **In Your Browser:** **[Open the Live Interactive Playground ↗](https://emmby.github.io/xstate-diagram/)** — Explore built-in statechart presets, edit XState v5 configs live, toggle `AUTO` / `RIGHT` / `DOWN` layouts, and download `.svg` diagrams.
- **From Your Terminal:** Render any `.ts`, `.js`, or `.json` XState machine file directly via `npx`:
  ```bash
  npx xstate-diagram src/checkoutMachine.ts -o diagram.svg
  ```

---

## Features

- **100% Browser-Free Runtime:** Zero headless browser, canvas, or OS font binary dependencies at runtime—only `xstate` (v5) and `elkjs`. Runs anywhere Node.js or a browser runs.
- **Full Harel & XState v5 Statechart Semantics:**
  - Atomic, compound (hierarchical), parallel (dashed orthogonal regions), final (double-bordered), and shallow/deep history (`H` / `H*`) states
  - Structured state compartments (`entry / ...`, `exit / ...`, `invoke / ...`, targetless internal transitions, and `#tag` pills)
  - Guarded transitions with explicit evaluation-priority badges (`[#1]`, `[#2]`), transition actions, eventless (`always`), delayed (`after(...)`), completion (`onDone`), actor `onDone(...)` / `onError(...)`, external self-loops, and simultaneous multi-target forks (`●` fork junction on a shared pre-fork trunk)
- **Compact Multi-Line Transition Cards:** Multi-clause transition labels automatically wrap into clean, left-aligned stacked cards (`event` -> `[guard]` -> `/ actions`, `<= 280px` pill width) while preserving exact canonical label text in SVG `<tspan class="edge-label-line">` elements.
- **Adaptive `AUTO` Orientation (`RIGHT` vs. `DOWN`):** Automatically evaluates horizontal, vertical, per-subtree (`SEPARATE_CHILDREN`), parallel-region grid, and chain-wrapped (`MULTI_EDGE`) layouts to produce balanced, compact diagrams (`max(W/H, H/W) <= 3.5`).
- **Deterministic Cross-Platform Typography:** Uses metrically compatible sans-serif (`Arial, Helvetica, "Liberation Sans", sans-serif`) and monospace (`Menlo, Consolas, "DejaVu Sans Mono", monospace`) stacks measured via an exact ASCII width table.

---

## Installation

```bash
npm install xstate-diagram xstate
```

To build and verify from source in this repository:

```bash
npm install
npm run build
CI=1 npm test
```

---

## Programmatic API

```ts
import { createMachine } from 'xstate';
import { renderMachineToSvg } from 'xstate-diagram';
import { writeFile } from 'node:fs/promises';

const checkoutMachine = createMachine({
  id: 'checkout',
  initial: 'cart',
  states: {
    cart: {
      entry: ['loadSavedCart'],
      on: {
        ADD_ITEM: {
          actions: ['assignItem', 'recalculateSubtotal'],
        },
        CHECKOUT: {
          guard: 'hasItems',
          target: 'payment',
          actions: ['lockCart'],
        },
      },
    },
    payment: {
      invoke: {
        id: 'chargeCard',
        src: 'stripePaymentActor',
        onDone: { target: 'confirmed', actions: ['sendReceipt'] },
        onError: { target: 'cart', actions: ['notifyPaymentError'] },
      },
    },
    confirmed: {
      type: 'final',
    },
  },
});

// Render with adaptive AUTO orientation (default)
const svg = await renderMachineToSvg(checkoutMachine);
await writeFile('checkout.svg', svg, 'utf8');

// Or explicitly force 'RIGHT' (left-to-right) or 'DOWN' (top-to-bottom)
const verticalSvg = await renderMachineToSvg(checkoutMachine, {
  direction: 'DOWN',
});
```

### Exported Functions & Types

- `renderMachineToSvg(machineOrConfig: unknown, options?: RenderOptions): Promise<string>` — Accepts either an XState v5 `StateMachine` instance or a raw JSON/object machine configuration and resolves to a standalone `<svg>` document string.
- `extractFromMachine(machineOrConfig: unknown): StatechartAST` — Normalizes an XState v5 machine or config into the canonical `StatechartAST`.
- `renderAstToSvg(ast: StatechartAST, options?: RenderOptions): Promise<string>` — Renders a pre-extracted `StatechartAST` to SVG.
- `RenderOptions`:
  - `direction?: 'AUTO' | 'RIGHT' | 'DOWN'` — Layout orientation (`'AUTO'` by default).
  - `theme?: ThemeTokens` — Optional visual theme overrides (`DEFAULT_THEME` exported).

---

## CLI Usage

`xstate-diagram` includes a standalone CLI that directly renders **TypeScript (`.ts`)**, **JavaScript (`.js` / `.mjs`)**, or **JSON (`.json`)** XState machine files (or JSON from `stdin`) into SVG:

```bash
# Render a TypeScript or JavaScript XState machine module (auto-discovers default or named export)
npx xstate-diagram src/checkoutMachine.ts -o checkout.svg

# Select a specific named export when a file exports multiple machines
npx xstate-diagram src/machines.ts --export paymentMachine -o payment.svg

# Render a JSON machine config file to an SVG file (adaptive AUTO layout)
npx xstate-diagram machine.json -o diagram.svg

# Force top-to-bottom or left-to-right layout direction
npx xstate-diagram src/checkoutMachine.ts -o diagram-down.svg --direction down
npx xstate-diagram src/checkoutMachine.ts -o diagram-right.svg --direction right

# Pipe from stdin to stdout
cat machine.json | npx xstate-diagram --direction auto > diagram.svg
```

### CLI Options

| Flag | Description |
| :--- | :--- |
| `-o, --output <file>` | Write SVG output to `<file>` (defaults to `stdout`) |
| `-d, --direction <dir>` | Layout direction: `auto` (default), `right`, or `down` |
| `-e, --export <name>` | Named export to render when input is a `.ts`/`.js` module |
| `-v, --version` | Print the package version |
| `-h, --help` | Show CLI usage instructions |

---

## GitHub Action (Auto-Generate Diagrams in CI)

Use `emmby/xstate-diagram` directly as a composite GitHub Action in any repository to keep your statechart SVGs automatically up to date:

```yaml
- name: Render XState diagram
  uses: emmby/xstate-diagram@v0.2.0
  with:
    input: src/machines/checkoutMachine.ts
    output: docs/diagrams/checkout.svg
    direction: auto
```

---

## Interactive Browser Playground

Because `xstate-diagram` uses a 100% browser-free pure-JS runtime, it runs directly in the browser.

- **Hosted Playground ([emmby.github.io/xstate-diagram](https://emmby.github.io/xstate-diagram/)):** Automatically deployed to GitHub Pages on every push to `main` via [`.github/workflows/pages.yml`](./.github/workflows/pages.yml).
- **Local Build:** Run `npm run build:playground` to generate the self-contained static playground in `dist/playground/index.html`.

---

## Release & Publishing Strategy

Releases are automated via [`.github/workflows/release.yml`](./.github/workflows/release.yml):

1. Bump the version in `package.json` and push a matching `v*` tag (e.g., `npm version patch && git push origin main --follow-tags`).
2. GitHub Actions runs `npm run typecheck`, `npm run build`, and the full 4-Gate test suite (`CI=1 npm test`).
3. On passing all gates, the workflow packs a slim tarball (`dist/`, `README.md`, `ARCHITECTURE.md`), creates a GitHub Release with auto-generated release notes and attached `.tgz` asset, and publishes to npm via tokenless OIDC Trusted Publishing (`--provenance`).

---

## Closed-Loop 4-Gate Verification Architecture

Every diagram across our 72-machine conformance & `statelyai/docs` Harel reference corpus (spanning Tiers 1–4, up to the 77-state, 81-transition Harel Citizen Quartz Multi-Alarm Watch) is validated through four independent gates:

1. **Gate 1 — Lossless Semantic Round-Trip (`src/verifier/extract-svg.ts`):** Parses the rendered `<svg>` DOM and real Chromium geometry (`getBBox()`, `getPointAtLength()`) to independently reconstruct `StatechartAST` and verify `deepEqual(extractFromSvg(svg), extractFromMachine(input))`—catching missing nodes/edges, wrong endpoints, unrendered compartments, and hierarchical containment violations.
2. **Gate 2 — Automated Geometric & Compactness Linter (`src/verifier/geometry-lint.ts`):** Evaluates rendered bounding boxes and sampled SVG path geometry in Playwright Chromium to enforce zero node/label overlaps, strict parent containment (`>= 8px` inset), zero interior obstacle piercing, outward/inward terminal tangents (`dot >= 0.50`), `>= 14px` multi-edge & label clearance, Voronoi nearest-neighbor label attribution (`> 8px` margin), multi-line card wrapping (`<= 280px`), and balanced canvas aspect ratios (`<= 3.5:1`).
3. **Gate 3 — Multimodal Visual & Semantic Critique:** Inspects rasterized contact-sheet galleries (`npm run gallery:tier1` .. `npm run gallery:tier4`) alongside ground-truth `statelyai/docs` reference screenshots for visual clarity, balance, and typographic polish.
4. **Gate 4 — Human Sign-Off:** Final inspection of generated galleries and benchmark metrics (`npx tsx scripts/benchmark-compactness.ts`).

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for full details on the `StatechartAST` schema, SVG DOM semantic contract, and layout pipeline.

