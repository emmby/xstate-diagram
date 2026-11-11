import { createMachine, type AnyStateMachine, type AnyStateNode } from 'xstate';
import type {
  InternalTransitionRowAST,
  InvocationAST,
  StateNodeAST,
  StateNodeType,
  StatechartAST,
  TransitionAST,
} from './types.js';

function isStateMachine(input: unknown): input is AnyStateMachine {
  return (
    typeof input === 'object' &&
    input !== null &&
    'root' in input &&
    typeof (input as AnyStateMachine).root === 'object' &&
    (input as AnyStateMachine).root !== null
  );
}

function isSyntheticAfterRaise(action: unknown): boolean {
  if (typeof action !== 'object' && typeof action !== 'function') return false;
  if (action === null) return false;
  const rec = action as Record<string, unknown>;
  return (
    rec.type === 'xstate.raise' &&
    typeof rec.id === 'string' &&
    rec.id.startsWith('xstate.after.')
  );
}

function isSyntheticAfterCancel(action: unknown): boolean {
  if (typeof action !== 'object' && typeof action !== 'function') return false;
  if (action === null) return false;
  const rec = action as Record<string, unknown>;
  return (
    rec.type === 'xstate.cancel' &&
    typeof rec.sendId === 'string' &&
    rec.sendId.startsWith('xstate.after.')
  );
}

function formatActionName(action: unknown): string {
  if (typeof action === 'string') {
    return action;
  }
  if (typeof action === 'function') {
    const rec = action as unknown as Record<string, unknown>;
    if (typeof rec.type === 'string') {
      if (rec.type === 'xstate.assign') {
        if (
          typeof rec.assignment === 'object' &&
          rec.assignment !== null &&
          !Array.isArray(rec.assignment)
        ) {
          const keys = Object.keys(rec.assignment);
          return keys.length > 0 ? `assign(${keys.join(', ')})` : 'assign';
        }
        return 'assign';
      }
      if (rec.type === 'xstate.raise') {
        const ev = rec.event as { type?: string } | undefined;
        return ev?.type ? `raise(${ev.type})` : 'raise';
      }
      if (rec.type === 'xstate.sendTo') {
        const ev = rec.event as { type?: string } | undefined;
        return ev?.type ? `sendTo(${ev.type})` : 'sendTo';
      }
      if (rec.type === 'xstate.log') {
        return 'log';
      }
      if (rec.type === 'xstate.stopChild') {
        return 'stopChild';
      }
      if (rec.type.startsWith('xstate.')) {
        return rec.type.slice('xstate.'.length);
      }
      return rec.type;
    }
    return action.name || 'anonymous';
  }
  if (typeof action === 'object' && action !== null) {
    const rec = action as Record<string, unknown>;
    if (typeof rec.type === 'string') {
      return rec.type;
    }
  }
  return String(action);
}

function formatGuardName(guard: unknown): string | null {
  if (!guard) return null;
  if (typeof guard === 'string') {
    return guard;
  }
  if (typeof guard === 'function' || typeof guard === 'object') {
    const rec = guard as Record<string, unknown>;
    const fnName = typeof guard === 'function' ? guard.name : '';

    // Builtin XState v5 combinators: and, or, not, stateIn
    if (Array.isArray(rec.guards)) {
      const inner = rec.guards
        .map((g) => formatGuardName(g))
        .filter((g): g is string => Boolean(g));
      if (fnName === 'not' || rec.check?.toString().includes('checkNot')) {
        return `not(${inner.join(', ')})`;
      }
      if (fnName === 'or' || rec.check?.toString().includes('checkOr')) {
        return `or(${inner.join(', ')})`;
      }
      return `and(${inner.join(', ')})`;
    }
    if (typeof rec.stateValue === 'string') {
      return `stateIn(${rec.stateValue})`;
    }
    if (typeof rec.type === 'string' && rec.type !== 'xstate.guard') {
      return rec.type;
    }
    if (fnName && fnName !== 'anonymous' && fnName !== 'guard') {
      return fnName;
    }
  }
  return String(guard);
}

function formatInvokeSrc(src: unknown): string {
  if (typeof src === 'string') return src;
  if (typeof src === 'function') return src.name || 'inlineActor';
  if (typeof src === 'object' && src !== null) {
    const rec = src as Record<string, unknown>;
    if (typeof rec.type === 'string') return rec.type;
    if (typeof rec.config === 'object' && rec.config !== null) {
      const cfg = rec.config as Record<string, unknown>;
      if (typeof cfg.id === 'string') return cfg.id;
    }
  }
  return 'actor';
}

