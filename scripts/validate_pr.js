require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function executeValidation(jsonSpecPath, mermaidOutputPath) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY environment variable is missing. Cannot execute remote AI validation.');
  }

  const ai = new GoogleGenAI({ apiKey });
  const promptTemplate = fs.readFileSync(path.join(__dirname, '../prompts/semantic_validation.md'), 'utf8');

  if (!fs.existsSync(jsonSpecPath)) {
    throw new Error(`JSON spec not found at: ${jsonSpecPath}`);
  }
  if (!fs.existsSync(mermaidOutputPath)) {
    throw new Error(`Mermaid output not found at: ${mermaidOutputPath}`);
  }

  const sourceJson = fs.readFileSync(jsonSpecPath, 'utf8');
  const mermaidOutput = fs.readFileSync(mermaidOutputPath, 'utf8');
  
  const filledPrompt = promptTemplate
    .replace('{source_json}', sourceJson)
    .replace('{mermaid_output}', mermaidOutput);

  console.log('Validating Mermaid Syntax with mmdc...');
  const proofImgPath = path.join(__dirname, '../specs/001_proof.svg');
  if (!fs.existsSync(path.dirname(proofImgPath))) {
    fs.mkdirSync(path.dirname(proofImgPath), { recursive: true });
  }

  try {
    execSync(`npx mmdc -i "${mermaidOutputPath}" -o "${proofImgPath}"`, { stdio: 'inherit' });
  } catch (err) {
    throw new Error(`mmdc validation failed: ${err.message}`);
  }
  
  console.log('Executing Semantic Validation using Gemini 3.0 Flash...');
  const response = await ai.models.generateContent({
    model: 'gemini-3.0-flash',
    contents: filledPrompt
  });

  console.log('\\n----- SEMANTIC MATCH PROOF -----\\n');
  console.log(response.text);
  console.log('\\n----------------------------------\\n');
  console.log('Proof successfully generated! Include specs/001_proof.svg and the text above in the PR.');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: node validate_pr.js <path_to_json_spec> <path_to_mermaid_output>");
    process.exit(1);
  }
  
  executeValidation(args[0], args[1]).catch(err => {
    console.error("Validation failed:", err.message);
    process.exit(1);
  });
}

module.exports = { executeValidation };
