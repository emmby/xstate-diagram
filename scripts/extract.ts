import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

const seenSignatures = new Set<string>();

function sanitizeKey(key: string): string {
    return key.replace(/['"]/g, '');
}

function processNode(node: ts.Node, sourceFile: ts.SourceFile): any {
    if (ts.isObjectLiteralExpression(node)) {
        const obj: any = {};
        for (const prop of node.properties) {
            if (ts.isPropertyAssignment(prop)) {
                const key = sanitizeKey(prop.name.getText(sourceFile));
                obj[key] = processNode(prop.initializer, sourceFile);
            }
        }
        return obj;
    }
    
    if (ts.isArrayLiteralExpression(node)) {
        return node.elements.map(el => processNode(el, sourceFile));
    }
    
    if (ts.isStringLiteral(node)) {
        return node.getText(sourceFile).replace(/^['"]|['"]$/g, '');
    }
    
    if (ts.isNumericLiteral(node)) {
        return Number(node.getText(sourceFile));
    }
    
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    
    // Fallback: capture native raw text unconditionally to prevent AST truncation!
    return `[Node: ${node.getText(sourceFile)}]`;
}

function extractMachines(sourceCode: string, filePath: string) {
    const sourceFile = ts.createSourceFile('temp.ts', sourceCode, ts.ScriptTarget.Latest, true);
    let index = 1;
    const categoryName = path.basename(filePath, '.test.ts');
    
    const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.expression.getText(sourceFile) === 'createMachine') {
            const configArg = node.arguments[0];
            if (configArg && ts.isObjectLiteralExpression(configArg)) {
                const machineConfig = processNode(configArg, sourceFile);
                const signature = JSON.stringify(machineConfig);
                
                if (!seenSignatures.has(signature)) {
                    seenSignatures.add(signature);
                    
                    const outDir = path.join('specs/unsupported', categoryName);
                    if (!fs.existsSync(outDir)) {
                        fs.mkdirSync(outDir, { recursive: true });
                    }
                    
                    const outPath = path.join(outDir, `${index.toString().padStart(3, '0')}.json`);
                    fs.writeFileSync(outPath, JSON.stringify(machineConfig, null, 2));
                    console.log(`Extracted: ${outPath}`);
                    index++;
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    
    visit(sourceFile);
}

const inputDir = '.tmp/xstate/packages/core/test';
const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.test.ts'));

for (const file of files) {
    const filePath = path.join(inputDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    extractMachines(content, filePath);
}
