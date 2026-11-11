import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

const seenSignatures = new Set<string>();

function sanitizeKey(key: string): string {
  return key.replace(/['"]/g, '');
}

function processNode(node: ts.Node, sourceFile: ts.SourceFile): unknown {
  if (ts.isObjectLiteralExpression(node)) {
    const obj: Record<string, unknown> = {};
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const key = sanitizeKey(prop.name.getText(sourceFile));
        obj[key] = processNode(prop.initializer, sourceFile);
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        const key = prop.name.text;
        obj[key] = `[Node: ${key}]`;
      } else if (ts.isMethodDeclaration(prop)) {
        const key = sanitizeKey(prop.name.getText(sourceFile));
        obj[key] = `[Node: ${prop.getText(sourceFile)}]`;
      }
    }
    return obj;
  }

  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((el) => processNode(el, sourceFile));
  }

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  if (ts.isNumericLiteral(node)) {
    return Number(node.text);
  }

  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;

  // Fallback: capture raw TypeScript AST expression text to avoid truncation.
  return `[Node: ${node.getText(sourceFile)}]`;
}

function extractMachines(
  sourceCode: string,
  filePath: string,
  outputRoot: string,
): void {
  const sourceFile = ts.createSourceFile(
    'temp.ts',
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
  );
  let index = 1;
  const categoryName = path.basename(filePath, '.test.ts');

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile) === 'createMachine'
    ) {
      const configArg = node.arguments[0];
      if (configArg && ts.isObjectLiteralExpression(configArg)) {
        const machineConfig = processNode(configArg, sourceFile);
        const signature = JSON.stringify(machineConfig);

        if (!seenSignatures.has(signature)) {
          seenSignatures.add(signature);

          const outDir = path.join(outputRoot, categoryName);
          if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
          }

          const outPath = path.join(
            outDir,
            `${index.toString().padStart(3, '0')}.json`,
          );
          fs.writeFileSync(
            outPath,
            `${JSON.stringify(machineConfig, null, 2)}\n`,
            'utf8',
          );
          console.log(`Extracted: ${outPath}`);
          index++;
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

function main(): void {
  const inputDir = process.argv[2] || '.tmp/xstate/packages/core/test';
  const outputRoot = process.argv[3] || 'tests/xstate-core-specs/extracted';

  if (!fs.existsSync(inputDir)) {
    throw new Error(`Input directory not found: ${inputDir}`);
  }

  const files = fs
    .readdirSync(inputDir)
    .filter((f) => f.endsWith('.test.ts'))
    .sort();

  for (const file of files) {
    const filePath = path.join(inputDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    extractMachines(content, filePath, outputRoot);
  }
}

main();
