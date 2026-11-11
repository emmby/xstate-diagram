#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderMachineToSvg } from './index.js';

interface CliArgs {
  inputPath: string | null;
  outputPath: string | null;
  direction: 'AUTO' | 'RIGHT' | 'DOWN';
  exportName: string | null;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let inputPath: string | null = null;
  let outputPath: string | null = null;
  let direction: 'AUTO' | 'RIGHT' | 'DOWN' = 'AUTO';
  let exportName: string | null = null;
  let help = false;
  let version = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      help = true;
    } else if (arg === '-v' || arg === '--version') {
      version = true;
    } else if (arg === '-o' || arg === '--output') {
      outputPath = argv[++i] ?? null;
    } else if (arg === '-e' || arg === '--export') {
      exportName = argv[++i] ?? null;
      if (!exportName) {
        throw new Error('Missing value for --export <name>.');
      }
    } else if (arg === '-d' || arg === '--direction') {
      const val = (argv[++i] ?? 'AUTO').toUpperCase();
      if (val === 'AUTO' || val === 'RIGHT' || val === 'DOWN') {
        direction = val;
      } else {
        throw new Error(
          `Invalid --direction "${val}". Expected AUTO, RIGHT, or DOWN.`,
        );
      }
    } else if (!arg.startsWith('-') && !inputPath) {
      inputPath = arg;
    } else {
      throw new Error(`Unknown or unexpected argument: "${arg}"`);
    }
  }

  return { inputPath, outputPath, direction, exportName, help, version };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function getPackageVersion(): Promise<string> {
  try {
    const pkgUrl = new URL('../package.json', import.meta.url);
    const raw = await readFile(pkgUrl, 'utf8');
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function printUsage(): void {
  const msg = [
    'Usage: xstate-diagram [machine.ts|machine.js|machine.json] [-o output.svg] [options]',
    '',
    'Options:',
    '  -o, --output <file>       Write SVG output to file (defaults to stdout)',
    '  -d, --direction <dir>     Layout direction: auto (default), right, or down',
    '  -e, --export <name>       Named export to render from a .ts/.js module',
    '  -v, --version             Show version number',
    '  -h, --help                Show this help message',
  ].join('\n');
  process.stdout.write(`${msg}\n`);
}

function isLikelyMachineOrConfig(val: unknown): boolean {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) {
    return false;
  }
  const rec = val as Record<string, unknown>;
  if ('root' in rec && typeof rec.root === 'object' && rec.root !== null) {
    return true;
  }
  if ('states' in rec && typeof rec.states === 'object' && rec.states !== null) {
    return true;
  }
  return false;
}

const MODULE_EXTENSIONS = new Set([
  '.ts',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
]);

async function importModuleFile(
  resolvedPath: string,
): Promise<Record<string, unknown>> {
  const fileUrl = pathToFileURL(resolvedPath).href;
  try {
    return (await import(fileUrl)) as Record<string, unknown>;
  } catch (primaryErr) {
    try {
      const tsxApi = (await import('tsx/esm/api')) as {
        tsImport: (
          specifier: string,
          parentURL: string,
        ) => Promise<Record<string, unknown>>;
      };
      return await tsxApi.tsImport(fileUrl, import.meta.url);
    } catch {
      throw primaryErr;
    }
  }
}

function selectExportFromModule(
  mod: Record<string, unknown>,
  inputPath: string,
  exportName: string | null,
): unknown {
  const defaultObj =
    typeof mod.default === 'object' &&
    mod.default !== null &&
    !Array.isArray(mod.default)
      ? (mod.default as Record<string, unknown>)
      : null;

  if (exportName) {
    if (exportName in mod && mod[exportName] !== undefined) {
      return mod[exportName];
    }
    if (defaultObj && exportName in defaultObj && defaultObj[exportName] !== undefined) {
      return defaultObj[exportName];
    }
    const available = [
      ...Object.keys(mod).filter((k) => k !== 'default'),
      ...(defaultObj && !isLikelyMachineOrConfig(defaultObj)
        ? Object.keys(defaultObj)
        : []),
    ];
    throw new Error(
      `Export "${exportName}" not found in "${inputPath}". Available exports: ${available.join(', ') || '(none)'}`,
    );
  }

  if (isLikelyMachineOrConfig(mod.default)) {
    return mod.default;
  }

  const candidates: Array<[string, unknown]> = [];
  for (const [key, val] of Object.entries(mod)) {
    if (key === 'default') continue;
    if (isLikelyMachineOrConfig(val)) {
      candidates.push([key, val]);
    }
  }
  if (candidates.length === 0 && defaultObj) {
    for (const [key, val] of Object.entries(defaultObj)) {
      if (isLikelyMachineOrConfig(val)) {
        candidates.push([key, val]);
      }
    }
  }

  if (candidates.length === 1) {
    return candidates[0][1];
  }
  if (candidates.length > 1) {
    const names = candidates.map(([k]) => k).join(', ');
    throw new Error(
      `Multiple state machines found in "${inputPath}" (${names}). Specify which one to render with --export <name>.`,
    );
  }

  throw new Error(
    `No valid XState machine or config export found in "${inputPath}". Export a machine via "export default createMachine(...)" or "export const myMachine = createMachine(...)".`,
  );
}

async function loadMachineInput(
  inputPath: string | null,
  exportName: string | null,
): Promise<unknown> {
  if (inputPath) {
    const resolvedPath = resolve(inputPath);
    const ext = extname(resolvedPath).toLowerCase();
    if (MODULE_EXTENSIONS.has(ext)) {
      const mod = await importModuleFile(resolvedPath);
      return selectExportFromModule(mod, inputPath, exportName);
    }
    const rawJson = await readFile(resolvedPath, 'utf8');
    return JSON.parse(rawJson) as unknown;
  }

  if (!process.stdin.isTTY) {
    const rawJson = await readStdin();
    return JSON.parse(rawJson) as unknown;
  }

  return null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  if (args.version) {
    const ver = await getPackageVersion();
    process.stdout.write(`${ver}\n`);
    return;
  }

  const machineOrConfig = await loadMachineInput(
    args.inputPath,
    args.exportName,
  );
  if (machineOrConfig === null) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const svg = await renderMachineToSvg(machineOrConfig, {
    direction: args.direction,
  });

  if (args.outputPath) {
    await writeFile(resolve(args.outputPath), svg, 'utf8');
  } else {
    process.stdout.write(svg);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`xstate-diagram error: ${message}\n`);
  process.exitCode = 1;
});
