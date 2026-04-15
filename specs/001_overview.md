# Requirements Document: xstate-diagram CLI

## 1. Overview
A CLI tool that converts XState V5 state machine descriptions into Mermaid diagrams, and subsequently exports those diagrams into various image formats (SVG, PNG, etc.). The entire project is to be generated using AI.

## 2. Core Features
- Input: XState V5 state machine definitions.
- Processing: Convert state machine definitions to Mermaid diagram syntax.
- Output: Export Mermaid diagrams into image formats (SVG, PNG).

## 3. Implementation Strategy & Validation
- **Iterative Growth**: Begin by implementing support for one `xstate5` test case at a time. Each test case and the corresponding code implementation will be a separate Pull Request.
- **Validation Options**:
  - *Option A*: Use existing `xstate5` test cases. Since we lack reference images for these, we will need a strategy to validate the output accuracy.
  - *Option B (Conformance Suite)*: Find publicly available XState JSON definitions that already have accompanying Mermaid diagrams to use as a ground truth for conformance testing.

---

## Interview Questions & Notes

**Q1: How will the CLI ingest the XState V5 machine definitions?**
- **User Answer:** The definitions are split between `setup()` and `createMachine()`. Is there a serialized format that combines these two?
- **Analysis:** XState V5 does not natively provide a standard JSON serialization format for code-generated machines unless they are specifically exported from the Stately visual editor. Since machines are defined via `setup({...}).createMachine({...})`, the implementations (actions, guards, delays) often contain compiled JavaScript functions, which do not serialize cleanly to JSON. 
- **Potential Parsers**:
  - **AST Parsing**: Utilizing `@xstate/machine-extractor` (the library Stately uses internally) to statically parse TS/JS files via the TypeScript compiler API.
  - **Runtime Execution**: Importing the JS/TS file via Node/V8 and directly inspecting the instantiated machine's `.config` object.
- **User Update:** For the Mermaid diagram, we likely only need the `createMachine()` definition, not the `setup()` config, as the graph paths and transitions are fully described within `createMachine()`.
- **Conclusion:** This suggests AST Parsing (Option A) may be the most elegant solution. If we only care about the structural graph, statically extracting the `createMachine` argument via AST will give us everything we need for Mermaid, completely avoiding the complexities of executing arbitrary TypeScript files at runtime.

**Q2/Q3: CLI Input and Output Semantics**
- **CLI Input:** The CLI will accept a file path as an argument, or read the machine definition directly from `stdin`.
- **CLI Output:** The CLI will output the formatted Mermaid diagram string to `stdout` by default, keeping it composable as a standard Unix pipeline tool.

**Q4: Image Generation Strategy**
- **User Answer:** Use an "All-in-one" approach (Option A).
- **Implementation Note:** The CLI will internally handle image generation by bundling a headless rendering engine (e.g., Puppeteer/Playwright with Mermaid.js) rather than offloading to an external binary. It will expose a flag (like `--format=svg` or `--format=png`) to instruct the CLI to render and output the image directly.

**Q5: Diagram Detail & Progression**
- **Edge Labeling:** The generated diagram edges must be stringent, including the event trigger, guards, and actions formatted typically as `EVENT [guard] / action`.
- **Complexity Progression:** The project will avoid front-loading complex features (hierarchical, parallel, history states). Instead, XState test cases will be grouped and ordered from least to most complex. This will naturally dictate the project phases, introducing advanced XState features organically.

---

## 4. Implementation Phases

**Phase 1: Project Skeleton & CLI Foundation**
- **Goal**: Set up the Node.js/TypeScript project and CLI argument parsing.
- **Acceptance Criteria**: 
  - The CLI runs successfully via the command line.
  - Accepts a file path or reads from `stdin` correctly.
  - Outputs a basic dummy string to `stdout` to verify the Unix pipeline functionality.

**Phase 2: Fundamental AST Extraction**
- **Goal**: Integrate `@xstate/machine-extractor` to parse a TypeScript file.
- **Acceptance Criteria**: 
  - Given a simple flat state machine, the CLI accurately extracts the machine config (`createMachine` argument) from the AST without executing user code.

