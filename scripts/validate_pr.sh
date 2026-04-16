#!/bin/bash
set -e

if [ "$#" -ne 2 ]; then
  echo "Usage: ./scripts/validate_pr.sh <path_to_json_spec> <path_to_mermaid_output>"
  exit 1
fi

JSON_SPEC=$1
MERMAID_OUT=$2
PROMPT_FILE="prompts/semantic_validation.md"
PROOF_SVG="specs/001_proof.svg"

# Ensure all files exist
if [ ! -f "$JSON_SPEC" ]; then echo "Error: $JSON_SPEC not found"; exit 1; fi
if [ ! -f "$MERMAID_OUT" ]; then echo "Error: $MERMAID_OUT not found"; exit 1; fi
if [ ! -f "$PROMPT_FILE" ]; then echo "Error: $PROMPT_FILE not found"; exit 1; fi

mkdir -p specs

echo "Validating Mermaid Syntax with mmdc..."
npx mmdc -i "$MERMAID_OUT" -o "$PROOF_SVG" -p puppeteer-config.json
echo "Syntax validated and $PROOF_SVG generated."

echo "Executing Semantic Validation using gemini cli..."

# Construct the payload dynamically, replacing the template tokens
PROMPT_CONTENT=$(cat "$PROMPT_FILE")
JSON_CONTENT=$(cat "$JSON_SPEC")
MERMAID_CONTENT=$(cat "$MERMAID_OUT")

export JSON_CONTENT
export MERMAID_CONTENT

perl -p -e 's/\{source_json\}/$ENV{JSON_CONTENT}/g; s/\{mermaid_output\}/$ENV{MERMAID_CONTENT}/g' "$PROMPT_FILE" > .tmp_prompt.txt

# Pipe to gemini CLI and capture output
VALIDATION_OUTPUT=$(cat .tmp_prompt.txt | gemini)
echo "$VALIDATION_OUTPUT"

rm .tmp_prompt.txt

# Grep through the model's text string for failures
if echo "$VALIDATION_OUTPUT" | grep -q "FAIL\|❌"; then
  echo -e "\n----------------------------------"
  echo "Validation FAILED. Please review the missing nodes above and correct your Mermaid definition."
  exit 1
fi

echo -e "\n----------------------------------"
echo "Proof successfully generated! Include $PROOF_SVG and the text above in the PR."
