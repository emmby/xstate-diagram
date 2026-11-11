import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractFromMachine } from '../src/ast/extract-machine.js';
import { renderMachineToSvg } from '../src/index.js';
import { extractFromSvg } from '../src/verifier/extract-svg.js';
import { lintSvgGeometry } from '../src/verifier/geometry-lint.js';
import { TIER4_FIXTURES } from './fixtures/tier4-parallel-history.js';

describe('Tier 4 — Parallel Regions, History, Multi-Target Forks, Invoked Actors & Full Corpus (Gate 1 + Gate 2)', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage({
      viewport: { width: 1800, height: 1400 },
      deviceScaleFactor: 2,
    });
  });

  afterAll(async () => {
    await page?.close();
    await browser?.close();
  });

  for (const fixture of TIER4_FIXTURES) {
    it(
      `${fixture.id}: ${fixture.title} passes Gate 1 (AST + parallel/history/fork/invoke geometry) and Gate 2 (geometric linter)`,
      async () => {
        const expectedAST = extractFromMachine(fixture.machineOrConfig);
        const svg = await renderMachineToSvg(fixture.machineOrConfig);

        await page.setContent(
          `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F8FAFC;"><div id="root">${svg}</div></body></html>`,
          { waitUntil: 'load' },
        );

        // Gate 1: Reconstruct AST from visible DOM + enforce anti-lying geometry (dashed parallel regions, H/H* circles/capsules, multi-target fork branches, invoke compartments)
        const actualAST = await extractFromSvg(page, '#root svg');
        expect(actualAST).toEqual(expectedAST);

        // Gate 2: Deterministic geometric & Voronoi linter
        const gate2 = await lintSvgGeometry(page, '#root svg', expectedAST);
        if (!gate2.passed) {
          const msg = gate2.violations
            .map((v, i) => `  ${i + 1}. [${v.rule}] (${v.elements.join(' vs ')}) ${v.message}`)
            .join('\n');
          expect.fail(
            `Gate 2 Geometric Linter failed with ${gate2.violations.length} violation(s):\n${msg}`,
          );
        }
        expect(gate2.passed).toBe(true);
      },
      30_000,
    );
  }
});
