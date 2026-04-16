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
npx mmdc -i "$MERMAID_OUT" -o "$PROOF_SVG"
echo "Syntax validated and $PROOF_SVG generated."

echo "Executing Semantic Validation using gemini cli..."

# Construct the payload dynamically, replacing the template tokens
PROMPT_CONTENT=$(cat "$PROMPT_FILE")
JSON_CONTENT=$(cat "$JSON_SPEC")
MERMAID_CONTENT=$(cat "$MERMAID_OUT")

# Replace tokens
# Using bash parameter expansion if tokens are simple, or awk. Awk is safer for multiline:
awk -v json="$JSON_CONTENT" -v mermaid="$MERMAID_CONTENT" '{
  gsub(/{source_json}/, json)
  gsub(/{mermaid_output}/, mermaid)
  print
}' "$PROMPT_FILE" > .tmp_prompt.txt

# Pipe to gemini CLI. (Using standard piping approach common to CLI llm tools)
cat .tmp_prompt.txt | gemini

rm .tmp_prompt.txt

echo -e "\n----------------------------------"
echo "Proof successfully generated! Include $PROOF_SVG and the text above in the PR."
