# `xstate-diagram` Implementation Plan

- **Track:** XState v5 to SVG Renderer & Closed-Loop Verification Harness [flowos: 2897578a-34fc-42c1-a6cb-da48bfe45445]

---

## Phase 0: Closed-Loop Harness & Spec Foundation [flowos: 60f1f890-bafd-4e25-b524-b8b79ec6135d]

- [x] Author ARCHITECTURE.md, RULES_OF_ENGAGEMENT.md, and PLAN.md (~0.5d) [flowos: 28a16472-5550-4617-8737-8647dedb03c9]
- [x] Scaffold TypeScript/ELK/Playwright project and Canonical StatechartAST extractor (`extractFromMachine`) (~1d) [flowos: 173cbef5-47a5-49b9-9d97-aed3bde777ac]
- [x] Implement Gate 1 (`extractFromSvg` + geometric endpoint/containment check), Gate 2 (Playwright geometric linter), and `gallery.html` generator (~1d) [flowos: 0d3969fb-968e-4691-9444-10296dad99e6]

## Phase 1: Tier 1 — Flat Atomic State Machines [flowos: 9f0e2843-6838-40d8-966b-ef9968f8acd1]

- [x] Curate Tier 1 XState v5 conformance fixtures (flat atomic states, initial/final, basic & bidirectional transitions, self-loops) (~0.5d) [flowos: 0a49ab36-5499-400d-abd8-7f07204461d1]
- [x] Implement Tier 1 ELK layout & SVG renderer passing Gate 1 and Gate 2 (~1d) [flowos: 39ff3631-e272-46a2-b8db-a792d1d0ecc5]
- [x] Gate 3 VLM critic check & Gate 4 Human Spot-Check on `gallery-tier-1.html` (~0.5d) [flowos: d50fb8f5-fb9b-41b4-b8a2-3ee6c8d36881]

## Phase 2: Tier 2 — Rich Transitions & State Compartments [flowos: 9d3d3203-f1ae-4441-afb3-f68b3e789166]

- [x] Curate Tier 2 XState v5 conformance fixtures (guards, priority order, entry/exit actions, internal/targetless, `always`, `after`) (~0.5d) [flowos: f2e6bee6-8834-4825-ae91-7f81de3309df]
- [x] Implement Tier 2 compartments & rich transition rendering passing Gate 1 and Gate 2 (~1.5d) [flowos: df655a49-b881-4e29-badf-65ef6743e6e4]
- [x] Gate 3 VLM critic check & Gate 4 Human Spot-Check on `gallery-tier-2.html` (~0.5d) [flowos: 02afda50-c3bb-403c-a8f8-c87115fe0f0b]

## Phase 3: Tier 3 — Hierarchical (Compound) Statecharts [flowos: 403febb8-13cd-47f8-b1f1-b7c22e48ffd3]

- [x] Curate Tier 3 XState v5 conformance fixtures (compound hierarchy, multi-level nesting, cross-boundary transitions, `onDone`) (~0.5d) [flowos: 6a67c357-2e53-46b6-903b-3307ba0316b9]
- [x] Implement Tier 3 compound hierarchical ELK layout & SVG rendering passing Gate 1 and Gate 2 (~1.5d) [flowos: 4bafb569-eff1-44da-8c29-42fa28afd5ba]
- [x] Gate 3 VLM critic check & Gate 4 Human Spot-Check on `gallery-tier-3.html` (~0.5d) [flowos: 58f18b84-cc7e-4221-81d6-25fa4b9aee86]

## Phase 4: Tier 4 — Parallel Regions, History & Invoked Actors [flowos: 9b74eb1f-1229-43e4-8065-226cf22e8a26]

- [x] Curate Tier 4 XState v5 conformance fixtures (parallel regions, shallow/deep history, multi-target forks, `invoke` actors) (~0.5d) [flowos: 5d8ffce2-2b65-45a7-993f-a12cef32e2a2]
- [x] Implement Tier 4 parallel dashed regions, `H`/`H*` history nodes, hyperedges, and `invoke` compartments passing Gate 1 and Gate 2 (~2d) [flowos: 3c7bbaa5-f7cf-4208-9f71-976dd093b6c8]
- [x] Gate 3 VLM critic check & Final Gate 4 Human Spot-Check on `gallery-tier-4.html` (~0.5d) [flowos: 0562236c-ae23-49af-986c-0d110a6ddc17]

## Phase 5: Holistic Compactness & Aspect-Ratio Optimization [flowos: 9e95f623-0393-48ed-9d1f-c7c4533de55c]

- [x] Implement multi-line stacked transition cards & adaptive `DOWN`/`RIGHT` layout selection across nested containers (~1.5d) [flowos: f8013028-5701-4044-a876-4aed69027207]
- [x] Enforce Gate 2 compactness/aspect-ratio budgets & full-corpus Gate 3/4 visual review (~0.5d) [flowos: 9fb6a2e6-1f48-4128-869e-c1bcfd165a6d]

---

## Track: Replace Mermaid Compiler with ELK/SVG Statechart Engine [flowos: 4ae829d4-c313-4213-8ce4-bff0ffd0c4e4]

### Phase 1: Repository Replacement, Renaming & CI Migration [flowos: 580e2cf1-48e0-4447-a7ff-e1ce4c33d111]

- [x] Create isolated worktree on xstate-diagram, replace Mermaid tree with renamed xstate-diagram SVG engine, harvest XState core specs, port GitHub Actions CI, and author TECH_DEBT.md (~0.3d) [flowos: 56740c2e-40c3-4f4f-ada9-45775255a6b8]
- [x] Verify full 89-test Gate 1 + Gate 2 suite under renamed xstate-diagram package/CLI and commit on migration branch (~0.2d) [flowos: 2d73f54b-e993-4d0b-9679-08469aaaa1af]

### Phase 2: PR Verification, Main Cutover & Local Sync [flowos: 225a6b51-e4ef-4a2d-a68a-89ff2d3a4635]

- [x] Push archive tag & PR, verify Ubuntu GitHub Actions CI, merge to main, watch main CI, and sync local checkout (~0.2d) [flowos: 5c2c370d-2634-4ca7-b9d6-98c9bb1aa8fa]

---

## Track: Release Strategy, Packaging & Multi-Channel Distribution

### Phase 1: npm Packaging & CLI Ergonomics
- [x] Add `tsconfig.build.json`, `"exports"` map, `"files"` whitelist (`2.4 MB` $\to$ `126 kB` tarball), and `prepack` script in `package.json`
- [x] Upgrade `src/cli.ts` to render `.ts` / `.js` / `.mjs` XState machine modules directly (`--export`, `--version`) in addition to `.json` and `stdin`

### Phase 2: CI/CD Release Automation, Composite GitHub Action & Web Playground
- [x] Add root `action.yml` composite GitHub Action (`uses: emmby/xstate-diagram@v0.2.0`)
- [x] Add `.github/workflows/release.yml` for tag-triggered 4-Gate verification, GitHub Releases, and npm publishing with provenance
- [x] Add `scripts/build-playground.ts` and `.github/workflows/pages.yml` for zero-install interactive browser playground on GitHub Pages
