# Eventless (`always`) Transitions Implementation Plan [flowos: 76ee480a-0dc5-4d14-ba4b-db62a509555c]

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile XState v5 eventless (`always`) transitions (string shorthand, single transition object, and transition arrays, including guards, actions, targetless self-transitions, and root-level `always`) into Mermaid `stateDiagram-v2` syntax in `xstate-diagram`.

**Architecture:** Extend [`src/compiler.ts`](file:///Users/mike/GitHub/xstate-diagram/src/compiler.ts) with a shared transition-formatting helper (`compileTransition`) invoked for both `stateNode.always` (with an empty event label `""`) and `stateNode.transitions` (`on` and `after`), plus root-level `rootNode.always` detection in `compile()`. Validate via unit tests, 12 promoted `transient_*.json` specs in `specs/supported/`, golden `.mermaid` snapshots in `src/__snapshots__/`, and `npx mmdc` syntax/rendering verification.

**Tech Stack:** TypeScript, Node.js, XState v5 (`xstate`), Jest (`ts-jest`), Mermaid CLI (`@mermaid-js/mermaid-cli` / `mmdc`).

**Spec:** [`docs/superpowers/specs/2026-11-04-always-transitions-design.md`](file:///Users/mike/GitHub/xstate-diagram/docs/superpowers/specs/2026-11-04-always-transitions-design.md)

## Global Constraints

- Do not emit `always` or `xstate.*` as a synthetic event name on the edge label:
  - Unconditional (`always` with no `guard` and no `actions`): `source --> target`
  - Guard only: `source --> target : [guard]`
  - Actions only: `source --> target : / action1, action2`
  - Guard and actions: `source --> target : [guard] / action1, action2`
- Targetless `always` transitions (`t.target` undefined) must default to `[stateNode]` (`source --> source : ...`), matching `on` transitions.
- When the root state node defines `always` transitions (`Array.isArray(rootNode.always) && rootNode.always.length > 0`), `hasRootTransitions` in `compile()` must evaluate to `true` so the root wrapper state is emitted as the transition source.
- Existing golden snapshots in `src/__snapshots__/` must remain 100% unchanged.
- Do not modify any files outside `/Users/mike/GitHub/xstate-diagram`.

## Review Focus

- **Unconditional `always` transition with no guard and no actions** (`"always": "b"` or `"always": [{ "target": "b" }]`): must emit `  a --> b` with no trailing ` : ` colon or whitespace.
- **`always` transition with only a guard or only actions** (`"always": { "target": "b", "guard": "isReady" }` or `"always": { "target": "b", "actions": ["doWork"] }`): must emit `  a --> b : [isReady]` and `  a --> b : / doWork` with a single space after `:` and no leading double-space from an empty event name.
- **Object-typed guard and action definitions on `always` transitions** (`"guard": { "type": "isReady" }`, `"actions": [{ "type": "log" }]`): must extract `.type` identically to `on` transitions.
- **Targetless `always` self-transition** (`"always": { "guard": "check", "actions": ["inc"] }`): must emit `  counting --> counting : [check] / inc` rather than throwing on `undefined` `t.target`.
- **Root-level `always` transition on the machine root** (`"id": "rootMachine", "always": [{ "target": ".done", "guard": "isComplete" }]`): must wrap the root state in `state "rootMachine" as rootMachine { ... }` and emit `  rootMachine --> rootMachine_done : [isComplete]`.

---

## Phase 1: Compiler & Test Suite Implementation [flowos: 8d2c4651-439e-4a7f-94ed-88fd3f824a7e]

### Task 1: Compile eventless (`always`) transitions in `src/compiler.ts` [flowos: daeff96f-84bb-49f2-a90b-fb11137b2f1d]

**Files:**
- Modify: `src/compiler.ts:96-153`
- Modify: `src/cli.test.ts:55-60`

**Interfaces:**
- Consumes: `createMachine` from `xstate`
- Produces: `compile(machine: AnyStateMachine): string` in `src/compiler.ts` supporting `stateNode.always` and `rootNode.always`

- [ ] **Step 1: Write failing unit tests in `src/cli.test.ts` covering all `always` transition forms and Review Focus cases**

Add a `describe('Eventless (always) transitions', ...)` block in `src/cli.test.ts` importing `createMachine` from `'xstate'` and `compile` from `'./compiler'`:

```ts
  describe('Eventless (always) transitions', () => {
    it('compiles string shorthand, guarded, action-only, and guard+action always transitions without leading space or xstate.* artifacts', () => {
      const machine = createMachine({
        id: 'clock',
        initial: 'init',
        states: {
          init: {
            always: [
              { target: 'connect', guard: 'needsDailySync', actions: ['logSync', { type: 'markSync' }] },
              { target: 'rtc', guard: { type: 'hasRtc' } },
              { target: 'fallback', actions: ['useFallback'] },
              { target: 'wait' }
            ]
          },
          connect: {
            always: 'rtc'
          },
          rtc: {},
          fallback: {},
          wait: {
            always: {
              guard: 'stillWaiting',
              actions: ['tick']
            }
          }
        }
      });

      expect(compile(machine)).toBe(
        [
          'stateDiagram-v2',
          '  [*] --> clock_init',
          '  state "init" as clock_init',
          '  state "connect" as clock_connect',
          '  state "rtc" as clock_rtc',
          '  state "fallback" as clock_fallback',
          '  state "wait" as clock_wait',
          '',
          '  clock_init --> clock_connect : [needsDailySync] / logSync, markSync',
          '  clock_init --> clock_rtc : [hasRtc]',
          '  clock_init --> clock_fallback : / useFallback',
          '  clock_init --> clock_wait',
          '  clock_connect --> clock_rtc',
          '  clock_wait --> clock_wait : [stillWaiting] / tick',
          ''
        ].join('\n')
      );
    });

    it('wraps root machine state when root defines always transitions', () => {
      const machine = createMachine({
        id: 'rootMachine',
        initial: 'active',
        states: {
          active: {},
          done: { type: 'final' }
        },
        always: [
          { target: '.done', guard: 'isComplete' }
        ]
      });

      expect(compile(machine)).toBe(
        [
          'stateDiagram-v2',
          '  state "rootMachine" as rootMachine {',
          '    [*] --> rootMachine_active',
          '    state "active" as rootMachine_active',
          '    state "done" as rootMachine_done',
          '  }',
          '',
          '  rootMachine_done --> [*]',
          '  rootMachine --> rootMachine_done : [isComplete]',
          ''
        ].join('\n')
      );
    });
  });
```

- [ ] **Step 2: Run Jest to verify the new tests fail while existing tests still pass**

Run: `npx jest -t "Eventless \\(always\\) transitions"`
Expected: FAIL (`clock_init --> clock_connect` and `rootMachine --> rootMachine_done` missing from output).

- [ ] **Step 3: Implement `compileTransition` and `always` handling in `src/compiler.ts`**

In `src/compiler.ts`:
1. Extract transition compilation into `compileTransition(stateNode: AnyStateNode, safeId: string, eventType: string, t: any, transitions: string[]): void` that builds an array of non-empty label parts (`labelParts: string[]`):
   - Map `eventType` (converting `xstate.after.<delay>.*` to `after <delay>`) and push to `labelParts` if non-empty.
   - Extract `guardName` from `t.guard` (string or `{ type }`) and push `[${guardName}]` to `labelParts` if present.
   - Extract `actionNames` from `t.actions` (strings or `{ type }`) and push `/ ${actionNames.join(', ')}` to `labelParts` if non-empty.
   - Join `labelParts.join(' ')` into `edgeLabel` and push `  ${safeId} --> ${getSafeId(targetNode)}${edgeLabel ? ` : ${edgeLabel}` : ''}` to `transitions` for each `targetNode` in `t.target || [stateNode]`.
2. In `compileStateNode`, before iterating `stateNode.transitions`, iterate `stateNode.always` (if `Array.isArray(stateNode.always)`) and call `compileTransition(stateNode, safeId, '', t, transitions)`. Then iterate `stateNode.transitions` calling `compileTransition(stateNode, safeId, eventType, t, transitions)`.
3. In `compile(machine: AnyStateMachine)`, update `hasRootTransitions`:
   ```ts
   const hasRootTransitions =
     Array.from(rootNode.transitions.entries()).some(([_, t]) => t.length > 0) ||
     (Array.isArray(rootNode.always) && rootNode.always.length > 0);
   ```

- [ ] **Step 4: Run the full test suite to verify the new unit tests pass and no existing snapshots changed**

Run: `npm test`
Expected: PASS (all existing 34 supported spec tests + 1 invalid JSON test + 2 new `always` unit tests pass without `UPDATE_SNAPSHOTS`).

- [ ] **Step 5: Commit Task 1**

```bash
git add src/compiler.ts src/cli.test.ts
git commit -m "feat(compiler): compile eventless (always) transitions"
```

---

### Task 2: Promote 12 `transient` specs, generate golden snapshots, and update semantic validation prompt [flowos: 1900676e-dba4-4f06-9106-16a41d5752b9]

**Files:**
- Modify: `prompts/semantic_validation.md:5-8`
- Move: `specs/unsupported/transient/{001,002,003,004,005,007,008,009,010,014,015,021}.json` -> `specs/supported/transient_{001,002,003,004,005,007,008,009,010,014,015,021}.json`
- Create: `src/__snapshots__/transient_{001,002,003,004,005,007,008,009,010,014,015,021}.mermaid`

**Interfaces:**
- Consumes: `compile(machine: AnyStateMachine): string` from Task 1 (`src/compiler.ts`)
- Produces: 12 new golden snapshots in `src/__snapshots__/transient_*.mermaid` validated by `assertValidMermaid` (`npx mmdc`)

- [ ] **Step 1: Update `prompts/semantic_validation.md` to include `always` transitions**

In `prompts/semantic_validation.md`, update rules 1 and 3:
- Rule 1: `1. **Strict No-Omission Rule:** Validate that EVERY semantically meaningful object, nested key, or behavioral block defined in the JSON (including but not limited to \`invoke\`, \`tags\`, \`history\`, \`activities\`, \`meta\`, \`after\`, or \`always\`) is visually accounted for in the Mermaid diagram. If the JSON contains arbitrary behavioral logic that is completely dropped from the output, it is an immediate FAILURE.`
- Rule 3: `3. Validate that EVERY single EVENT transition (the \`on\` property keys), delayed transition (\`after\`), and eventless transition (\`always\`, rendered without an event trigger prefix) from the source exists perfectly between the same two states in the Mermaid output.`

- [ ] **Step 2: Move the 12 clean `transient` specs from `specs/unsupported/transient/` to `specs/supported/`**

Run:
```bash
for n in 001 002 003 004 005 007 008 009 010 014 015 021; do
  git mv "specs/unsupported/transient/${n}.json" "specs/supported/transient_${n}.json"
done
```
Expected: 12 files moved to `specs/supported/transient_*.json`.

- [ ] **Step 3: Run `npm test` to generate and `mmdc`-validate the 12 new `.mermaid` golden snapshots**

Run: `npm test`
Expected: PASS (49 tests total: 34 existing specs + 12 new `transient_*` specs + 1 invalid JSON test + 2 `always` unit tests), and `git diff src/__snapshots__/` shows zero modifications to existing `.mermaid` snapshot files (only 12 new untracked `src/__snapshots__/transient_*.mermaid` files).

- [ ] **Step 4: Build TypeScript (`npm run build`) and verify clean compilation**

Run: `npm run build`
Expected: Exit code `0` with no TypeScript errors.

- [ ] **Step 5: Commit Task 2**

```bash
git add prompts/semantic_validation.md specs/supported/transient_*.json specs/unsupported/transient/ src/__snapshots__/transient_*.mermaid
git commit -m "test(transient): promote 12 always transition specs and golden snapshots"
```
