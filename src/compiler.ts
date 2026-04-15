import { AnyStateMachine } from 'xstate';

function getSafeId(node: any): string {
  const idStr = node.id || node.key || 'state';
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

    // Iterate transitions for this state node
    for (const [eventType, transitions] of stateNode.transitions) {
      transitions.forEach(t => {
        const targets = t.target || [stateNode];
        
        targets.forEach(targetNode => {
          let edgeLabel = eventType;

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
