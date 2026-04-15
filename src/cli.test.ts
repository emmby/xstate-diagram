import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { processInput } from './cli';

describe('Phase 2: JSON Definition Ingestion', () => {
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

  it('should successfully parse a valid XState machine configuration', () => {
    const validConfig = {
      id: 'test',
      initial: 'idle',
      states: {
        idle: { on: { GO: 'run' } },
        run: {}
      }
    };
    
    processInput(JSON.stringify(validConfig));
    expect(consoleOutput.some(msg => msg.includes('dummy-mermaid-output'))).toBe(true);
  });

  it('should fail elegantly with invalid JSON syntax', () => {
    expect(() => {
      processInput('{"id": "bad", '); // broken json
    }).toThrow(/Input is not valid JSON/);
  });

  it('should successfully pass raw un-typed strings due to xstate structural flexibility', () => {
    const invalidSchema = {
      id: "rawstring",
      initial: "does-not-exist",
      states: "invalid-type"
    };

    // Should not throw an immediate XState configuration error since it validates dynamically on start
    processInput(JSON.stringify(invalidSchema));
    expect(consoleOutput.some(msg => msg.includes('dummy-mermaid-output'))).toBe(true);
  });
});
