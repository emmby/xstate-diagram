#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs';
import { createMachine } from 'xstate';
import { compile } from './compiler';

const program = new Command();

program
  .name('xstate-diagram')
  .description('Convert XState V5 machine definitions into Mermaid state diagrams')
  .version('0.0.1')
  .option('-f, --file <path>', 'Path to the XState JSON configuration file')
  .action((options) => {
    // Determine if we are reading from file or stdin
    if (options.file) {
      try {
        const fileContent = fs.readFileSync(options.file, 'utf8');
        processInput(fileContent);
      } catch (err) {
        console.error(`Error:`, err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    } else {
      // Read from stdin
      let inputData = '';
      
      // If stdin is not a TTY, we might have data piped in
      if (!process.stdin.isTTY) {
        process.stdin.setEncoding('utf8');
        
        process.stdin.on('data', (chunk) => {
          inputData += chunk;
        });

        process.stdin.on('end', () => {
          if (!inputData.trim()) {
            console.error('Error: No data provided via stdin. Please use --file or pipe data.');
            program.help({ error: true });
          }
          try {
            processInput(inputData);
          } catch (err) {
            console.error(`Error:`, err instanceof Error ? err.message : String(err));
            process.exit(1);
          }
        });
        
        process.stdin.on('error', (err) => {
          console.error('Error reading from stdin:', err);
          process.exit(1);
        });
      } else {
        console.error('Error: No input provided. Please use --file or pipe data via stdin.');
        program.help({ error: true });
      }
    }
  });

export function processInput(input: string) {
  let parsedJson;
  try {
    parsedJson = JSON.parse(input);
  } catch (err) {
    throw new Error(`Input is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const machine = createMachine(parsedJson);
    console.log(compile(machine));
  } catch (err) {
    throw new Error(`Invalid XState configuration: ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (require.main === module) {
  program.parse(process.argv);
}
