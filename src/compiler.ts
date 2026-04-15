import { AnyStateMachine } from 'xstate';

export function compile(machine: AnyStateMachine): string {
  let mermaid = 'stateDiagram-v2\n';

  // 1. Root initial transition
  if (machine.root.initial) {
    machine.root.initial.target.forEach(node => {
      mermaid += `  [*] --> ${node.key}\n`;
    });
  }

  // 2. Iterate flat states
  for (const [stateKey, stateNode] of Object.entries(machine.root.states)) {
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

          mermaid += `  ${stateKey} --> ${targetNode.key} : ${edgeLabel}\n`;
        });
      });
    }
  }

  return mermaid;
}
