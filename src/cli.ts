#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderMachineToSvg } from './index.js';

interface CliArgs {
  inputPath: string | null;
  outputPath: string | null;
  direction: 'AUTO' | 'RIGHT' | 'DOWN';
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let inputPath: string | null = null;
  let outputPath: string | null = null;
  let direction: 'AUTO' | 'RIGHT' | 'DOWN' = 'AUTO';
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      help = true;
    } else if (arg === '-o' || arg === '--output') {
      outputPath = argv[++i] ?? null;
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

  return { inputPath, outputPath, direction, help };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function printUsage(): void {
  const msg = [
    'Usage: xstate-diagram [input.json] [-o output.svg] [--direction auto|right|down]',
    '',
    'Options:',
    '  -o, --output <file>       Write SVG output to file (defaults to stdout)',
    '  -d, --direction <dir>     Layout direction: auto (default), right, or down',
    '  -h, --help                Show this help message',
  ].join('\n');
  process.stdout.write(`${msg}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  let rawJson: string;
  if (args.inputPath) {
    rawJson = await readFile(resolve(args.inputPath), 'utf8');
  } else if (!process.stdin.isTTY) {
    rawJson = await readStdin();
  } else {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const config = JSON.parse(rawJson) as unknown;
  const svg = await renderMachineToSvg(config, { direction: args.direction });

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
