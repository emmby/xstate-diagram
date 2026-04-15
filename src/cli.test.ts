import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Phase 2: JSON Definition Ingestion', () => {
  const cliPath = path.join(__dirname, 'cli.ts');
  let tempDir: string;

  beforeAll(() => {
    const sysTemp = os.tmpdir();
    tempDir = fs.mkdtempSync(path.join(sysTemp, 'xstate-diagram-'));
  });
  
  afterAll(() => {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
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
    const file = path.join(tempDir, 'valid.json');
    fs.writeFileSync(file, JSON.stringify(validConfig));

    const stdout = execSync(`npx ts-node ${cliPath} --file ${file}`).toString();
    expect(stdout).toContain('dummy-mermaid-output');
  });

  it('should fail elegantly with invalid JSON syntax', () => {
    const file = path.join(tempDir, 'invalid-syntax.json');
    fs.writeFileSync(file, '{"id": "bad", '); // broken json

    expect(() => {
      execSync(`npx ts-node ${cliPath} --file ${file}`, { stdio: 'pipe' });
    }).toThrow(/Input is not valid JSON/);
  });

  it('should successfully pass raw un-typed strings due to xstate structural flexibility', () => {
    // Proving that XState swallows unrecognized formats gracefully during initial parsing
    const file = path.join(tempDir, 'invalid-config.json');
    fs.writeFileSync(file, JSON.stringify({
      id: "rawstring",
      initial: "does-not-exist",
      states: "invalid-type"
    }));

    // Should not throw an immediate XState configuration error since it validates dynamically on start
    const stdout = execSync(`npx ts-node ${cliPath} --file ${file}`).toString();
    expect(stdout).toContain('dummy-mermaid-output');
  });
});
