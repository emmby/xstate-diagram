export type StateNodeType = 'atomic' | 'compound' | 'parallel' | 'final' | 'history';

export interface InvocationAST {
  id: string | null;
  src: string;
}

export interface InternalTransitionRowAST {
  eventType: string;
  order: number;
  guard: string | null;
  actions: string[];
}

export interface StateNodeAST {
  /** Full dot-delimited XState state node ID, e.g. "machine.active.loading" */
  id: string;
  /** Local key name displayed in the state header, e.g. "loading" */
  key: string;
  /** Harel statechart node classification */
  type: StateNodeType;
  /** Present only when type === 'history' */
  historyKind: 'shallow' | 'deep' | null;
  /** Parent state node ID, or null for the root machine container (or top-level children of root) */
  parentId: string | null;
  /** Child state ID for initial pseudostate indicator (● -> initialTargetId), if compound */
  initialTargetId: string | null;

  /** Compartment metadata rendered inside the state box */
  entryActions: string[];
  exitActions: string[];
  invocations: InvocationAST[];
  internalTransitions: InternalTransitionRowAST[];
  tags: string[];
}

export interface TransitionAST {
  /** Deterministic transition identifier: `${sourceId}__${eventType}__${order}` */
  id: string;
  /** Source state node ID */
  sourceId: string;
  /**
   * Target state node IDs (sorted lexicographically for multi-target forks).
   * Note: Targetless/internal transitions with reenter:false and no external target
   * are stored in StateNodeAST.internalTransitions instead of drawn as external arrows,
   * EXCEPT explicit self-transitions that draw a visual loop arrow.
   */
  targetIds: string[];
  /** Normalized event label, e.g. "FETCH", "always", "after(1000ms)", "done.state.parent" */
  eventType: string;
  /** Priority order index (0-based) within the source state's transitions for the same eventType */
  order: number;
  /** Guard condition label if present, e.g. "isAuthorized" */
  guard: string | null;
  /** Action names executed on transition */
  actions: string[];
}

export interface StatechartAST {
  machineId: string;
  /** Initial state ID of the root machine */
  rootInitialTargetId: string | null;
  /** Map of state ID -> StateNodeAST (excludes the synthetic root container unless root has compartments/transitions) */
  nodes: Record<string, StateNodeAST>;
  /** All visual arrow transitions (external transitions, initial transitions, history default transitions) */
  transitions: TransitionAST[];
}

/**
 * Canonical visual label formatter for external transitions and internal transition rows
 * (ARCHITECTURE.md §3.3):
 * - Single branch for `(sourceId, eventType)`: `<eventType> [guard] / action1, action2`
 * - Multiple branches (`totalForEvent > 1`) sharing `(sourceId, eventType)`:
 *   `[#${order + 1}] <eventType> [guard] / action1, action2`
 */
export function formatTransitionLabel(params: {
  eventType: string;
  guard: string | null;
  actions: string[];
  order?: number;
  totalForEvent?: number;
}): string {
  const prefix =
    (params.totalForEvent ?? 1) > 1 ? `[#${(params.order ?? 0) + 1}] ` : '';
  let label = `${prefix}${params.eventType}`;
  if (params.guard) {
    label += ` [${params.guard}]`;
  }
  if (params.actions.length > 0) {
    label += ` / ${params.actions.join(', ')}`;
  }
  return label;
}
