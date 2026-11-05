# Eventless (`always`) Transitions in `xstate-diagram` — Design Specification

## 1. Intent & Context
We are migrating `ClockMatter` (`AprilClockFSM`) from itemis CREATE to `portable-xstate` and embedding the output of `xstate-diagram` inside a ```` ```mermaid ```` block in `README.md` on GitHub.

Currently, [`src/compiler.ts`](file:///Users/mike/GitHub/xstate-diagram/src/compiler.ts) compiles XState v5 states (flat, hierarchical, parallel, final), `entry`/`exit` actions, `on` event transitions, and `after` delayed transitions with guards and actions, but silently omits eventless (`always`) transitions.

In XState v5, when `createMachine(json)` normalizes a machine definition, eventless transitions defined under `"always"` (whether via string shorthand `"always": "target"`, single transition object `"always": { "target": "..." }`, or transition array `"always": [ ... ]`) are stored on `stateNode.always` as an array of `TransitionDefinition` objects (with `eventType: ""`), separate from `stateNode.transitions` (which is a `Map` of `on` and `after` transitions). Because `src/compiler.ts` only iterates `stateNode.transitions`, all `always` transitions are dropped from the compiled Mermaid `stateDiagram-v2` output.

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
1. **Compile `always` transitions on any state node**: Support all XState v5 `always` JSON forms (string shorthand, single transition object, array of transition objects) across atomic, composite, parallel, and root state nodes.
2. **Consistent edge labeling without internal XState artifacts**:
   - Unconditional (`always` with no `guard` and no `actions`): `source --> target`
   - Guard only: `source --> target : [guard]`
   - Actions only: `source --> target : / action1, action2`
   - Guard and actions: `source --> target : [guard] / action1, action2`
3. **Targetless (`always`) self-transitions**: When an `always` transition omits `target` (e.g., an internal transition with `guard` and/or `actions`), default the target to `[stateNode]` (`source --> source : ...`), matching existing `on` transition behavior.
4. **Root-level `always` transitions**: When the machine root node defines `always` transitions, include `rootNode.always` in the `hasRootTransitions` check in `compile()` so the root machine wrapper state (`state "machine" as machine { ... }`) is emitted as the transition source.
5. **Test suite & visual verification**: Promote the clean `transient` specs from `specs/unsupported/transient/` to `specs/supported/transient_*.json`, generate golden `.mermaid` snapshots in `src/__snapshots__/`, verify `npm test` (`mmdc` syntax check) passes without regressing existing snapshots, and visually inspect the rendered Mermaid diagrams.

### Non-Goals
- **Rewriting/sanitizing multi-line JavaScript AST dumps (`\n`, `;`, `{}`) inside `[Node: ...]` strings**: Several raw XState TypeScript test extractions in `specs/unsupported/transient/` (`011`, `016`, `017`, `020`, `022`) contain multi-statement JavaScript bodies with newlines, semicolons, and braces. Mermaid's `stateDiagram-v2` parser treats `\n` and `;` as statement terminators and `{` as composite state blocks, causing parse errors or phantom floating state boxes. Real `portable-xstate` / `ClockMatter` definitions use clean named identifiers for guards and actions. Those raw AST-dump test files will remain in `specs/unsupported/transient/`.
- **Fixing Mermaid/Dagre layout of parent-to-own-child transitions (`018`, `019`)**: Mermaid's Dagre layout engine renders transitions from a composite state directly to its own child node (`active --> active_a`) overlapping the child box. Those specs (`018`, `019`) will remain in `specs/unsupported/transient/`.
- **Dynamic template literal targets (`012`) or unrelated features (`006` raise-only, `013` invoke-only)**: These remain in `specs/unsupported/transient/`.

### Anti-Goals
- **Do not emit `always` or `xstate.*` as a synthetic event name on the edge label**: Eventless transitions in UML / statecharts and Mermaid `stateDiagram-v2` have no event trigger name; their label starts directly with `[guard]` or `/ action` (or no colon/label at all when unconditional).
- **Do not alter existing golden snapshots**: Existing snapshots in `src/__snapshots__/` must remain 100% unchanged.

## 3. Constraints
- Must preserve compatibility with the existing two-pass transition hoisting architecture in [`src/compiler.ts`](file:///Users/mike/GitHub/xstate-diagram/src/compiler.ts), where all state declarations are emitted first and all transitions are appended to the `transitions: string[]` accumulator at the end of the diagram.
- Must pass `npm test` (Jest golden snapshot comparison + `npx mmdc` Puppeteer rendering check in [`src/test-helper.ts`](file:///Users/mike/GitHub/xstate-diagram/src/test-helper.ts)).
- Must satisfy the semantic validation rules in [`prompts/semantic_validation.md`](file:///Users/mike/GitHub/xstate-diagram/prompts/semantic_validation.md) and `./scripts/validate_pr.sh`.

## 4. Technical Design

### 4.1 Compiler Changes (`src/compiler.ts`)

1. **Transition Formatting Helper (Builder's call on exact helper structure)**:
   In `compileStateNode`, both `stateNode.always` (an array of `TransitionDefinition` objects) and `stateNode.transitions` (a `Map<string, TransitionDefinition[]>`) share the exact same target, guard, and action resolution rules:
   - **Targets**: `const targets = t.target || [stateNode];`
   - **Event label**:
     - For `stateNode.always`: empty (`""`).
     - For `stateNode.transitions`: `eventType`, with `xstate.after.<delay>.*` mapped to `after <delay>`.
   - **Guard**:
     - Extract `guardName` via `typeof t.guard === 'string' ? t.guard : (t.guard && typeof t.guard === 'object' && 'type' in t.guard ? String(t.guard.type) : undefined)`.
     - Append `[${guardName}]` to the label components if present.
   - **Actions**:
     - Extract `actionNames` from `t.actions` via `typeof a === 'string' ? a : (a && typeof a === 'object' && 'type' in a ? String(a.type) : undefined)`.
     - Append `/ ${actionNames.join(', ')}` to the label components if non-empty.
   - **Joining Label Parts**:
     - Join non-empty label parts (`eventLabel`, `[${guardName}]`, `/ ${actionNames.join(', ')}`) with a single space `' '`.
     - Notice that for `on` and `after` transitions where `eventLabel` is non-empty, joining non-empty parts with `' '` produces the exact same string as the current `edgeLabel += ...` logic (`EVENT [guard] / a1, a2`), while for `always` transitions where `eventLabel` is empty, it cleanly produces `[guard]`, `/ a1, a2`, `[guard] / a1, a2`, or `""` without a leading space!
   - **Edge Emission**:
     - `transitions.push(\`  \${safeId} --> \${getSafeId(targetNode)}\${edgeLabel ? \` : \${edgeLabel}\` : ''}\`);`

2. **Ordering of `always` vs `on`/`after` Transitions on a State Node (Builder's call)**:
   - Within `compileStateNode`, iterate `stateNode.always` (if `Array.isArray(stateNode.always)`) and `stateNode.transitions`.
   - Emitting `stateNode.always` before `stateNode.transitions` (or after) is deterministic; emitting `stateNode.always` first (before `stateNode.transitions`) naturally reflects XState's evaluation order (eventless transitions are evaluated immediately upon entering a state before waiting for events) and has zero impact on existing snapshots since no existing supported spec contains `always`.

3. **Root-Level `always` Detection in `compile()`**:
   - Update `hasRootTransitions` in `compile(machine: AnyStateMachine)`:
     ```ts
     const hasRootTransitions =
       Array.from(rootNode.transitions.entries()).some(([_, t]) => t.length > 0) ||
       (Array.isArray(rootNode.always) && rootNode.always.length > 0);
     ```

### 4.2 Semantic Validation Prompt Update (`prompts/semantic_validation.md`)
Update item 1 and item 3 in `prompts/semantic_validation.md` so the LLM validator recognizes `always` (eventless) transitions:
- Item 1: Include `always` in the list of semantically meaningful behavioral blocks (`invoke`, `tags`, `history`, `activities`, `meta`, `after`, or `always`).
- Item 3: Specify that every `on` event transition, `after` delayed transition, and `always` eventless transition (rendered without an event name prefix, e.g. `source --> target` or `source --> target : [guard] / action`) must exist between the same source and target states in the Mermaid output.

### 4.3 Test Specs to Promote (`specs/unsupported/transient/` -> `specs/supported/`)
Move the following 12 clean `always` specifications from `specs/unsupported/transient/{num}.json` to `specs/supported/transient_{num}.json` using `git mv` and generate their corresponding `.mermaid` snapshots in `src/__snapshots__/transient_{num}.mermaid`:

| Spec | XState `always` Features Covered |
|------|----------------------------------|
| `transient_001.json` | Array of `always` transitions with guards and unconditional fallback, plus root `on` transitions |
| `transient_002.json` | Event transition into transient state `E` with guarded + unguarded `always` array |
| `transient_003.json` | Event transition into transient state `E` with two guarded `always` branches |
| `transient_004.json` | Same structure as `002` with `data: true` initial context |
| `transient_005.json` | Single-element `always` array (`"always": [{ "target": "B" }]`) between states with `entry`/`exit` actions |
| `transient_007.json` | Parallel state machine combining string shorthand `"always": "A3"` and guarded object `"always": { "target": "...", "guard": "..." }` across regions |
| `transient_008.json` | Parallel 3-region machine with guarded `always` object transitions |
| `transient_009.json` | String shorthand `"always": "c"` alongside `entry` action and `on` transitions on the same state |
| `transient_010.json` | String shorthand `"always": "pass"` alongside wildcard `"*"` transition |
| `transient_014.json` | Single object `"always": { "target": "b", "guard": "..." }` |
| `transient_015.json` | Chained single-object guarded `always` transitions (`a --> b` -> `b --> c`) |
| `transient_021.json` | Targetless self-transition `"always": { "guard": "...", "actions": "..." }` (`counting --> counting : [guard] / action`) |

*(Note: All 12 of these specs were rendered to PNG via `npx mmdc` during design exploration and visually verified to render cleanly with no phantom nodes or overlapping edges.)*

## 5. What's Left to the Builder
- Whether to extract a small helper function (e.g., `compileTransition(...)`) in `src/compiler.ts` or normalize `always` and `transitions` into a single iterable inside `compileStateNode`.
- Running `npm test` (first without `UPDATE_SNAPSHOTS` to confirm existing tests pass, then with `UPDATE_SNAPSHOTS=1` to write the new `transient_*.mermaid` snapshots) and running `./scripts/validate_pr.sh` if preparing a PR.
