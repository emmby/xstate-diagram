import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createMachine } from 'xstate';
import { processInput } from './cli';
import { compile } from './compiler';
import { assertValidMermaid } from './test-helper';

describe('Phase 3: Basic Mermaid String Compilation', () => {
  let originalConsoleLog: any;
  let consoleOutput: string[] = [];

  beforeAll(() => {
    originalConsoleLog = console.log;
  });
  
  beforeEach(() => {
    consoleOutput = [];
    console.log = (msg: string) => { consoleOutput.push(msg); };
  });

  afterAll(() => {
    console.log = originalConsoleLog;
  });

  const supportedDir = path.join(__dirname, '../specs/supported');
  
  function getTestCases(dir: string): { desc: string, name: string, fullPath: string }[] {
    if (!fs.existsSync(dir)) return [];
    let cases: any[] = [];
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
         cases = cases.concat(getTestCases(fullPath));
      } else if (file.endsWith('.json')) {
         const relPath = path.relative(supportedDir, fullPath);
         // Flatten nested names so snapshotting works without subfolders natively:
         const name = relPath.replace(/\.json$/, '').replace(new RegExp('\\' + path.sep, 'g'), '_');
         cases.push({ desc: `should compile supported spec dynamically: ${relPath}`, name, fullPath });
      }
    }
    return cases;
  }

  const testCases = getTestCases(supportedDir);

  testCases.forEach(({ desc, name, fullPath }) => {
    it(desc, () => {
      const validConfig = fs.readFileSync(fullPath, 'utf8');
      
      processInput(validConfig);
      assertValidMermaid(consoleOutput[0], name);
    });
  });

  it('should fail elegantly with invalid JSON syntax', () => {
    expect(() => {
      processInput('{"id": "bad", '); // broken json
    }).toThrow(/Input is not valid JSON/);
  });

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
});
