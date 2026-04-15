import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { processInput } from './cli';

describe('Phase 3: Basic Mermaid String Compilation', () => {
  let tempDir: string;
  let originalConsoleLog: any;
  let consoleOutput: string[] = [];

  beforeAll(() => {
    const sysTemp = os.tmpdir();
    tempDir = fs.mkdtempSync(path.join(sysTemp, 'xstate-diagram-'));
    originalConsoleLog = console.log;
  });
  
  beforeEach(() => {
    consoleOutput = [];
    console.log = (msg: string) => { consoleOutput.push(msg); };
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    console.log = originalConsoleLog;
  });

  it('should compile a basic flat state machine mapping reliably', () => {
    const validConfig = {
      id: 'basic',
      initial: 'idle',
      states: {
        idle: { on: { GO: 'run' } },
        run: {}
      }
    };
    
    processInput(JSON.stringify(validConfig));
    expect(consoleOutput[0]).toMatchInlineSnapshot(`
"stateDiagram-v2
  [*] --> idle
  idle --> run : GO
"
`);
  });

  it('should stringently map transition events with guards and multifaceted actions', () => {
    const complexTransitionConfig = {
      id: 'advanced',
      initial: 'idle',
      states: {
        idle: {
          on: {
            GO: {
              target: 'run',
              guard: 'isReady',
              actions: ['logStart', { type: 'metrics' }]
            }
          }
        },
        run: {}
      }
    };
    
    processInput(JSON.stringify(complexTransitionConfig));
    expect(consoleOutput[0]).toMatchInlineSnapshot(`
"stateDiagram-v2
  [*] --> idle
  idle --> run : GO [isReady] / logStart, metrics
"
`);
  });

  it('should map flat self-transitions gracefully', () => {
    const selfConfig = {
      id: 'ping',
      initial: 'active',
      states: {
        active: {
          on: {
            BEAT: { actions: 'logSelf' }
          }
        }
      }
    };
    
    processInput(JSON.stringify(selfConfig));
    expect(consoleOutput[0]).toMatchInlineSnapshot(`
"stateDiagram-v2
  [*] --> active
  active --> active : BEAT / logSelf
"
`);
  });

  it('should fail elegantly with invalid JSON syntax', () => {
    expect(() => {
      processInput('{"id": "bad", '); // broken json
    }).toThrow(/Input is not valid JSON/);
  });
});
