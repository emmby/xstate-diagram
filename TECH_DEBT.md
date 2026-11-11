# Technical Debt & Follow-Up Backlog

This document tracks known follow-up items following the replacement of the legacy Mermaid `stateDiagram-v2` compiler (`v0.0.1`, preserved at tag `archive/mermaid-v0.0.1`) with the `elkjs` + pure-JS SVG statechart engine (`v0.2.0`).

---

## 1. XState v5 Core Test-Suite Spec Conformance (`tests/xstate-core-specs/`)

During the initial Mermaid prototype, XState v5 `createMachine(...)` object literals were extracted from `statelyai/xstate` (`packages/core/test/*.test.ts`) and preserved in this repository under `tests/xstate-core-specs/` via `git mv`:

- **`tests/xstate-core-specs/supported/`** — Curated JSON machine specifications previously validated during the initial conformance pass (39 committed specs on `origin/main`, up to 44 including in-flight scratch specs).
- **`tests/xstate-core-specs/unsupported/`** — 938 extracted JSON machine configurations across **54 categories** (`actions`, `activities`, `actor`, `actorLogic`, `after`, `assert`, `assign`, `clock`, `deep`, `definition`, `deterministic`, `emit`, `errors`, `event`, `eventDescriptors`, `final`, `getNextSnapshot`, `guards`, `history`, `id`, `initial`, `input`, `inspect`, `internalTransitions`, `interpreter`, `invalid`, `invoke`, `json`, `logger`, `machine`, `match`, `meta`, `microstep`, `multiple`, `order`, `parallel`, `predictableExec`, `rehydration`, `resolve`, `select`, `setup.types`, `spawn`, `spawn.types`, `spawnChild`, `state`, `stateIn`, `system`, `tags`, `toPromise`, `transient`, `transition`, `typeHelpers`, `types`, `waitFor`).
- **`scripts/extract-xstate-core-specs.ts`** — ESM TypeScript AST extractor ported from the legacy `scripts/extract.ts`, defaulting output to `tests/xstate-core-specs/extracted`.

### Required Follow-Up Work

1. **Normalize `[Node: ...]` TypeScript AST Placeholders:**
   - Because `scripts/extract-xstate-core-specs.ts` serializes non-literal TypeScript AST nodes (inline arrow functions, `assign(...)`, `raise(...)`, `sendTo(...)`, shorthand properties, method declarations, computed delay/guard expressions) as string placeholders of the form `"[Node: ...]"`, `extractFromMachine` / `createMachine` must pre-normalize or stub `[Node: ...]` placeholders (e.g., mapping action/guard/actor/delay AST strings into valid named descriptors or no-op stubs) before instantiating `createMachine(config)`.
2. **Exclude Intentionally Malformed Error-Test Configs (`invalid/` & negative tests):**
   - `tests/xstate-core-specs/unsupported/invalid/` (and scattered negative assertions in `errors/`, `id/`, `history/`, etc.) intentionally pass malformed statechart configurations designed to assert that XState v5 throws at `createMachine(...)` time (e.g., nonexistent initial state targets, invalid sibling IDs, illegal child states on `atomic`/`final` nodes). These must be separated into an explicit negative-test manifest rather than treated as renderable diagrams.
3. **Wire a Dedicated Conformance Vitest Suite:**
   - Add a dedicated test suite (e.g., `tests/xstate-core-specs.test.ts`) running Gate 1 (semantic + geometric round-trip isomorphism) and Gate 2 (Playwright geometric & compactness linter) across the normalized `supported/` and `unsupported/` specs, fixing any remaining extractor or renderer edge cases uncovered by XState's internal unit tests.

---

## 2. Post-Merge Mermaid Legacy Cleanup

Following the v0.2.0 ELK/SVG engine cutover on main (with the final Mermaid commit 56c5712 preserved on origin at tag archive/mermaid-v0.0.1):

1. ~~**Close Superseded Mermaid-Era Pull Requests:**~~ *(Completed)*
   - Closed open PRs targeting the retired Mermaid compiler (`#22`, `#23`, `#25`) with a note linking to the `v0.2.0` ELK/SVG engine replacement.
2. ~~**Close Resolved / Superseded Mermaid-Era Issues:**~~ *(Completed)*
   - Closed `#13` (`getSafeId` Mermaid identifier collisions) and `#24` (multi-edge transitions between identical states colliding in Mermaid/Dagre).
3. ~~**Prune Stale `wt-*` Mermaid Branches & Worktrees:**~~ *(Remote branches pruned on `origin`)*
   - Pruned all 20 remote `wt-*` branches on `origin` (`wt-after-transitions`, `wt-batch-*`, `wt-bead-system`, `wt-deep-states`, `wt-entry-actions`, `wt-final-states`, `wt-history-*`, `wt-issue-16-v1`, `wt-parallel*`, `wt-phase*`, `wt-setup-ci`). Any remaining local worktrees or local branches (`wt-*`, `fix_mermaid_labels_actions`) on a developer workstation can be pruned with `git worktree prune && git fetch --prune origin`.
4. **Retire Bootstrap Directory:** Archive or remove the local `/Users/mike/GitHub/xstate-svg` bootstrap repository now that `main` on `xstate-diagram` is canonical.
