import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface DiagramCompactnessEntry {
  tier: number;
  id: string;
  key: string;
  width: number;
  height: number;
  area: number;
  wOverH: number;
  aspectMax: number;
  maxLabelPillWidth: number;
}

export interface CompactnessSnapshot {
  capturedAt: string;
  diagramCount: number;
  totalArea: number;
  meanAspectMax: number;
  medianAspectMax: number;
  maxAspectMax: number;
  over3_5Count: number;
  over2_5Count: number;
  maxLabelPillWidthOverall: number;
  entries: DiagramCompactnessEntry[];
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export async function extractSnapshotFromGalleries(
  distDir = path.resolve(process.cwd(), 'dist'),
): Promise<CompactnessSnapshot> {
  const entries: DiagramCompactnessEntry[] = [];

  for (const tier of [1, 2, 3, 4]) {
    const htmlPath = path.join(distDir, `gallery-tier-${tier}.html`);
    const html = await fs.readFile(htmlPath, 'utf8');

    const cardRegex =
      /<section class="fixture-card" id="fixture-([^"]+)">([\s\S]*?)<\/section>/g;
    let match: RegExpExecArray | null;
    while ((match = cardRegex.exec(html)) !== null) {
      const id = match[1];
      const body = match[2];

      const vbMatch = body.match(/<svg[^>]*\bviewBox="([^"]+)"/);
      if (!vbMatch) continue;
      const parts = vbMatch[1].trim().split(/[\s,]+/).map(Number);
      const width = parts[2] || 0;
      const height = parts[3] || 0;
      const area = width * height;
      const wOverH = height > 0 ? width / height : 0;
      const aspectMax =
        width > 0 && height > 0 ? Math.max(width / height, height / width) : 0;

      let maxLabelPillWidth = 0;
      const pillRegex = /<rect\s+class="edge-label-bg"[^>]*?\swidth="([^"]+)"/g;
      let pm: RegExpExecArray | null;
      while ((pm = pillRegex.exec(body)) !== null) {
        const w = parseFloat(pm[1] || '0');
        if (w > maxLabelPillWidth) maxLabelPillWidth = w;
      }

      entries.push({
        tier,
        id,
        key: `tier${tier}/${id}`,
        width,
        height,
        area,
        wOverH,
        aspectMax,
        maxLabelPillWidth,
      });
    }
  }

  const aspects = entries.map((e) => e.aspectMax);
  const totalArea = entries.reduce((acc, e) => acc + e.area, 0);
  const meanAspectMax =
    aspects.length > 0 ? aspects.reduce((a, b) => a + b, 0) / aspects.length : 0;
  const medianAspectMax = median(aspects);
  const maxAspectMax = aspects.length > 0 ? Math.max(...aspects) : 0;
  const over3_5Count = entries.filter((e) => e.aspectMax > 3.5).length;
  const over2_5Count = entries.filter((e) => e.aspectMax > 2.5).length;
  const maxLabelPillWidthOverall =
    entries.length > 0 ? Math.max(...entries.map((e) => e.maxLabelPillWidth)) : 0;

  return {
    capturedAt: new Date().toISOString(),
    diagramCount: entries.length,
    totalArea,
    meanAspectMax,
    medianAspectMax,
    maxAspectMax,
    over3_5Count,
    over2_5Count,
    maxLabelPillWidthOverall,
    entries,
  };
}

