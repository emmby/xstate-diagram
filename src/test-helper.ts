import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

export function assertValidMermaid(mermaidStr: string, snapshotName: string) {
  const snapshotDir = path.join(__dirname, '__snapshots__');
  const snapshotPath = path.join(snapshotDir, snapshotName + '.mermaid');
  
  if (!fs.existsSync(snapshotDir)) {
    fs.mkdirSync(snapshotDir, { recursive: true });
  }

  // Golden Snapshot text matching
  const existing = fs.existsSync(snapshotPath) ? fs.readFileSync(snapshotPath, 'utf8') : null;
  if (existing && existing !== mermaidStr) {
     if (process.env.UPDATE_SNAPSHOTS) {
       fs.writeFileSync(snapshotPath, mermaidStr);
     } else {
       throw new Error(`Snapshot mismatch for ${snapshotName}. Run with UPDATE_SNAPSHOTS=1 to update.`);
     }
  } else if (!existing) {
     fs.writeFileSync(snapshotPath, mermaidStr);
  }

  // Syntax validation via mermaid-cli
  const sysTemp = os.tmpdir();
  const uuid = crypto.randomUUID();
  const tmpIn = path.join(sysTemp, `${snapshotName}-${uuid}.mermaid`);
  const tmpOut = path.join(sysTemp, `${snapshotName}-${uuid}.svg`);
  
  fs.writeFileSync(tmpIn, mermaidStr);
  try {
     const puppeteerConfig = path.join(__dirname, '../puppeteer-config.json');
     execSync(`npx mmdc -i ${tmpIn} -o ${tmpOut} -p ${puppeteerConfig}`, { stdio: 'pipe' });
  } catch (err: any) {
     throw new Error(`Mermaid validation failed for ${snapshotName}: ${err.message}\n${err.stderr?.toString()}`);
  } finally {
     if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
     if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
  }
}
