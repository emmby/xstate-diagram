import { AnyStateMachine } from 'xstate';

function getSafeId(node: any): string {
  let idStr = node.id || node.key || 'state';
  if (idStr.startsWith('(machine).')) {
    idStr = idStr.substring(10);
  }
  return idStr.replace(/[^a-zA-Z0-9_]/g, '_');
}

export function compile(machine: AnyStateMachine): string {
  let mermaid = 'stateDiagram-v2\n';

  // 0. Declare State Aliases (Guarantees safe Mermaid node IDs)
  for (const [stateKey, stateNode] of Object.entries(machine.root.states)) {
    const safeId = getSafeId(stateNode);
    mermaid += `  state "${stateKey.replace(/"/g, '\\"')}" as ${safeId}\n`;
  }

  // 1. Root initial transition
  if (machine.root.initial) {
    machine.root.initial.target.forEach(node => {
      mermaid += `  [*] --> ${getSafeId(node)}\n`;
    });
  }

  // 2. Iterate flat states
  for (const [stateKey, stateNode] of Object.entries(machine.root.states)) {
    const sourceId = getSafeId(stateNode);

    // Map Final Types
    if (stateNode.type === 'final') {
      mermaid += `  ${sourceId} --> [*]\n`;
    }

    // Map Entry and Exit Actions
    (['entry', 'exit'] as const).forEach((type) => {
      const actions = stateNode[type];
      if (Array.isArray(actions)) {
        const seenActions = new Set<string>();
        actions.forEach((action: any) => {
          const actionStr = typeof action === 'string'
            ? action
            : (action && typeof action === 'object' && 'type' in action ? String(action.type) : undefined);
          if (actionStr && !seenActions.has(actionStr)) {
            seenActions.add(actionStr);
            mermaid += `  ${sourceId} : ${type} / ${actionStr}\n`;
          }
        });
      }
    });

    // Iterate transitions for this state node
    for (const [eventType, transitions] of stateNode.transitions) {
      transitions.forEach(t => {
        const targets = t.target || [stateNode];
        
        targets.forEach(targetNode => {
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
            const actionNames = t.actions.map(a => typeof a === 'string' ? a : (a && typeof a === 'object' && 'type' in a ? String(a.type) : undefined)).filter(Boolean);
            if (actionNames.length > 0) {
              edgeLabel += ` / ${actionNames.join(', ')}`;
            }
          }

          mermaid += `  ${sourceId} --> ${getSafeId(targetNode)} : ${edgeLabel}\n`;
        });
      });
    }
  }

  return mermaid;
}
