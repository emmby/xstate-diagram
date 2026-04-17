import { AnyStateMachine, AnyStateNode } from 'xstate';

function getSafeId(node: AnyStateNode): string {
  let idStr = node.id || node.key || 'state';
  if (idStr.startsWith('(machine).')) {
    idStr = idStr.substring(10);
  }
  return idStr.replace(/[^a-zA-Z0-9_]/g, '_');
}

function compileStateChildren(stateNode: AnyStateNode, indent: string): string {
  let result = '';
  
  // Initial transition for this composite state
  if (stateNode.initial) {
    stateNode.initial.target.forEach((node: AnyStateNode) => {
      result += `${indent}  [*] --> ${getSafeId(node)}\n`;
    });
  }

  // Recursively compile child states
  const isParallel = stateNode.type === 'parallel';
  let firstChild = true;
  for (const [childKey, childNode] of Object.entries((stateNode as any).states)) {
    if (isParallel && !firstChild) {
      result += `${indent}  --\n`;
    }
    firstChild = false;
    result += compileStateNode(childKey, childNode as AnyStateNode, indent + '  ');
  }

  return result;
}

function compileStateNode(stateKey: string, stateNode: AnyStateNode, indent: string): string {
  let result = '';
  const safeId = getSafeId(stateNode);
  const label = stateKey.replace(/"/g, '\\"');

  const childStateKeys = stateNode.states ? Object.keys(stateNode.states) : [];
  const isComposite = childStateKeys.length > 0;

  if (isComposite) {
    result += `${indent}state "${label}" as ${safeId} {\n`;
    result += compileStateChildren(stateNode, indent);
    result += `${indent}}\n`;
  } else {
    result += `${indent}state "${label}" as ${safeId}\n`;
  }

  // Map Final Types
  if (stateNode.type === 'final') {
    result += `${indent}${safeId} --> [*]\n`;
  }

  // Map Entry and Exit Actions
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

  // Iterate transitions for this state node
  for (const [eventType, transitions] of stateNode.transitions) {
    transitions.forEach((t: any) => {
      const targets = t.target || [stateNode];
      
      targets.forEach((targetNode: AnyStateNode) => {
        let edgeLabel = eventType;

        // Map string 'after' transition labels naturally
        if (eventType.startsWith('xstate.after.')) {
          const delayMatch = eventType.match(/xstate\.after\.([\d.]+)\./);
          if (delayMatch && delayMatch[1]) {
            edgeLabel = `after ${delayMatch[1]}`;
          }
        }

        // Parse Guard
        if (t.guard) {
          const guardName = typeof t.guard === 'string' ? t.guard : (t.guard && typeof t.guard === 'object' && 'type' in t.guard ? String(t.guard.type) : undefined);
          if (guardName) {
            edgeLabel += ` [${guardName}]`;
          }
        }

        // Parse Actions
        if (t.actions && t.actions.length > 0) {
          const actionNames = t.actions.map((a: unknown) => typeof a === 'string' ? a : (a && typeof a === 'object' && 'type' in a ? String(a.type) : undefined)).filter(Boolean);
          if (actionNames.length > 0) {
            edgeLabel += ` / ${actionNames.join(', ')}`;
          }
        }

        result += `${indent}${safeId} --> ${getSafeId(targetNode)} : ${edgeLabel}\n`;
      });
    });
  }

  return result;
}

export function compile(machine: AnyStateMachine): string {
  let mermaid = 'stateDiagram-v2\n';

  const rootNode = machine.root;
  // Check if root has any transitions, actions or is parallel
  const hasRootTransitions = Array.from(rootNode.transitions.entries()).some(([_, t]) => t.length > 0);
  const hasRootActions = rootNode.entry.length > 0 || rootNode.exit.length > 0;
  const isParallelRoot = rootNode.type === 'parallel';

  if (hasRootTransitions || hasRootActions || isParallelRoot) {
    const rootLabel = (machine.id || 'machine').replace(/"/g, '\\"');
    mermaid += compileStateNode(rootLabel, rootNode, '  ');
  } else {
    mermaid += compileStateChildren(rootNode, '');
  }

  return mermaid;
}
