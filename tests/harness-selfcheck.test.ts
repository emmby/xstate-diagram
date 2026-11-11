import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assign, createMachine } from 'xstate';
import { extractFromMachine } from '../src/ast/extract-machine.js';
import { renderMachineToSvg } from '../src/index.js';
import { inspectGate1 } from '../src/verifier/extract-svg.js';
import { lintSvgGeometry } from '../src/verifier/geometry-lint.js';

const execFileAsync = promisify(execFile);

describe('Phase 0 Harness Self-Check (AST Normalization + Adversarial Gate 1/2 Negative Tests)', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  });

  afterAll(async () => {
    await page?.close();
    await browser?.close();
  });

  it('extractFromMachine normalizes delays, always, onDone, invoke, internal rows, and filters synthetic after actions', () => {
    const machine = createMachine({
      id: 'checkout',
      initial: 'editing',
      states: {
        editing: {
          entry: ['initCart', assign({ items: [] })],
          exit: ['saveDraft'],
          tags: ['interactive'],
          after: {
            30000: { target: 'timedOut' },
            SESSION_WARN: { actions: 'warnUser' },
          },
          on: {
            UPDATE_QTY: {
              guard: 'isPositive',
              actions: ['recalculate'],
            },
            SUBMIT: {
              guard: 'hasItems',
              target: 'submitting',
              actions: ['lockCart'],
            },
          },
        },
        submitting: {
          invoke: {
            src: 'chargeCard',
            onDone: { target: 'verifying' },
            onError: { target: 'editing' },
          },
        },
        verifying: {
          initial: 'checking',
          onDone: { target: 'complete' },
          states: {
            checking: {
              always: [
                { guard: 'isApproved', target: 'verified' },
                { target: '#checkout.editing' },
              ],
            },
            verified: { type: 'final' },
          },
        },
        timedOut: { type: 'final' },
        complete: { type: 'final' },
      },
    });

    const ast = extractFromMachine(machine);
    expect(ast.machineId).toBe('checkout');
    expect(ast.rootInitialTargetId).toBe('checkout.editing');

    const editing = ast.nodes['checkout.editing'];
    // Synthetic xstate.raise / xstate.cancel from `after` MUST NOT pollute entry/exit
    expect(editing.entryActions).toEqual(['initCart', 'assign(items)']);
    expect(editing.exitActions).toEqual(['saveDraft']);
    expect(editing.tags).toEqual(['interactive']);

    // Targetless transitions (`UPDATE_QTY` and `after(SESSION_WARN)`) go to internalTransitions
    expect(editing.internalTransitions).toEqual([
      {
        eventType: 'UPDATE_QTY',
        order: 0,
        guard: 'isPositive',
        actions: ['recalculate'],
      },
      {
        eventType: 'after(SESSION_WARN)',
        order: 0,
        guard: null,
        actions: ['warnUser'],
      },
    ]);

    // External transitions normalized cleanly
    const submittingEdges = ast.transitions.filter(
      (t) => t.sourceId === 'checkout.submitting',
    );
    expect(submittingEdges.map((t) => t.eventType)).toEqual([
      'onDone(chargeCard)',
      'onError(chargeCard)',
    ]);

    const checkingAlways = ast.transitions.filter(
      (t) => t.sourceId === 'checkout.verifying.checking' && t.eventType === 'always',
    );
    expect(checkingAlways).toHaveLength(2);
    expect(checkingAlways[0]).toMatchObject({
      order: 0,
      guard: 'isApproved',
      targetIds: ['checkout.verifying.verified'],
    });
    expect(checkingAlways[1]).toMatchObject({
      order: 1,
      guard: null,
      targetIds: ['checkout.editing'],
    });
  });

  it('Gate 1 catches lying DOM attributes when visible text contradicts data-state-key or data-edge-event', async () => {
    const svg = await renderMachineToSvg({
      id: 'lieTest',
      initial: 'idle',
      states: {
        idle: { on: { GO: 'active' } },
        active: {},
      },
    });

    // Mutate visible state title text without changing data-state-key
    const lyingSvg = svg.replace('>idle</text>', '>SPOOFED</text>');
    await page.setContent(`<html><body>${lyingSvg}</body></html>`, { waitUntil: 'load' });
    const res = await inspectGate1(page, 'svg');
    expect(res.violations.some((v) => v.rule === 'text-truthfulness')).toBe(true);
  });

  it('Gate 1 catches detached transition endpoints (> 3.5px from state-box perimeter)', async () => {
    const svg = await renderMachineToSvg({
      id: 'detachTest',
      initial: 'idle',
      states: {
        idle: { on: { GO: 'active' } },
        active: {},
      },
    });

    await page.setContent(`<html><body>${svg}</body></html>`, { waitUntil: 'load' });
    await page.evaluate(() => {
      document.querySelector('path.edge-path')?.setAttribute('d', 'M 5 5 L 20 5');
    });
    const res = await inspectGate1(page, 'svg');
    expect(res.violations.some((v) => v.rule === 'endpoint-connectivity')).toBe(true);
  });

  it('Gate 2 catches overlapping sibling states and piercing edges', async () => {
    const config = {
      id: 'pierceTest',
      initial: 'a',
      states: {
        a: { on: { JUMP: 'c' } },
        b: {},
        c: {},
      },
    };
    const ast = extractFromMachine(config);
    const craftedBadSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="400" height="200" data-machine-id="pierceTest">
        <defs>
          <marker id="arrow-transition" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6 Z" fill="#333" />
          </marker>
        </defs>
        <g class="state-node" data-state-id="pierceTest.a" data-state-key="a" data-state-type="atomic" data-parent-id="" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="20" y="60" width="80" height="40" />
          <text class="state-title" x="60" y="84">a</text>
        </g>
        <g class="state-node" data-state-id="pierceTest.b" data-state-key="b" data-state-type="atomic" data-parent-id="" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="150" y="60" width="80" height="40" />
          <text class="state-title" x="190" y="84">b</text>
        </g>
        <g class="state-node" data-state-id="pierceTest.c" data-state-key="c" data-state-type="atomic" data-parent-id="" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="225" y="60" width="80" height="40" />
          <text class="state-title" x="265" y="84">c</text>
        </g>
        <g class="transition-edge" data-edge-id="pierceTest.a__JUMP__0" data-edge-source="pierceTest.a" data-edge-targets="pierceTest.c" data-edge-event="JUMP" data-edge-order="0" data-edge-guard="" data-edge-actions="">
          <path class="edge-path" d="M 100 80 L 225 80" stroke="#333" marker-end="url(#arrow-transition)" />
          <g class="edge-label">
            <rect class="edge-label-bg" x="110" y="70" width="40" height="20" />
            <text class="edge-label-text" x="130" y="84">JUMP</text>
          </g>
        </g>
      </svg>
    `;
    await page.setContent(`<html><body>${craftedBadSvg}</body></html>`, {
      waitUntil: 'load',
    });
    const g2 = await lintSvgGeometry(page, 'svg', ast);
    expect(g2.passed).toBe(false);
    expect(g2.violations.some((v) => v.rule === 'sibling-overlap-clearance')).toBe(true);
    expect(g2.violations.some((v) => v.rule === 'edge-obstacle-piercing')).toBe(true);
  });

  it('Standalone CLI converts an input JSON machine config into a valid SVG file', async () => {
    const tmpDir = path.resolve(process.cwd(), '.tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const inputPath = path.join(tmpDir, 'cli-smoke.json');
    const outputPath = path.join(tmpDir, 'cli-smoke.svg');
    await fs.writeFile(
      inputPath,
      JSON.stringify({
        id: 'cliSmoke',
        initial: 'ready',
        states: {
          ready: { on: { RUN: 'done' } },
          done: { type: 'final' },
        },
      }),
      'utf8',
    );

    const cliJs = path.resolve(process.cwd(), 'dist/cli.js');
    await execFileAsync(process.execPath, [cliJs, inputPath, '-o', outputPath]);
    const svgOut = await fs.readFile(outputPath, 'utf8');
    expect(svgOut).toContain('<svg');
    expect(svgOut).toContain('data-machine-id="cliSmoke"');
  });

  it('Gate 1 catches missing [#N] priority prefix when multiple branches share an event', async () => {
    const svg = await renderMachineToSvg({
      id: 'prioLie',
      initial: 'check',
      states: {
        check: {
          on: {
            EVAL: [
              { guard: 'isHigh', target: 'high' },
              { target: 'low' },
            ],
          },
        },
        high: { type: 'final' },
        low: { type: 'final' },
      },
    });

    // Strip visible [#1] prefix in rendered DOM while leaving data-edge-order="0" intact
    await page.setContent(`<html><body>${svg}</body></html>`, { waitUntil: 'load' });
    await page.evaluate(() => {
      const labelEl = document.querySelector('text.edge-label-text');
      if (labelEl && labelEl.textContent) {
        labelEl.textContent = labelEl.textContent.replace(/^\[#\d+\]\s*/, '');
      }
    });
    const res = await inspectGate1(page, 'svg');
    expect(res.violations.some((v) => v.rule === 'text-truthfulness')).toBe(true);
  });

  it('Gate 1 catches missing or invisible .state-divider on compartmented states', async () => {
    const svg = await renderMachineToSvg({
      id: 'dividerLie',
      initial: 'working',
      states: {
        working: {
          entry: ['startJob'],
          tags: ['busy'],
          on: { DONE: 'finished' },
        },
        finished: { type: 'final' },
      },
    });

    await page.setContent(`<html><body>${svg}</body></html>`, { waitUntil: 'load' });
    await page.evaluate(() => {
      document.querySelector('.state-divider')?.setAttribute('opacity', '0');
    });
    const res = await inspectGate1(page, 'svg');
    expect(res.violations.some((v) => v.rule === 'visibility')).toBe(true);
  });

  it('Gate 1 catches child state box or compound initial-indicator escaping its parent container', async () => {
    const craftedEscapingHierarchySvg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 300" width="500" height="300" data-machine-id="escapeTest">
        <defs>
          <marker id="arrow-initial" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#0F172A" />
          </marker>
        </defs>
        <g class="state-node" data-state-id="escapeTest.parent" data-state-key="parent" data-state-type="compound" data-parent-id="" data-initial-target="escapeTest.parent.child" data-history-kind="">
          <rect class="state-box" x="40" y="30" width="200" height="180" rx="10" />
          <text class="state-title" x="140" y="50">parent</text>
          <line class="state-divider" x1="40" y1="64" x2="240" y2="64" stroke="#CBD5E1" stroke-width="1" />
        </g>
        <g class="state-node" data-state-id="escapeTest.parent.child" data-state-key="child" data-state-type="atomic" data-parent-id="escapeTest.parent" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="280" y="100" width="90" height="44" rx="8" />
          <text class="state-title" x="325" y="122">child</text>
        </g>
        <g class="initial-indicator" data-parent-id="escapeTest.parent" data-target-id="escapeTest.parent.child">
          <circle class="initial-dot" cx="15" cy="122" r="5" />
          <path class="initial-edge" d="M 20 122 L 280 122" stroke="#0F172A" marker-end="url(#arrow-initial)" />
        </g>
      </svg>
    `;
    await page.setContent(`<html><body>${craftedEscapingHierarchySvg}</body></html>`, {
      waitUntil: 'load',
    });
    const res = await inspectGate1(page, 'svg');
    const containmentViolations = res.violations.filter(
      (v) => v.rule === 'hierarchy-containment',
    );
    expect(containmentViolations.length).toBeGreaterThanOrEqual(2);
  });

  it('Gate 2 catches <8px parent inset, parent header-zone intrusion, and label straddling compound border', async () => {
    const config = {
      id: 'hierLint',
      initial: 'outside',
      states: {
        outside: { on: { DEEP_IN: 'box.inner' } },
        box: {
          initial: 'inner',
          states: {
            inner: {},
          },
        },
      },
    };
    const ast = extractFromMachine(config);
    const craftedBadHierarchySvg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300" width="600" height="300" data-machine-id="hierLint">
        <defs>
          <marker id="arrow-transition" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6 Z" fill="#334155" />
          </marker>
        </defs>
        <g class="state-node" data-state-id="hierLint.outside" data-state-key="outside" data-state-type="atomic" data-parent-id="" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="20" y="110" width="90" height="44" rx="8" />
          <text class="state-title" x="65" y="134">outside</text>
        </g>
        <g class="state-node" data-state-id="hierLint.box" data-state-key="box" data-state-type="compound" data-parent-id="" data-initial-target="hierLint.box.inner" data-history-kind="">
          <rect class="state-box" x="200" y="40" width="260" height="200" rx="10" />
          <text class="state-title" x="330" y="62">box</text>
          <line class="state-divider" x1="200" y1="80" x2="460" y2="80" stroke="#CBD5E1" stroke-width="1" />
        </g>
        <!-- Child inset only 3px from left wall AND intruding above y=80 header divider -->
        <g class="state-node" data-state-id="hierLint.box.inner" data-state-key="inner" data-state-type="atomic" data-parent-id="hierLint.box" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="203" y="72" width="100" height="44" rx="8" />
          <text class="state-title" x="253" y="96">inner</text>
        </g>
        <!-- Transition label pill straddling hierLint.box left border at x=200 -->
        <g class="transition-edge" data-edge-id="hierLint.outside__DEEP_IN__0" data-edge-source="hierLint.outside" data-edge-targets="hierLint.box.inner" data-edge-event="DEEP_IN" data-edge-order="0" data-edge-guard="" data-edge-actions="">
          <path class="edge-path" d="M 110 132 L 253 132 L 253 116" fill="none" stroke="#334155" marker-end="url(#arrow-transition)" />
          <g class="edge-label">
            <rect class="edge-label-bg" x="175" y="120" width="60" height="24" rx="5" />
            <text class="edge-label-text" x="205" y="135">DEEP_IN</text>
          </g>
        </g>
      </svg>
    `;
    await page.setContent(`<html><body>${craftedBadHierarchySvg}</body></html>`, {
      waitUntil: 'load',
    });
    const g2 = await lintSvgGeometry(page, 'svg', ast);
    expect(g2.passed).toBe(false);
    expect(g2.violations.some((v) => v.rule === 'parent-containment-inset')).toBe(true);
    expect(g2.violations.some((v) => v.rule === 'parent-header-clearance')).toBe(true);
    expect(g2.violations.some((v) => v.rule === 'label-border-collision')).toBe(true);
  });

  it('Gate 1 & Gate 2 catch undashed parallel child regions and illegal initial-indicator on parallel states', async () => {
    const config = {
      id: 'parLie',
      type: 'parallel' as const,
      states: {
        regA: {},
        regB: {},
      },
    };
    const ast = extractFromMachine(config);
    const badParallelSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 260" width="500" height="260" data-machine-id="parLie">
        <defs>
          <marker id="arrow-initial" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#0F172A" />
          </marker>
        </defs>
        <g class="state-node" data-state-id="parLie" data-state-key="parLie" data-state-type="parallel" data-parent-id="" data-initial-target="parLie.regA" data-history-kind="">
          <rect class="state-box" x="20" y="20" width="440" height="200" rx="10" fill="#F8FAFC" stroke="#475569" />
          <text class="state-title" x="240" y="42">parLie</text>
          <line class="state-divider" x1="20" y1="58" x2="460" y2="58" stroke="#CBD5E1" stroke-width="1" />
        </g>
        <!-- Missing stroke-dasharray on parallel region regA! -->
        <g class="state-node" data-state-id="parLie.regA" data-state-key="regA" data-state-type="atomic" data-parent-id="parLie" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="48" y="88" width="160" height="90" rx="8" fill="#FAFAFA" stroke="#64748B" />
          <text class="state-title" x="128" y="135">regA</text>
        </g>
        <g class="state-node" data-state-id="parLie.regB" data-state-key="regB" data-state-type="atomic" data-parent-id="parLie" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="260" y="88" width="160" height="90" rx="8" fill="#FAFAFA" stroke="#64748B" stroke-dasharray="6 4" />
          <text class="state-title" x="340" y="135">regB</text>
        </g>
        <!-- Illegal initial-indicator on a parallel state! -->
        <g class="initial-indicator" data-parent-id="parLie" data-target-id="parLie.regA">
          <circle class="initial-dot" cx="34" cy="133" r="4" fill="#0F172A" />
          <path class="initial-edge" d="M 38 133 L 48 133" stroke="#0F172A" marker-end="url(#arrow-initial)" />
        </g>
      </svg>
    `;
    await page.setContent(`<html><body>${badParallelSvg}</body></html>`, {
      waitUntil: 'load',
    });
    const g1 = await inspectGate1(page, 'svg');
    expect(g1.violations.some((v) => v.rule === 'visibility' && v.message.includes('dashed border'))).toBe(true);
    expect(g1.violations.some((v) => v.rule === 'text-truthfulness' && v.message.includes('Parallel state'))).toBe(true);

    const g2 = await lintSvgGeometry(page, 'svg', ast);
    expect(g2.violations.some((v) => v.rule === 'parallel-region-dashed')).toBe(true);
  });

  it('Gate 1 catches lying history kind/shape, lying invoke row text, and incomplete multi-target hyperedge branches', async () => {
    const badTier4Svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 300" width="620" height="300" data-machine-id="forkLie">
        <defs>
          <marker id="arrow-transition" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6 Z" fill="#334155" />
          </marker>
        </defs>
        <g class="state-node" data-state-id="forkLie.src" data-state-key="src" data-state-type="atomic" data-parent-id="" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="20" y="80" width="180" height="90" rx="8" fill="#FFFFFF" stroke="#334155" />
          <text class="state-title" x="110" y="102">src</text>
          <line class="state-divider" x1="20" y1="114" x2="200" y2="114" stroke="#CBD5E1" stroke-width="1" />
          <g class="state-compartment" data-compartment="invoke">
            <!-- Lying invoke text: claims otherActor instead of realActor -->
            <text x="30" y="136" data-invoke-id="worker" data-invoke-src="realActor">invoke / worker: SPOOFED</text>
          </g>
        </g>
        <!-- History node rendered as sharp square (rx=2) AND visible "H" lying about data-history-kind="deep" -->
        <g class="state-node" data-state-id="forkLie.hist" data-state-key="history" data-state-type="history" data-parent-id="" data-initial-target="" data-history-kind="deep">
          <rect class="state-box" x="340" y="60" width="32" height="32" rx="2" fill="#FEF3C7" stroke="#D97776" />
          <text class="state-title" x="356" y="80">H</text>
        </g>
        <g class="state-node" data-state-id="forkLie.t2" data-state-key="t2" data-state-type="atomic" data-parent-id="" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="340" y="170" width="100" height="44" rx="8" fill="#FFFFFF" stroke="#334155" />
          <text class="state-title" x="390" y="196">t2</text>
        </g>
        <!-- Multi-target hyperedge claiming 2 targets [forkLie.hist, forkLie.t2] but only rendering 1 branch path! -->
        <g class="transition-edge" data-edge-id="forkLie.src__FORK__0" data-edge-source="forkLie.src" data-edge-targets="forkLie.hist,forkLie.t2" data-edge-event="FORK" data-edge-order="0" data-edge-guard="" data-edge-actions="">
          <path class="edge-path" d="M 200 125 L 340 76" fill="none" stroke="#334155" marker-end="url(#arrow-transition)" />
          <g class="edge-label">
            <rect class="edge-label-bg" x="245" y="90" width="48" height="20" rx="4" />
            <text class="edge-label-text" x="269" y="104">FORK</text>
          </g>
        </g>
      </svg>
    `;
    await page.setContent(`<html><body>${badTier4Svg}</body></html>`, {
      waitUntil: 'load',
    });
    const g1 = await inspectGate1(page, 'svg');
    expect(g1.violations.some((v) => v.rule === 'visibility' && v.elementId === 'state-box:forkLie.hist')).toBe(true);
    expect(g1.violations.some((v) => v.rule === 'text-truthfulness' && v.elementId === 'forkLie.hist')).toBe(true);
    expect(g1.violations.some((v) => v.rule === 'text-truthfulness' && v.elementId === 'forkLie.src')).toBe(true);
    expect(g1.violations.some((v) => v.rule === 'marker-validity' && v.elementId === 'forkLie.src__FORK__0')).toBe(true);
  });

  it('Gate 2 catches inverted circle arrowhead tangents and short terminal circle-piercing hooks', async () => {
    const config = {
      id: 'histHook',
      initial: 'outside',
      states: {
        outside: { on: { RESUME: 'box.history' } },
        box: {
          initial: 'a',
          states: {
            a: {},
            history: { type: 'history' as const, history: 'shallow' as const },
          },
        },
      },
    };
    const ast = extractFromMachine(config);
    // Circular H at (cx=320, cy=140, r=14). Edge drops inside right hemisphere at x=326, then steps OUTWARD right to (329.8, 150)
    const invertedCircleHookSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 260" width="500" height="260" data-machine-id="histHook">
        <defs>
          <marker id="arrow-transition" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6 Z" fill="#334155" />
          </marker>
        </defs>
        <g class="state-node" data-state-id="histHook.outside" data-state-key="outside" data-state-type="atomic" data-parent-id="" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="20" y="110" width="90" height="44" rx="8" />
          <text class="state-title" x="65" y="134">outside</text>
        </g>
        <g class="state-node" data-state-id="histHook.box" data-state-key="box" data-state-type="compound" data-parent-id="" data-initial-target="histHook.box.a" data-history-kind="">
          <rect class="state-box" x="190" y="30" width="260" height="200" rx="10" />
          <text class="state-title" x="320" y="52">box</text>
          <line class="state-divider" x1="190" y1="68" x2="450" y2="68" stroke="#CBD5E1" stroke-width="1" />
        </g>
        <g class="state-node" data-state-id="histHook.box.a" data-state-key="a" data-state-type="atomic" data-parent-id="histHook.box" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="215" y="165" width="80" height="40" rx="8" />
          <text class="state-title" x="255" y="187">a</text>
        </g>
        <g class="state-node" data-state-id="histHook.box.history" data-state-key="history" data-state-type="history" data-parent-id="histHook.box" data-initial-target="" data-history-kind="shallow">
          <circle class="state-box" cx="320" cy="140" r="14" fill="#FEF3C7" stroke="#D97706" />
          <text class="state-title" x="320" y="141">H</text>
        </g>
        <g class="transition-edge" data-edge-id="histHook.outside__RESUME__0" data-edge-source="histHook.outside" data-edge-targets="histHook.box.history" data-edge-event="RESUME" data-edge-order="0" data-edge-guard="" data-edge-actions="">
          <path class="edge-path" d="M 110 132 L 160 132 L 160 95 L 326 95 L 326 150 L 329.8 150" fill="none" stroke="#334155" marker-end="url(#arrow-transition)" />
          <g class="edge-label">
            <rect class="edge-label-bg" x="210" y="83" width="62" height="22" rx="5" />
            <text class="edge-label-text" x="241" y="96">RESUME</text>
          </g>
        </g>
      </svg>
    `;
    await page.setContent(`<html><body>${invertedCircleHookSvg}</body></html>`, {
      waitUntil: 'load',
    });
    const g2 = await lintSvgGeometry(page, 'svg', ast);
    expect(g2.passed).toBe(false);
    expect(g2.violations.some((v) => v.rule === 'terminal-tangent-direction')).toBe(true);
    expect(g2.violations.some((v) => v.rule === 'edge-obstacle-piercing')).toBe(true);
  });

  it('Gate 1 & Gate 2 catch unmerged hyperedge source ports, missing .fork-junction, and post-fork stranded hyperedge labels', async () => {
    const config = {
      id: 'forkStrand',
      initial: 'lobby',
      states: {
        lobby: {
          on: {
            LAUNCH_BOTH: ['#forkStrand.par.r1.a', '#forkStrand.par.r2.b'],
          },
        },
        par: {
          type: 'parallel' as const,
          states: {
            r1: { initial: 'a', states: { a: {} } },
            r2: { initial: 'b', states: { b: {} } },
          },
        },
      },
    };
    const ast = extractFromMachine(config);
    // Branches start 4px apart on lobby (y=136 vs y=140), omit .fork-junction, and strand the label far downstream on branch 1 only
    const strandedHyperedgeSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 340" width="640" height="340" data-machine-id="forkStrand">
        <defs>
          <marker id="arrow-transition" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6 Z" fill="#334155" />
          </marker>
        </defs>
        <g class="state-node" data-state-id="forkStrand.lobby" data-state-key="lobby" data-state-type="atomic" data-parent-id="" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="20" y="115" width="90" height="50" rx="8" />
          <text class="state-title" x="65" y="142">lobby</text>
        </g>
        <g class="state-node" data-state-id="forkStrand.par" data-state-key="par" data-state-type="parallel" data-parent-id="" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="240" y="20" width="360" height="290" rx="10" />
          <text class="state-title" x="420" y="42">par</text>
          <line class="state-divider" x1="240" y1="58" x2="600" y2="58" stroke="#CBD5E1" stroke-width="1" />
        </g>
        <g class="state-node" data-state-id="forkStrand.par.r1" data-state-key="r1" data-state-type="compound" data-parent-id="forkStrand.par" data-initial-target="forkStrand.par.r1.a" data-history-kind="">
          <rect class="state-box" x="264" y="76" width="312" height="100" rx="8" stroke-dasharray="6 4" />
          <text class="state-title" x="420" y="96">r1</text>
          <line class="state-divider" x1="264" y1="110" x2="576" y2="110" stroke="#CBD5E1" stroke-width="1" />
        </g>
        <g class="state-node" data-state-id="forkStrand.par.r1.a" data-state-key="a" data-state-type="atomic" data-parent-id="forkStrand.par.r1" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="440" y="124" width="90" height="40" rx="8" />
          <text class="state-title" x="485" y="146">a</text>
        </g>
        <g class="state-node" data-state-id="forkStrand.par.r2" data-state-key="r2" data-state-type="compound" data-parent-id="forkStrand.par" data-initial-target="forkStrand.par.r2.b" data-history-kind="">
          <rect class="state-box" x="264" y="194" width="312" height="100" rx="8" stroke-dasharray="6 4" />
          <text class="state-title" x="420" y="214">r2</text>
          <line class="state-divider" x1="264" y1="228" x2="576" y2="228" stroke="#CBD5E1" stroke-width="1" />
        </g>
        <g class="state-node" data-state-id="forkStrand.par.r2.b" data-state-key="b" data-state-type="atomic" data-parent-id="forkStrand.par.r2" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="440" y="242" width="90" height="40" rx="8" />
          <text class="state-title" x="485" y="264">b</text>
        </g>
        <g class="transition-edge" data-edge-id="forkStrand.lobby__LAUNCH_BOTH__0" data-edge-source="forkStrand.lobby" data-edge-targets="forkStrand.par.r1.a,forkStrand.par.r2.b" data-edge-event="LAUNCH_BOTH" data-edge-order="0" data-edge-guard="" data-edge-actions="">
          <path class="edge-path" data-edge-target="forkStrand.par.r1.a" d="M 110 136 L 130 136 L 130 144 L 440 144" fill="none" stroke="#334155" marker-end="url(#arrow-transition)" />
          <path class="edge-path" data-edge-target="forkStrand.par.r2.b" d="M 110 140 L 130 140 L 130 262 L 440 262" fill="none" stroke="#334155" marker-end="url(#arrow-transition)" />
          <!-- Stranded far downstream on branch 1 only (y=144, >100px away from branch 2 at y=262)! -->
          <g class="edge-label">
            <rect class="edge-label-bg" x="310" y="133" width="96" height="22" rx="5" />
            <text class="edge-label-text" x="358" y="146">LAUNCH_BOTH</text>
          </g>
        </g>
      </svg>
    `;
    await page.setContent(`<html><body>${strandedHyperedgeSvg}</body></html>`, {
      waitUntil: 'load',
    });
    const g1 = await inspectGate1(page, 'svg');
    expect(g1.violations.some((v) => v.rule === 'endpoint-connectivity' && v.message.includes('merged source port'))).toBe(true);
    expect(g1.violations.some((v) => v.rule === 'visibility' && v.elementId === 'fork-junction:forkStrand.lobby__LAUNCH_BOTH__0')).toBe(true);

    const g2 = await lintSvgGeometry(page, 'svg', ast);
    expect(g2.passed).toBe(false);
    expect(g2.violations.some((v) => v.rule === 'voronoi-label-attribution' && v.message.includes('shared pre-fork trunk'))).toBe(true);
  });

  it('Gate 1 verifies valid multi-line tspan.edge-label-line cards and catches overlapping stacked lines', async () => {
    const config = {
      id: 'cardCheck',
      initial: 'cart',
      states: {
        cart: {
          on: {
            CHECKOUT: {
              guard: 'hasValidCard',
              target: 'paid',
              actions: ['reserveInventory', 'chargePayment'],
            },
          },
        },
        paid: { type: 'final' as const },
      },
    };
    const expectedAst = extractFromMachine(config);

    // 1. Valid 4-line stacked transition card
    const validCardSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 220" width="540" height="220" data-machine-id="cardCheck">
        <defs>
          <marker id="arrow-initial" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#0F172A" />
          </marker>
          <marker id="arrow-transition" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6 Z" fill="#334155" />
          </marker>
        </defs>
        <g class="initial-indicator" data-parent-id="__root__" data-target-id="cardCheck.cart">
          <circle class="initial-dot" cx="18" cy="110" r="5" fill="#0F172A" />
          <path class="initial-edge" d="M 23 110 L 40 110" fill="none" stroke="#0F172A" marker-end="url(#arrow-initial)" />
        </g>
        <g class="state-node" data-state-id="cardCheck.cart" data-state-key="cart" data-state-type="atomic" data-parent-id="" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="40" y="88" width="90" height="44" rx="8" fill="#FFFFFF" stroke="#334155" />
          <text class="state-title" x="85" y="114" font-size="13" text-anchor="middle">cart</text>
        </g>
        <g class="state-node" data-state-id="cardCheck.paid" data-state-key="paid" data-state-type="final" data-parent-id="" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="410" y="88" width="90" height="44" rx="8" fill="#FFFFFF" stroke="#0F172A" stroke-width="2" />
          <rect class="final-inner-box" x="414" y="92" width="82" height="36" rx="5" fill="none" stroke="#334155" />
          <text class="state-title" x="455" y="114" font-size="13" text-anchor="middle">paid</text>
        </g>
        <g class="transition-edge" data-edge-id="cardCheck.cart__CHECKOUT__0" data-edge-source="cardCheck.cart" data-edge-targets="cardCheck.paid" data-edge-event="CHECKOUT" data-edge-order="0" data-edge-guard="hasValidCard" data-edge-actions="reserveInventory,chargePayment">
          <path class="edge-path" d="M 130 110 L 410 110" fill="none" stroke="#334155" marker-end="url(#arrow-transition)" />
          <g class="edge-label">
            <rect class="edge-label-bg" x="180" y="34" width="180" height="68" rx="5" fill="#FFFFFF" stroke="#CBD5E1" />
            <text class="edge-label-text" x="188" y="49" font-size="10.5" font-family="monospace">
              <tspan class="edge-label-line" x="188" dy="0">CHECKOUT </tspan>
              <tspan class="edge-label-line" x="188" dy="15">[hasValidCard] </tspan>
              <tspan class="edge-label-line" x="188" dy="15">/ reserveInventory, </tspan>
              <tspan class="edge-label-line" x="188" dy="15">chargePayment</tspan>
            </text>
          </g>
        </g>
      </svg>
    `;
    await page.setContent(`<html><body>${validCardSvg}</body></html>`, {
      waitUntil: 'load',
    });
    const g1Valid = await inspectGate1(page, 'svg');
    expect(g1Valid.violations).toEqual([]);
    expect(g1Valid.ast).toEqual(expectedAst);

    // 2. Overlapping tspan lines (dy="2" causes line[1] to collide vertically with line[0])
    const overlappingCardSvg = validCardSvg.replace(
      '<tspan class="edge-label-line" x="188" dy="15">[hasValidCard] </tspan>',
      '<tspan class="edge-label-line" x="188" dy="2">[hasValidCard] </tspan>',
    );
    await page.setContent(`<html><body>${overlappingCardSvg}</body></html>`, {
      waitUntil: 'load',
    });
    const g1Bad = await inspectGate1(page, 'svg');
    expect(
      g1Bad.violations.some(
        (v) =>
          v.rule === 'visibility' &&
          v.elementId === 'edge-label-line:cardCheck.cart__CHECKOUT__0:1',
      ),
    ).toBe(true);
  });

  it('Gate 2 catches unwrapped wide multi-clause pills (> 280px) and extreme ribbon aspect ratios (> 3.5:1)', async () => {
    const config = {
      id: 'ribbonTest',
      initial: 'cart',
      states: {
        cart: {
          on: {
            CHECKOUT: {
              target: 'receipt',
              actions: ['reserveInventory', 'chargePayment', 'raise(SEND_RECEIPT)'],
            },
          },
        },
        receipt: { type: 'final' as const },
      },
    };
    const ast = extractFromMachine(config);
    // Extreme 5.2:1 viewBox (936x180) AND unwrapped 470px single-line pill (> 280px cap)
    const wideRibbonSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 936 180" width="936" height="180" data-machine-id="ribbonTest">
        <defs>
          <marker id="arrow-transition" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6 Z" fill="#334155" />
          </marker>
        </defs>
        <g class="state-node" data-state-id="ribbonTest.cart" data-state-key="cart" data-state-type="atomic" data-parent-id="" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="24" y="68" width="96" height="44" rx="8" />
          <text class="state-title" x="72" y="94" font-size="13" text-anchor="middle">cart</text>
        </g>
        <g class="state-node" data-state-id="ribbonTest.receipt" data-state-key="receipt" data-state-type="final" data-parent-id="" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="800" y="68" width="104" height="44" rx="8" />
          <text class="state-title" x="852" y="94" font-size="13" text-anchor="middle">receipt</text>
        </g>
        <g class="transition-edge" data-edge-id="ribbonTest.cart__CHECKOUT__0" data-edge-source="ribbonTest.cart" data-edge-targets="ribbonTest.receipt" data-edge-event="CHECKOUT" data-edge-order="0" data-edge-guard="" data-edge-actions="reserveInventory,chargePayment,raise(SEND_RECEIPT)">
          <path class="edge-path" d="M 120 90 L 460 90 L 800 102" fill="none" stroke="#334155" marker-end="url(#arrow-transition)" />
          <g class="edge-label">
            <rect class="edge-label-bg" x="225" y="60" width="470" height="22" rx="5" />
            <text class="edge-label-text" x="233" y="75" font-size="10.5" font-family="monospace">CHECKOUT / reserveInventory, chargePayment, raise(SEND_RECEIPT)</text>
          </g>
        </g>
      </svg>
    `;
    await page.setContent(`<html><body>${wideRibbonSvg}</body></html>`, {
      waitUntil: 'load',
    });
    const g2 = await lintSvgGeometry(page, 'svg', ast);
    expect(g2.passed).toBe(false);
    expect(g2.violations.some((v) => v.rule === 'diagram-aspect-ratio')).toBe(true);
    expect(g2.violations.some((v) => v.rule === 'edge-label-multiline-wrap')).toBe(true);
    expect(g2.violations.some((v) => v.rule === 'orthogonal-edge-segments')).toBe(true);
  });

  it('Gate 2 catches roller-coaster / S-maze forward-edge detours on non-cycle pipeline transitions', async () => {
    const config = {
      id: 'detourCheck',
      initial: 'idle',
      states: {
        idle: { on: { START: 'done' } },
        done: { type: 'final' as const },
      },
    };
    const ast = extractFromMachine(config);
    // Endpoints are only 220px apart horizontally, but path takes a 1,100px S-maze roller-coaster detour
    const rollerCoasterSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 560" width="520" height="560" data-machine-id="detourCheck">
        <defs>
          <marker id="arrow-transition" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6 Z" fill="#334155" />
          </marker>
        </defs>
        <g class="state-node" data-state-id="detourCheck.idle" data-state-key="idle" data-state-type="atomic" data-parent-id="" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="40" y="240" width="90" height="44" rx="8" />
          <text class="state-title" x="85" y="266" font-size="13" text-anchor="middle">idle</text>
        </g>
        <g class="state-node" data-state-id="detourCheck.done" data-state-key="done" data-state-type="final" data-parent-id="" data-initial-target="" data-history-kind="">
          <rect class="state-box" x="350" y="180" width="90" height="44" rx="8" />
          <text class="state-title" x="395" y="206" font-size="13" text-anchor="middle">done</text>
        </g>
        <g class="transition-edge" data-edge-id="detourCheck.idle__START__0" data-edge-source="detourCheck.idle" data-edge-targets="detourCheck.done" data-edge-event="START" data-edge-order="0" data-edge-guard="" data-edge-actions="">
          <path class="edge-path" d="M 85 284 L 85 520 L 240 520 L 240 40 L 395 40 L 395 180" fill="none" stroke="#334155" marker-end="url(#arrow-transition)" />
          <g class="edge-label">
            <rect class="edge-label-bg" x="135" y="508" width="56" height="22" rx="5" />
            <text class="edge-label-text" x="163" y="523" font-size="11" text-anchor="middle">START</text>
          </g>
        </g>
      </svg>
    `;
    await page.setContent(`<html><body>${rollerCoasterSvg}</body></html>`, {
      waitUntil: 'load',
    });
    const g2 = await lintSvgGeometry(page, 'svg', ast);
    expect(g2.passed).toBe(false);
    expect(g2.violations.some((v) => v.rule === 'forward-edge-detour')).toBe(true);
  });

  it('API renderMachineToSvg and CLI --direction support auto, right, and down overrides', async () => {
    const pipelineConfig = {
      id: 'dirOverride',
      initial: 'step1',
      states: {
        step1: { on: { NEXT_A: 'step2' } },
        step2: { on: { NEXT_B: 'step3' } },
        step3: { type: 'final' as const },
      },
    };
    const ast = extractFromMachine(pipelineConfig);

    const svgRight = await renderMachineToSvg(pipelineConfig, { direction: 'RIGHT' });
    await page.setContent(`<html><body>${svgRight}</body></html>`, { waitUntil: 'load' });
    const g1Right = await inspectGate1(page, 'svg');
    const g2Right = await lintSvgGeometry(page, 'svg', ast, { skipAspectRatioCheck: true });
    expect(g1Right.violations).toEqual([]);
    expect(g2Right.passed).toBe(true);
    expect(g1Right.metrics.viewBox.width).toBeGreaterThan(g1Right.metrics.viewBox.height);

    const svgDown = await renderMachineToSvg(pipelineConfig, { direction: 'DOWN' });
    await page.setContent(`<html><body>${svgDown}</body></html>`, { waitUntil: 'load' });
    const g1Down = await inspectGate1(page, 'svg');
    const g2Down = await lintSvgGeometry(page, 'svg', ast, { skipAspectRatioCheck: true });
    expect(g1Down.violations).toEqual([]);
    expect(g2Down.passed).toBe(true);
    expect(g1Down.metrics.viewBox.height).toBeGreaterThan(g1Down.metrics.viewBox.width);

    const tmpDir = path.resolve(process.cwd(), '.tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const inputPath = path.join(tmpDir, 'cli-dir.json');
    await fs.writeFile(inputPath, JSON.stringify(pipelineConfig), 'utf8');

    const cliJs = path.resolve(process.cwd(), 'dist/cli.js');
    for (const dirFlag of ['auto', 'right', 'down']) {
      const outPath = path.join(tmpDir, `cli-dir-${dirFlag}.svg`);
      await execFileAsync(process.execPath, [
        cliJs,
        inputPath,
        '--direction',
        dirFlag,
        '-o',
        outPath,
      ]);
      const svgOut = await fs.readFile(outPath, 'utf8');
      expect(svgOut).toContain('<svg');
      expect(svgOut).toContain('data-machine-id="dirOverride"');
    }
  });
});
