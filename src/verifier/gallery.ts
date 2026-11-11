import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { verifyMachine, type VerifyMachineResult } from './verify-machine.js';

export interface ConformanceFixture {
  id: string;
  title: string;
  description: string;
  configSource: Record<string, unknown>;
  machineOrConfig: unknown;
  /** Optional relative path to a cached statelyai/docs ground-truth reference PNG */
  referencePngRelPath?: string;
  /** Optional human-readable label for the ground-truth reference source */
  referenceSourceLabel?: string;
}

export interface GalleryBuildSummary {
  tier: number;
  htmlPath: string;
  overviewPngPath: string;
  tierDirPngPath: string;
  fixtureScreenshots: string[];
  referenceScreenshots: string[];
  allPassed: boolean;
  results: Array<{
    fixture: ConformanceFixture;
    verification: VerifyMachineResult;
  }>;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(val: number | null, unit = 'px'): string {
  if (val === null || !Number.isFinite(val)) return 'n/a';
  return `${val.toFixed(1)}${unit}`;
}

export async function generateGalleryForFixtures(
  tier: number,
  fixtures: ConformanceFixture[],
  outDir = path.resolve(process.cwd(), 'dist'),
): Promise<GalleryBuildSummary> {
  const tierDir = path.join(outDir, `tier-${tier}`);
  await fs.mkdir(tierDir, { recursive: true });

  const browser = await chromium.launch();
  const evalPage = await browser.newPage({
    viewport: { width: 1600, height: 1200 },
    deviceScaleFactor: 2,
  });

  const results: Array<{
    fixture: ConformanceFixture;
    verification: VerifyMachineResult;
    refDataUri: string | null;
  }> = [];
  const fixtureScreenshots: string[] = [];
  const referenceScreenshots: string[] = [];

  try {
    for (const fixture of fixtures) {
      const verification = await verifyMachine(fixture.machineOrConfig, {
        page: evalPage,
      });

      let refDataUri: string | null = null;
      if (fixture.referencePngRelPath) {
        const refAbsPath = path.resolve(process.cwd(), fixture.referencePngRelPath);
        const refBytes = await fs.readFile(refAbsPath);
        refDataUri = `data:image/png;base64,${refBytes.toString('base64')}`;
        const copiedRefPath = path.join(tierDir, `${fixture.id}.ref.png`);
        await fs.copyFile(refAbsPath, copiedRefPath);
        referenceScreenshots.push(copiedRefPath);
      }

      results.push({ fixture, verification, refDataUri });

      // Rasterize high-DPI standalone SVG screenshot for VLM Blind Visual Audit
      const svgShotHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body {
      margin: 0;
      padding: 0;
      background: #F8FAFC;
    }
    #capture-wrap {
      display: inline-block;
      padding: 16px;
      background: #F8FAFC;
    }
    svg {
      display: block;
    }
  </style>
</head>
<body>
  <div id="capture-wrap">${verification.svg}</div>
</body>
</html>`;
      await evalPage.setContent(svgShotHtml, { waitUntil: 'load' });
      const wrapLocator = evalPage.locator('#capture-wrap');
      const pngPath = path.join(tierDir, `${fixture.id}.png`);
      await wrapLocator.screenshot({ path: pngPath });
      fixtureScreenshots.push(pngPath);
    }

    const passedCount = results.filter((r) => r.verification.passed).length;
    const allPassed = passedCount === results.length;

    const cardsHtml = results
      .map(({ fixture, verification, refDataUri }) => {
        const g1Ok =
          verification.astEqual && verification.gate1.violations.length === 0;
        const g2Ok = verification.gate2.passed;
        const m1 = verification.gate1.metrics;
        const m2 = verification.gate2.metrics;

        const allViolations = [
          ...(!verification.astEqual
            ? ['[Gate 1 AST Isomorphism] Reconstructed AST did not match expected StatechartAST']
            : []),
          ...verification.gate1.violations.map(
            (v) => `[Gate 1 ${v.rule}] (${v.elementId}) ${v.message}`,
          ),
          ...verification.gate2.violations.map(
            (v) => `[Gate 2 ${v.rule}] (${v.elements.join(', ')}) ${v.message}`,
          ),
        ];

        const violationsHtml =
          allViolations.length > 0
            ? `<div class="violations">
                <strong>Violations (${allViolations.length}):</strong>
                <ul>${allViolations.map((msg) => `<li>${escapeHtml(msg)}</li>`).join('')}</ul>
              </div>`
            : '';

        const refBadgeHtml = refDataUri
          ? `<span class="badge ref-badge">Ground-Truth Corpus</span>`
          : '';

        const visualStageHtml = refDataUri
          ? `<div class="dual-stage">
              <div class="stage-col">
                <div class="stage-caption">xstate-diagram Rendered Output</div>
                <div class="svg-stage dual-svg">${verification.svg}</div>
              </div>
              <div class="stage-col ref-col">
                <div class="stage-caption">${escapeHtml(
                  fixture.referenceSourceLabel ||
                    `statelyai/docs Reference (${fixture.referencePngRelPath})`,
                )}</div>
                <div class="ref-stage">
                  <img src="${refDataUri}" alt="${escapeHtml(fixture.title)} reference diagram" />
                </div>
              </div>
            </div>`
          : `<div class="svg-stage">
              ${verification.svg}
            </div>`;

        return `
      <section class="fixture-card" id="fixture-${escapeHtml(fixture.id)}">
        <header class="card-header">
          <div>
            <span class="fixture-id">${escapeHtml(fixture.id)}</span>
            <h2>${escapeHtml(fixture.title)}</h2>
            <p class="fixture-desc">${escapeHtml(fixture.description)}</p>
          </div>
          <div class="badges">
            ${refBadgeHtml}
            <span class="badge ${g1Ok ? 'pass' : 'fail'}">Gate 1: ${g1Ok ? 'PASS' : 'FAIL'}</span>
            <span class="badge ${g2Ok ? 'pass' : 'fail'}">Gate 2: ${g2Ok ? 'PASS' : 'FAIL'}</span>
          </div>
        </header>

        <div class="card-body">
          ${visualStageHtml}
          <aside class="inspector-pane">
            <div class="metrics-grid">
              <div class="metric">
                <span class="metric-label">States / Edges</span>
                <span class="metric-val">${m1.stateCount} / ${m1.transitionCount}</span>
              </div>
              <div class="metric">
                <span class="metric-label">Max Endpoint Gap</span>
                <span class="metric-val">${fmtNum(m1.maxEndpointDistancePx)} (&le;3.5px)</span>
              </div>
              <div class="metric">
                <span class="metric-label">Min Sibling Clearance</span>
                <span class="metric-val">${fmtNum(m2.minSiblingClearancePx)} (&ge;12px)</span>
              </div>
              ${
                m2.minParentInsetPx !== null
                  ? `<div class="metric">
                <span class="metric-label">Min Parent Inset</span>
                <span class="metric-val">${fmtNum(m2.minParentInsetPx)} (&ge;8px)</span>
              </div>`
                  : ''
              }
              <div class="metric">
                <span class="metric-label">Max Label-Own-Edge</span>
                <span class="metric-val">${fmtNum(m2.maxLabelOwnPathDistPx)} (&le;14px)</span>
              </div>
              <div class="metric">
                <span class="metric-label">Min Voronoi Margin</span>
                <span class="metric-val">${fmtNum(m2.minVoronoiMarginPx)} (&gt;8px)</span>
              </div>
              <div class="metric">
                <span class="metric-label">ViewBox</span>
                <span class="metric-val">${Math.round(m1.viewBox.width)}&times;${Math.round(m1.viewBox.height)}</span>
              </div>
              <div class="metric">
                <span class="metric-label">Aspect Ratio</span>
                <span class="metric-val">${m2.aspectRatioMax !== null ? `${m2.aspectRatioMax.toFixed(2)}:1` : 'n/a'} (&le;3.5:1)</span>
              </div>
              <div class="metric">
                <span class="metric-label">Max Label Width</span>
                <span class="metric-val">${fmtNum(m2.maxLabelPillWidthPx)} (&le;280px)</span>
              </div>
            </div>
            ${violationsHtml}
            <details class="config-details" open>
              <summary>XState v5 Machine Config</summary>
              <pre><code>${escapeHtml(JSON.stringify(fixture.configSource, null, 2))}</code></pre>
            </details>
          </aside>
        </div>
      </section>`;
      })
      .join('\n');

    const galleryHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>xstate-diagram — Tier ${tier} Conformance Contact Sheet</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      background: #0F172A;
      color: #F8FAFC;
    }
    .page-header {
      max-width: 1560px;
      margin: 0 auto 28px auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #334155;
      padding-bottom: 18px;
    }
    .page-header h1 {
      margin: 0 0 6px 0;
      font-size: 24px;
      letter-spacing: -0.02em;
    }
    .page-header p {
      margin: 0;
      color: #94A3B8;
      font-size: 14px;
    }
    .summary-pill {
      padding: 8px 16px;
      border-radius: 999px;
      font-weight: 700;
      font-size: 14px;
    }
    .summary-pill.pass {
      background: #064E3B;
      color: #6EE7B7;
      border: 1px solid #059669;
    }
    .summary-pill.fail {
      background: #7F1D1D;
      color: #FCA5A5;
      border: 1px solid #DC2626;
    }
    .gallery-list {
      max-width: 1560px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 28px;
    }
    .fixture-card {
      background: #1E293B;
      border: 1px solid #334155;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
    }
    .card-header {
      padding: 16px 22px;
      background: #0F172A;
      border-bottom: 1px solid #334155;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }
    .fixture-id {
      display: inline-block;
      font-family: Menlo, Consolas, monospace;
      font-size: 11px;
      color: #38BDF8;
      background: rgba(56, 189, 248, 0.12);
      padding: 2px 8px;
      border-radius: 4px;
      margin-bottom: 4px;
    }
    .card-header h2 {
      margin: 2px 0 4px 0;
      font-size: 18px;
      color: #F8FAFC;
    }
    .fixture-desc {
      margin: 0;
      font-size: 13px;
      color: #94A3B8;
    }
    .badges {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }
    .badge {
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 700;
      font-family: Menlo, Consolas, monospace;
    }
    .badge.ref-badge {
      background: #1E1B4B;
      color: #C7D2FE;
      border: 1px solid #6366F1;
    }
    .badge.pass {
      background: #064E3B;
      color: #6EE7B7;
      border: 1px solid #059669;
    }
    .badge.fail {
      background: #7F1D1D;
      color: #FCA5A5;
      border: 1px solid #DC2626;
    }
    .card-body {
      display: grid;
      grid-template-columns: minmax(0, 1.65fr) minmax(320px, 0.85fr);
      min-height: 280px;
    }
    .dual-stage {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      border-right: 1px solid #334155;
    }
    .stage-col {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .stage-col.ref-col {
      border-left: 1px solid #334155;
      background: #0B1120;
    }
    .stage-caption {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      padding: 8px 14px;
      background: #0F172A;
      color: #94A3B8;
      border-bottom: 1px solid #334155;
    }
    .svg-stage {
      background: #F8FAFC;
      padding: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
      border-right: 1px solid #334155;
      flex: 1;
    }
    .svg-stage.dual-svg {
      border-right: none;
    }
    .svg-stage svg {
      max-width: 100%;
      height: auto;
      display: block;
    }
    .ref-stage {
      padding: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
      flex: 1;
      background: #0B1120;
    }
    .ref-stage img {
      max-width: 100%;
      height: auto;
      display: block;
      border-radius: 6px;
      border: 1px solid #1E293B;
    }
    .inspector-pane {
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      background: #1E293B;
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .metric {
      background: #0F172A;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 8px 10px;
    }
    .metric-label {
      display: block;
      font-size: 11px;
      color: #94A3B8;
      margin-bottom: 2px;
    }
    .metric-val {
      font-family: Menlo, Consolas, monospace;
      font-size: 12px;
      font-weight: 600;
      color: #E2E8F0;
    }
    .violations {
      background: rgba(127, 29, 29, 0.45);
      border: 1px solid #DC2626;
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 12px;
      color: #FECACA;
    }
    .violations ul {
      margin: 6px 0 0 0;
      padding-left: 18px;
    }
    .config-details summary {
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      color: #CBD5E1;
      margin-bottom: 6px;
    }
    .config-details pre {
      margin: 0;
      padding: 10px 12px;
      background: #0F172A;
      border: 1px solid #334155;
      border-radius: 6px;
      font-family: Menlo, Consolas, monospace;
      font-size: 11px;
      line-height: 1.45;
      color: #CBD5E1;
      max-height: 260px;
      overflow: auto;
    }
  </style>
</head>
<body>
  <header class="page-header">
    <div>
      <h1>xstate-diagram &mdash; Tier ${tier} Conformance Contact Sheet</h1>
      <p>Closed-Loop Verification Harness: Gate 1 (AST + Anti-Lying Geometry), Gate 2 (Playwright BBox + Voronoi Linter) &amp; Ground-Truth Corpus</p>
    </div>
    <div class="summary-pill ${allPassed ? 'pass' : 'fail'}">
      ${passedCount} / ${results.length} Fixtures Passing
    </div>
  </header>
  <main class="gallery-list">
    ${cardsHtml}
  </main>
</body>
</html>`;

    const htmlPath = path.join(outDir, `gallery-tier-${tier}.html`);
    await fs.writeFile(htmlPath, galleryHtml, 'utf8');

    const galleryPage = await browser.newPage({
      viewport: { width: 1620, height: 1000 },
      deviceScaleFactor: 2,
    });
    await galleryPage.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    const overviewPngPath = path.join(outDir, `tier-${tier}-overview.png`);
    const tierDirPngPath = path.join(tierDir, 'overview.png');
    await galleryPage.screenshot({ path: overviewPngPath, fullPage: true });
    await fs.copyFile(overviewPngPath, tierDirPngPath);
    await galleryPage.close();

    return {
      tier,
      htmlPath,
      overviewPngPath,
      tierDirPngPath,
      fixtureScreenshots,
      referenceScreenshots,
      allPassed,
      results: results.map(({ fixture, verification }) => ({ fixture, verification })),
    };
  } finally {
    await evalPage.close();
    await browser.close();
  }
}

const TIER_FIXTURE_FILES: Record<number, string> = {
  1: 'tests/fixtures/tier1-flat.ts',
  2: 'tests/fixtures/tier2-compartments.ts',
  3: 'tests/fixtures/tier3-hierarchy.ts',
  4: 'tests/fixtures/tier4-parallel-history.ts',
};

async function runCli(): Promise<void> {
  const tierArg = parseInt(process.argv[2] || '1', 10);
  const relPath = TIER_FIXTURE_FILES[tierArg];
  if (!relPath) {
    throw new Error(`Unknown tier "${process.argv[2]}". Expected 1, 2, 3, or 4.`);
  }
  const absPath = path.resolve(process.cwd(), relPath);
  const mod = (await import(pathToFileURL(absPath).href)) as {
    fixtures?: ConformanceFixture[];
    TIER1_FIXTURES?: ConformanceFixture[];
    TIER2_FIXTURES?: ConformanceFixture[];
    TIER3_FIXTURES?: ConformanceFixture[];
    TIER4_FIXTURES?: ConformanceFixture[];
  };
  const fixtures =
    mod.fixtures ??
    mod.TIER1_FIXTURES ??
    mod.TIER2_FIXTURES ??
    mod.TIER3_FIXTURES ??
    mod.TIER4_FIXTURES;
  if (!fixtures || !Array.isArray(fixtures)) {
    throw new Error(`Fixture module ${relPath} did not export "fixtures" array.`);
  }

  const summary = await generateGalleryForFixtures(tierArg, fixtures);
  console.log(`Generated ${summary.htmlPath}`);
  console.log(`Generated ${summary.overviewPngPath}`);
  console.log(
    `Generated ${summary.fixtureScreenshots.length} fixture PNGs (${summary.referenceScreenshots.length} paired ref PNGs) in dist/tier-${tierArg}/`,
  );
  if (!summary.allPassed) {
    console.error(`One or more Tier ${tierArg} fixtures failed verification gates!`);
    process.exitCode = 1;
  }
}

const isDirectEntry =
  process.argv[1] &&
  path.resolve(process.argv[1]).endsWith(path.join('verifier', 'gallery.ts'));

if (isDirectEntry) {
  runCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
