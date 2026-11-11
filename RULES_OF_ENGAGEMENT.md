# Rules of Engagement & Closed-Loop Verification Protocol

This document governs how autonomous agents (`@harness`, `@renderer`, `@critic`) collaborate to build and verify `xstate-diagram`. Every agent MUST read both `ARCHITECTURE.md` and `RULES_OF_ENGAGEMENT.md` before taking action.

---

## 1. Adversarial Separation of Ownership (Anti-Gaming Law)

To guarantee that passing tests reflect genuine SVG correctness and visual clarity—and never weakened assertions—file ownership is strictly partitioned by role:

| Swarm Role | Owned Paths | Strictly Forbidden Paths | Responsibilities |
|---|---|---|---|
| **`@harness`** | `src/ast/**`<br>`src/verifier/**`<br>`tests/**`<br>`scripts/**`<br>`package.json`<br>`tsconfig.json` | `src/renderer/**` | Builds `extractFromMachine`, `extractFromSvg`, the Playwright Geometric Linter, the XState v5 conformance fixture suites (Tiers 1–4), and the `gallery.html` generator. |
| **`@renderer`** | `src/renderer/**`<br>`src/index.ts`<br>`src/cli.ts` | `src/ast/**`<br>`src/verifier/**`<br>`tests/**` | Implements pure-JS text/box measurement, `StatechartAST` $\to$ `elkjs` graph translation, port allocation, orthogonal/rounded path routing, SVG rendering, and the standalone CLI entrypoint. |
| **`@critic`** | Read-only across `src/**` & `tests/**` (writes only temporary inspection scripts/screenshots in `dist/`) | Editing any production or test code (`src/**`, `tests/**`) | Runs the test suite, rasterizes `dist/gallery-tier-N.html` to PNG, performs blind visual readback, audits aesthetic quality, and posts defects to `@renderer` or `@harness`. |

### Hard Invariants
1. **No Detuning Tests:** `@harness` and `@renderer` may NEVER relax a geometric threshold (e.g., allowing overlaps or increasing endpoint distance tolerances) or skip a conformance test case to make CI green.
2. **No Lying DOM Attributes:** `@renderer` must never emit `data-*` attributes that contradict the rendered SVG geometry or text content. Gate 1 cross-checks `data-*` attributes against actual browser `getBBox()`, `getPointAtLength()`, and visible text.

---

## 2. The Four Verification Gates

A tier is complete ONLY when every test fixture in the tier passes Gates 1, 2, and 3, and the coordinator presents `dist/gallery-tier-N.html` to the user for Gate 4.

### Gate 1: Semantic + Geometric Round-Trip Isomorphism (`src/verifier/extract-svg.ts`)
Loaded in headless Chromium via Playwright so all SVG DOM APIs use real layout & font metrics:
1. **AST Reconstruction:** `extractFromSvg(page, svgSelector)` reconstructs a `StatechartAST` from the rendered SVG and asserts `expect(actualAST).toEqual(expectedAST)`.
2. **Anti-Lying Geometry Cross-Checks (enforced inside Gate 1):**
   - **Visibility Check:** Every state box, title text, compartment row, transition path, and transition label must have `width > 0`, `height > 0`, `opacity > 0`, and lie completely inside the root `<svg viewBox>`.
   - **Text Truthfulness:** The reconstructed `key`, `eventType`, `guard`, `actions`, `entryActions`, `exitActions`, and `invocations` must be parsed from the visible `.textContent` of the `<text>` elements (and verified to match the `data-*` attributes).
   - **Physical Endpoint Connectivity:** For every transition `<path>`:
     - Let $P_{\text{start}} = \text{path.getPointAtLength}(0)$ and $P_{\text{end}} = \text{path.getPointAtLength}(\text{totalLength})$.
     - Distance from $P_{\text{start}}$ to the perimeter of `sourceId`'s `.state-box` must be $\le 3.5\text{ px}$.
     - Distance from $P_{\text{end}}$ to the perimeter of `targetId`'s `.state-box` must be $\le 3.5\text{ px}$.
     - `marker-end` must reference a valid `<marker>` definition with non-empty visible geometry.
     - $P_{\text{start}}$ and $P_{\text{end}}$ must be separated by at least $10\text{ px}$ (even for self-loops).
   - **Physical Hierarchy Containment:** If state $C$ has `parentId = P`, the screen bounding box of $C$'s `.state-box` must lie strictly inside the screen bounding box of $P$'s `.state-box`.

