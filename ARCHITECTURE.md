# `xstate-diagram` Architecture & Specification

## 1. Purpose & Goals
`xstate-diagram` converts XState v5 state machine definitions (either raw JSON/TypeScript machine configs or instantiated `StateMachine` objects from `createMachine`) into clean, accurate, publication-quality SVG statechart diagrams.

Unlike Mermaid's `stateDiagram-v2` (which relies on Dagre and struggles with compound hierarchies, parallel orthogonal regions, self-loops, internal compartments, and label collisions), `xstate-diagram` combines:
1. **XState v5's native statechart normalization** (`createMachine(config).root`) to extract an exact, canonical **Attributed Statechart AST (`StatechartAST`)**.
2. **Eclipse Layout Kernel (`elkjs`)** using the `layered` algorithm with `INCLUDE_CHILDREN` hierarchy handling, explicit port placement, and orthogonal/spline routing.
3. **A Closed-Loop Verification Harness** that reconstructs the `StatechartAST` back from the rendered SVG DOM + browser geometry (`getBBox()`, `getPointAtLength()`) and enforces strict geometric and visual quality invariants.

---

## 2. Technology Stack & Repository Layout

- **Runtime & Language:** Node.js (ESM), TypeScript (`strict: true`), packaged as both a browser-free library and a standalone CLI (`npx xstate-diagram machine.json -o diagram.svg`).
- **Core Runtime Dependencies (Zero Browser / Zero Native Binaries):**
  - `xstate` (v5.x) — state machine normalization & conformance semantics
  - `elkjs` — hierarchical port-aware statechart layout engine
  - *(Note: Production code in `src/ast/**`, `src/renderer/**`, `src/index.ts`, and `src/cli.ts` MUST NOT import Playwright, DOM globals, or OS-specific font binaries. Text sizing in `src/renderer/measure.ts` uses a deterministic pure-JS ASCII character-width table.)*
- **Verification & Dev Dependencies (`devDependencies` only):**
  - `vitest` — test runner
  - `playwright` — headless Chromium for exact SVG `getBBox()`, `getComputedTextLength()`, `getPointAtLength()`, and PNG rasterization

### Directory Structure & Ownership Boundaries
```text
xstate-diagram/
├── README.md                 # Overview, installation, programmatic API & CLI guide
├── ARCHITECTURE.md           # This specification
├── RULES_OF_ENGAGEMENT.md    # Multi-agent rules, gates, and file ownership
├── PLAN.md                   # Tiered conformance roadmap & FlowOS tracking
├── TECH_DEBT.md              # Follow-up backlog (XState core specs & Mermaid cleanup)
├── package.json              # Includes "bin": { "xstate-diagram": "./dist/cli.js" }
├── tsconfig.json
├── scripts/
│   ├── benchmark-compactness.ts      # Corpus-wide viewBox area & aspect-ratio benchmark
│   └── fetch-reference-corpus.ts     # statelyai/docs Harel reference corpus fetcher
├── src/
│   ├── index.ts              # Public API: renderMachineToSvg(config, options?)
│   ├── cli.ts                # Standalone CLI (JSON file or stdin -> SVG file or stdout)
│   ├── ast/                  # Shared canonical StatechartAST types & XState extractor
│   │   ├── types.ts          # StatechartAST, StateNodeAST, TransitionAST
│   │   └── extract-machine.ts# extractFromMachine(machineOrConfig): StatechartAST
│   ├── renderer/             # [OWNED BY @renderer] ELK layout + SVG generation
│   │   ├── measure.ts        # Pure-JS metrically-compatible text/compartment sizing
│   │   ├── elk-graph.ts      # StatechartAST -> ELK Graph conversion
│   │   ├── svg-render.ts     # ELK Graph + StatechartAST -> SVG string
│   │   └── theme.ts          # Visual tokens (typography, colors, paddings, markers)
│   └── verifier/             # [OWNED BY @harness] Closed-loop verification gates
│       ├── extract-svg.ts    # Gate 1: SVG DOM + Geometry -> StatechartAST
│       ├── geometry-lint.ts  # Gate 2: Playwright BBox, collision & Voronoi checks
│       ├── gallery.ts        # Contact sheet generator (dist/gallery-tier-N.html)
│       └── verify-machine.ts # Combined Gate 1 + Gate 2 runner
└── tests/                    # [OWNED BY @harness] Tiered XState v5 conformance tests
    ├── fixtures/
    │   ├── tier1-flat.ts
    │   ├── tier2-compartments.ts
    │   ├── tier3-hierarchy.ts
    │   └── tier4-parallel-history.ts
    ├── tier1.test.ts
    ├── tier2.test.ts
    ├── tier3.test.ts
    └── tier4.test.ts
```