function normalizeEventType(
  rawEventType: string,
  sourceNode: AnyStateNode,
  syntheticInvokeIdToSrc: Map<string, string>,
): string {
  if (rawEventType === '') {
    return 'always';
  }
  if (rawEventType.startsWith('xstate.after.')) {
    const withoutPrefix = rawEventType.slice('xstate.after.'.length);
    const suffix = `.${sourceNode.id}`;
    const delay = withoutPrefix.endsWith(suffix)
      ? withoutPrefix.slice(0, withoutPrefix.length - suffix.length)
      : withoutPrefix;
    if (/^\d+(\.\d+)?$/.test(delay)) {
      return `after(${delay}ms)`;
    }
    return `after(${delay})`;
  }
  if (rawEventType.startsWith('xstate.done.state.')) {
    return 'onDone';
  }
  if (rawEventType.startsWith('xstate.done.actor.')) {
    const actorId = rawEventType.slice('xstate.done.actor.'.length);
    const mapped = syntheticInvokeIdToSrc.get(actorId) ?? actorId;
    return `onDone(${mapped})`;
  }
  if (rawEventType.startsWith('xstate.error.actor.')) {
    const actorId = rawEventType.slice('xstate.error.actor.'.length);
    const mapped = syntheticInvokeIdToSrc.get(actorId) ?? actorId;
    return `onError(${mapped})`;
  }
  return rawEventType;
}

function resolveHistoryTargetId(
  histNode: AnyStateNode,
  machine: AnyStateMachine,
): string | null {
  const rawTarget = (histNode.config as { target?: string } | undefined)?.target;
  if (!rawTarget || typeof rawTarget !== 'string') {
    return null;
  }
  if (rawTarget.startsWith('#')) {
    const customId = rawTarget.slice(1);
    const idMap = (machine as unknown as { idMap?: Map<string, AnyStateNode> }).idMap;
    const found = idMap?.get(customId) ?? machine.getStateNodeById(customId);
    return found ? found.id : null;
  }
  const parent = histNode.parent;
  if (!parent) return null;
  const parts = rawTarget.replace(/^\./, '').split('.');
  let current: AnyStateNode | undefined = parent;
  for (const part of parts) {
    current = current?.states?.[part];
    if (!current) return null;
  }
  return current.id;
}

/**
 * Extracts a canonical, normalized StatechartAST from either an instantiated XState v5
 * StateMachine or a raw XState v5 machine configuration object.
 */
