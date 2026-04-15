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
  state "idle" as basic_idle
  state "run" as basic_run
  [*] --> basic_idle
  basic_idle --> basic_run : GO
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
  state "idle" as advanced_idle
  state "run" as advanced_run
  [*] --> advanced_idle
  advanced_idle --> advanced_run : GO [isReady] / logStart, metrics
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
  state "active" as ping_active
  [*] --> ping_active
  ping_active --> ping_active : BEAT / logSelf
"
`);
  });

  it('should implement safe aliases when parsing keys with spaces or special characters', () => {
    const spaceConfig = {
      id: 'MyApp',
      initial: 'start state',
      states: {
        'start state': {
          on: {
            'NEXT STEP': 'end-state'
          }
        },
        'end-state': {}
      }
    };
    
    processInput(JSON.stringify(spaceConfig));
    expect(consoleOutput[0]).toMatchInlineSnapshot(`
"stateDiagram-v2
  state "start state" as MyApp_start_state
  state "end-state" as MyApp_end_state
  [*] --> MyApp_start_state
  MyApp_start_state --> MyApp_end_state : NEXT STEP
"
`);
  });

  it('should fail elegantly with invalid JSON syntax', () => {
    expect(() => {
      processInput('{"id": "bad", '); // broken json
    }).toThrow(/Input is not valid JSON/);
  });
});