---

## 3. Canonical Attributed Statechart AST (`StatechartAST`)

Both the input extractor (`extractFromMachine`) and the SVG verifier (`extractFromSvg`) produce this exact normalized structure:

```ts
export type StateNodeType = 'atomic' | 'compound' | 'parallel' | 'final' | 'history';

export interface InvocationAST {
  id: string | null;
  src: string;
}

export interface InternalTransitionRowAST {
  eventType: string;
  order: number;
  guard: string | null;
  actions: string[];
}

export interface StateNodeAST {
  /** Full dot-delimited XState state node ID, e.g. "machine.active.loading" */
  id: string;
  /** Local key name displayed in the state header, e.g. "loading" */
  key: string;
  /** Harel statechart node classification */
  type: StateNodeType;
  /** Present only when type === 'history' */
  historyKind: 'shallow' | 'deep' | null;
  /** Parent state node ID, or null for the root machine container (or top-level children of root) */
  parentId: string | null;
  /** Child state ID for initial pseudostate indicator (● -> initialTargetId), if compound */
  initialTargetId: string | null;

  /** Compartment metadata rendered inside the state box */
  entryActions: string[];
  exitActions: string[];
  invocations: InvocationAST[];
  internalTransitions: InternalTransitionRowAST[];
  tags: string[];
}

export interface TransitionAST {
  /** Deterministic transition identifier: `${sourceId}__${eventType}__${order}` */
  id: string;
  /** Source state node ID */
  sourceId: string;
  /**
   * Target state node IDs (sorted lexicographically for multi-target forks).
   * Note: Targetless/internal transitions with reenter:false and no external target
   * are stored in StateNodeAST.internalTransitions instead of drawn as external arrows,
   * EXCEPT explicit self-transitions that draw a visual loop arrow.
   */
  targetIds: string[];
  /** Normalized event label, e.g. "FETCH", "always", "after(1000ms)", "done.state.parent" */
  eventType: string;
  /** Priority order index (0-based) within the source state's transitions for the same eventType */
  order: number;
  /** Guard condition label if present, e.g. "isAuthorized" */
  guard: string | null;
  /** Action names executed on transition */
  actions: string[];
}

export interface StatechartAST {
  machineId: string;
  /** Initial state ID of the root machine */
  rootInitialTargetId: string | null;
  /** Map of state ID -> StateNodeAST (excludes the synthetic root container unless root has compartments/transitions) */
  nodes: Record<string, StateNodeAST>;
  /** All visual arrow transitions (external transitions, initial transitions, history default transitions) */
  transitions: TransitionAST[];
}
```

### Normalization Rules (`extractFromMachine`)
1. **Event Names:**
   - Eventless (`always`) transitions use `eventType: "always"`.
   - Delayed (`after`) transitions (`xstate.after.<delay>.<id>`) normalize to `after(<delay>ms)` (or `after(<delayName>)` for named delays).
   - Completion (`xstate.done.state.<id>`) normalizes to `onDone`.
   - Actor completion (`xstate.done.actor.<id>`) normalizes to `onDone(<id>)`.
   - Actor error (`xstate.error.actor.<id>`) normalizes to `onError(<id>)`.
2. **Internal / Targetless vs. External Transitions:**
   - A transition with **no target** (`target === undefined` or `target.length === 0`) is a **compartment row** stored in `node.internalTransitions` and rendered inside the state's text compartment as `<eventType> [guard] / action1, action2`.
   - A transition with one or more targets (including self-transitions where `target` resolves to `sourceId`) is stored in `ast.transitions` and rendered as a directed `<path>` arrow.
3. **Transition Label Formatting:**
   - Canonical visual text for a transition label or internal transition row:
     - Base: `<eventType>` (if `order > 0` among guarded branches on the same event from the same source, prefix with priority badge or index `[#${order + 1}] ` or preserve explicit guard order attribute + visual ordering).
     - With guard: `<eventType> [${guard}]`
     - With actions: `<eventType> / ${actions.join(', ')}`
     - With both: `<eventType> [${guard}] / ${actions.join(', ')}`

---

## 4. SVG DOM & Semantic Attribute Contract

Every generated SVG must be a standalone, valid `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 W H" width="W" height="H">` document containing:

