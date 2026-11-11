import { isDeepStrictEqual } from 'node:util';
import { chromium, type Browser, type Page } from 'playwright';
import { extractFromMachine } from '../ast/extract-machine.js';
import type { StatechartAST } from '../ast/types.js';
import { renderMachineToSvg, type RenderOptions } from '../index.js';
import { inspectGate1, type Gate1InspectionResult } from './extract-svg.js';
import {
  lintSvgGeometry,
  type Gate2Result,
  type LintGeometryOptions,
} from './geometry-lint.js';

export interface VerifyMachineResult {
  svg: string;
  expectedAST: StatechartAST;
  actualAST: StatechartAST;
  astEqual: boolean;
  gate1: Gate1InspectionResult;
  gate2: Gate2Result;
  passed: boolean;
}

export interface VerifyMachineOptions {
  page?: Page;
  browser?: Browser;
  renderOptions?: RenderOptions;
  lintOptions?: LintGeometryOptions;
}

function deepEqualAst(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(a, b);
}

/**
 * Renders an XState v5 machine/config to SVG via `renderMachineToSvg`, loads the SVG
 * in headless Chromium via Playwright, runs Gate 1 (`inspectGate1` + AST isomorphism)
 * and Gate 2 (`lintSvgGeometry`), and returns full diagnostics.
 */
export async function verifyMachine(
  machineOrConfig: unknown,
  options: VerifyMachineOptions = {},
): Promise<VerifyMachineResult> {
  const expectedAST = extractFromMachine(machineOrConfig);
  const svg = await renderMachineToSvg(machineOrConfig, options.renderOptions);

  let ownedBrowser: Browser | null = null;
  let ownedPage: Page | null = null;

  try {
    let page = options.page;
    if (!page) {
      const browser = options.browser ?? (ownedBrowser = await chromium.launch());
      ownedPage = await browser.newPage({
        viewport: { width: 1600, height: 1200 },
        deviceScaleFactor: 2,
      });
      page = ownedPage;
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body {
      margin: 0;
      padding: 0;
      background: #F8FAFC;
    }
    #diagram-root {
      display: inline-block;
    }
  </style>
</head>
<body>
  <div id="diagram-root">${svg}</div>
</body>
</html>`;

    await page.setContent(html, { waitUntil: 'load' });

    const gate1 = await inspectGate1(page, '#diagram-root svg');
    const explicitNonAutoDir = Boolean(
      options.renderOptions?.direction &&
        String(options.renderOptions.direction).toUpperCase() !== 'AUTO',
    );
    const gate2 = await lintSvgGeometry(page, '#diagram-root svg', expectedAST, {
      skipAspectRatioCheck: explicitNonAutoDir,
      ...options.lintOptions,
    });
    const astEqual = deepEqualAst(gate1.ast, expectedAST);

    return {
      svg,
      expectedAST,
      actualAST: gate1.ast,
      astEqual,
      gate1,
      gate2,
      passed: astEqual && gate1.violations.length === 0 && gate2.passed,
    };
  } finally {
    if (ownedPage) {
      await ownedPage.close();
    }
    if (ownedBrowser) {
      await ownedBrowser.close();
    }
  }
}
