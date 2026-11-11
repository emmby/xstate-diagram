import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { extractFromMachine } from '../src/ast/extract-machine.js';
import type { StatechartAST } from '../src/ast/types.js';

const execFileAsync = promisify(execFile);

const HAREL_NAMES = [
  'harel-activities',
  'harel-avionics',
  'harel-beep-test',
  'harel-broadcast-cycle',
  'harel-clustered',
  'harel-conditional',
  'harel-conflict',
  'harel-digit',
  'harel-displays',
  'harel-flat',
  'harel-history-deep',
  'harel-history-selective',
  'harel-history-shallow',
  'harel-overlap-inactive',
  'harel-overlap-shared',
  'harel-overlap',
  'harel-parallel-entry',
  'harel-parallel',
  'harel-product',
  'harel-selection',
  'harel-semantics',
  'harel-simultaneous',
  'harel-stopwatch',
  'harel-telephones',
  'harel-timeout',
  'harel-unclustering',
  'harel-updates',
  'harel-watch',
];

const COFFEE_NAMES = [
  'coffee-order',
  'coffee-nested',
  'coffee-donut-parallel',
];

const FEATURE_SCREENSHOTS = [
  {
    name: 'guards',
    repoPath: 'content/docs/assets/transitions-and-events/guards/guards.png',
  },
  {
    name: 'delayed-transitions',
    repoPath:
      'content/docs/assets/transitions-and-events/delayed-transitions/delayed-transitions.png',
  },
  {
    name: 'state-done-events',
    repoPath:
      'content/docs/assets/transitions-and-events/state-done-events/state-done-events.png',
  },
];

export interface ReferenceCorpusEntry {
  slug: string;
  sourceGroup: 'harel-statecharts' | 'statecharts';
  jsonRelPath: string;
  pngRelPath: string;
  tier: 1 | 2 | 3 | 4;
  tierReasons: string[];
  machineId: string;
  stateCount: number;
  transitionCount: number;
}

export interface ReferenceCorpusManifest {
  sourceRepo: string;
  fetchedAt: string;
  totalMachines: number;
  countsByTier: Record<'1' | '2' | '3' | '4', number>;
  featureReferencePngs: Record<string, string>;
  entries: ReferenceCorpusEntry[];
}

export function classifyAstTier(ast: StatechartAST): {
  tier: 1 | 2 | 3 | 4;
  reasons: string[];
} {
  const tier4Reasons = new Set<string>();
  const tier3Reasons = new Set<string>();
  const tier2Reasons = new Set<string>();

  for (const node of Object.values(ast.nodes)) {
    if (node.type === 'parallel') tier4Reasons.add('parallel-state');
    if (node.type === 'history') tier4Reasons.add(`history-${node.historyKind ?? 'shallow'}`);
    if (node.invocations.length > 0) tier4Reasons.add('invoke-actor');

    if (node.type === 'compound') tier3Reasons.add('compound-state');
    if (node.parentId !== null) tier3Reasons.add('nested-hierarchy');

    if (node.entryActions.length > 0) tier2Reasons.add('entry-actions');
    if (node.exitActions.length > 0) tier2Reasons.add('exit-actions');
    if (node.internalTransitions.length > 0) tier2Reasons.add('internal-transitions');
    if (node.tags.length > 0) tier2Reasons.add('state-tags');
  }

  for (const edge of ast.transitions) {
    if (edge.targetIds.length > 1) tier4Reasons.add('multi-target-fork');
    if (edge.eventType.startsWith('onDone(') || edge.eventType.startsWith('onError(')) {
      tier4Reasons.add('actor-completion-event');
    }

    if (edge.eventType === 'onDone') tier3Reasons.add('state-onDone');

    if (edge.guard !== null) tier2Reasons.add('transition-guard');
    if (edge.actions.length > 0) tier2Reasons.add('transition-actions');
    if (edge.order > 0) tier2Reasons.add('priority-branch-order');
    if (edge.eventType === 'always') tier2Reasons.add('always-eventless');
    if (edge.eventType.startsWith('after(')) tier2Reasons.add('after-delayed');
  }

  if (tier4Reasons.size > 0) {
    return { tier: 4, reasons: [...tier4Reasons] };
  }
  if (tier3Reasons.size > 0) {
    return { tier: 3, reasons: [...tier3Reasons] };
  }
  if (tier2Reasons.size > 0) {
    return { tier: 2, reasons: [...tier2Reasons] };
  }
  return { tier: 1, reasons: ['flat-atomic'] };
}