### Gate 2: Deterministic Geometric Linter (`src/verifier/geometry-lint.ts`)
Runs in Playwright on every rendered SVG and enforces zero layout defects:
1. **Strict Parent Containment & Header Clearance:**
   - Every child state's bounding box must be inset by at least `8px` from its parent state's `.state-box` border on all four sides.
   - No child state's bounding box may intersect its parent state's title header or compartment rows (`entry`/`exit`/`invoke`/`internal`).
2. **Sibling State Non-Overlap:**
   - For any two sibling states $A$ and $B$ sharing the same `parentId`, their `.state-box` bounding boxes must have zero intersection and a minimum edge-to-edge clearance of $\ge 12\text{ px}$.
3. **Zero Text & Label Collisions:**
   - Collect bounding boxes of all `.state-title`, `.state-compartment text`, `.state-tag`, and `.edge-label-bg` elements.
   - No two text/label bounding boxes may intersect ($\text{intersectionArea} = 0$).
   - No `.edge-label-bg` may intersect any `.state-box` border or `.initial-dot`.
4. **Edge Obstacle Avoidance (No Piercing Unrelated Boxes):**
   - Sample points every `4px` along every transition `<path>` (excluding the first and last `6px` near the source/target border).
   - No sampled interior point of a transition between $S$ and $T$ may fall inside the `.state-box` of any state $U$ unless $U$ is a strict ancestor of $S$ or $T$.
5. **No Collinear Overlapping Edge Segments ("No Highway Merges"):**
   - Extract line segments from all transition `<path>` elements.
   - No two segments belonging to different transitions may be parallel, within `4px` perpendicular distance, and overlap along their projection for more than `8px` (unless they are shared trunk segments of the exact same multi-target hyperedge).
6. **Voronoi / Nearest-Neighbor Label Attribution:**
   - For every transition $e_i$ with label box $L_i$ (center $c_i$):
     - Minimum distance from $L_i$ to its own path $P_i$ must be $\le 14\text{ px}$.
     - For every other transition path $P_j$ ($j \ne i$), the distance from $c_i$ to $P_j$ must be strictly greater than $\text{dist}(c_i, P_i) + 8\text{ px}$.

### Gate 3: VLM Visual Critic, Blind Readback & Reference Semantic Check
Once all tests in the active tier pass Gates 1 and 2:
1. `@harness` generates `dist/gallery-tier-<N>.html` (including official `statelyai/docs` reference PNG thumbnails for any reference-corpus fixtures in that tier) and rasterizes full-resolution PNG screenshots (`dist/tier-<N>-overview.png` and per-fixture PNGs in `dist/tier-<N>/`).
2. `@critic` inspects the PNGs using `read_file` and performs:
   - **Blind Visual Readback:** Reconstruct the states, compartments (`entry`, `exit`, `invoke`, internal targetless transitions, `tags`), guard conditions & priority order, `always` / `after` transitions, and topology purely from the PNG, verifying 100% match with the XState machine.
   - **Official Reference Semantic Comparison:** For fixtures from the `statelyai/docs` ground-truth corpus (`tests/reference-corpus/`), inspect Stately's official reference PNG alongside our rendered PNG to confirm we represent every semantic construct (guards, delays, compartments, hierarchy, parallel regions, history) accurately—without copying Stately's visual theme.
   - **Aesthetic & Readability Check:** Verify compact node proportions, clear divider lines between state headers and compartments, unambiguous transition pill formatting (`EVENT [guard] / actions`), separated bidirectional/self-loop paths, and crisp hierarchy.
3. If `@critic` finds any visual or semantic defect:
   - `@critic` posts the exact fixture ID and coordinate/visual issue to `@renderer` AND asks `@harness` if a new deterministic rule should be added to Gate 2 to catch that class of visual flaw permanently.

### Gate 4: Human Spot-Check Pause (Mandatory Tier Barrier)
- **Never advance to Tier $N+1$ without explicit user approval of Tier $N$.**
- When Tier $N$ passes Gates 1, 2, and 3, the swarm reports completion of Tier $N$ to `@coordinator`, and all workers park in `waiting` state while the user reviews `dist/gallery-tier-<N>.html`.