1. **State Nodes (`<g class="state-node">`):**
   - Required attributes:
     - `data-state-id="<id>"`
     - `data-state-key="<key>"`
     - `data-state-type="atomic|compound|parallel|final|history"`
     - `data-parent-id="<parentId or ''>"`
     - `data-initial-target="<initialTargetId or ''>"`
     - `data-history-kind="<shallow|deep|''>"`
   - Must contain a primary bounding shape `<rect class="state-box" ... />` (or `<circle class="state-box" />` for `history` pseudostates) that defines the state's visual perimeter.
   - Must contain `<text class="state-title">` displaying the state's `key` (or `H` / `H*` for history states, or bullseye for top-level final states if unnamed, though XState final states have a `key` which must be shown).
   - **Compartments (`<g class="state-compartment" data-compartment="entry|exit|invoke|internal|tags">`):**
     - Each entry action in `<text data-entry-action="<name>">entry / <name></text>`
     - Each exit action in `<text data-exit-action="<name>">exit / <name></text>`
     - Each invocation in `<text data-invoke-src="<src>" data-invoke-id="<id or ''>">invoke / <src></text>`
     - Each internal targetless transition in `<text data-internal-event="<eventType>" data-internal-order="<order>" data-internal-guard="<guard or ''>" data-internal-actions="<comma-joined>">...</text>`
     - Each tag in `<g class="state-tag" data-tag="<tag>"><text>#<tag></text></g>`

2. **Initial Pseudostate Indicators (`<g class="initial-indicator">`):**
   - Required attributes:
     - `data-parent-id="<parentId or '__root__'>"`
     - `data-target-id="<initialTargetId>"`
   - Contains a filled `<circle class="initial-dot" />` and a `<path class="initial-edge" marker-end="url(#arrow-initial)" />` terminating on the border of `initialTargetId`.

3. **Transition Edges (`<g class="transition-edge">`):**
   - Required attributes:
     - `data-edge-id="<id>"`
     - `data-edge-source="<sourceId>"`
     - `data-edge-targets="<comma-separated targetIds>"`
     - `data-edge-event="<eventType>"`
     - `data-edge-order="<order>"`
     - `data-edge-guard="<guard or ''>"`
     - `data-edge-actions="<comma-separated actions>"`
   - Contains `<path class="edge-path" marker-end="url(#arrow-transition)" d="..." />` (or multiple branch paths for hyperedge forks from a `<circle class="fork-junction" />` shared pre-fork trunk).
   - Contains `<g class="edge-label">` with `<rect class="edge-label-bg" />` and `<text class="edge-label-text">`:
     - Short single-clause labels (`!guard && actions.length === 0`, up to `24` chars if space-separated) render on a single line.
     - Multi-clause labels (combining an event with `[guard]` and/or `/ action1, action2`) or long space-separated phrases render as a compact **multi-line stacked card** (`<= 280px` pill width) using `<tspan class="edge-label-line" x="..." dy="...">` children inside `<text class="edge-label-text">`:
       1. **Event line:** `[#N] <eventType>` (bold sans-serif)
       2. **Guard line(s):** `[<guard>]` (monospace, wrapped at internal spaces if `> 32` chars while keeping `[` and `]` intact)
       3. **Action line(s):** `/ action1, action2` (monospace, wrapped cleanly at top-level commas targeting `<= 28` chars per line, plus internal space-wrapping if a single action phrase exceeds `32` chars)
     - Every non-final `<tspan class="edge-label-line">` ends with a single trailing space `' '` (with zero whitespace between `<tspan>` tags) so `.edge-label-text.textContent` reconstructs the exact canonical single-line transition label string for Gate 1 (`extractFromSvg`).

---

## 5. Visual Design System & Styling Requirements

To ensure diagrams render identically across macOS, Windows, and Linux with zero font-embedding bloat while remaining crisp and modern:
- **Cross-Platform Metrically-Compatible Font Stacks:**
  - **Sans-serif (State titles & event names):** `Arial, Helvetica, "Liberation Sans", "Nimbus Sans L", sans-serif` (`Arial`, `Helvetica`, and `Liberation Sans` share identical ASCII glyph width metrics across OSes; `measure.ts` uses an exact 95-char ASCII width lookup table plus a `+6px` horizontal safety buffer).
  - **Monospace (Guards `[cond]`, actions `/ act`, and compartments):** `Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace` (`~0.60 * fontSize` fixed advance width per character across OSes, plus `+6px` horizontal safety buffer).