async function downloadRawFromGitHub(repoPath: string, destPath: string): Promise<void> {
  try {
    await fs.access(destPath);
    const st = await fs.stat(destPath);
    if (st.size > 0) return;
  } catch {
    // Proceed to download
  }

  const url = `https://raw.githubusercontent.com/statelyai/docs/main/${repoPath}`;
  const resp = await fetch(url);
  if (resp.ok) {
    const buf = Buffer.from(await resp.arrayBuffer());
    await fs.writeFile(destPath, buf);
    return;
  }

  // Fallback via `gh api` with raw accept header
  const { stdout } = await execFileAsync(
    'gh',
    ['api', '-H', 'Accept: application/vnd.github.raw', `repos/statelyai/docs/contents/${repoPath}`],
    { encoding: 'buffer', maxBuffer: 25 * 1024 * 1024 },
  );
  await fs.writeFile(destPath, stdout);
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const corpusDir = path.join(rootDir, 'tests/reference-corpus');
  const machinesDir = path.join(corpusDir, 'machines');
  const screenshotsDir = path.join(corpusDir, 'screenshots');
  const featuresDir = path.join(corpusDir, 'features');

  await fs.mkdir(machinesDir, { recursive: true });
  await fs.mkdir(screenshotsDir, { recursive: true });
  await fs.mkdir(featuresDir, { recursive: true });

  const items: Array<{
    slug: string;
    sourceGroup: 'harel-statecharts' | 'statecharts';
    jsonRepoPath: string;
    pngRepoPath: string;
  }> = [
    ...HAREL_NAMES.map((slug) => ({
      slug,
      sourceGroup: 'harel-statecharts' as const,
      jsonRepoPath: `public/assets/harel-statecharts/examples/${slug}.json`,
      pngRepoPath: `public/assets/harel-statecharts/screenshots/${slug}.png`,
    })),
    ...COFFEE_NAMES.map((slug) => ({
      slug,
      sourceGroup: 'statecharts' as const,
      jsonRepoPath: `public/assets/statecharts/examples/${slug}.json`,
      pngRepoPath: `public/assets/statecharts/dark/${slug}.png`,
    })),
  ];

  // Download in small parallel batches
  const batchSize = 8;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(
      batch.flatMap((item) => [
        downloadRawFromGitHub(
          item.jsonRepoPath,
          path.join(machinesDir, `${item.slug}.json`),
        ),
        downloadRawFromGitHub(
          item.pngRepoPath,
          path.join(screenshotsDir, `${item.slug}.png`),
        ),
      ]),
    );
  }

  const featureReferencePngs: Record<string, string> = {};
  await Promise.all(
    FEATURE_SCREENSHOTS.map(async (f) => {
      const dest = path.join(featuresDir, `${f.name}.png`);
      await downloadRawFromGitHub(f.repoPath, dest);
      featureReferencePngs[f.name] = `tests/reference-corpus/features/${f.name}.png`;
    }),
  );

  const entries: ReferenceCorpusEntry[] = [];
  const countsByTier: Record<'1' | '2' | '3' | '4', number> = {
    '1': 0,
    '2': 0,
    '3': 0,
    '4': 0,
  };

  for (const item of items) {
    const jsonAbs = path.join(machinesDir, `${item.slug}.json`);
    const rawJson = JSON.parse(await fs.readFile(jsonAbs, 'utf8'));
    const ast = extractFromMachine(rawJson);
    const { tier, reasons } = classifyAstTier(ast);
    countsByTier[String(tier) as '1' | '2' | '3' | '4']++;

    entries.push({
      slug: item.slug,
      sourceGroup: item.sourceGroup,
      jsonRelPath: `tests/reference-corpus/machines/${item.slug}.json`,
      pngRelPath: `tests/reference-corpus/screenshots/${item.slug}.png`,
      tier,
      tierReasons: reasons,
      machineId: ast.machineId,
      stateCount: Object.keys(ast.nodes).length,
      transitionCount: ast.transitions.length,
    });
  }

  const manifest: ReferenceCorpusManifest = {
    sourceRepo: 'https://github.com/statelyai/docs',
    fetchedAt: new Date().toISOString(),
    totalMachines: entries.length,
    countsByTier,
    featureReferencePngs,
    entries,
  };

  const manifestPath = path.join(corpusDir, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`Fetched & classified ${entries.length} reference machines:`);
  console.log('Counts by tier:', countsByTier);
  for (const e of entries) {
    console.log(
      `  [Tier ${e.tier}] ${e.slug} (${e.stateCount} states, ${e.transitionCount} edges) -> ${e.tierReasons.join(', ')}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