**Phase 3: Basic Mermaid String Compilation**
- **Goal**: Translate the extracted XState config into a Mermaid state diagram string.
- **Acceptance Criteria**: 
  - The CLI outputs a basic `stateDiagram-v2` string to `stdout` representing basic states and transitions.
  - Transition edges perfectly follow the stringent `EVENT [guard] / action` structure.

**Phase 4: Agentic Validation Framework**
- **Goal**: Establish a rigorous validation safety net utilizing LLMs as PR reviewers to guarantee semantic translation correctness without heavy CI infrastructure.
- **Acceptance Criteria**:
  - **Universal Golden Snapshots (CI)**: Every single test case implemented MUST generate and commit a `.mermaid` "Golden Snapshot" artifact alongside the PR. In CI, strict text snapshot testing ensures deterministic regression prevention across the entire test suite. Additionally, all generated strings must pass through the `@mermaid-js` parser to assert syntactical validity.
  - **Semantic LLM Proof (Agent Workflow)**: The AI Agent responsible for generating the PR must execute a semantic validation prompt (via subagent or `gemini` CLI). It will compare the XState source file with the generated Mermaid output and rigorously verify that all states, transitions, actions, and guards are correctly mapped.
  - **PR Artifact**: The AI Agent MUST explicitly include the outputted semantic validation proof directly in the Pull Request description so the human reviewer can safely validate the conversion efficiency.
  - **Feedback Loop & Prompt Evolution**: If a human reviewer identifies a flaw in the generated diagram that the LLM proof missed, the human manually corrects the Golden Snapshot. Crucially, **the LLM semantic validation prompt itself must be updated** to explicitly instruct the LLM on how to catch that specific failure scenario in all future automated PR checks.

**Phase 5: Feature Scaling (The Test Suite Iteration)**
- **Goal**: Iteratively grow support for advanced XState features utilizing the `xstate5` test suite, ordered from simplest to most complex, with every PR gated by the Validation Infrastructure.
- **Acceptance Criteria**: 
  - Iteration 1: Implement hierarchical (nested) states.
  - Iteration 2: Implement parallel (orthogonal) regions.
  - Iteration 3: Expand support for delays, history nodes, null events/always transitions, etc.
  - *(Each test case supported is gated by the Agentic Validation framework and landed via an individual PR)*

**Phase 6: Internal Image Rendering Engine**
- **Goal**: Establish the headless browser rendering pipeline for direct image outputs.
- **Acceptance Criteria**: 
  - Supplying `--format=svg` or `--format=png` to the CLI invokes a headless engine (Puppeteer/Playwright).
  - The CLI successfully renders the Mermaid structure and outputs a valid `.svg` or `.png` graphic.

---

## Appendix: Alternatives Considered for Validation

### 1. Functional Traversal Validation (Model-Based Testing)
**Approach**: Execute `@xstate/graph`'s `toDirectedGraph(machine)` in CI to generate the mathematical ground truth of all transitions from the actual XState engine. Parse the outputted Mermaid diagram into a generic graph and mathematically assert that all demanded edges/actions/guards are present.
**Reason for Rejection**: High initial engineering effort to build and maintain the downstream Mermaid graph parser simply for making testing comparisons. Given the entirely AI-driven nature of this project's development, pushing this verification to the Agent Context during PR generation is vastly more pragmatic.

### 2. LLM Arbiter via GitHub Actions (CI)
**Approach**: Run an LLM prompt as a mandatory blocking GitHub Action on every PR to semantically verify the Mermaid code against the source.
**Reason for Rejection**: Running LLMs dynamically in a CI block is slow, non-deterministic (flake risk), and incurs continuous API costs. Executing this step strictly by the "Agent PR Creator" prior to opening the PR solves this.

### 3. Visual Layout Regression Testing (VLM)
**Approach**: Generate an SVG and pass it to a Vision LLM to verify layout overlaps and semantic correctness.
**Reason for Rejection**: Vision models lack the rigorous path-counting and strict text-reading capabilities required to algorithmically prove a deterministic state machine's logic is flawlessly represented visually out of the box.
