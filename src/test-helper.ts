import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

export function extractSvgVisibleTexts(svgContent: string): string[] {
  const texts: string[] = [];
  const blockRegex = /<(?:foreignObject|text)\b[^>]*>([\s\S]*?)<\/(?:foreignObject|text)>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(svgContent)) !== null) {
    const inner = match[1]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (inner) {
      texts.push(inner);
    }
  }
  return texts;
}

export function renderMermaidSvg(mermaidStr: string, name = 'diagram'): string {
  const sysTemp = os.tmpdir();
  const uuid = crypto.randomUUID();
  const tmpIn = path.join(sysTemp, `${name}-${uuid}.mermaid`);
  const tmpOut = path.join(sysTemp, `${name}-${uuid}.svg`);

  fs.writeFileSync(tmpIn, mermaidStr);
  try {
    const puppeteerConfig = path.join(__dirname, '../puppeteer-config.json');
    execSync(`npx mmdc -i ${tmpIn} -o ${tmpOut} -p ${puppeteerConfig}`, { stdio: 'pipe' });
    return fs.readFileSync(tmpOut, 'utf8');
  } catch (err: any) {
    throw new Error(`Mermaid validation failed for ${name}: ${err.message}\n${err.stderr?.toString()}`);
  } finally {
    if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
  }
}

export function assertValidMermaid(mermaidStr: string, snapshotName: string): string {
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

  // Syntax and rendered SVG validation via mermaid-cli
  const svgContent = renderMermaidSvg(mermaidStr, snapshotName);
  const visibleTexts = extractSvgVisibleTexts(svgContent);
  const joinedVisibleText = visibleTexts.join('\n');

  // 1. Rendered SVG text elements must never contain literal \n
  for (const text of visibleTexts) {
    if (text.includes('\\n')) {
      throw new Error(`Rendered SVG for ${snapshotName} contains literal "\\n" in visible text: ${JSON.stringify(text)}`);
    }
  }

  // 2. Aliased states (state "Label" as safeId) must not display internal prefixed safeId as visible node text
  const stateAliasRegex = /^\s*state\s+"((?:\\"|[^"])*)"\s+as\s+([a-zA-Z0-9_]+)/gm;
  let match: RegExpExecArray | null;
  while ((match = stateAliasRegex.exec(mermaidStr)) !== null) {
    const rawLabel = match[1].replace(/\\"/g, '"');
    const safeId = match[2];
    const baseLabel = rawLabel.split('<br/>')[0];
    if (safeId !== baseLabel && visibleTexts.includes(safeId)) {
      throw new Error(
        `Rendered SVG for ${snapshotName} displays internal safeId "${safeId}" instead of label "${baseLabel}"`
      );
    }
  }

  // 3. Every entry / <action> and exit / <action> must appear in rendered SVG text
  const actionRegex = /(?:entry|exit)\s+\/\s+[^\s"<\\]+/g;
  const expectedActions = mermaidStr.match(actionRegex) || [];
  for (const expectedAction of expectedActions) {
    if (!joinedVisibleText.includes(expectedAction)) {
      throw new Error(
        `Rendered SVG for ${snapshotName} is missing action annotation "${expectedAction}" in visible text`
      );
    }
  }

  return svgContent;
}
