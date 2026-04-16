import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { processInput } from './cli';
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

  const testCases = [
    { desc: 'should compile a basic flat state machine mapping reliably', name: 'basic_flat_machine' },
    { desc: 'should stringently map transition events with guards and multifaceted actions', name: 'advanced_transitions' },
    { desc: 'should map flat self-transitions gracefully', name: 'self_transitions' },
    { desc: 'should implement safe aliases when parsing keys with spaces or special characters', name: 'safe_aliases' }
  ];

  testCases.forEach(({ desc, name }) => {
    it(desc, () => {
      const specPath = path.join(__dirname, `../specs/${name}.json`);
      const validConfig = fs.readFileSync(specPath, 'utf8');
      
      processInput(validConfig);
      assertValidMermaid(consoleOutput[0], name);
    });
  });

  it('should fail elegantly with invalid JSON syntax', () => {
    expect(() => {
      processInput('{"id": "bad", '); // broken json
    }).toThrow(/Input is not valid JSON/);
  });
});