export function extractFromMachine(machineOrConfig: unknown): StatechartAST {
  const machine: AnyStateMachine = isStateMachine(machineOrConfig)
    ? machineOrConfig
    : createMachine(machineOrConfig as Parameters<typeof createMachine>[0]);

  const root = machine.root;
  const machineId = machine.id;
  const rootInitialTargetId =
    root.type === 'compound' && root.initial?.target?.[0]
      ? root.initial.target[0].id
      : null;

  // Build map of synthetic invoke IDs (`0.machine.state`) -> invoke `src` name
  // across all state nodes so `xstate.done.actor.<id>` normalizes cleanly.
  const syntheticInvokeIdToSrc = new Map<string, string>();
  const registerNodeInvokes = (node: AnyStateNode): void => {
    const rawConfigInvoke = (node.config as Record<string, unknown> | undefined)?.invoke;
    const rawInvokeList = Array.isArray(rawConfigInvoke)
      ? rawConfigInvoke
      : rawConfigInvoke
        ? [rawConfigInvoke]
        : [];
    (node.invoke ?? []).forEach((inv, idx) => {
      const srcName = formatInvokeSrc(inv.src);
      const rawCfg = rawInvokeList[idx] as Record<string, unknown> | undefined;
      const hasExplicitId = typeof rawCfg?.id === 'string' && rawCfg.id.length > 0;
      if (!hasExplicitId && inv.id === `${idx}.${node.id}`) {
        syntheticInvokeIdToSrc.set(inv.id, srcName);
      }
    });
    for (const child of Object.values(node.states ?? {})) {
      registerNodeInvokes(child);
    }
  };
  registerNodeInvokes(root);

  const extractNodeData = (
    node: AnyStateNode,
    parentId: string | null,
  ): {
    nodeAST: StateNodeAST;
    externalTransitions: TransitionAST[];
  } => {
    const type = node.type as StateNodeType;
    const historyKind: 'shallow' | 'deep' | null =
      type === 'history' ? (node.history === 'deep' ? 'deep' : 'shallow') : null;

    const initialTargetId =
      type === 'compound' && node.initial?.target?.[0]
        ? node.initial.target[0].id
        : null;

    const entryActions = (node.entry ?? [])
      .filter((a) => !isSyntheticAfterRaise(a))
      .map((a) => formatActionName(a));

    const exitActions = (node.exit ?? [])
      .filter((a) => !isSyntheticAfterCancel(a))
      .map((a) => formatActionName(a));

    const rawConfigInvoke = (node.config as Record<string, unknown> | undefined)?.invoke;
    const rawInvokeList = Array.isArray(rawConfigInvoke)
      ? rawConfigInvoke
      : rawConfigInvoke
        ? [rawConfigInvoke]
        : [];

    const invocations: InvocationAST[] = (node.invoke ?? []).map((inv, idx) => {
      const src = formatInvokeSrc(inv.src);
      const rawCfg = rawInvokeList[idx] as Record<string, unknown> | undefined;
      const hasExplicitId = typeof rawCfg?.id === 'string' && rawCfg.id.length > 0;
      const id = hasExplicitId ? inv.id : inv.id === `${idx}.${node.id}` ? null : inv.id ?? null;
      return { id, src };
    });

    const tags = [...(node.tags ?? [])];

    const internalTransitions: InternalTransitionRowAST[] = [];
    const externalTransitions: TransitionAST[] = [];
    const externalOrderCounters = new Map<string, number>();
    const internalOrderCounters = new Map<string, number>();

    // Collect eventless (`always`) transitions first, then named/builtin transitions
    const allRawTransitions = [
      ...(node.always ?? []),
      ...[...(node.transitions?.values() ?? [])].flat(),
    ];

    for (const t of allRawTransitions) {
      const eventType = normalizeEventType(
        t.eventType,
        node,
        syntheticInvokeIdToSrc,
      );
      const guard = formatGuardName(t.guard);
      const actions = (t.actions ?? []).map((a) => formatActionName(a));
      const targets = t.target ? t.target.map((tn) => tn.id) : [];

      if (targets.length === 0) {
        const order = internalOrderCounters.get(eventType) ?? 0;
        internalOrderCounters.set(eventType, order + 1);
        internalTransitions.push({
          eventType,
          order,
          guard,
          actions,
        });
      } else {
        const targetIds = [...targets].sort((a, b) => a.localeCompare(b));
        const order = externalOrderCounters.get(eventType) ?? 0;
        externalOrderCounters.set(eventType, order + 1);
        externalTransitions.push({
          id: `${node.id}__${eventType}__${order}`,
          sourceId: node.id,
          targetIds,
          eventType,
          order,
          guard,
          actions,
        });
      }
    }

    // History default transition if specified via `target`
    if (type === 'history') {
      const histTargetId = resolveHistoryTargetId(node, machine);
      if (histTargetId) {
        const eventType = 'default';
        const order = externalOrderCounters.get(eventType) ?? 0;
        externalOrderCounters.set(eventType, order + 1);
        externalTransitions.push({
          id: `${node.id}__${eventType}__${order}`,
          sourceId: node.id,
          targetIds: [histTargetId],
          eventType,
          order,
          guard: null,
          actions: [],
        });
      }
    }

    const nodeAST: StateNodeAST = {
      id: node.id,
      key: node.key,
      type,
      historyKind,
      parentId,
      initialTargetId,
      entryActions,
      exitActions,
      invocations,
      internalTransitions,
      tags,
    };

    return { nodeAST, externalTransitions };
  };

  // Check if root itself has compartments or outgoing transitions
  const rootExtracted = extractNodeData(root, null);
  const includeRoot =
    root.type === 'parallel' ||
    rootExtracted.nodeAST.entryActions.length > 0 ||
    rootExtracted.nodeAST.exitActions.length > 0 ||
    rootExtracted.nodeAST.invocations.length > 0 ||
    rootExtracted.nodeAST.internalTransitions.length > 0 ||
    rootExtracted.nodeAST.tags.length > 0 ||
    rootExtracted.externalTransitions.length > 0 ||
    Object.keys(root.states ?? {}).length === 0;

  const nodes: Record<string, StateNodeAST> = {};
  const transitions: TransitionAST[] = [];

  if (includeRoot) {
    nodes[root.id] = rootExtracted.nodeAST;
    transitions.push(...rootExtracted.externalTransitions);
  }

  const walkChildren = (parentNode: AnyStateNode, parentIdForChildren: string | null): void => {
    for (const child of Object.values(parentNode.states ?? {})) {
      const { nodeAST, externalTransitions } = extractNodeData(child, parentIdForChildren);
      nodes[child.id] = nodeAST;
      transitions.push(...externalTransitions);
      walkChildren(child, child.id);
    }
  };

  walkChildren(root, includeRoot ? root.id : null);

  // Canonical deterministic sort for transitions: (sourceId, eventType, order)
  transitions.sort(
    (a, b) =>
      a.sourceId.localeCompare(b.sourceId) ||
      a.eventType.localeCompare(b.eventType) ||
      a.order - b.order,
  );

  return {
    machineId,
    rootInitialTargetId: includeRoot ? null : rootInitialTargetId,
    nodes,
    transitions,
  };
}
