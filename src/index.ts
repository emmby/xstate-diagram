import { extractFromMachine } from './ast/extract-machine.js';
import type { StatechartAST } from './ast/types.js';
import {
  layoutStatechart,
  type LayoutDirection,
  type LayoutOptions,
} from './renderer/elk-graph.js';
import { renderDiagramToSvg } from './renderer/svg-render.js';

export type { LayoutDirection };
export type RenderOptions = LayoutOptions;

/**
 * Converts an XState v5 StateMachine or raw machine configuration object
 * into a standalone, publication-quality SVG statechart diagram.
 */
export async function renderMachineToSvg(
  machineOrConfig: unknown,
  options?: RenderOptions,
): Promise<string> {
  const ast = extractFromMachine(machineOrConfig);
  return renderAstToSvg(ast, options);
}

/**
 * Renders a pre-extracted StatechartAST directly to an SVG string.
 */
export async function renderAstToSvg(
  ast: StatechartAST,
  options?: RenderOptions,
): Promise<string> {
  const diagram = await layoutStatechart(ast, options);
  return renderDiagramToSvg(diagram, ast);
}

export { extractFromMachine } from './ast/extract-machine.js';
export type {
  InternalTransitionRowAST,
  InvocationAST,
  StatechartAST,
  StateNodeAST,
  StateNodeType,
  TransitionAST,
} from './ast/types.js';
export { DEFAULT_THEME, type ThemeTokens } from './renderer/theme.js';