function printSnapshotSummary(label: string, snap: CompactnessSnapshot): void {
  console.log(`=== ${label} (${snap.diagramCount} diagrams) ===`);
  console.log(`  Total ViewBox Area:      ${(snap.totalArea / 1e6).toFixed(2)} MPx²`);
  console.log(`  Mean Aspect max(W/H,H/W): ${snap.meanAspectMax.toFixed(2)}:1`);
  console.log(`  Median Aspect Ratio:      ${snap.medianAspectMax.toFixed(2)}:1`);
  console.log(`  Worst Aspect Ratio:       ${snap.maxAspectMax.toFixed(2)}:1`);
  console.log(`  Diagrams > 3.5:1:         ${snap.over3_5Count}`);
  console.log(`  Diagrams > 2.5:1:         ${snap.over2_5Count}`);
  console.log(`  Max Edge Label Pill W:    ${snap.maxLabelPillWidthOverall.toFixed(1)}px`);

  const worst5 = [...snap.entries]
    .sort((a, b) => b.aspectMax - a.aspectMax)
    .slice(0, 8);
  console.log(`  Top 8 Most Elongated Diagrams:`);
  for (const e of worst5) {
    console.log(
      `    - ${e.key}: ${Math.round(e.width)}x${Math.round(e.height)} (aspect=${e.aspectMax.toFixed(2)}:1, maxPillW=${e.maxLabelPillWidth.toFixed(1)}px)`,
    );
  }
  const widestPills = [...snap.entries]
    .sort((a, b) => b.maxLabelPillWidth - a.maxLabelPillWidth)
    .slice(0, 5);
  console.log(`  Top 5 Widest Edge Label Pills:`);
  for (const e of widestPills) {
    console.log(
      `    - ${e.key}: maxPillW=${e.maxLabelPillWidth.toFixed(1)}px (viewBox=${Math.round(e.width)}x${Math.round(e.height)})`,
    );
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2] || 'compare';
  const tmpDir = path.resolve(process.cwd(), '.tmp');
  await fs.mkdir(tmpDir, { recursive: true });
  const baselinePath = path.join(tmpDir, 'phase5-baseline.json');

  if (mode === '--save-baseline' || mode === 'save') {
    const snap = await extractSnapshotFromGalleries();
    await fs.writeFile(baselinePath, JSON.stringify(snap, null, 2), 'utf8');
    console.log(`Saved pre-Phase-5 baseline to ${baselinePath}`);
    printSnapshotSummary('Pre-Phase-5 Baseline', snap);
    return;
  }

  const baseRaw = await fs.readFile(baselinePath, 'utf8');
  const before = JSON.parse(baseRaw) as CompactnessSnapshot;
  const after = await extractSnapshotFromGalleries();

  printSnapshotSummary('BEFORE Phase 5', before);
  console.log('');
  printSnapshotSummary('AFTER Phase 5', after);
  console.log('');

  const beforeMap = new Map(before.entries.map((e) => [e.key, e]));
  const areaRatios: number[] = [];
  for (const cur of after.entries) {
    const prev = beforeMap.get(cur.key);
    if (prev && prev.area > 0) {
      areaRatios.push(cur.area / prev.area);
    }
  }
  const totalAreaDeltaPct =
    before.totalArea > 0
      ? ((after.totalArea - before.totalArea) / before.totalArea) * 100
      : 0;
  const medianAreaDeltaPct = (median(areaRatios) - 1) * 100;

  console.log(`=== Phase 5 Delta Summary (${after.diagramCount} diagrams) ===`);
  console.log(
    `  Total Area Change:        ${totalAreaDeltaPct.toFixed(1)}% (${(before.totalArea / 1e6).toFixed(2)} -> ${(after.totalArea / 1e6).toFixed(2)} MPx²)`,
  );
  console.log(`  Median Diagram Area Δ:    ${medianAreaDeltaPct.toFixed(1)}%`);
  console.log(
    `  Mean Aspect Ratio:        ${before.meanAspectMax.toFixed(2)}:1 -> ${after.meanAspectMax.toFixed(2)}:1`,
  );
  console.log(
    `  Max Aspect Ratio:         ${before.maxAspectMax.toFixed(2)}:1 -> ${after.maxAspectMax.toFixed(2)}:1`,
  );
  console.log(
    `  Diagrams > 3.5:1:         ${before.over3_5Count} -> ${after.over3_5Count}`,
  );
  console.log(
    `  Diagrams > 2.5:1:         ${before.over2_5Count} -> ${after.over2_5Count}`,
  );
  console.log(
    `  Max Label Pill Width:     ${before.maxLabelPillWidthOverall.toFixed(1)}px -> ${after.maxLabelPillWidthOverall.toFixed(1)}px`,
  );

  const spotlights = [
    'tier2/03-transition-actions',
    'tier2/04-combined-guard-and-actions',
    'tier2/11-tier2-kitchen-sink',
    'tier3/ref-08-harel-digit',
    'tier4/ref-17-harel-updates',
    'tier4/ref-18-harel-watch',
    'tier4/10-tier4-kitchen-sink-statechart',
  ];
  console.log(`  Spotlight Fixtures (Before -> After):`);
  for (const key of spotlights) {
    const b = beforeMap.get(key);
    const a = after.entries.find((x) => x.key === key);
    if (b && a) {
      const areaChg = (((a.area - b.area) / b.area) * 100).toFixed(1);
      console.log(
        `    - ${key}: ${Math.round(b.width)}x${Math.round(b.height)} (${b.aspectMax.toFixed(2)}:1, pill=${b.maxLabelPillWidth.toFixed(0)}px) -> ${Math.round(a.width)}x${Math.round(a.height)} (${a.aspectMax.toFixed(2)}:1, pill=${a.maxLabelPillWidth.toFixed(0)}px, area ${areaChg}%)`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
