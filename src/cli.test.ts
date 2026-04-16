import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { processInput } from './cli';
import { assertValidMermaid } from './test-helper';

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
    assertValidMermaid(consoleOutput[0], 'basic_flat_machine');
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
    assertValidMermaid(consoleOutput[0], 'advanced_transitions');
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
    assertValidMermaid(consoleOutput[0], 'self_transitions');
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
    assertValidMermaid(consoleOutput[0], 'safe_aliases');
  });

  it('should fail elegantly with invalid JSON syntax', () => {
    expect(() => {
      processInput('{"id": "bad", '); // broken json
    }).toThrow(/Input is not valid JSON/);
  });
});
