import { AnyStateMachine, AnyStateNode } from 'xstate';

function getSafeId(node: AnyStateNode): string {
  let idStr = node.id || node.key || 'state';
  if (idStr.startsWith('(machine).')) {
    idStr = idStr.substring(10);
  }
  return idStr.replace(/[^a-zA-Z0-9_]/g, '_');
}

function isCompositeNode(node: AnyStateNode): boolean {
  return Boolean(node.states && Object.keys(node.states).length > 0);
}

function compileStateChildren(stateNode: AnyStateNode, indent: string, transitions: string[]): string {
  let result = '';

  // When an initial transition targets a composite child state (cluster), Mermaid's
  // Dagre cluster-anchor resolution requires the [*] start node to precede the nested
  // cluster block so deeply nested clusters with external transitions (e.g. deep_002)
  // do not fail layout.
  if (stateNode.initial) {
    stateNode.initial.target.forEach((node: AnyStateNode) => {
      if (isCompositeNode(node)) {
        result += `${indent}  [*] --> ${getSafeId(node)}\n`;
      }
    });
  }

  // Recursively compile child states before atomic initial transitions so Mermaid registers
  // human-readable state labels/aliases and entry/exit descriptions before seeing '[*] --> <safeId>'.
  const isParallel = stateNode.type === 'parallel';
  let firstChild = true;
  for (const [childKey, childNode] of Object.entries((stateNode as any).states)) {
    if (isParallel && !firstChild) {
      result += `${indent}  --\n`;
    }
    firstChild = false;
    result += compileStateNode(childKey, childNode as AnyStateNode, indent + '  ', transitions);
  }

  // Initial transition for atomic child states
  if (stateNode.initial) {
    stateNode.initial.target.forEach((node: AnyStateNode) => {
      if (!isCompositeNode(node)) {
        result += `${indent}  [*] --> ${getSafeId(node)}\n`;
      }
    });
  }

  return result;
}

function compileStateNode(stateKey: string, stateNode: AnyStateNode, indent: string, transitions: string[]): string {
  let result = '';
  const safeId = getSafeId(stateNode);
  let label = stateKey.replace(/"/g, '\\"');

  const childStateKeys = stateNode.states ? Object.keys(stateNode.states) : [];
  const isComposite = childStateKeys.length > 0;

  // Mermaid stateDiagram-v2 strictly forbids descriptions (i.e. 'state : description')
  // on composite/group nodes. To preserve entry/exit definitions for parent states,
  // we append them to the node's multi-line label natively instead.
  if (isComposite) {
    (['entry', 'exit'] as const).forEach((type) => {
      const actions = stateNode[type];
      if (Array.isArray(actions)) {
        const seenActions = new Set<string>();
        actions.forEach((action: unknown) => {
          const actionStr = typeof action === 'string'
            ? action
            : (action && typeof action === 'object' && 'type' in action ? String(action.type) : undefined);
          if (actionStr && !seenActions.has(actionStr)) {
            seenActions.add(actionStr);
            label += `<br/>${type} / ${actionStr}`;
          }
        });
      }
    });
  }

  if (isComposite) {
    result += `${indent}state "${label}" as ${safeId} {\n`;
    result += compileStateChildren(stateNode, indent, transitions);
    result += `${indent}}\n`;
  } else {
    result += `${indent}state "${label}" as ${safeId}\n`;
  }

  // Map Final Types
  if (stateNode.type === 'final') {
    transitions.push(`  ${safeId} --> [*]`);
  }

  // Map Entry and Exit Actions
  if (!isComposite) {
    (['entry', 'exit'] as const).forEach((type) => {
      const actions = stateNode[type];
      if (Array.isArray(actions)) {
        const seenActions = new Set<string>();
        actions.forEach((action: unknown) => {
          const actionStr = typeof action === 'string'
            ? action
            : (action && typeof action === 'object' && 'type' in action ? String(action.type) : undefined);
          if (actionStr && !seenActions.has(actionStr)) {
            seenActions.add(actionStr);
            result += `${indent}${safeId} : ${type} / ${actionStr}\n`;
          }
        });
      }
    });
  }

  // Iterate eventless ('always') transitions for this state node
  if (Array.isArray(stateNode.always)) {
    stateNode.always.forEach((t: any) => {
      compileTransition(stateNode, safeId, '', t, transitions);
    });
  }

  // Iterate transitions for this state node
  for (const [eventType, txs] of stateNode.transitions) {
    txs.forEach((t: any) => {
      compileTransition(stateNode, safeId, eventType, t, transitions);
    });
  }

  return result;
}

function compileTransition(
  stateNode: AnyStateNode,
  safeId: string,
  eventType: string,
  t: any,
  transitions: string[]
): void {
  const targets = t.target || [stateNode];

  targets.forEach((targetNode: AnyStateNode) => {
    const labelParts: string[] = [];
    let eventLabel = eventType;

    // Map string 'after' transition labels naturally
    if (eventType.startsWith('xstate.after.')) {
      const delayMatch = eventType.match(/xstate\.after\.([\d.]+)\./);
      if (delayMatch && delayMatch[1]) {
        eventLabel = `after ${delayMatch[1]}`;
      }
    }

    if (eventLabel) {
      labelParts.push(eventLabel);
    }

    // Parse Guard
    if (t.guard) {
      const guardName =
        typeof t.guard === 'string'
          ? t.guard
          : t.guard && typeof t.guard === 'object' && 'type' in t.guard
            ? String(t.guard.type)
            : undefined;
      if (guardName) {
        labelParts.push(`[${guardName}]`);
      }
    }

    // Parse Actions
    if (t.actions && t.actions.length > 0) {
      const actionNames = t.actions
        .map((a: unknown) =>
          typeof a === 'string'
            ? a
            : a && typeof a === 'object' && 'type' in a
              ? String(a.type)
              : undefined
        )
        .filter(Boolean);
      if (actionNames.length > 0) {
        labelParts.push(`/ ${actionNames.join(', ')}`);
      }
    }

    const edgeLabel = labelParts.join(' ');
    transitions.push(`  ${safeId} --> ${getSafeId(targetNode)}${edgeLabel ? ` : ${edgeLabel}` : ''}`);
  });
}

export function compile(machine: AnyStateMachine): string {
  let mermaid = 'stateDiagram-v2\n';

  const rootNode = machine.root;
  // Check if root has any transitions, actions or is parallel
  const hasRootTransitions =
    Array.from(rootNode.transitions.entries()).some(([_, t]) => t.length > 0) ||
    (Array.isArray(rootNode.always) && rootNode.always.length > 0);
  const hasRootActions = rootNode.entry.length > 0 || rootNode.exit.length > 0;
  const isParallelRoot = rootNode.type === 'parallel';

  const transitions: string[] = [];

  if (hasRootTransitions || hasRootActions || isParallelRoot) {
    const rootLabel = (machine.id || 'machine').replace(/"/g, '\\"');
    mermaid += compileStateNode(rootLabel, rootNode, '  ', transitions);
  } else {
    mermaid += compileStateChildren(rootNode, '', transitions);
  }

  if (transitions.length > 0) {
    mermaid += '\n' + transitions.join('\n') + '\n';
  }

  return mermaid;
}