- **Color Palette (Light Mode Default, High Contrast):**
  - Canvas background: `#F8FAFC`
  - Atomic state box: fill `#FFFFFF`, stroke `#334155` (`1.5px`), `rx="8"`
  - Compound state container: fill `#F1F5F9` (nested depth alternates `#F8FAFC` / `#EFF6FF`), header bar `#E2E8F0`, stroke `#475569` (`1.5px`), `rx="10"`
  - Parallel state region container: stroke `#64748B` (`1.5px`), ` stroke-dasharray="6 4"`, fill `#FAFAFA`
  - Final state: double border (outer `rx="8"` stroke `#0F172A` `2px`, inner rect inset by `4px` stroke `#0F172A` `1.5px`) + subtle badge
  - History state: circular node (`r="14"`), fill `#FEF3C7`, stroke `#D97706` (`1.5px`), centered bold `H` or `H*`
  - Transition path: stroke `#475569` (`1.75px`), rounded orthogonal corners (`rx="6"` on bend points or clean orthogonal segments), distinct filled arrowhead marker (`8x6px`)
  - Transition label pill: fill `#FFFFFF` (opacity `0.95`), stroke `#CBD5E1` (`1px`), `rx="4"`, padding `4px 6px`, text `#0F172A` (`12px` medium)
- **Bidirectional & Multi-Edge Separation:**
  - Two transitions between the same pair of states ($A \to B$ and $B \to A$, or two events $A \xrightarrow{E_1} B$ and $A \xrightarrow{E_2} B$) must use distinct ELK ports/channels so their paths and label pills are separated by at least `14px`.
- **Compact Node Proportions & Structured Compartments:**
  - Keep atomic state boxes compact around their title and compartments—do not over-inflate vertical node height beyond what is needed for compartments and actual multi-edge port clearance.
  - When a state has compartments (`entryActions`, `exitActions`, `invocations`, `internalTransitions`, or `tags`), draw a crisp horizontal divider line (`1px` `#CBD5E1`) below the header title and render each compartment row with clear typographic contrast (monospace `#334155` `11.5px`) and comfortable vertical line-height (`18–20px`).
- **Multi-Line Transition Cards & Pill Width Discipline:**
  - Splittable transition labels wrap into left-aligned multi-line cards (`padding: 4px 8px`, `17px` line-height) so `.edge-label-bg` width stays `<= 280px`, preventing wide transition strings from inflating inter-layer gaps.
- **Adaptive `AUTO` (`RIGHT` vs. `DOWN`) Layout Orientation & Aspect-Ratio Balance:**
  - `renderMachineToSvg(machineOrConfig, { direction?: 'AUTO' | 'RIGHT' | 'DOWN' })` and `xstate-diagram --direction <auto|right|down>` default to `'AUTO'`.
  - Under `'AUTO'`, `layoutStatechart` evaluates candidate `RIGHT` and `DOWN` layouts—combining per-container `SEPARATE_CHILDREN` orientation on closed hierarchical subtrees, `elk.aspectRatio` tuning for parallel orthogonal region grids, and `elk.layered.wrapping.strategy: 'MULTI_EDGE'` folding on elongated chains—selecting the candidate with zero geometric violations and optimal canvas compactness + aspect-ratio balance (targeting `W/H ≈ 1.35` and enforcing `max(W/H, H/W) <= 3.5` on all `>= 2`-state diagrams).

---

## 6. Official `statelyai/docs` Ground-Truth Reference Corpus

To validate semantic statechart representation against XState's official visual reference (for **semantic correctness**, NOT copying Stately's visual aesthetic):
- `tests/reference-corpus/` caches the paired official XState v5 JSON machine definitions and official Stately Studio reference PNG screenshots from `github.com/statelyai/docs` (`public/assets/harel-statecharts/{examples,screenshots}/*` and `public/assets/statecharts/examples/*` + `dark/*`).
- `@harness` classifies each reference machine into the lowest Tier (`1`, `2`, `3`, or `4`) that supports every construct in its AST:
  - **Tier 1:** Flat atomic/final states + basic transitions
  - **Tier 2:** Flat states + guards, priority order, entry/exit/transition actions, internal/targetless transitions, `always`, `after`, `tags`
  - **Tier 3:** Compound hierarchical states + cross-boundary transitions + `onDone`
  - **Tier 4:** Parallel states, `H`/`H*` history states, multi-target forks, and `invoke` actors
- For every fixture backed by a `statelyai/docs` reference PNG, `gallery-tier-<N>.html` displays the reference PNG alongside our rendered SVG, and `@critic` inspects both in Gate 3 to verify semantic completeness and accuracy.
