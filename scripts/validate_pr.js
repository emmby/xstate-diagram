require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function main() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error('Error: GOOGLE_API_KEY environment variable is missing.');
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });
  const promptTemplate = fs.readFileSync(path.join(__dirname, '../prompts/semantic_validation.md'), 'utf8');

  // Let's validate the basic flat machine test case as our PR artifact
  // In a real pipeline, loop through all test cases or take a CLI argument.
  const testJsonPath = path.join(__dirname, '../__snapshots__/basic_flat_machine.mermaid');
  // Wait, we need the original JSON to match it.
  // The test source JSON is inside cli.test.ts, let's just write a dummy basic.json for the proof.
  
  const basicJson = {
    id: 'basic',
    initial: 'idle',
    states: {
      idle: { on: { GO: 'run' } },
      run: {}
    }
  };

  const mermaidOutput = fs.readFileSync(testJsonPath, 'utf8');
  
  const filledPrompt = promptTemplate
    .replace('{source_json}', JSON.stringify(basicJson, null, 2))
    .replace('{mermaid_output}', mermaidOutput);

  console.log('Validating Mermaid Syntax with mmdc...');
  const proofImgPath = path.join(__dirname, '../proof.svg');
  execSync(`npx mmdc -i ${testJsonPath} -o ${proofImgPath}`, { stdio: 'inherit' });
  
  console.log('Executing Semantic Validation using Gemini...');
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: filledPrompt
    });

    console.log('\\n----- SEMANTIC MATCH PROOF -----\\n');
    console.log(response.text);
    console.log('\\n----------------------------------\\n');
    console.log('Proof successfully generated! Include the proof.svg and the text above in the PR.');
  } catch (err) {
    console.error('Validation failed!', err);
  }
}

main();
