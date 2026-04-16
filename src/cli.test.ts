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
});
