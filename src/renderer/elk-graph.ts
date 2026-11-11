import ELKModule, {
  type ELK as ELKInstance,
  type ElkExtendedEdge,
  type ElkNode,
  type ElkPort,
} from 'elkjs/lib/elk.bundled.js';
import type {
  StatechartAST,
  StateNodeAST,
  TransitionAST,
} from '../ast/types.js';
import {
  formatTransitionLabel,
  layoutTagPills,
  measureEdgeLabelPill,
  measureTextWidth,
  type EdgeLabelLine,
  type MeasuredEdgeLabelPill,
} from './measure.js';
import { DEFAULT_THEME, type ThemeTokens } from './theme.js';

type ElkConstructorType = new () => ELKInstance;
const ELK: ElkConstructorType =
  (ELKModule as unknown as { default?: ElkConstructorType }).default ??
  (ELKModule as unknown as ElkConstructorType);

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LayoutDirection = 'AUTO' | 'RIGHT' | 'DOWN';

export interface LayoutOptions {
  direction?: LayoutDirection;
  theme?: ThemeTokens;
}

export interface PositionedNode {
  ast: StateNodeAST;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  headerHeight: number;
  compartmentHeight: number;
  compartmentLines: CompartmentGroup[];
}

export interface CompartmentGroup {
  kind: 'entry' | 'exit' | 'invoke' | 'internal' | 'tags';
  rows: CompartmentRow[];
}

export interface CompartmentRow {
  text: string;
  attrs: Record<string, string>;
}

export interface PositionedInitialIndicator {
  parentId: string | null;
  targetId: string;
  cx: number;
  cy: number;
  r: number;
  points: Point[];
}

export interface PositionedEdge {
  ast: TransitionAST;
  branches: Point[][];
  label: {
    x: number;
    y: number;
    width: number;
    height: number;
    lineHeight: number;
    text: string;
    priorityPrefix: string;
    suffix: string;
    lines: EdgeLabelLine[];
  };
}

export interface PositionedDiagram {
  width: number;
  height: number;
  theme: ThemeTokens;
  nodes: PositionedNode[];
  initialIndicators: PositionedInitialIndicator[];
  edges: PositionedEdge[];
}

const INITIAL_NODE_PREFIX = '__elk_initial__';

function buildCompartmentGroups(node: StateNodeAST): CompartmentGroup[] {
  const groups: CompartmentGroup[] = [];

  if (node.entryActions.length > 0) {
    groups.push({
      kind: 'entry',
      rows: node.entryActions.map((act) => ({
        text: `entry / ${act}`,
        attrs: { 'data-entry-action': act },
      })),
    });
  }

  if (node.exitActions.length > 0) {
    groups.push({
      kind: 'exit',
      rows: node.exitActions.map((act) => ({
        text: `exit / ${act}`,
        attrs: { 'data-exit-action': act },
      })),
    });
  }

  if (node.invocations.length > 0) {
    groups.push({
      kind: 'invoke',
      rows: node.invocations.map((inv) => ({
        text: inv.id ? `invoke / ${inv.id}: ${inv.src}` : `invoke / ${inv.src}`,
        attrs: {
          'data-invoke-src': inv.src,
          'data-invoke-id': inv.id ?? '',
        },
      })),
    });
  }

  if (node.internalTransitions.length > 0) {
    const internalEventCounts = new Map<string, number>();
    for (const tr of node.internalTransitions) {
      internalEventCounts.set(
        tr.eventType,
        (internalEventCounts.get(tr.eventType) ?? 0) + 1,
      );
    }
    groups.push({
      kind: 'internal',
      rows: node.internalTransitions.map((tr) => ({
        text: formatTransitionLabel(
          tr.eventType,
          tr.guard,
          tr.actions,
          tr.order,
          internalEventCounts.get(tr.eventType) ?? 1,
        ),
        attrs: {
          'data-internal-event': tr.eventType,
          'data-internal-order': String(tr.order),
          'data-internal-guard': tr.guard ?? '',
          'data-internal-actions': tr.actions.join(','),
        },
      })),
    });
  }

  if (node.tags.length > 0) {
    groups.push({
      kind: 'tags',
      rows: node.tags.map((tag) => ({
        text: `#${tag}`,
        attrs: { 'data-tag': tag },
      })),
    });
  }

  return groups;
}

function computeSidePortSpanReq(
  peerCounts: Map<string, number>,
  samePairStep = 40,
): number {
  let totalPorts = 0;
  let samePairExtra = 0;
  for (const c of peerCounts.values()) {
    totalPorts += c;
    if (c > 1) {
      samePairExtra += (c - 1) * samePairStep;
    }
  }
  if (totalPorts <= 1) return 42;
  const distinctPeers = peerCounts.size;
  const betweenPeerSpan = Math.max(0, distinctPeers - 1) * 22;
  return 30 + samePairExtra + betweenPeerSpan;
}

function measureNodeIntrinsicSize(
  node: StateNodeAST,
  groups: CompartmentGroup[],
  westPeers: Map<string, number>,
  eastPeers: Map<string, number>,
  selfLoopCount: number,
  maxSelfLoopLabelWidth: number,
  maxSamePairPillWidth: number,
  flowDirection: 'RIGHT' | 'DOWN',
  theme: ThemeTokens,
): {
  minWidth: number;
  minHeight: number;
  headerHeight: number;
  compartmentHeight: number;
  portSpacing: number;
} {
  if (node.type === 'history') {
    let maxHistSamePair = 1;
    let totalHistEdges = 0;
    for (const c of westPeers.values()) {
      maxHistSamePair = Math.max(maxHistSamePair, c);
      totalHistEdges += c;
    }
    for (const c of eastPeers.values()) {
      maxHistSamePair = Math.max(maxHistSamePair, c);
      totalHistEdges += c;
    }

    if (node.key === 'history') {
      if (maxHistSamePair >= 3 || totalHistEdges >= 4) {
        return {
          minWidth: 184,
          minHeight: Math.max(
            200,
            Math.max(maxHistSamePair, totalHistEdges) * 34,
          ),
          headerHeight: 38,
          compartmentHeight: 0,
          portSpacing: 24,
        };
      }
      const d = theme.radii.history * 2;
      return {
        minWidth: d,
        minHeight: d,
        headerHeight: d,
        compartmentHeight: 0,
        portSpacing: 8,
      };
    }

    const symbol = node.historyKind === 'deep' ? 'H*' : 'H';
    const labelText = `${symbol}: ${node.key}`;
    const h = theme.radii.history * 2;
    const textW = measureTextWidth(labelText, {
      fontFamily: 'sans',
      fontSize: theme.fontSizes.history,
      bold: true,
    });
    const w = Math.max(56, Math.ceil(textW + 22));
    return {
      minWidth: w,
      minHeight: h,
      headerHeight: h,
      compartmentHeight: 0,
      portSpacing: 16,
    };
  }

  const isFinal = node.type === 'final';
  const isParallel = node.type === 'parallel';
  const titleWidth = measureTextWidth(node.key, {
    fontFamily: 'sans',
    fontSize: theme.fontSizes.stateTitle,
    bold: true,
  });

  let maxRowWidth = titleWidth + (isFinal || isParallel ? 26 : 0);
  let compartmentHeight = 0;

  // Measure text compartments first so tag wrapping knows natural box width
  for (const g of groups) {
    if (g.kind === 'tags') continue;
    compartmentHeight += theme.spacing.compartmentPaddingY;
    for (const r of g.rows) {
      const w = measureTextWidth(r.text, {
        fontFamily: 'mono',
        fontSize: theme.fontSizes.compartment,
      });
      maxRowWidth = Math.max(maxRowWidth, w);
      compartmentHeight += theme.spacing.compartmentLineHeight;
    }
    compartmentHeight += theme.spacing.compartmentPaddingY;
  }

  for (const g of groups) {
    if (g.kind !== 'tags') continue;
    const wrapTarget = Math.max(180, maxRowWidth);
    const laidOutTags = layoutTagPills(
      g.rows.map((r) => r.text),
      wrapTarget,
      theme.fontSizes.tag,
    );
    maxRowWidth = Math.max(maxRowWidth, laidOutTags.totalWidth);
    compartmentHeight += laidOutTags.totalHeight;
  }

  const hasChildren = node.type === 'compound' || node.type === 'parallel';
  const hasCompartments = groups.length > 0;
  const headerHeight =
    hasChildren || hasCompartments
      ? theme.spacing.headerHeight + (isFinal ? theme.spacing.finalInset : 0)
      : Math.max(theme.spacing.nodeMinHeight, theme.spacing.headerHeight + 6);

  if (isFinal && hasCompartments) {
    compartmentHeight += theme.spacing.finalInset;
  }

  let nonSelfTotal = 0;
  let maxSamePair = 1;
  for (const c of westPeers.values()) {
    nonSelfTotal += c;
    maxSamePair = Math.max(maxSamePair, c);
  }
  for (const c of eastPeers.values()) {
    nonSelfTotal += c;
    maxSamePair = Math.max(maxSamePair, c);
  }

  const downSamePairStep =
    flowDirection === 'DOWN' && maxSamePair >= 3
      ? Math.max(44, Math.ceil(maxSamePairPillWidth * 0.58 + 16))
      : 40;

  const primaryPortSpanReq = Math.max(
    computeSidePortSpanReq(
      westPeers,
      flowDirection === 'DOWN' ? downSamePairStep : 40,
    ),
    computeSidePortSpanReq(
      eastPeers,
      flowDirection === 'DOWN' ? downSamePairStep : 40,
    ),
  );
  const secondaryPortSpanReq = 32 + Math.ceil(nonSelfTotal / 4) * 22;
  const maxPeersOnSide = Math.max(westPeers.size, eastPeers.size);
  const portSpacing =
    maxSamePair >= 2 && maxPeersOnSide <= 1 ? downSamePairStep : 22;

  const selfLoopWidthReq =
    selfLoopCount >= 2
      ? Math.max(
          Math.min(148, maxSelfLoopLabelWidth * 0.55 + 42),
          38 + Math.ceil(selfLoopCount / 2) * 42,
        )
      : maxSelfLoopLabelWidth > 0
        ? Math.min(144, maxSelfLoopLabelWidth * 0.55 + 40)
        : 0;

  const padX =
    theme.spacing.nodePaddingX + (isFinal ? theme.spacing.finalInset : 0);

  const portWidthReq =
    flowDirection === 'DOWN' ? primaryPortSpanReq : secondaryPortSpanReq;
  const portHeightReq =
    flowDirection === 'DOWN' ? 42 : primaryPortSpanReq;

  const minWidth = Math.max(
    theme.spacing.nodeMinWidth,
    maxRowWidth + padX * 2,
    portWidthReq,
    selfLoopWidthReq,
  );

  const minHeight = Math.max(
    theme.spacing.nodeMinHeight,
    headerHeight + compartmentHeight + (isFinal && !hasCompartments ? 8 : 0),
    portHeightReq,
  );

  return {
    minWidth: Math.ceil(minWidth),
    minHeight: Math.ceil(minHeight),
    headerHeight,
    compartmentHeight,
    portSpacing,
  };
}

interface SingleLayoutConfig {
  rootDir: 'RIGHT' | 'DOWN';
  closedContainerDirMode: 'SAME' | 'OPPOSITE';
  parallelAspect: string;
  wrapRoot: boolean;
  wrapLongContainers: boolean;
  compactLayers?: boolean;
}

function findClosedSubtreeContainers(ast: StatechartAST): Set<string> {
  const closed = new Set<string>();
  const isProperDesc = (u: string, anc: string): boolean => {
    let cur = ast.nodes[u]?.parentId ?? null;
    while (cur) {
      if (cur === anc) return true;
      cur = ast.nodes[cur]?.parentId ?? null;
    }
    return false;
  };
  for (const n of Object.values(ast.nodes)) {
    if (n.type !== 'compound' && n.type !== 'parallel') continue;
    let ok = true;
    for (const tr of ast.transitions) {
      const endpoints = [tr.sourceId, ...tr.targetIds];
      const anyInside = endpoints.some((ep) => isProperDesc(ep, n.id));
      const allInside = endpoints.every((ep) => isProperDesc(ep, n.id));
      if (anyInside && !allInside) {
        ok = false;
        break;
      }
    }
    if (ok) closed.add(n.id);
  }
  return closed;
}

/**
 * Computes hierarchical + port-aware layout for a StatechartAST using elkjs,
 * evaluating adaptive orientation & compactness candidates when `direction === 'AUTO'` (default).
 */
export async function layoutStatechart(
  ast: StatechartAST,
  options: LayoutOptions = {},
): Promise<PositionedDiagram> {
  const requestedDir = options.direction ?? 'AUTO';
  const theme = options.theme ?? DEFAULT_THEME;
  const elk = new ELK();
  const closedContainers = findClosedSubtreeContainers(ast);

  if (requestedDir === 'RIGHT' || requestedDir === 'DOWN') {
    return layoutSingleConfig(
      ast,
      {
        rootDir: requestedDir,
        closedContainerDirMode: 'SAME',
        parallelAspect: '1.35',
        wrapRoot: false,
        wrapLongContainers: false,
      },
      closedContainers,
      theme,
      elk,
    );
  }

  const stateCount = Object.keys(ast.nodes).length;
  const isLargeGraph = stateCount >= 35;
  const hasParallel = Object.values(ast.nodes).some((n) => n.type === 'parallel');
  const { hasLongRoot, hasLongContainer } = (() => {
    const counts = new Map<string | null, number>();
    for (const n of Object.values(ast.nodes)) {
      if (n.type === 'history') continue;
      const p = n.parentId ?? null;
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    let longContainer = false;
    for (const [p, c] of counts.entries()) {
      if (p !== null && c >= 6) longContainer = true;
    }
    return {
      hasLongRoot: (counts.get(null) ?? 0) >= 5,
      hasLongContainer: longContainer,
    };
  })();

  const baseCandidates: SingleLayoutConfig[] = [
    {
      rootDir: 'RIGHT',
      closedContainerDirMode: 'SAME',
      parallelAspect: isLargeGraph ? '1.35' : hasParallel ? '0.55' : '1.35',
      wrapRoot: false,
      wrapLongContainers: false,
      compactLayers: false,
    },
    {
      rootDir: 'DOWN',
      closedContainerDirMode: 'SAME',
      parallelAspect: hasParallel ? '1.8' : '1.35',
      wrapRoot: false,
      wrapLongContainers: false,
      compactLayers: false,
    },
  ];
  if (!isLargeGraph) {
    baseCandidates.push(
      {
        rootDir: 'DOWN',
        closedContainerDirMode: 'SAME',
        parallelAspect: hasParallel ? '1.8' : '1.35',
        wrapRoot: false,
        wrapLongContainers: false,
        compactLayers: true,
      },
      {
        rootDir: 'RIGHT',
        closedContainerDirMode: 'SAME',
        parallelAspect: hasParallel ? '0.55' : '1.35',
        wrapRoot: false,
        wrapLongContainers: false,
        compactLayers: true,
      },
    );
  }
  if (hasParallel && !isLargeGraph) {
    baseCandidates.push({
      rootDir: 'RIGHT',
      closedContainerDirMode: 'SAME',
      parallelAspect: '1.35',
      wrapRoot: false,
      wrapLongContainers: false,
      compactLayers: false,
    });
  }

  if (!isLargeGraph && closedContainers.size > 0) {
    baseCandidates.push(
      {
        rootDir: 'RIGHT',
        closedContainerDirMode: 'OPPOSITE',
        parallelAspect: '0.55',
        wrapRoot: false,
        wrapLongContainers: false,
      },
      {
        rootDir: 'DOWN',
        closedContainerDirMode: 'OPPOSITE',
        parallelAspect: '2.1',
        wrapRoot: false,
        wrapLongContainers: false,
      },
    );
  }

  let bestDiag: PositionedDiagram | null = null;
  let bestEval = { hardViolations: Infinity, maxAR: Infinity, score: Infinity };

  const tryConfig = async (cfg: SingleLayoutConfig) => {
    try {
      const diag = await layoutSingleConfig(
        ast,
        cfg,
        closedContainers,
        theme,
        elk,
      );
      const ev = evaluateCandidateLayout(
        diag,
        ast,
        cfg.wrapRoot || cfg.wrapLongContainers,
      );
      if (
        !bestDiag ||
        ev.hardViolations < bestEval.hardViolations ||
        (ev.hardViolations === bestEval.hardViolations &&
          ev.score < bestEval.score)
      ) {
        bestDiag = diag;
        bestEval = ev;
      }
    } catch {
      // Skip unsupported ELK configuration combination cleanly
    }
  };

  for (const cfg of baseCandidates) {
    await tryConfig(cfg);
    if (isLargeGraph && bestEval.hardViolations === 0 && bestEval.maxAR <= 2.35) {
      break;
    }
  }

  if (
    !isLargeGraph &&
    stateCount >= 5 &&
    bestEval.hardViolations > 0 &&
    (hasLongContainer || hasLongRoot)
  ) {
    const wrapCandidates: SingleLayoutConfig[] = [];
    if (hasLongContainer) {
      wrapCandidates.push({
        rootDir: 'RIGHT',
        closedContainerDirMode: 'SAME',
        parallelAspect: '1.35',
        wrapRoot: false,
        wrapLongContainers: true,
      });
    }
    if (hasLongRoot) {
      wrapCandidates.push({
        rootDir: 'RIGHT',
        closedContainerDirMode: 'SAME',
        parallelAspect: '1.35',
        wrapRoot: true,
        wrapLongContainers: hasLongContainer,
      });
    }
    for (const cfg of wrapCandidates) {
      await tryConfig(cfg);
    }
  }

  return (
    bestDiag ??
    layoutSingleConfig(
      ast,
      {
        rootDir: 'RIGHT',
        closedContainerDirMode: 'SAME',
        parallelAspect: '1.35',
        wrapRoot: false,
        wrapLongContainers: false,
      },
      closedContainers,
      theme,
      elk,
    )
  );
}

async function layoutSingleConfig(
  ast: StatechartAST,
  config: SingleLayoutConfig,
  closedContainers: Set<string>,
  theme: ThemeTokens,
  elk: ELKInstance,
): Promise<PositionedDiagram> {
  const direction = config.rootDir;
  const oppDirection: 'RIGHT' | 'DOWN' =
    direction === 'RIGHT' ? 'DOWN' : 'RIGHT';

  const nodeIds = Object.keys(ast.nodes);
  const childrenByParent = new Map<string | null, StateNodeAST[]>();
  for (const id of nodeIds) {
    const n = ast.nodes[id];
    const p = n.parentId && ast.nodes[n.parentId] ? n.parentId : null;
    const list = childrenByParent.get(p) ?? [];
    list.push(n);
    childrenByParent.set(p, list);
  }

  // Order sibling states in BFS order from each container's initial state so
  // MODEL_ORDER cycle breaking always places the initial state on the left/top!
  const adj = new Map<string, string[]>();
  for (const tr of ast.transitions) {
    const list = adj.get(tr.sourceId) ?? [];
    for (const tid of tr.targetIds) {
      if (tid !== tr.sourceId) list.push(tid);
    }
    adj.set(tr.sourceId, list);
  }
  for (const [parentId, siblings] of childrenByParent.entries()) {
    const initId =
      parentId === null
        ? ast.rootInitialTargetId
        : ast.nodes[parentId]?.initialTargetId ?? null;
    if (!initId) continue;
    const siblingSet = new Set(siblings.map((s) => s.id));
    const orderedIds: string[] = [];
    const visited = new Set<string>();
    const queue: string[] = [];
    if (siblingSet.has(initId)) {
      visited.add(initId);
      queue.push(initId);
    }
    while (queue.length > 0) {
      const cur = queue.shift()!;
      orderedIds.push(cur);
      for (const nxt of adj.get(cur) ?? []) {
        // Resolve nxt to sibling ancestor if nested
        let cand: string | null = nxt;
        while (cand && !siblingSet.has(cand)) {
          cand = ast.nodes[cand]?.parentId ?? null;
        }
        if (cand && !visited.has(cand)) {
          visited.add(cand);
          queue.push(cand);
        }
      }
    }
    for (const s of siblings) {
      if (!visited.has(s.id)) orderedIds.push(s.id);
    }
    const byId = new Map(siblings.map((s) => [s.id, s]));
    childrenByParent.set(
      parentId,
      orderedIds.map((id) => byId.get(id)!),
    );
  }

  // Record BFS sibling rank per container so we can classify West vs East port demand
  const siblingRank = new Map<string, number>();
  for (const siblings of childrenByParent.values()) {
    siblings.forEach((s, idx) => siblingRank.set(s.id, idx));
  }

  const resolveSiblingPairRanks = (
    u: string,
    v: string,
  ): { ru: number; rv: number } => {
    const chainU: string[] = [];
    let curU: string | null = u;
    while (curU && ast.nodes[curU]) {
      chainU.unshift(curU);
      curU = ast.nodes[curU].parentId;
    }
    const chainV: string[] = [];
    let curV: string | null = v;
    while (curV && ast.nodes[curV]) {
      chainV.unshift(curV);
      curV = ast.nodes[curV].parentId;
    }
    let k = 0;
    while (k < chainU.length && k < chainV.length && chainU[k] === chainV[k]) {
      k++;
    }
    const subU = chainU[Math.min(k, chainU.length - 1)] ?? u;
    const subV = chainV[Math.min(k, chainV.length - 1)] ?? v;
    return {
      ru: siblingRank.get(subU) ?? 0,
      rv: siblingRank.get(subV) ?? 1,
    };
  };

  // Count external transitions sharing (sourceId, eventType) for priority prefix [#N]
  const externalEventCounts = new Map<string, number>();
  for (const tr of ast.transitions) {
    const k = `${tr.sourceId}::${tr.eventType}`;
    externalEventCounts.set(k, (externalEventCounts.get(k) ?? 0) + 1);
  }

  // Classify non-self incident transitions per state into West vs East peer maps & self-loops
  const westPeersByNode = new Map<string, Map<string, number>>();
  const eastPeersByNode = new Map<string, Map<string, number>>();
  const selfTransitionsByNode = new Map<string, TransitionAST[]>();
  const selfPillsByNode = new Map<string, MeasuredEdgeLabelPill[]>();
  const maxSelfLabelWidth = new Map<string, number>();
  const maxSamePairPillWidthByNode = new Map<string, number>();

  const bumpSidePeer = (
    mapByNode: Map<string, Map<string, number>>,
    nodeId: string,
    peerId: string,
  ) => {
    let m = mapByNode.get(nodeId);
    if (!m) {
      m = new Map<string, number>();
      mapByNode.set(nodeId, m);
    }
    m.set(peerId, (m.get(peerId) ?? 0) + 1);
  };

  for (const tr of ast.transitions) {
    const totalForEvent =
      externalEventCounts.get(`${tr.sourceId}::${tr.eventType}`) ?? 1;
    const pill = measureEdgeLabelPill(
      tr.eventType,
      tr.guard,
      tr.actions,
      tr.order,
      totalForEvent,
    );
    const isSelf =
      tr.targetIds.length === 1 && tr.targetIds[0] === tr.sourceId;
    if (isSelf) {
      const list = selfTransitionsByNode.get(tr.sourceId) ?? [];
      list.push(tr);
      selfTransitionsByNode.set(tr.sourceId, list);
      const pillList = selfPillsByNode.get(tr.sourceId) ?? [];
      pillList.push(pill);
      selfPillsByNode.set(tr.sourceId, pillList);
      maxSelfLabelWidth.set(
        tr.sourceId,
        Math.max(maxSelfLabelWidth.get(tr.sourceId) ?? 0, pill.width),
      );
    } else {
      for (const tid of tr.targetIds) {
        maxSamePairPillWidthByNode.set(
          tr.sourceId,
          Math.max(maxSamePairPillWidthByNode.get(tr.sourceId) ?? 0, pill.width),
        );
        maxSamePairPillWidthByNode.set(
          tid,
          Math.max(maxSamePairPillWidthByNode.get(tid) ?? 0, pill.width),
        );
        if (isAncestorInAst(tr.sourceId, tid, ast)) {
          bumpSidePeer(westPeersByNode, tr.sourceId, tid);
          bumpSidePeer(westPeersByNode, tid, tr.sourceId);
        } else if (isAncestorInAst(tid, tr.sourceId, ast)) {
          bumpSidePeer(eastPeersByNode, tr.sourceId, tid);
          bumpSidePeer(eastPeersByNode, tid, tr.sourceId);
        } else {
          const { ru, rv } = resolveSiblingPairRanks(tr.sourceId, tid);
          if (rv >= ru) {
            bumpSidePeer(eastPeersByNode, tr.sourceId, tid);
            bumpSidePeer(westPeersByNode, tid, tr.sourceId);
          } else {
            bumpSidePeer(westPeersByNode, tr.sourceId, tid);
            bumpSidePeer(eastPeersByNode, tid, tr.sourceId);
          }
        }
      }
    }
  }

  // Count initial indicator arrows toward target state west port budgets so initial
  // states that also receive incoming transitions get enough port room
  if (ast.rootInitialTargetId && ast.nodes[ast.rootInitialTargetId]) {
    bumpSidePeer(westPeersByNode, ast.rootInitialTargetId, '__initial_root__');
  }
  for (const n of Object.values(ast.nodes)) {
    if (n.initialTargetId && ast.nodes[n.initialTargetId]) {
      bumpSidePeer(westPeersByNode, n.initialTargetId, `__initial_${n.id}__`);
    }
  }

  // Determine effective flow direction inside each container (`null` = root)
  const effectiveDirOfContainer = (
    containerId: string | null,
  ): 'RIGHT' | 'DOWN' => {
    if (!containerId) return direction;
    if (
      config.closedContainerDirMode === 'OPPOSITE' &&
      closedContainers.has(containerId)
    ) {
      return oppDirection;
    }
    // Check if an enclosing closed ancestor flipped to `oppDirection`
    let cur: string | null = containerId;
    while (cur) {
      if (
        config.closedContainerDirMode === 'OPPOSITE' &&
        closedContainers.has(cur)
      ) {
        return oppDirection;
      }
      cur = ast.nodes[cur]?.parentId ?? null;
    }
    return direction;
  };

  // Precompute compartments & intrinsic measurements
  const nodeMeta = new Map<
    string,
    {
      groups: CompartmentGroup[];
      minWidth: number;
      minHeight: number;
      headerHeight: number;
      compartmentHeight: number;
      portSpacing: number;
      ports: ElkPort[];
    }
  >();

  for (const n of Object.values(ast.nodes)) {
    const groups = buildCompartmentGroups(n);
    const parentFlowDir = effectiveDirOfContainer(n.parentId ?? null);
    const measured = measureNodeIntrinsicSize(
      n,
      groups,
      westPeersByNode.get(n.id) ?? new Map(),
      eastPeersByNode.get(n.id) ?? new Map(),
      (selfTransitionsByNode.get(n.id) ?? []).length,
      maxSelfLabelWidth.get(n.id) ?? 0,
      maxSamePairPillWidthByNode.get(n.id) ?? 0,
      parentFlowDir,
      theme,
    );
    nodeMeta.set(n.id, {
      groups,
      ...measured,
      ports: [],
    });
  }

  let portSeq = 0;
  const allocatePort = (nodeId: string): string => {
    const meta = nodeMeta.get(nodeId);
    const pid = `port__${nodeId}__${portSeq++}`;
    if (meta) {
      meta.ports.push({
        id: pid,
        width: 1,
        height: 1,
      });
    }
    return pid;
  };

  // Initial pseudostate specs
  interface InitialSpec {
    elkNodeId: string;
    edgeId: string;
    parentId: string | null;
    targetId: string;
    targetPortId: string;
  }
  const initialSpecs: InitialSpec[] = [];

  if (ast.rootInitialTargetId && ast.nodes[ast.rootInitialTargetId]) {
    const elkNodeId = `${INITIAL_NODE_PREFIX}__root__`;
    initialSpecs.push({
      elkNodeId,
      edgeId: `${elkNodeId}__edge`,
      parentId: null,
      targetId: ast.rootInitialTargetId,
      targetPortId: allocatePort(ast.rootInitialTargetId),
    });
  }

  for (const n of Object.values(ast.nodes)) {
    if (
      n.type !== 'parallel' &&
      n.initialTargetId &&
      ast.nodes[n.initialTargetId]
    ) {
      const elkNodeId = `${INITIAL_NODE_PREFIX}${n.id}`;
      initialSpecs.push({
        elkNodeId,
        edgeId: `${elkNodeId}__edge`,
        parentId: n.id,
        targetId: n.initialTargetId,
        targetPortId: allocatePort(n.initialTargetId),
      });
    }
  }

  // Build ELK edges for transitions
  interface EdgeBuildRecord {
    tr: TransitionAST;
    elkEdgeIds: string[];
    pill: MeasuredEdgeLabelPill;
    isSelfLoop: boolean;
  }

  const elkEdgesByContainer = new Map<string | null, ElkExtendedEdge[]>();
  const addElkEdge = (containerId: string | null, edge: ElkExtendedEdge) => {
    const list = elkEdgesByContainer.get(containerId) ?? [];
    list.push(edge);
    elkEdgesByContainer.set(containerId, list);
  };

  // Add initial edges into their container
  for (const spec of initialSpecs) {
    addElkEdge(spec.parentId, {
      id: spec.edgeId,
      sources: [spec.elkNodeId],
      targets: [spec.targetPortId],
      layoutOptions: {
        'elk.layered.priority.direction': '50',
        'elk.layered.priority.shortness': '100',
      },
    });
  }

  const getAncestors = (id: string): string[] => {
    const chain: string[] = [];
    let cur: string | null = id;
    while (cur && ast.nodes[cur]) {
      chain.unshift(cur);
      cur = ast.nodes[cur].parentId;
    }
    return chain;
  };

  const findContainerForPair = (a: string, b: string): string | null => {
    if (a === b) {
      return ast.nodes[a]?.parentId ?? null;
    }
    const ancA = getAncestors(a);
    const ancB = getAncestors(b);
    let lca: string | null = null;
    const len = Math.min(ancA.length, ancB.length);
    for (let i = 0; i < len; i++) {
      if (ancA[i] === ancB[i]) {
        // If one node IS the ancestor of the other, LCA for the edge is that ancestor itself
        lca = ancA[i];
      } else {
        break;
      }
    }
    // If lca equals a or b (ancestor <-> descendant edge), place inside lca so ELK
    // routes cleanly from lca's inner border to the descendant without crossing headers.
    if (lca && (lca === a || lca === b)) {
      const node = ast.nodes[lca];
      if (node.type === 'compound' || node.type === 'parallel') {
        return lca;
      }
      return node.parentId ?? null;
    }
    return lca;
  };

  const isLargeGraph = nodeIds.length >= 35;
  const elkLabelWidthPad = 14;
  const deferredTransitionIds = isLargeGraph
    ? computeFoldedTransitionIds(ast, childrenByParent)
    : new Set<string>();
  const edgeRecords: EdgeBuildRecord[] = [];
  for (const tr of ast.transitions) {
    const totalForEvent =
      externalEventCounts.get(`${tr.sourceId}::${tr.eventType}`) ?? 1;
    const pill = measureEdgeLabelPill(
      tr.eventType,
      tr.guard,
      tr.actions,
      tr.order,
      totalForEvent,
    );
    const isSelfLoop =
      tr.targetIds.length === 1 && tr.targetIds[0] === tr.sourceId;

    if (tr.targetIds.length <= 1) {
      const targetId = tr.targetIds[0] ?? tr.sourceId;
      const srcPort = allocatePort(tr.sourceId);
      const tgtPort = allocatePort(targetId);
      const containerId = findContainerForPair(tr.sourceId, targetId);
      const elkEdgeId = `edge__${tr.id}`;
      if (!deferredTransitionIds.has(tr.id)) {
        addElkEdge(containerId, {
          id: elkEdgeId,
          sources: [srcPort],
          targets: [tgtPort],
          labels: [
            {
              id: `label__${tr.id}`,
              text: pill.text,
              width: pill.width + elkLabelWidthPad,
              height: pill.height + 6,
              layoutOptions: {
                'elk.edgeLabels.placement': 'CENTER',
              },
            },
          ],
        });
      }
      edgeRecords.push({
        tr,
        elkEdgeIds: [elkEdgeId],
        pill,
        isSelfLoop,
      });
    } else {
      // Multi-target fork transition: allocate per-branch ports during ELK layout so branches
      // spanning different hierarchy containers never conflict, then unify trunks post-layout.
      const elkEdgeIds: string[] = [];
      tr.targetIds.forEach((tid, idx) => {
        const srcPort = allocatePort(tr.sourceId);
        const tgtPort = allocatePort(tid);
        const containerId = findContainerForPair(tr.sourceId, tid);
        const branchId = `edge__${tr.id}__branch_${idx}`;
        elkEdgeIds.push(branchId);
        addElkEdge(containerId, {
          id: branchId,
          sources: [srcPort],
          targets: [tgtPort],
          labels:
            idx === 0
              ? [
                  {
                    id: `label__${tr.id}`,
                    text: pill.text,
                    width: pill.width + elkLabelWidthPad,
                    height: pill.height + 6,
                    layoutOptions: {
                      'elk.edgeLabels.placement': 'CENTER',
                    },
                  },
                ]
              : [],
        });
      });
      edgeRecords.push({
        tr,
        elkEdgeIds,
        pill,
        isSelfLoop: false,
      });
    }
  }

  // Recursive ELK node builder
  const buildElkSubtree = (parentId: string | null): ElkNode[] => {
    const result: ElkNode[] = [];

    // Add initial pseudostate node if belonging to this parent
    for (const spec of initialSpecs) {
      if (spec.parentId === parentId) {
        const d = theme.radii.initialDot * 2 + 2;
        result.push({
          id: spec.elkNodeId,
          width: d,
          height: d,
        });
      }
    }

    const children = childrenByParent.get(parentId) ?? [];
    for (const child of children) {
      const meta = nodeMeta.get(child.id)!;
      const grandChildren = buildElkSubtree(child.id);
      const isContainer = grandChildren.length > 0;

      const directChildAsts = childrenByParent.get(child.id) ?? [];
      let maxChildSelfLoops = 0;
      let maxTopLoopNeed = 0;
      let maxBotLoopNeed = 0;
      for (const gc of directChildAsts) {
        const gcPills = selfPillsByNode.get(gc.id) ?? [];
        maxChildSelfLoops = Math.max(maxChildSelfLoops, gcPills.length);
        let topNeed = 0;
        let botNeed = 0;
        gcPills.forEach((pl, pIdx) => {
          const ringNeed = 28 + pl.height + 16;
          if (pIdx % 2 === 0) topNeed += ringNeed;
          else botNeed += ringNeed;
        });
        maxTopLoopNeed = Math.max(maxTopLoopNeed, topNeed);
        maxBotLoopNeed = Math.max(maxBotLoopNeed, botNeed);
      }

      const headerBand = meta.headerHeight + meta.compartmentHeight;
      const topPad = headerBand + Math.max(18, maxTopLoopNeed);
      const bottomPad = Math.max(18, maxBotLoopNeed);
      const leftPad = 18;
      const rightPad = maxChildSelfLoops >= 3 ? 96 : 18;

      const containerMinHeight = isContainer
        ? Math.max(meta.minHeight, topPad + bottomPad + 44)
        : meta.minHeight;

      const layoutOptions: Record<string, string> = {
        'elk.portConstraints': 'FREE',
        'elk.spacing.portPort': String(meta.portSpacing),
        'elk.spacing.portsSurrounding':
          child.type === 'history' && meta.minWidth <= 45
            ? '[top=4,left=4,bottom=4,right=4]'
            : '[top=14,left=14,bottom=14,right=14]',
        'elk.spacing.nodeSelfLoop': '34',
      };

      if (isContainer) {
        const containerDir = effectiveDirOfContainer(child.id);
        const useSeparate =
          config.closedContainerDirMode === 'OPPOSITE' &&
          closedContainers.has(child.id);
        layoutOptions['elk.algorithm'] = 'layered';
        layoutOptions['elk.direction'] = containerDir;
        layoutOptions['elk.hierarchyHandling'] = useSeparate
          ? 'SEPARATE_CHILDREN'
          : 'INCLUDE_CHILDREN';
        layoutOptions['elk.insideSelfLoops.activate'] = 'true';
        layoutOptions['elk.layered.cycleBreaking.strategy'] = 'MODEL_ORDER';
        layoutOptions['elk.considerModelOrder.strategy'] = 'NODES_AND_EDGES';
        layoutOptions['elk.separateConnectedComponents'] = 'true';
        layoutOptions['elk.aspectRatio'] =
          child.type === 'parallel' ? config.parallelAspect : '1.35';
        layoutOptions['elk.spacing.componentComponent'] =
          child.type === 'parallel' ? '26' : isLargeGraph ? '72' : '34';
        layoutOptions['elk.padding'] =
          `[top=${topPad},left=${leftPad},bottom=${bottomPad},right=${rightPad}]`;
        layoutOptions['elk.spacing.nodeNode'] = '36';
        layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'] =
          config.compactLayers
            ? containerDir === 'DOWN'
              ? '26'
              : '40'
            : '76';
        layoutOptions['elk.spacing.edgeNode'] = '24';
        layoutOptions['elk.spacing.edgeEdge'] = '32';
        layoutOptions['elk.layered.spacing.edgeNodeBetweenLayers'] =
          config.compactLayers
            ? containerDir === 'DOWN'
              ? '10'
              : '14'
            : '26';
        layoutOptions['elk.layered.spacing.edgeEdgeBetweenLayers'] = '34';
        layoutOptions['elk.spacing.labelLabel'] = '16';
        layoutOptions['elk.spacing.labelNode'] = config.compactLayers ? '8' : '16';
        layoutOptions['elk.spacing.edgeLabel'] = config.compactLayers ? '5' : '8';
        layoutOptions['elk.nodeSize.constraints'] = 'MINIMUM_SIZE';
        layoutOptions['elk.nodeSize.minimum'] =
          `(${meta.minWidth},${containerMinHeight})`;
        const nonHistDirectChildren = directChildAsts.filter(
          (gc) => gc.type !== 'history',
        ).length;
        if (
          config.wrapLongContainers &&
          containerDir === 'RIGHT' &&
          nonHistDirectChildren >= 6
        ) {
          layoutOptions['elk.layered.wrapping.strategy'] = 'MULTI_EDGE';
          layoutOptions['elk.layered.wrapping.additionalEdgeSpacing'] = '30';
        }
      }

      result.push({
        id: child.id,
        width: meta.minWidth,
        height: containerMinHeight,
        ports: meta.ports,
        children: isContainer ? grandChildren : undefined,
        edges: elkEdgesByContainer.get(child.id),
        layoutOptions,
      });
    }

    return result;
  };

  const rootLayoutOptions: Record<string, string> = {
    'elk.algorithm': 'layered',
    'elk.direction': direction,
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
    'elk.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.aspectRatio': '1.35',
    'elk.spacing.nodeNode': isLargeGraph ? '44' : '38',
    'elk.layered.spacing.nodeNodeBetweenLayers': isLargeGraph
      ? '104'
      : config.compactLayers
        ? direction === 'DOWN'
          ? '26'
          : '40'
        : '82',
    'elk.spacing.edgeNode': '26',
    'elk.spacing.edgeEdge': '32',
    'elk.layered.spacing.edgeNodeBetweenLayers': config.compactLayers
      ? direction === 'DOWN'
        ? '10'
        : '14'
      : '28',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '34',
    'elk.spacing.portPort': '24',
    'elk.spacing.nodeSelfLoop': '34',
    'elk.spacing.labelLabel': '16',
    'elk.spacing.labelNode': config.compactLayers ? '8' : '16',
    'elk.spacing.edgeLabel': config.compactLayers ? '5' : '8',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.separateConnectedComponents': 'true',
    'elk.spacing.componentComponent': isLargeGraph ? '52' : '36',
  };
  const rootNonHistChildren = (childrenByParent.get(null) ?? []).filter(
    (c) => c.type !== 'history',
  ).length;
  if (
    config.wrapRoot &&
    direction === 'RIGHT' &&
    rootNonHistChildren >= 5
  ) {
    rootLayoutOptions['elk.layered.wrapping.strategy'] = 'MULTI_EDGE';
    rootLayoutOptions['elk.layered.wrapping.additionalEdgeSpacing'] = '32';
  }

  const rootGraph: ElkNode = {
    id: '__root__',
    layoutOptions: rootLayoutOptions,
    children: buildElkSubtree(null),
    edges: elkEdgesByContainer.get(null) ?? [],
  };

  const laidOut = await elk.layout(rootGraph);

  // Extract absolute positions for all nodes, initial pseudostates, and edges
  const absNodes = new Map<string, PositionedNode>();
  const absInitialNodes = new Map<string, Rect>();
  const rawEdges = new Map<
    string,
    { points: Point[]; elkLabelPos?: Point }
  >();

  const walkLaidOut = (
    container: ElkNode,
    offsetX: number,
    offsetY: number,
    depth: number,
  ) => {
    for (const edge of container.edges ?? []) {
      // Note: With INCLUDE_CHILDREN, ELK expresses edge sections relative to `container`
      const pts: Point[] = [];
      for (const sec of edge.sections ?? []) {
        const sp = {
          x: offsetX + sec.startPoint.x,
          y: offsetY + sec.startPoint.y,
        };
        if (
          pts.length === 0 ||
          Math.hypot(
            pts[pts.length - 1].x - sp.x,
            pts[pts.length - 1].y - sp.y,
          ) > 0.5
        ) {
          pts.push(sp);
        }
        for (const bp of sec.bendPoints ?? []) {
          pts.push({ x: offsetX + bp.x, y: offsetY + bp.y });
        }
        pts.push({
          x: offsetX + sec.endPoint.x,
          y: offsetY + sec.endPoint.y,
        });
      }
      const lbl = edge.labels?.[0];
      const elkLabelPos =
        lbl && lbl.x !== undefined && lbl.y !== undefined
          ? { x: offsetX + lbl.x, y: offsetY + lbl.y }
          : undefined;
      rawEdges.set(edge.id, { points: pts, elkLabelPos });
    }

    for (const child of container.children ?? []) {
      const cx = offsetX + (child.x ?? 0);
      const cy = offsetY + (child.y ?? 0);
      const cw = child.width ?? 0;
      const ch = child.height ?? 0;

      if (child.id.startsWith(INITIAL_NODE_PREFIX)) {
        absInitialNodes.set(child.id, {
          x: cx,
          y: cy,
          width: cw,
          height: ch,
        });
      } else if (ast.nodes[child.id]) {
        const meta = nodeMeta.get(child.id)!;
        absNodes.set(child.id, {
          ast: ast.nodes[child.id],
          x: cx,
          y: cy,
          width: cw,
          height: ch,
          depth,
          headerHeight: meta.headerHeight,
          compartmentHeight: meta.compartmentHeight,
          compartmentLines: meta.groups,
        });
        walkLaidOut(child, cx, cy, depth + 1);
      }
    }
  };

  walkLaidOut(laidOut, 0, 0, 0);

  // 0. Snap initial indicators to ELK's laid-out endpoints first
  const positionedInitials: PositionedInitialIndicator[] = [];
  for (const spec of initialSpecs) {
    const initRect = absInitialNodes.get(spec.elkNodeId);
    const targetNode = absNodes.get(spec.targetId);
    const rawEdge = rawEdges.get(spec.edgeId);
    if (!initRect || !targetNode) continue;

    const r = theme.radii.initialDot;
    const cx = initRect.x + initRect.width / 2;
    const cy = initRect.y + initRect.height / 2;

    let pts =
      rawEdge && rawEdge.points.length >= 2
        ? rawEdge.points.map((p) => ({ ...p }))
        : [
            { x: cx, y: cy },
            {
              x: targetNode.x,
              y: targetNode.y + targetNode.height / 2,
            },
          ];

    pts = snapInitialPolyline(
      { cx, cy, r },
      targetNode,
      pts,
    );

    positionedInitials.push({
      parentId: spec.parentId,
      targetId: spec.targetId,
      cx,
      cy,
      r,
      points: pts,
    });
  }

  // 1. Build & route non-self transition edges first so initials & self-loops can avoid them
  const nonSelfEdges: PositionedEdge[] = [];
  const edgeSlotByRecord: Array<PositionedEdge | null> = new Array(
    edgeRecords.length,
  ).fill(null);

  const deferredRecordsToRoute: Array<{ rIdx: number; pe: PositionedEdge }> = [];

  for (let rIdx = 0; rIdx < edgeRecords.length; rIdx++) {
    const rec = edgeRecords[rIdx];
    if (rec.isSelfLoop) continue;
    const srcNode = absNodes.get(rec.tr.sourceId);
    if (!srcNode) continue;

    if (deferredTransitionIds.has(rec.tr.id)) {
      const pe: PositionedEdge = {
        ast: rec.tr,
        branches: [],
        label: {
          x: 0,
          y: 0,
          width: rec.pill.width,
          height: rec.pill.height,
          text: rec.pill.text,
          priorityPrefix: rec.pill.priorityPrefix,
          suffix: rec.pill.suffix,
          lineHeight: rec.pill.lineHeight,
          lines: rec.pill.lines,
        },
      };
      deferredRecordsToRoute.push({ rIdx, pe });
      continue;
    }

    const branches: Point[][] = [];
    let hasWrappedDiagonalCut = false;
    for (let i = 0; i < rec.elkEdgeIds.length; i++) {
      const eid = rec.elkEdgeIds[i];
      const tid = rec.tr.targetIds[i] ?? rec.tr.sourceId;
      const tgtNode = absNodes.get(tid);
      const raw = rawEdges.get(eid);
      if (!tgtNode) continue;

      const sMidY = srcNode.y + srcNode.height / 2;
      const tMidY = tgtNode.y + tgtNode.height / 2;
      const midX = (srcNode.x + srcNode.width + tgtNode.x) / 2;
      let pts =
        raw && raw.points.length >= 2
          ? raw.points.map((p) => ({ ...p }))
          : [
              { x: srcNode.x + srcNode.width, y: sMidY },
              { x: midX, y: sMidY },
              { x: midX, y: tMidY },
              { x: tgtNode.x, y: tMidY },
            ];

      pts = snapEdgeEndpoints(srcNode, tgtNode, pts, ast);
      pts = simplifyOrthogonalPolyline(pts);
      for (let k = 0; k < pts.length - 1; k++) {
        if (
          Math.abs(pts[k + 1].x - pts[k].x) > 1.8 &&
          Math.abs(pts[k + 1].y - pts[k].y) > 1.8
        ) {
          hasWrappedDiagonalCut = true;
          break;
        }
      }
      branches.push(pts);
    }

    if (hasWrappedDiagonalCut && rec.tr.targetIds.length === 1) {
      const pe: PositionedEdge = {
        ast: rec.tr,
        branches: [],
        label: {
          x: 0,
          y: 0,
          width: rec.pill.width,
          height: rec.pill.height,
          text: rec.pill.text,
          priorityPrefix: rec.pill.priorityPrefix,
          suffix: rec.pill.suffix,
          lineHeight: rec.pill.lineHeight,
          lines: rec.pill.lines,
        },
      };
      deferredRecordsToRoute.push({ rIdx, pe });
      continue;
    }

    const pe: PositionedEdge = {
      ast: rec.tr,
      branches,
      label: {
        x: 0,
        y: 0,
        width: rec.pill.width,
        height: rec.pill.height,
        text: rec.pill.text,
        priorityPrefix: rec.pill.priorityPrefix,
        suffix: rec.pill.suffix,
        lineHeight: rec.pill.lineHeight,
        lines: rec.pill.lines,
      },
    };
    nonSelfEdges.push(pe);
    edgeSlotByRecord[rIdx] = pe;
  }

  for (const { rIdx, pe } of deferredRecordsToRoute) {
    const tid = pe.ast.targetIds[0] ?? pe.ast.sourceId;
    const pts = routeDeferredFoldEdge(
      pe.ast.sourceId,
      tid,
      nonSelfEdges,
      positionedInitials,
      absNodes,
      ast,
      theme,
    );
    pe.branches = [pts];
    nonSelfEdges.push(pe);
    edgeSlotByRecord[rIdx] = pe;
  }

  // Straighten unnecessary micro-jogs between facing state sides when clear
  straightenMinorJogs(nonSelfEdges, absNodes, ast);

  // De-overlap any collinear parallel segments from different transitions
  separateCollinearEdgeSegments(nonSelfEdges, absNodes, ast);

  // Re-verify endpoint snapping & obstacle avoidance for non-self edges
  for (const edge of nonSelfEdges) {
    const srcNode = absNodes.get(edge.ast.sourceId);
    if (!srcNode) continue;
    for (let b = 0; b < edge.branches.length; b++) {
      const tid = edge.ast.targetIds[b] ?? edge.ast.sourceId;
      const tgtNode = absNodes.get(tid);
      if (!tgtNode) continue;
      edge.branches[b] = simplifyOrthogonalPolyline(
        snapEdgeEndpoints(srcNode, tgtNode, edge.branches[b], ast),
      );
      edge.branches[b] = rerouteAroundPiercedObstacles(
        edge.ast.sourceId,
        tid,
        edge.branches[b],
        absNodes,
        ast,
        theme,
      );
    }
  }

  // Run another pass of collinear separation in case obstacle rerouting created shared lanes
  uncrossSamePairEdges(nonSelfEdges);
  separateCollinearEdgeSegments(nonSelfEdges, absNodes, ast);
  straightenMinorJogs(nonSelfEdges, absNodes, ast);
  eliminatePolylineMicroJogs(nonSelfEdges, absNodes, ast);
  separateCollinearEdgeSegments(nonSelfEdges, absNodes, ast);
  uncrossSamePairEdges(nonSelfEdges);
  for (const edge of nonSelfEdges) {
    const srcNode = absNodes.get(edge.ast.sourceId);
    if (!srcNode) continue;
    for (let b = 0; b < edge.branches.length; b++) {
      const tid = edge.ast.targetIds[b] ?? edge.ast.sourceId;
      const tgtNode = absNodes.get(tid);
      if (!tgtNode) continue;
      edge.branches[b] = rerouteAroundPiercedObstacles(
        edge.ast.sourceId,
        tid,
        edge.branches[b],
        absNodes,
        ast,
        theme,
      );
    }
  }
  rerouteWraparoundMultiEdgeBundles(nonSelfEdges, absNodes, ast, theme);
  connectHaloEdgesToHistoryCircles(nonSelfEdges, absNodes);
  unifyHyperedgeTrunks(nonSelfEdges, absNodes, ast, theme);
  resnapRegularHistoryEndpoints(nonSelfEdges, absNodes);
  eliminatePolylineMicroJogs(nonSelfEdges, absNodes, ast);
  enforceStrictOrthogonalEdges(nonSelfEdges, absNodes);

  // 1b. Compact initial indicators close to their target states while respecting parent containers & routed wires
  for (const ind of positionedInitials) {
    const targetNode = absNodes.get(ind.targetId);
    if (!targetNode) continue;
    const parentNode = ind.parentId ? absNodes.get(ind.parentId) ?? null : null;
    const compacted = compactInitialIndicator(
      { cx: ind.cx, cy: ind.cy, r: ind.r, pts: ind.points },
      targetNode,
      parentNode,
      Array.from(absNodes.values()),
      nonSelfEdges,
    );
    ind.cx = compacted.cx;
    ind.cy = compacted.cy;
    ind.points = compacted.pts;
  }

  // 2. Now build external self-loops with full awareness of routed non-self edges & sibling self-loops
  const placedSelfLoopsPerNode = new Map<
    string,
    PlacedSelfLoopRecord[]
  >();
  const selfLoopIndexPerNode = new Map<string, number>();

  for (let rIdx = 0; rIdx < edgeRecords.length; rIdx++) {
    const rec = edgeRecords[rIdx];
    if (!rec.isSelfLoop) continue;
    const srcNode = absNodes.get(rec.tr.sourceId);
    if (!srcNode) continue;

    const loopIdx = selfLoopIndexPerNode.get(rec.tr.sourceId) ?? 0;
    selfLoopIndexPerNode.set(rec.tr.sourceId, loopIdx + 1);
    const existingOnNode = placedSelfLoopsPerNode.get(rec.tr.sourceId) ?? [];

    const built = buildCleanSelfLoop(
      srcNode,
      loopIdx,
      rec.pill,
      Array.from(absNodes.values()),
      positionedInitials,
      nonSelfEdges,
      existingOnNode,
    );
    existingOnNode.push(built.record);
    placedSelfLoopsPerNode.set(rec.tr.sourceId, existingOnNode);

    edgeSlotByRecord[rIdx] = {
      ast: rec.tr,
      branches: [built.points],
      label: {
        x: 0,
        y: 0,
        width: rec.pill.width,
        height: rec.pill.height,
        text: rec.pill.text,
        priorityPrefix: rec.pill.priorityPrefix,
        suffix: rec.pill.suffix,
        lineHeight: rec.pill.lineHeight,
        lines: rec.pill.lines,
      },
    };
  }

  const positionedEdges: PositionedEdge[] = edgeSlotByRecord.filter(
    (e): e is PositionedEdge => e !== null,
  );

  // Place all transition labels with guaranteed collision-free + Voronoi nearest-neighbor safety
  placeAllEdgeLabels(
    positionedEdges,
    Array.from(absNodes.values()),
    positionedInitials,
    ast,
  );

  // Normalize canvas coordinates so all elements lie comfortably inside [padding, W - padding]
  const orderedNodes = Array.from(absNodes.values()).sort(
    (a, b) => a.depth - b.depth,
  );

  const normalized = normalizeCanvasBounds(
    orderedNodes,
    positionedInitials,
    positionedEdges,
    theme,
  );

  return normalized;
}

function evaluateCandidateLayout(
  diag: PositionedDiagram,
  ast: StatechartAST,
  isWrapped: boolean,
): { hardViolations: number; maxAR: number; score: number } {
  const w = Math.max(1, diag.width);
  const h = Math.max(1, diag.height);
  const ar = w / h;
  const maxAR = Math.max(ar, 1 / ar);
  const stateCount = diag.nodes.length;

  let hardViolations = 0;

  // 1. Canvas aspect ratio cap (Gate 2: max(W/H, H/W) <= 3.5 on >= 2-state diagrams)
  if (stateCount >= 2 && maxAR > 3.45) {
    hardViolations += 2 + (maxAR - 3.45) * 5;
  }

  // 2. Atomic/final node height proportions (matching geometry-lint.ts)
  const incidentPerNode = new Map<string, number>();
  for (const edge of diag.edges) {
    incidentPerNode.set(
      edge.ast.sourceId,
      (incidentPerNode.get(edge.ast.sourceId) ?? 0) + 1,
    );
    for (const tid of edge.ast.targetIds) {
      if (tid !== edge.ast.sourceId) {
        incidentPerNode.set(tid, (incidentPerNode.get(tid) ?? 0) + 1);
      }
    }
  }
  for (const n of diag.nodes) {
    if (n.ast.type === 'atomic' || n.ast.type === 'final') {
      const inc = incidentPerNode.get(n.ast.id) ?? 0;
      const expectedContentH = 40 + n.compartmentHeight;
      const expectedPortH = 28 + Math.max(1, inc) * 44;
      const maxAllowedH = Math.max(expectedContentH, expectedPortH, 68) + 64;
      if (n.height > maxAllowedH) {
        hardViolations += 1;
      }
    }
  }

  // 3. Label clearances, state-border checks, own-path, foreign-wire & Voronoi checks
  const getAllowedContainers = (edge: PositionedEdge): Set<string> => {
    const allowed = new Set<string>();
    const addAnc = (id: string) => {
      let cur = ast.nodes[id]?.parentId ?? null;
      while (cur) {
        allowed.add(cur);
        cur = ast.nodes[cur]?.parentId ?? null;
      }
    };
    addAnc(edge.ast.sourceId);
    for (const tid of edge.ast.targetIds) addAnc(tid);
    return allowed;
  };

  for (let i = 0; i < diag.edges.length; i++) {
    const edge = diag.edges[i];
    if (!edge.label.text || edge.label.width <= 0 || edge.label.height <= 0) {
      continue;
    }
    const lRect: Rect = {
      x: edge.label.x,
      y: edge.label.y,
      width: edge.label.width,
      height: edge.label.height,
    };
    const center: Point = {
      x: lRect.x + lRect.width / 2,
      y: lRect.y + lRect.height / 2,
    };
    const allowed = getAllowedContainers(edge);

    for (const node of diag.nodes) {
      const nBox: Rect = {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
      };
      if (!rectsIntersect(lRect, nBox, 0)) continue;
      if (!allowed.has(node.ast.id)) {
        hardViolations += 2;
      } else {
        const bandBottom =
          node.ast.type === 'compound' || node.ast.type === 'parallel'
            ? node.y + node.headerHeight + node.compartmentHeight + 1.5
            : node.y + 1.5;
        const strictlyInside =
          lRect.x >= node.x + 1.5 &&
          lRect.y >= bandBottom &&
          lRect.x + lRect.width <= node.x + node.width - 1.5 &&
          lRect.y + lRect.height <= node.y + node.height - 1.5;
        if (!strictlyInside) {
          hardViolations += 2;
        }
      }
    }
    for (const init of diag.initialIndicators) {
      const ir: Rect = {
        x: init.cx - init.r,
        y: init.cy - init.r,
        width: init.r * 2,
        height: init.r * 2,
      };
      if (rectsIntersect(lRect, ir, 0)) {
        hardViolations += 2;
      }
    }

    for (let j = i + 1; j < diag.edges.length; j++) {
      const oLbl = diag.edges[j].label;
      if (!oLbl.text || oLbl.width <= 0 || oLbl.height <= 0) continue;
      const oRect: Rect = {
        x: oLbl.x,
        y: oLbl.y,
        width: oLbl.width,
        height: oLbl.height,
      };
      if (rectsIntersect(lRect, oRect, 0)) {
        hardViolations += 3;
      } else {
        const dx = Math.max(
          0,
          lRect.x - (oRect.x + oRect.width),
          oRect.x - (lRect.x + lRect.width),
        );
        const dy = Math.max(
          0,
          lRect.y - (oRect.y + oRect.height),
          oRect.y - (lRect.y + lRect.height),
        );
        if (Math.hypot(dx, dy) < 13.95) {
          hardViolations += 2;
        }
      }
    }

    const dOwn = distRectToEdge(lRect, edge);
    if (dOwn > 13.5) {
      hardViolations += 2;
    }
    if (edge.branches.length > 1) {
      const p0 = edge.branches[0]?.[0];
      for (const br of edge.branches) {
        if (distRectToPolyline(lRect, br) > 13.5) {
          hardViolations += 2;
        }
        if (
          p0 &&
          br.length > 0 &&
          Math.hypot(br[0].x - p0.x, br[0].y - p0.y) > 1.5
        ) {
          hardViolations += 2;
        }
      }
    }

    const dOwnC = distPointToEdge(center, edge);
    for (let j = 0; j < diag.edges.length; j++) {
      if (j === i) continue;
      if (distRectToEdge(lRect, diag.edges[j]) < 4.2) {
        hardViolations += 2;
      }
      if (distPointToEdge(center, diag.edges[j]) - dOwnC <= 8.2) {
        hardViolations += 2;
      }
    }
  }

  // 4. Obstacle piercing, terminal tangents, title crossings, collinear overlaps, crossings & bends
  const nodeById = new Map(diag.nodes.map((n) => [n.ast.id, n]));
  const evalOutwardNormal = (pt: Point, n: PositionedNode): Point => {
    const cx = n.x + n.width / 2;
    const cy = n.y + n.height / 2;
    if (n.ast.type === 'history' && !(n.ast.key === 'history' && n.width > 45)) {
      const dx = pt.x - cx;
      const dy = pt.y - cy;
      const len = Math.hypot(dx, dy);
      return len > 1e-6 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 };
    }
    const dL = Math.abs(pt.x - n.x);
    const dR = Math.abs(pt.x - (n.x + n.width));
    const dT = Math.abs(pt.y - n.y);
    const dB = Math.abs(pt.y - (n.y + n.height));
    const m = Math.min(dL, dR, dT, dB);
    if (m === dL) return { x: -1, y: 0 };
    if (m === dR) return { x: 1, y: 0 };
    if (m === dT) return { x: 0, y: -1 };
    return { x: 0, y: 1 };
  };

  interface EvalSeg {
    edgeIdx: number;
    horiz: boolean;
    coord: number;
    lo: number;
    hi: number;
  }
  const segs: EvalSeg[] = [];
  let bends = 0;
  let detourScorePenalty = 0;

  const lcaOfAstPair = (a: string, b: string): string | null => {
    const chainA: string[] = [];
    let c: string | null = ast.nodes[a]?.parentId ?? null;
    while (c) {
      chainA.unshift(c);
      c = ast.nodes[c]?.parentId ?? null;
    }
    const setA = new Set(chainA);
    let cb: string | null = ast.nodes[b]?.parentId ?? null;
    while (cb) {
      if (setA.has(cb)) return cb;
      cb = ast.nodes[cb]?.parentId ?? null;
    }
    return null;
  };

  const isDescInScope = (id: string, scopeAnc: string | null): boolean =>
    scopeAnc === null ? true : isAncestorInAst(scopeAnc, id, ast);

  const scopeAdjCache = new Map<string, Map<string, Set<string>>>();
  const canReachWithinScope = (
    startId: string,
    goalId: string,
    scopeAnc: string | null,
  ): boolean => {
    const key = scopeAnc ?? '__root__';
    let adj = scopeAdjCache.get(key);
    if (!adj) {
      adj = new Map<string, Set<string>>();
      const addE = (u: string, v: string) => {
        let s = adj!.get(u);
        if (!s) {
          s = new Set<string>();
          adj!.set(u, s);
        }
        s.add(v);
      };
      const allN = Object.values(ast.nodes);
      for (const n of allN) {
        if (!isDescInScope(n.id, scopeAnc)) continue;
        if (n.type === 'compound' && n.initialTargetId) {
          addE(n.id, n.initialTargetId);
        } else if (n.type === 'parallel') {
          for (const ch of allN) {
            if (ch.parentId === n.id) addE(n.id, ch.id);
          }
        } else if (n.type === 'history' && n.parentId) {
          for (const ch of allN) {
            if (ch.id !== n.id && isAncestorInAst(n.parentId, ch.id, ast)) {
              addE(n.id, ch.id);
            }
          }
        }
      }
      for (const tr of ast.transitions) {
        if (!isDescInScope(tr.sourceId, scopeAnc)) continue;
        for (const tId of tr.targetIds) {
          if (!isDescInScope(tId, scopeAnc)) continue;
          addE(tr.sourceId, tId);
          for (const n of allN) {
            if (isAncestorInAst(tr.sourceId, n.id, ast)) {
              addE(n.id, tId);
            }
          }
        }
      }
      scopeAdjCache.set(key, adj);
    }

    const goals = new Set<string>([goalId]);
    for (const nId of Object.keys(ast.nodes)) {
      if (isAncestorInAst(goalId, nId, ast)) goals.add(nId);
    }
    const seen = new Set<string>([startId]);
    const queue: string[] = [startId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (goals.has(cur)) return true;
      for (const nxt of adj.get(cur) ?? []) {
        if (!seen.has(nxt)) {
          seen.add(nxt);
          queue.push(nxt);
        }
      }
    }
    return false;
  };

  for (let eIdx = 0; eIdx < diag.edges.length; eIdx++) {
    const edge = diag.edges[eIdx];
    const srcNode = nodeById.get(edge.ast.sourceId);
    const srcIsTgtAnc = edge.ast.targetIds.some((tid) =>
      isAncestorInAst(edge.ast.sourceId, tid, ast),
    );
    for (let b = 0; b < edge.branches.length; b++) {
      const br = edge.branches[b];
      if (br.length > 2) bends += br.length - 2;
      const tid = edge.ast.targetIds[b] ?? edge.ast.sourceId;
      const tgtNode = nodeById.get(tid);

      if (
        edge.ast.targetIds.length === 1 &&
        edge.branches.length === 1 &&
        br.length >= 2 &&
        edge.ast.sourceId !== tid &&
        !isAncestorInAst(edge.ast.sourceId, tid, ast) &&
        !isAncestorInAst(tid, edge.ast.sourceId, ast)
      ) {
        const scopeAnc = lcaOfAstPair(edge.ast.sourceId, tid);
        if (!canReachWithinScope(tid, edge.ast.sourceId, scopeAnc)) {
          const p0 = br[0];
          const pEnd = br[br.length - 1];
          const directDist = Math.hypot(pEnd.x - p0.x, pEnd.y - p0.y);
          const pathLen = polylineLength(br);
          const maxAllowedLen = Math.max(3.5 * directDist, directDist + 480);
          const upwardClimb = p0.y - pEnd.y;
          if (
            pathLen > maxAllowedLen ||
            (srcNode?.ast.type !== 'history' && upwardClimb > 500)
          ) {
            hardViolations += 4;
          } else if (directDist > 20 && pathLen > 1.55 * directDist + 50) {
            detourScorePenalty += (pathLen / directDist - 1.55) * 0.22;
          }
        }
      }

      if (br.length >= 2 && srcNode && !srcIsTgtAnc) {
        const d0 = Math.hypot(br[1].x - br[0].x, br[1].y - br[0].y);
        if (d0 > 1e-4) {
          const nOut = evalOutwardNormal(br[0], srcNode);
          const dotOut =
            ((br[1].x - br[0].x) / d0) * nOut.x +
            ((br[1].y - br[0].y) / d0) * nOut.y;
          if (dotOut < 0.5) hardViolations += 2;
        }
      }
      if (
        br.length >= 2 &&
        tgtNode &&
        !isAncestorInAst(tid, edge.ast.sourceId, ast)
      ) {
        const pA = br[br.length - 2];
        const pB = br[br.length - 1];
        const dE = Math.hypot(pB.x - pA.x, pB.y - pA.y);
        if (dE > 1e-4) {
          const nOut = evalOutwardNormal(pB, tgtNode);
          const dotIn =
            ((pB.x - pA.x) / dE) * -nOut.x + ((pB.y - pA.y) / dE) * -nOut.y;
          if (dotIn < 0.5) hardViolations += 2;
        }
      }

      if (tid !== edge.ast.sourceId) {
        const totalLen = polylineLength(br);
        for (let d = 5; d < totalLen - 5; d += 4) {
          const p = pointAtPolylineLength(br, d);
          for (const node of diag.nodes) {
            const uid = node.ast.id;
            if (
              node.ast.type === 'compound' ||
              node.ast.type === 'parallel'
            ) {
              const titleW = measureTextWidth(node.ast.key, {
                fontFamily: 'sans',
                fontSize: diag.theme.fontSizes.stateTitle,
                bold: true,
              });
              if (
                p.x >= node.x + 12 &&
                p.x <= node.x + Math.min(node.width - 10, 16 + titleW) &&
                p.y >= node.y + 7 &&
                p.y <= node.y + 25
              ) {
                hardViolations += 2;
                break;
              }
            }
            if (
              uid === edge.ast.sourceId ||
              uid === tid ||
              isAncestorInAst(uid, edge.ast.sourceId, ast) ||
              isAncestorInAst(uid, tid, ast)
            ) {
              continue;
            }
            if (
              node.ast.type === 'history' &&
              !(node.ast.key === 'history' && node.width > 45)
            ) {
              const r = Math.min(node.width, node.height) / 2 - 1.5;
              const cx = node.x + node.width / 2;
              const cy = node.y + node.height / 2;
              if (r > 0 && Math.hypot(p.x - cx, p.y - cy) < r) {
                hardViolations += 2;
                break;
              }
            } else if (
              p.x > node.x + 1.5 &&
              p.x < node.x + node.width - 1.5 &&
              p.y > node.y + 1.5 &&
              p.y < node.y + node.height - 1.5
            ) {
              hardViolations += 2;
              break;
            }
          }
        }
      }

      for (let s = 0; s < br.length - 1; s++) {
        const p1 = br[s];
        const p2 = br[s + 1];
        const dx = Math.abs(p2.x - p1.x);
        const dy = Math.abs(p2.y - p1.y);
        if (dx > 2.0 && dy > 2.0) {
          hardViolations += 4;
        }
        if (dy < 1 && dx >= 8) {
          segs.push({
            edgeIdx: eIdx,
            horiz: true,
            coord: (p1.y + p2.y) / 2,
            lo: Math.min(p1.x, p2.x),
            hi: Math.max(p1.x, p2.x),
          });
        } else if (dx < 1 && dy >= 8) {
          segs.push({
            edgeIdx: eIdx,
            horiz: false,
            coord: (p1.x + p2.x) / 2,
            lo: Math.min(p1.y, p2.y),
            hi: Math.max(p1.y, p2.y),
          });
        }
      }
    }
  }

  let crossings = 0;
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i];
    for (let j = i + 1; j < segs.length; j++) {
      const b = segs[j];
      if (a.edgeIdx === b.edgeIdx) continue;
      if (a.horiz === b.horiz) {
        const overlap = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
        const perp = Math.abs(a.coord - b.coord);
        if (overlap > 8 && perp < 4.0) {
          hardViolations += 2;
        } else if (
          overlap > 10 &&
          perp < 14.0 &&
          edgesShareStatePair(diag.edges[a.edgeIdx], diag.edges[b.edgeIdx])
        ) {
          hardViolations += 2;
        }
      } else {
        const hSeg = a.horiz ? a : b;
        const vSeg = a.horiz ? b : a;
        if (
          vSeg.coord > hSeg.lo + 2 &&
          vSeg.coord < hSeg.hi - 2 &&
          hSeg.coord > vSeg.lo + 2 &&
          hSeg.coord < vSeg.hi - 2
        ) {
          crossings++;
          if (edgesShareStatePair(diag.edges[a.edgeIdx], diag.edges[b.edgeIdx])) {
            hardViolations += 2;
          }
        }
      }
    }
  }

  for (let i = 0; i < diag.edges.length; i++) {
    for (let j = i + 1; j < diag.edges.length; j++) {
      if (!edgesShareStatePair(diag.edges[i], diag.edges[j])) continue;
      let minSep = Infinity;
      for (const brA of diag.edges[i].branches) {
        for (let sA = 0; sA < brA.length - 1; sA++) {
          const rA: Rect = {
            x: Math.min(brA[sA].x, brA[sA + 1].x),
            y: Math.min(brA[sA].y, brA[sA + 1].y),
            width: Math.abs(brA[sA + 1].x - brA[sA].x),
            height: Math.abs(brA[sA + 1].y - brA[sA].y),
          };
          for (const brB of diag.edges[j].branches) {
            minSep = Math.min(minSep, distRectToPolyline(rA, brB));
          }
        }
      }
      if (minSep < 14.0) {
        hardViolations += 2;
      }
    }
  }

  const arBalance = Math.abs(Math.log(Math.max(0.05, ar) / 1.35)) * 0.72;
  const arExcess =
    Math.max(0, maxAR - 1.95) * 0.9 + Math.max(0, maxAR - 2.6) * 2.5;
  const areaTerm = Math.log(Math.max(1, w * h)) * 0.85;
  const score =
    arBalance +
    arExcess +
    areaTerm +
    crossings * 0.05 +
    bends * 0.008 +
    detourScorePenalty +
    (isWrapped ? 0.95 : 0);

  return { hardViolations, maxAR, score };
}

// ============================================================================
// Geometric Post-Processing Helpers
// ============================================================================

function clamp(v: number, lo: number, hi: number): number {
  if (lo > hi) return (lo + hi) / 2;
  return Math.max(lo, Math.min(hi, v));
}

function nodeCornerMargin(node: PositionedNode): number {
  const base = node.ast.type === 'compound' ? 15 : 13;
  return Math.min(base, node.width / 3, node.height / 3);
}

function nodeAllowedYRange(
  node: PositionedNode,
  inwardToDescendant: boolean,
): { minY: number; maxY: number } {
  const margin = nodeCornerMargin(node);
  const maxY = node.y + node.height - margin;
  if (
    inwardToDescendant &&
    (node.ast.type === 'compound' || node.ast.type === 'parallel')
  ) {
    const bodyTop =
      node.y + node.headerHeight + node.compartmentHeight + 14;
    return {
      minY: Math.min(maxY, Math.max(node.y + margin, bodyTop)),
      maxY,
    };
  }
  return { minY: node.y + margin, maxY };
}

function snapPointToNodePerimeter(
  pt: Point,
  interiorHint: Point,
  node: PositionedNode,
  inwardToDescendant = false,
): { snapped: Point; side: 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM' } {
  if (
    node.ast.type === 'history' &&
    !(node.ast.key === 'history' && node.width > 45)
  ) {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const left = node.x;
    const right = node.x + node.width;
    const top = node.y;
    const bottom = node.y + node.height;

    const segDx = Math.abs(pt.x - interiorHint.x);
    const segDy = Math.abs(pt.y - interiorHint.y);
    let sideChoice: 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM';
    if (segDx + segDy > 1.5) {
      if (segDx >= segDy) {
        sideChoice = interiorHint.x <= cx ? 'LEFT' : 'RIGHT';
      } else {
        sideChoice = interiorHint.y <= cy ? 'TOP' : 'BOTTOM';
      }
    } else {
      const dLeft = Math.abs(pt.x - left);
      const dRight = Math.abs(pt.x - right);
      const dTop = Math.abs(pt.y - top);
      const dBottom = Math.abs(pt.y - bottom);
      const minD = Math.min(dLeft, dRight, dTop, dBottom);
      sideChoice =
        minD === dLeft
          ? 'LEFT'
          : minD === dRight
            ? 'RIGHT'
            : minD === dTop
              ? 'TOP'
              : 'BOTTOM';
    }

    if (node.ast.key === 'history') {
      const r = Math.min(node.width, node.height) / 2;
      const maxOff = Math.max(0, r - 3.5);
      if (sideChoice === 'LEFT') {
        const y = clamp(pt.y, cy - maxOff, cy + maxOff);
        const dy = y - cy;
        return {
          snapped: { x: cx - Math.sqrt(Math.max(0, r * r - dy * dy)), y },
          side: 'LEFT',
        };
      }
      if (sideChoice === 'RIGHT') {
        const y = clamp(pt.y, cy - maxOff, cy + maxOff);
        const dy = y - cy;
        return {
          snapped: { x: cx + Math.sqrt(Math.max(0, r * r - dy * dy)), y },
          side: 'RIGHT',
        };
      }
      if (sideChoice === 'TOP') {
        const x = clamp(pt.x, cx - maxOff, cx + maxOff);
        const dx = x - cx;
        return {
          snapped: { x, y: cy - Math.sqrt(Math.max(0, r * r - dx * dx)) },
          side: 'TOP',
        };
      }
      const x = clamp(pt.x, cx - maxOff, cx + maxOff);
      const dx = x - cx;
      return {
        snapped: { x, y: cy + Math.sqrt(Math.max(0, r * r - dx * dx)) },
        side: 'BOTTOM',
      };
    }

    // Rounded capsule history node (`key !== 'history'`)
    const rx = Math.min(14, node.height / 2);
    const maxCapOff = Math.max(0, rx - 3.5);
    if (sideChoice === 'LEFT') {
      const y = clamp(pt.y, cy - maxCapOff, cy + maxCapOff);
      const dy = y - cy;
      return {
        snapped: {
          x: left + rx - Math.sqrt(Math.max(0, rx * rx - dy * dy)),
          y,
        },
        side: 'LEFT',
      };
    }
    if (sideChoice === 'RIGHT') {
      const y = clamp(pt.y, cy - maxCapOff, cy + maxCapOff);
      const dy = y - cy;
      return {
        snapped: {
          x: right - rx + Math.sqrt(Math.max(0, rx * rx - dy * dy)),
          y,
        },
        side: 'RIGHT',
      };
    }
    if (sideChoice === 'TOP') {
      return {
        snapped: { x: clamp(pt.x, left + rx, right - rx), y: top },
        side: 'TOP',
      };
    }
    return {
      snapped: { x: clamp(pt.x, left + rx, right - rx), y: bottom },
      side: 'BOTTOM',
    };
  }

  const left = node.x;
  const right = node.x + node.width;
  const top = node.y;
  const bottom = node.y + node.height;
  const margin = nodeCornerMargin(node);
  const { minY, maxY } = nodeAllowedYRange(node, inwardToDescendant);

  const dLeft = Math.abs(pt.x - left);
  const dRight = Math.abs(pt.x - right);
  // Never snap inward border transitions onto a compound parent's TOP header wall
  const dTop = inwardToDescendant ? Infinity : Math.abs(pt.y - top);
  const dBottom = Math.abs(pt.y - bottom);
  const minD = Math.min(dLeft, dRight, dTop, dBottom);

  if (minD === dLeft) {
    return {
      snapped: { x: left, y: clamp(pt.y, minY, maxY) },
      side: 'LEFT',
    };
  }
  if (minD === dRight) {
    return {
      snapped: { x: right, y: clamp(pt.y, minY, maxY) },
      side: 'RIGHT',
    };
  }
  if (minD === dTop) {
    return {
      snapped: { x: clamp(pt.x, left + margin, right - margin), y: top },
      side: 'TOP',
    };
  }
  return {
    snapped: { x: clamp(pt.x, left + margin, right - margin), y: bottom },
    side: 'BOTTOM',
  };
}

function snapInitialPolyline(
  dot: { cx: number; cy: number; r: number },
  targetNode: PositionedNode,
  pts: Point[],
): Point[] {
  const out = pts.map((p) => ({ ...p }));
  if (out.length < 2) {
    out.push({ x: targetNode.x, y: targetNode.y + targetNode.height / 2 });
  }

  // Snap end to targetNode perimeter
  const prev = out[out.length - 2];
  const endSnap = snapPointToNodePerimeter(
    out[out.length - 1],
    prev,
    targetNode,
  );
  out[out.length - 1] = endSnap.snapped;
  if (out.length === 2) {
    // Direct line from dot center toward snapped target point, clipped to dot radius
    let dx = out[1].x - dot.cx;
    let dy = out[1].y - dot.cy;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    out[0] = { x: dot.cx + dx * dot.r, y: dot.cy + dy * dot.r };
    return out;
  }

  // Align penultimate point orthogonally to target side
  if (endSnap.side === 'LEFT' || endSnap.side === 'RIGHT') {
    out[out.length - 2].y = endSnap.snapped.y;
  } else {
    out[out.length - 2].x = endSnap.snapped.x;
  }

  // Start point on circle perimeter aimed at out[1]
  let dx = out[1].x - dot.cx;
  let dy = out[1].y - dot.cy;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  out[0] = { x: dot.cx + dx * dot.r, y: dot.cy + dy * dot.r };

  return simplifyOrthogonalPolyline(out);
}

function compactInitialIndicator(
  ind: { cx: number; cy: number; r: number; pts: Point[] },
  targetNode: PositionedNode,
  parentNode: PositionedNode | null,
  allNodes: PositionedNode[],
  nonSelfEdges: PositionedEdge[],
): { cx: number; cy: number; pts: Point[] } {
  if (ind.pts.length < 2) {
    return { cx: ind.cx, cy: ind.cy, pts: ind.pts };
  }
  const pEnd = ind.pts[ind.pts.length - 1];
  const pPrev = ind.pts[ind.pts.length - 2];
  const dx = pPrev.x - pEnd.x;
  const dy = pPrev.y - pEnd.y;
  const desiredDist = 34; // crisp 28.5px shaft + 5.5px radius

  const evalStraightCandidate = (
    candEnd: Point,
    ux: number,
    uy: number,
    dist: number,
    minEdgeClear: number,
  ): { cx: number; cy: number; pts: Point[]; minEdgeDist: number } | null => {
    const newCx = candEnd.x + ux * dist;
    const newCy = candEnd.y + uy * dist;
    const dotBox: Rect = {
      x: newCx - ind.r,
      y: newCy - ind.r,
      width: ind.r * 2,
      height: ind.r * 2,
    };
    const shaftBox: Rect = {
      x: Math.min(newCx, candEnd.x) - 2,
      y: Math.min(newCy, candEnd.y) - 2,
      width: Math.abs(newCx - candEnd.x) + 4,
      height: Math.abs(newCy - candEnd.y) + 4,
    };

    // Must stay strictly inside enclosing compound container body (below header + compartments)
    if (parentNode) {
      const bodyTop =
        parentNode.y +
        parentNode.headerHeight +
        parentNode.compartmentHeight +
        6;
      if (
        dotBox.x < parentNode.x + 10 ||
        dotBox.x + dotBox.width > parentNode.x + parentNode.width - 10 ||
        dotBox.y < bodyTop ||
        dotBox.y + dotBox.height > parentNode.y + parentNode.height - 10
      ) {
        return null;
      }
    }

    for (const other of allNodes) {
      if (other.ast.id === targetNode.ast.id) continue;
      if (isStrictAncestor(other.ast.id, targetNode.ast.id, allNodes)) continue;
      if (
        rectsIntersect(dotBox, other, 10) ||
        rectsIntersect(shaftBox, other, 4)
      ) {
        return null;
      }
    }

    let minEdgeDist = Infinity;
    for (const edge of nonSelfEdges) {
      const dDot = distRectToEdge(dotBox, edge);
      const dShaft = distRectToEdge(shaftBox, edge);
      const d = Math.min(dDot, dShaft + 2);
      if (dDot < minEdgeClear || dShaft < Math.max(4, minEdgeClear - 2)) {
        return null;
      }
      if (d < minEdgeDist) minEdgeDist = d;
    }

    return {
      cx: newCx,
      cy: newCy,
      pts: [
        { x: newCx - ux * ind.r, y: newCy - uy * ind.r },
        { ...candEnd },
      ],
      minEdgeDist,
    };
  };

  // Axis-aligned unit vector from pEnd outward along terminal approach segment
  const ux = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0;
  const uy = Math.abs(dx) < Math.abs(dy) ? Math.sign(dy) : 0;

  if (ux !== 0 || uy !== 0) {
    const atOriginal = evalStraightCandidate(pEnd, ux, uy, desiredDist, 8);
    if (atOriginal) {
      if (
        ind.pts.length === 2 &&
        Math.hypot(ind.cx - pEnd.x, ind.cy - pEnd.y) <= desiredDist + 4
      ) {
        return { cx: ind.cx, cy: ind.cy, pts: ind.pts };
      }
      return {
        cx: atOriginal.cx,
        cy: atOriginal.cy,
        pts: atOriginal.pts,
      };
    }
  }

  // Original port was bent or crowded by a cross-hierarchy edge: search clean straight ports on targetNode
  const margin = nodeCornerMargin(targetNode);
  const yRange = nodeAllowedYRange(targetNode, false);
  const midY = (yRange.minY + yRange.maxY) / 2;
  const midX = targetNode.x + targetNode.width / 2;

  for (const minClear of [8, 5.5]) {
    for (const dist of [desiredDist, 29]) {
      // 1. Prefer LEFT face (standard LR flow)
      let bestLeft: {
        cx: number;
        cy: number;
        pts: Point[];
        score: number;
      } | null = null;
      for (let cy = yRange.minY; cy <= yRange.maxY + 0.01; cy += 2) {
        const y = Math.min(cy, yRange.maxY);
        const res = evalStraightCandidate(
          { x: targetNode.x, y },
          -1,
          0,
          dist,
          minClear,
        );
        if (res) {
          const score =
            Math.min(res.minEdgeDist, 24) - 0.12 * Math.abs(y - midY);
          if (!bestLeft || score > bestLeft.score) {
            bestLeft = { ...res, score };
          }
        }
      }
      if (bestLeft) {
        return { cx: bestLeft.cx, cy: bestLeft.cy, pts: bestLeft.pts };
      }

      // 2. Fallback to TOP or BOTTOM face when LEFT is completely occupied
      if (
        targetNode.ast.type !== 'compound' &&
        targetNode.ast.type !== 'parallel'
      ) {
        let bestVert: {
          cx: number;
          cy: number;
          pts: Point[];
          score: number;
        } | null = null;
        for (const [faceY, vuy] of [
          [targetNode.y, -1],
          [targetNode.y + targetNode.height, 1],
        ] as const) {
          for (
            let cx = targetNode.x + margin;
            cx <= targetNode.x + targetNode.width - margin + 0.01;
            cx += 4
          ) {
            const x = Math.min(cx, targetNode.x + targetNode.width - margin);
            const res = evalStraightCandidate(
              { x, y: faceY },
              0,
              vuy,
              dist,
              minClear,
            );
            if (res) {
              const score =
                Math.min(res.minEdgeDist, 24) -
                0.12 * Math.abs(x - midX) +
                (vuy === -1 ? 2 : 0);
              if (!bestVert || score > bestVert.score) {
                bestVert = { ...res, score };
              }
            }
          }
        }
        if (bestVert) {
          return { cx: bestVert.cx, cy: bestVert.cy, pts: bestVert.pts };
        }
      }
    }
  }

  return { cx: ind.cx, cy: ind.cy, pts: ind.pts };
}

function straightenMinorJogs(
  edges: PositionedEdge[],
  absNodes: Map<string, PositionedNode>,
  ast: StatechartAST,
): void {
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (edge.branches.length !== 1) continue;
    const tid = edge.ast.targetIds[0];
    if (!tid || tid === edge.ast.sourceId) continue;

    const srcNode = absNodes.get(edge.ast.sourceId);
    const tgtNode = absNodes.get(tid);
    if (
      !srcNode ||
      !tgtNode ||
      srcNode.ast.type === 'history' ||
      tgtNode.ast.type === 'history'
    ) {
      continue;
    }

    const pts = edge.branches[0];
    if (pts.length < 3) continue;
    const pStart = pts[0];
    const pEnd = pts[pts.length - 1];
    const polyMinY = Math.min(...pts.map((p) => p.y));
    const polyMaxY = Math.max(...pts.map((p) => p.y));

    const srcInward = isAncestorInAst(srcNode.ast.id, tgtNode.ast.id, ast);
    const tgtInward = isAncestorInAst(tgtNode.ast.id, srcNode.ast.id, ast);
    // Check horizontal facing case: right side of src -> left side of tgt, left -> right,
    // OR inward left-border of ancestor src -> left side of descendant tgt!
    const lrFacing =
      (Math.abs(pStart.x - (srcNode.x + srcNode.width)) < 1 &&
        Math.abs(pEnd.x - tgtNode.x) < 1) ||
      (Math.abs(pStart.x - srcNode.x) < 1 &&
        Math.abs(pEnd.x - (tgtNode.x + tgtNode.width)) < 1) ||
      (srcInward &&
        Math.abs(pStart.x - srcNode.x) < 1 &&
        Math.abs(pEnd.x - tgtNode.x) < 1) ||
      (tgtInward &&
        Math.abs(pStart.x - (srcNode.x + srcNode.width)) < 1 &&
        Math.abs(pEnd.x - (tgtNode.x + tgtNode.width)) < 1);

    if (
      lrFacing &&
      (pts.length >= 5 ||
        (Math.abs(pStart.y - pEnd.y) <= 96 && polyMaxY - polyMinY <= 120))
    ) {
      const rSrc = nodeAllowedYRange(srcNode, srcInward);
      const rTgt = nodeAllowedYRange(tgtNode, tgtInward);
      const loY = Math.max(rSrc.minY, rTgt.minY);
      const hiY = Math.min(rSrc.maxY, rTgt.maxY);
      if (loY <= hiY) {
        const targetMidY = (pStart.y + pEnd.y) / 2;
        const rawCandYs: number[] = [
          clamp(targetMidY, loY, hiY),
          clamp(pEnd.y, loY, hiY),
          clamp(pStart.y, loY, hiY),
        ];
        if (pts.length >= 5 || Math.abs(pStart.y - pEnd.y) > 28) {
          const gridSlots: number[] = [];
          for (let y = loY + 8; y <= hiY - 8; y += 22) {
            gridSlots.push(y);
          }
          gridSlots.sort(
            (a, b) => Math.abs(a - targetMidY) - Math.abs(b - targetMidY),
          );
          rawCandYs.push(...gridSlots);
        }
        for (const cy of rawCandYs) {
          const line: Point[] = [
            { x: pStart.x, y: cy },
            { x: pEnd.x, y: cy },
          ];
          // Check no obstacle pierced, port clearance on both walls, and safe clearance from other edges
          let clear = true;
          const minX = Math.min(pStart.x, pEnd.x);
          const maxX = Math.max(pStart.x, pEnd.x);
          for (const node of absNodes.values()) {
            const uid = node.ast.id;
            if (uid === srcNode.ast.id || uid === tgtNode.ast.id) continue;
            if (
              isAncestorInAst(uid, srcNode.ast.id, ast) ||
              isAncestorInAst(uid, tgtNode.ast.id, ast)
            ) {
              // Never route horizontally through an ancestor compound header/compartment band
              if (
                (node.ast.type === 'compound' || node.ast.type === 'parallel') &&
                maxX > node.x - 4 &&
                minX < node.x + node.width + 4 &&
                cy >= node.y - 6 &&
                cy <= node.y + node.headerHeight + node.compartmentHeight + 8
              ) {
                clear = false;
                break;
              }
              continue;
            }
            if (
              maxX > node.x - 6 &&
              minX < node.x + node.width + 6 &&
              cy >= node.y - 8 &&
              cy <= node.y + node.height + 8
            ) {
              clear = false;
              break;
            }
          }
          if (!clear) continue;

          for (let j = 0; j < edges.length; j++) {
            if (j === i) continue;
            const samePair = edgesShareStatePair(edge, edges[j]);
            const reqClear = samePair ? 40 : 20;
            for (let bIdx = 0; bIdx < edges[j].branches.length; bIdx++) {
              const obr = edges[j].branches[bIdx];
              if (obr.length >= 2) {
                const os = obr[0];
                const oe = obr[obr.length - 1];
                if (
                  (Math.abs(os.x - pStart.x) < 1.5 &&
                    Math.abs(os.y - cy) < (samePair ? 38 : 20)) ||
                  (Math.abs(oe.x - pStart.x) < 1.5 &&
                    Math.abs(oe.y - cy) < (samePair ? 38 : 20)) ||
                  (Math.abs(os.x - pEnd.x) < 1.5 &&
                    Math.abs(os.y - cy) < (samePair ? 38 : 20)) ||
                  (Math.abs(oe.x - pEnd.x) < 1.5 &&
                    Math.abs(oe.y - cy) < (samePair ? 38 : 20))
                ) {
                  clear = false;
                  break;
                }
              }
              for (let s = 0; s < obr.length - 1; s++) {
                if (Math.abs(obr[s].y - obr[s + 1].y) < 1) {
                  const oMinX = Math.min(obr[s].x, obr[s + 1].x);
                  const oMaxX = Math.max(obr[s].x, obr[s + 1].x);
                  if (Math.min(maxX, oMaxX) - Math.max(minX, oMinX) > 4) {
                    if (Math.abs(obr[s].y - cy) < reqClear) {
                      clear = false;
                      break;
                    }
                  }
                } else if (Math.abs(obr[s].x - obr[s + 1].x) < 1) {
                  const vx = obr[s].x;
                  const oMinY = Math.min(obr[s].y, obr[s + 1].y);
                  const oMaxY = Math.max(obr[s].y, obr[s + 1].y);
                  if (
                    vx > minX + 1 &&
                    vx < maxX - 1 &&
                    cy >= oMinY - (samePair ? 18 : 2) &&
                    cy <= oMaxY + (samePair ? 18 : 2)
                  ) {
                    clear = false;
                    break;
                  }
                }
              }
              if (!clear) break;
            }
            if (!clear) break;
          }

          if (clear) {
            edge.branches[0] = line;
            break;
          }
        }
      }
      continue;
    }

    // Check vertical facing case: bottom side of src -> top side of tgt, top -> bottom,
    // OR bottom side of descendant src -> inward bottom-border of ancestor tgt!
    const polyMinX = Math.min(...pts.map((p) => p.x));
    const polyMaxX = Math.max(...pts.map((p) => p.x));
    const tbFacing =
      (Math.abs(pStart.y - (srcNode.y + srcNode.height)) < 1 &&
        Math.abs(pEnd.y - tgtNode.y) < 1) ||
      (Math.abs(pStart.y - srcNode.y) < 1 &&
        Math.abs(pEnd.y - (tgtNode.y + tgtNode.height)) < 1) ||
      (tgtInward &&
        Math.abs(pStart.y - (srcNode.y + srcNode.height)) < 1 &&
        Math.abs(pEnd.y - (tgtNode.y + tgtNode.height)) < 1);

    if (
      tbFacing &&
      Math.abs(pStart.x - pEnd.x) <= 28 &&
      polyMaxX - polyMinX <= 36
    ) {
      const mSrc = nodeCornerMargin(srcNode);
      const mTgt = nodeCornerMargin(tgtNode);
      const loX = Math.max(srcNode.x + mSrc, tgtNode.x + mTgt);
      const hiX = Math.min(
        srcNode.x + srcNode.width - mSrc,
        tgtNode.x + tgtNode.width - mTgt,
      );
      if (loX <= hiX) {
        const candXs = [
          clamp((pStart.x + pEnd.x) / 2, loX, hiX),
          clamp(pEnd.x, loX, hiX),
          clamp(pStart.x, loX, hiX),
        ];
        for (const cx of candXs) {
          const line: Point[] = [
            { x: cx, y: pStart.y },
            { x: cx, y: pEnd.y },
          ];
          let clear = true;
          const minY = Math.min(pStart.y, pEnd.y);
          const maxY = Math.max(pStart.y, pEnd.y);
          for (const node of absNodes.values()) {
            const uid = node.ast.id;
            if (uid === srcNode.ast.id || uid === tgtNode.ast.id) continue;
            if (
              isAncestorInAst(uid, srcNode.ast.id, ast) ||
              isAncestorInAst(uid, tgtNode.ast.id, ast)
            ) {
              if (
                (node.ast.type === 'compound' || node.ast.type === 'parallel') &&
                cx >= node.x - 6 &&
                cx <= node.x + node.width + 6 &&
                maxY > node.y - 4 &&
                minY < node.y + node.headerHeight + node.compartmentHeight + 8
              ) {
                clear = false;
                break;
              }
              continue;
            }
            if (
              cx >= node.x - 8 &&
              cx <= node.x + node.width + 8 &&
              maxY > node.y - 6 &&
              minY < node.y + node.height + 6
            ) {
              clear = false;
              break;
            }
          }
          if (!clear) continue;

          for (let j = 0; j < edges.length; j++) {
            if (j === i) continue;
            const samePair = edgesShareStatePair(edge, edges[j]);
            const reqClear = samePair ? 35.5 : 19.5;
            for (const obr of edges[j].branches) {
              for (let s = 0; s < obr.length - 1; s++) {
                if (Math.abs(obr[s].x - obr[s + 1].x) < 1) {
                  const oMinY = Math.min(obr[s].y, obr[s + 1].y);
                  const oMaxY = Math.max(obr[s].y, obr[s + 1].y);
                  if (Math.min(maxY, oMaxY) - Math.max(minY, oMinY) > 4) {
                    if (Math.abs(obr[s].x - cx) < reqClear) {
                      clear = false;
                      break;
                    }
                  }
                } else if (Math.abs(obr[s].y - obr[s + 1].y) < 1) {
                  const hy = obr[s].y;
                  const oMinX = Math.min(obr[s].x, obr[s + 1].x);
                  const oMaxX = Math.max(obr[s].x, obr[s + 1].x);
                  if (
                    hy > minY + 1 &&
                    hy < maxY - 1 &&
                    cx >= oMinX - (samePair ? 18 : 2) &&
                    cx <= oMaxX + (samePair ? 18 : 2)
                  ) {
                    clear = false;
                    break;
                  }
                }
              }
              if (!clear) break;
            }
            if (!clear) break;
          }

          if (clear) {
            edge.branches[0] = line;
            break;
          }
        }
      }
    }
  }
}

function snapEdgeEndpoints(
  srcNode: PositionedNode,
  tgtNode: PositionedNode,
  pts: Point[],
  ast: StatechartAST,
): Point[] {
  const out = simplifyOrthogonalPolyline(pts.map((p) => ({ ...p })));
  if (out.length < 2) {
    return [
      { x: srcNode.x + srcNode.width, y: srcNode.y + srcNode.height / 2 },
      { x: tgtNode.x, y: tgtNode.y + tgtNode.height / 2 },
    ];
  }

  const srcInward = isAncestorInAst(srcNode.ast.id, tgtNode.ast.id, ast);
  const tgtInward = isAncestorInAst(tgtNode.ast.id, srcNode.ast.id, ast);

  const srcSnap = snapPointToNodePerimeter(out[0], out[1], srcNode, srcInward);
  const tgtSnap = snapPointToNodePerimeter(
    out[out.length - 1],
    out[out.length - 2],
    tgtNode,
    tgtInward,
  );

  out[0] = srcSnap.snapped;
  out[out.length - 1] = tgtSnap.snapped;

  if (out.length === 2) {
    // Maintain orthogonal segment or insert mid-jog if unaligned
    if (
      (srcSnap.side === 'LEFT' || srcSnap.side === 'RIGHT') &&
      (tgtSnap.side === 'LEFT' || tgtSnap.side === 'RIGHT')
    ) {
      if (Math.abs(out[0].y - out[1].y) > 0.5) {
        const midX = (out[0].x + out[1].x) / 2;
        return [
          out[0],
          { x: midX, y: out[0].y },
          { x: midX, y: out[1].y },
          out[1],
        ];
      }
    } else if (
      (srcSnap.side === 'TOP' || srcSnap.side === 'BOTTOM') &&
      (tgtSnap.side === 'TOP' || tgtSnap.side === 'BOTTOM')
    ) {
      if (Math.abs(out[0].x - out[1].x) > 0.5) {
        const midY = (out[0].y + out[1].y) / 2;
        return [
          out[0],
          { x: out[0].x, y: midY },
          { x: out[1].x, y: midY },
          out[1],
        ];
      }
    } else if (
      (srcSnap.side === 'LEFT' || srcSnap.side === 'RIGHT') &&
      (tgtSnap.side === 'TOP' || tgtSnap.side === 'BOTTOM')
    ) {
      return [out[0], { x: out[1].x, y: out[0].y }, out[1]];
    } else {
      return [out[0], { x: out[0].x, y: out[1].y }, out[1]];
    }
    return out;
  }

  // Adjust interior bend points adjacent to endpoints to keep first & last segments orthogonal
  if (srcSnap.side === 'LEFT' || srcSnap.side === 'RIGHT') {
    out[1].y = out[0].y;
  } else {
    out[1].x = out[0].x;
  }

  if (tgtSnap.side === 'LEFT' || tgtSnap.side === 'RIGHT') {
    out[out.length - 2].y = out[out.length - 1].y;
  } else {
    out[out.length - 2].x = out[out.length - 1].x;
  }

  // Ensure interior segments are still orthogonal if out.length === 3
  if (out.length === 3) {
    const dx = Math.abs(out[1].x - out[2].x);
    const dy = Math.abs(out[1].y - out[2].y);
    if (dx > 0.5 && dy > 0.5) {
      out.splice(2, 0, { x: out[2].x, y: out[1].y });
    }
  }

  return out;
}

function simplifyOrthogonalPolyline(pts: Point[]): Point[] {
  if (pts.length <= 2) return pts;
  const dedup: Point[] = [{ ...pts[0] }];
  for (let i = 1; i < pts.length; i++) {
    const prev = dedup[dedup.length - 1];
    if (Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y) > 0.5) {
      dedup.push({ ...pts[i] });
    }
  }
  if (dedup.length <= 2) return dedup;

  // Snap sub-1px ELK hierarchical boundary drifts on interior points while keeping endpoints exact
  for (let i = 0; i < dedup.length - 2; i++) {
    const a = dedup[i];
    const b = dedup[i + 1];
    if (Math.abs(b.y - a.y) <= 1.0 && Math.abs(b.x - a.x) > 1.5) {
      b.y = a.y;
    } else if (Math.abs(b.x - a.x) <= 1.0 && Math.abs(b.y - a.y) > 1.5) {
      b.x = a.x;
    }
  }
  const lastIdx = dedup.length - 1;
  if (lastIdx >= 2) {
    const pen = dedup[lastIdx - 1];
    const end = dedup[lastIdx];
    if (Math.abs(pen.y - end.y) <= 1.0 && Math.abs(pen.x - end.x) > 1.5) {
      pen.y = end.y;
    } else if (
      Math.abs(pen.x - end.x) <= 1.0 &&
      Math.abs(pen.y - end.y) > 1.5
    ) {
      pen.x = end.x;
    }
  }

  const clean: Point[] = [dedup[0]];
  for (let i = 1; i < dedup.length - 1; i++) {
    const a = clean[clean.length - 1];
    const b = dedup[i];
    const c = dedup[i + 1];
    const collinearX =
      Math.abs(a.x - b.x) <= 0.05 && Math.abs(b.x - c.x) <= 0.05;
    const collinearY =
      Math.abs(a.y - b.y) <= 0.05 && Math.abs(b.y - c.y) <= 0.05;
    if (!collinearX && !collinearY) {
      clean.push(b);
    }
  }
  clean.push(dedup[dedup.length - 1]);
  return clean;
}

/**
 * Eliminates sub-18px orthogonal Z-jogs on start stubs, end stubs, and interior
 * segments so polylines enter/leave state boxes and cross container boundaries cleanly.
 */
function eliminatePolylineMicroJogs(
  edges: PositionedEdge[],
  absNodes: Map<string, PositionedNode>,
  ast: StatechartAST,
): void {
  const MAX_JOG = 18;

  const isHorizontalRailClear = (
    selfEdgeIdx: number,
    srcId: string,
    tgtId: string,
    x1: number,
    x2: number,
    candY: number,
  ): boolean => {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    for (const node of absNodes.values()) {
      const uid = node.ast.id;
      if (uid === srcId || uid === tgtId) continue;
      if (isAncestorInAst(uid, srcId, ast) || isAncestorInAst(uid, tgtId, ast)) {
        if (
          (node.ast.type === 'compound' || node.ast.type === 'parallel') &&
          maxX > node.x - 4 &&
          minX < node.x + node.width + 4 &&
          candY >= node.y - 6 &&
          candY <= node.y + node.headerHeight + node.compartmentHeight + 8
        ) {
          return false;
        }
        continue;
      }
      if (
        maxX > node.x - 6 &&
        minX < node.x + node.width + 6 &&
        candY >= node.y - 8 &&
        candY <= node.y + node.height + 8
      ) {
        return false;
      }
    }
    for (let j = 0; j < edges.length; j++) {
      if (j === selfEdgeIdx) continue;
      const samePair = edgesShareStatePair(edges[selfEdgeIdx], edges[j]);
      const reqClear = samePair ? 35.5 : 19.5;
      for (const obr of edges[j].branches) {
        for (let s = 0; s < obr.length - 1; s++) {
          if (Math.abs(obr[s].y - obr[s + 1].y) < 1) {
            const oMinX = Math.min(obr[s].x, obr[s + 1].x);
            const oMaxX = Math.max(obr[s].x, obr[s + 1].x);
            if (Math.min(maxX, oMaxX) - Math.max(minX, oMinX) > 4) {
              if (Math.abs(obr[s].y - candY) < reqClear) {
                return false;
              }
            }
          }
        }
      }
    }
    return true;
  };

  const isPortCoordFree = (
    selfEdgeIdx: number,
    nodeId: string,
    sideX: number | null,
    sideY: number | null,
    candCoord: number,
  ): boolean => {
    for (let j = 0; j < edges.length; j++) {
      if (j === selfEdgeIdx) continue;
      const other = edges[j];
      for (let b = 0; b < other.branches.length; b++) {
        const op = other.branches[b];
        if (op.length < 2) continue;
        const endpoints: { pt: Point; owner: string }[] = [
          { pt: op[0], owner: other.ast.sourceId },
          {
            pt: op[op.length - 1],
            owner: other.ast.targetIds[b] ?? other.ast.sourceId,
          },
        ];
        for (const ep of endpoints) {
          if (ep.owner !== nodeId) continue;
          if (sideX !== null && Math.abs(ep.pt.x - sideX) < 1.5) {
            if (Math.abs(ep.pt.y - candCoord) < 18) return false;
          }
          if (sideY !== null && Math.abs(ep.pt.y - sideY) < 1.5) {
            if (Math.abs(ep.pt.x - candCoord) < 18) return false;
          }
        }
      }
    }
    return true;
  };

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const isSelf =
      edge.ast.targetIds.length === 1 &&
      edge.ast.targetIds[0] === edge.ast.sourceId;
    if (isSelf) continue;

    for (let b = 0; b < edge.branches.length; b++) {
      let pts = simplifyOrthogonalPolyline(edge.branches[b]);
      const srcNode = absNodes.get(edge.ast.sourceId);
      const tid = edge.ast.targetIds[b] ?? edge.ast.sourceId;
      const tgtNode = absNodes.get(tid);
      const srcInward =
        srcNode && tgtNode
          ? isAncestorInAst(srcNode.ast.id, tgtNode.ast.id, ast)
          : false;
      const tgtInward =
        srcNode && tgtNode
          ? isAncestorInAst(tgtNode.ast.id, srcNode.ast.id, ast)
          : false;

      for (let pass = 0; pass < 3; pass++) {
        const beforeLen = pts.length;

        // 1. End-stub micro-jog: [..., A, B, C, D] where B->C is a tiny step and C->D enters tgtNode
        if (
          pts.length >= 4 &&
          tgtNode &&
          tgtNode.ast.type !== 'history'
        ) {
          const n = pts.length;
          const pA = pts[n - 4];
          const pB = pts[n - 3];
          const pC = pts[n - 2];
          const pD = pts[n - 1];
          const endHoriz = Math.abs(pC.y - pD.y) < 1;
          const stepVert = Math.abs(pB.x - pC.x) < 1;
          const margin = nodeCornerMargin(tgtNode);
          const tgtYRange = nodeAllowedYRange(tgtNode, tgtInward);
          if (endHoriz && stepVert) {
            const jog = Math.abs(pC.y - pB.y);
            if (
              jog > 0 &&
              jog <= MAX_JOG &&
              pB.y >= tgtYRange.minY &&
              pB.y <= tgtYRange.maxY &&
              isPortCoordFree(i, tid, pD.x, null, pB.y) &&
              isHorizontalRailClear(
                i,
                edge.ast.sourceId,
                tid,
                Math.abs(pA.y - pB.y) < 1 ? pA.x : pC.x,
                pD.x,
                pB.y,
              )
            ) {
              pC.y = pB.y;
              pD.y = pB.y;
              pts = simplifyOrthogonalPolyline(pts);
            } else if (
              jog > 0 &&
              jog <= MAX_JOG &&
              n >= 5 &&
              Math.abs(pts[n - 4].y - pB.y) < 1 &&
              Math.abs(pts[n - 5].x - pts[n - 4].x) < 1 &&
              isHorizontalRailClear(
                i,
                edge.ast.sourceId,
                tid,
                pts[n - 4].x,
                pD.x,
                pD.y,
              )
            ) {
              pts[n - 4].y = pD.y;
              pB.y = pD.y;
              pC.y = pD.y;
              pts = simplifyOrthogonalPolyline(pts);
            }
          } else if (!endHoriz && !stepVert) {
            const jog = Math.abs(pC.x - pB.x);
            if (
              jog > 0 &&
              jog <= MAX_JOG &&
              pB.x >= tgtNode.x + margin &&
              pB.x <= tgtNode.x + tgtNode.width - margin &&
              isPortCoordFree(i, tid, null, pD.y, pB.x)
            ) {
              pC.x = pB.x;
              pD.x = pB.x;
              pts = simplifyOrthogonalPolyline(pts);
            }
          }
        }

        // 2. Start-stub micro-jog: [A, B, C, D, ...] where A->B leaves srcNode and B->C is a tiny step
        if (
          pts.length >= 4 &&
          srcNode &&
          srcNode.ast.type !== 'history'
        ) {
          const pA = pts[0];
          const pB = pts[1];
          const pC = pts[2];
          const pD = pts[3];
          const startHoriz = Math.abs(pA.y - pB.y) < 1;
          const stepVert = Math.abs(pB.x - pC.x) < 1;
          const margin = nodeCornerMargin(srcNode);
          const srcYRange = nodeAllowedYRange(srcNode, srcInward);
          if (startHoriz && stepVert) {
            const jog = Math.abs(pC.y - pB.y);
            if (
              jog > 0 &&
              jog <= MAX_JOG &&
              pC.y >= srcYRange.minY &&
              pC.y <= srcYRange.maxY &&
              isPortCoordFree(i, edge.ast.sourceId, pA.x, null, pC.y) &&
              isHorizontalRailClear(
                i,
                edge.ast.sourceId,
                tid,
                pA.x,
                Math.abs(pC.y - pD.y) < 1 ? pD.x : pB.x,
                pC.y,
              )
            ) {
              pA.y = pC.y;
              pB.y = pC.y;
              pts = simplifyOrthogonalPolyline(pts);
            } else if (
              jog > 0 &&
              jog <= MAX_JOG &&
              pts.length >= 5 &&
              Math.abs(pC.y - pts[3].y) < 1 &&
              Math.abs(pts[3].x - pts[4].x) < 1 &&
              isHorizontalRailClear(
                i,
                edge.ast.sourceId,
                tid,
                pA.x,
                pts[3].x,
                pA.y,
              )
            ) {
              pB.y = pA.y;
              pC.y = pA.y;
              pts[3].y = pA.y;
              pts = simplifyOrthogonalPolyline(pts);
            }
          } else if (!startHoriz && !stepVert) {
            const jog = Math.abs(pC.x - pB.x);
            if (
              jog > 0 &&
              jog <= MAX_JOG &&
              pC.x >= srcNode.x + margin &&
              pC.x <= srcNode.x + srcNode.width - margin &&
              isPortCoordFree(i, edge.ast.sourceId, null, pA.y, pC.x)
            ) {
              pA.x = pC.x;
              pB.x = pC.x;
              pts = simplifyOrthogonalPolyline(pts);
            }
          }
        }

        // 3. Interior horizontal rail micro-jog (e.g. ELK hierarchical container-boundary steps)
        for (let k = 1; k <= pts.length - 3; k++) {
          const p0 = pts[k - 1];
          const p1 = pts[k];
          const p2 = pts[k + 1];
          const p3 = pts[k + 2];
          if (
            Math.abs(p0.y - p1.y) < 1 &&
            Math.abs(p1.x - p2.x) < 1 &&
            Math.abs(p2.y - p3.y) < 1
          ) {
            const jog = Math.abs(p2.y - p1.y);
            if (jog > 0 && jog <= MAX_JOG) {
              // Option A: shift [p2..p3] onto p1.y if p3 is an interior vertical bend (not end port)
              if (
                k + 3 < pts.length &&
                Math.abs(p3.x - pts[k + 3].x) < 1 &&
                isHorizontalRailClear(
                  i,
                  edge.ast.sourceId,
                  tid,
                  p0.x,
                  p3.x,
                  p1.y,
                )
              ) {
                p2.y = p1.y;
                p3.y = p1.y;
                pts = simplifyOrthogonalPolyline(pts);
                break;
              }
              // Option B: shift [p0..p1] onto p2.y if p0 is an interior vertical bend (not start port)
              if (
                k - 2 >= 0 &&
                Math.abs(pts[k - 2].x - p0.x) < 1 &&
                isHorizontalRailClear(
                  i,
                  edge.ast.sourceId,
                  tid,
                  p0.x,
                  p3.x,
                  p2.y,
                )
              ) {
                p0.y = p2.y;
                p1.y = p2.y;
                pts = simplifyOrthogonalPolyline(pts);
                break;
              }
            }
          }
        }

        // 4. Interior vertical rail micro-jog (e.g. ~3px horizontal steps along a vertical shaft)
        const isVerticalRailClear = (
          y1: number,
          y2: number,
          candX: number,
        ): boolean => {
          const minY = Math.min(y1, y2);
          const maxY = Math.max(y1, y2);
          for (const node of absNodes.values()) {
            const uid = node.ast.id;
            if (uid === edge.ast.sourceId || uid === tid) continue;
            if (
              isAncestorInAst(uid, edge.ast.sourceId, ast) ||
              isAncestorInAst(uid, tid, ast)
            ) {
              if (
                (node.ast.type === 'compound' || node.ast.type === 'parallel') &&
                candX >= node.x - 6 &&
                candX <= node.x + node.width + 6 &&
                maxY > node.y - 4 &&
                minY < node.y + node.headerHeight + node.compartmentHeight + 8
              ) {
                return false;
              }
              continue;
            }
            if (
              candX >= node.x - 8 &&
              candX <= node.x + node.width + 8 &&
              maxY > node.y - 6 &&
              minY < node.y + node.height + 6
            ) {
              return false;
            }
          }
          for (let j = 0; j < edges.length; j++) {
            if (j === i) continue;
            const samePair = edgesShareStatePair(edge, edges[j]);
            const reqClear = samePair ? 35.5 : 19.5;
            for (const obr of edges[j].branches) {
              for (let s = 0; s < obr.length - 1; s++) {
                if (Math.abs(obr[s].x - obr[s + 1].x) < 1) {
                  const oMinY = Math.min(obr[s].y, obr[s + 1].y);
                  const oMaxY = Math.max(obr[s].y, obr[s + 1].y);
                  if (Math.min(maxY, oMaxY) - Math.max(minY, oMinY) > 4) {
                    if (Math.abs(obr[s].x - candX) < reqClear) {
                      return false;
                    }
                  }
                }
              }
            }
          }
          return true;
        };

        for (let k = 1; k <= pts.length - 3; k++) {
          const p0 = pts[k - 1];
          const p1 = pts[k];
          const p2 = pts[k + 1];
          const p3 = pts[k + 2];
          if (
            Math.abs(p0.x - p1.x) < 1 &&
            Math.abs(p1.y - p2.y) < 1 &&
            Math.abs(p2.x - p3.x) < 1
          ) {
            const jog = Math.abs(p2.x - p1.x);
            if (jog > 0 && jog <= MAX_JOG) {
              if (
                k + 3 < pts.length &&
                Math.abs(p3.y - pts[k + 3].y) < 1 &&
                isVerticalRailClear(p0.y, p3.y, p1.x)
              ) {
                p2.x = p1.x;
                p3.x = p1.x;
                pts = simplifyOrthogonalPolyline(pts);
                break;
              }
              if (
                k - 2 >= 0 &&
                Math.abs(pts[k - 2].y - p0.y) < 1 &&
                isVerticalRailClear(p0.y, p3.y, p2.x)
              ) {
                p0.x = p2.x;
                p1.x = p2.x;
                pts = simplifyOrthogonalPolyline(pts);
                break;
              }
            }
          }
        }

        if (pts.length === beforeLen) break;
      }

      edge.branches[b] = pts;
    }
  }
}

function rectsIntersect(a: Rect, b: Rect, margin = 0): boolean {
  return !(
    a.x + a.width + margin <= b.x ||
    b.x + b.width + margin <= a.x ||
    a.y + a.height + margin <= b.y ||
    b.y + b.height + margin <= a.y
  );
}

interface PlacedSelfLoopRecord {
  side: 'TOP' | 'BOTTOM' | 'RIGHT' | 'LEFT';
  span: number;
  pillWidth: number;
  pillHeight: number;
  loopOut: number;
}

function buildCleanSelfLoop(
  node: PositionedNode,
  loopIdx: number,
  pill: { width: number; height: number },
  allNodes: PositionedNode[],
  initials: PositionedInitialIndicator[],
  nonSelfEdges: PositionedEdge[],
  existingOnNode: PlacedSelfLoopRecord[],
): { points: Point[]; record: PlacedSelfLoopRecord } {
  const cMargin = nodeCornerMargin(node);
  const maxAllowedSpan = Math.max(26, node.width - cMargin * 2);
  const cx = node.x + node.width / 2;

  const parentNode = node.ast.parentId
    ? allNodes.find((n) => n.ast.id === node.ast.parentId) ?? null
    : null;

  const isClearRect = (r: Rect): boolean => {
    if (parentNode) {
      const bodyTop =
        parentNode.y +
        parentNode.headerHeight +
        parentNode.compartmentHeight +
        6;
      if (
        r.x < parentNode.x + 8 ||
        r.x + r.width > parentNode.x + parentNode.width - 8 ||
        r.y < bodyTop ||
        r.y + r.height > parentNode.y + parentNode.height - 8
      ) {
        return false;
      }
    }
    for (const other of allNodes) {
      if (other.ast.id === node.ast.id) continue;
      if (isStrictAncestor(other.ast.id, node.ast.id, allNodes)) continue;
      if (rectsIntersect(r, other, 8)) return false;
    }
    for (const init of initials) {
      const ir: Rect = {
        x: init.cx - init.r,
        y: init.cy - init.r,
        width: init.r * 2,
        height: init.r * 2,
      };
      if (rectsIntersect(r, ir, 8)) return false;
    }
    for (const edge of nonSelfEdges) {
      if (distRectToEdge(r, edge) < 14) return false;
    }
    return true;
  };

  const makeTopOrBottom = (
    side: 'TOP' | 'BOTTOM',
    ignoreClearance = false,
  ): { points: Point[]; record: PlacedSelfLoopRecord } | null => {
    const prevOnSide = existingOnNode.filter((p) => p.side === side);
    const sameSideIdx = prevOnSide.length;
    const loopOut =
      sameSideIdx === 0
        ? 26
        : Math.max(...prevOnSide.map((p) => p.loopOut + p.pillHeight + 18));
    let span: number;
    if (sameSideIdx === 0) {
      span = clamp(
        Math.min(84, Math.max(40, pill.width * 0.55)),
        26,
        maxAllowedSpan,
      );
    } else {
      const maxPrevSpan = Math.max(...prevOnSide.map((p) => p.span));
      span = clamp(maxPrevSpan + 36, 26, maxAllowedSpan);
    }

    const x1 = cx - span / 2;
    const x2 = cx + span / 2;
    const zoneW = Math.max(span, pill.width);
    const zone: Rect =
      side === 'TOP'
        ? {
            x: cx - zoneW / 2,
            y: node.y - loopOut - pill.height - 8,
            width: zoneW,
            height: loopOut + pill.height + 6,
          }
        : {
            x: cx - zoneW / 2,
            y: node.y + node.height + 2,
            width: zoneW,
            height: loopOut + pill.height + 8,
          };

    if (!ignoreClearance && !isClearRect(zone)) return null;

    const points: Point[] =
      side === 'TOP'
        ? [
            { x: x1, y: node.y },
            { x: x1, y: node.y - loopOut },
            { x: x2, y: node.y - loopOut },
            { x: x2, y: node.y },
          ]
        : [
            { x: x1, y: node.y + node.height },
            { x: x1, y: node.y + node.height + loopOut },
            { x: x2, y: node.y + node.height + loopOut },
            { x: x2, y: node.y + node.height },
          ];

    return {
      points,
      record: {
        side,
        span,
        pillWidth: pill.width,
        pillHeight: pill.height,
        loopOut,
      },
    };
  };

  const makeLateral = (
    side: 'RIGHT' | 'LEFT',
    ignoreClearance = false,
  ): { points: Point[]; record: PlacedSelfLoopRecord } | null => {
    const prevOnSide = existingOnNode.filter((p) => p.side === side);
    const sameSideIdx = prevOnSide.length;
    const maxVSpan = Math.max(20, node.height - cMargin * 2);
    const vSpan =
      sameSideIdx === 0
        ? clamp(Math.max(24, Math.min(36, pill.height * 0.65)), 20, maxVSpan)
        : clamp(
            Math.max(...prevOnSide.map((p) => p.span)) + 34,
            20,
            maxVSpan,
          );
    const cy = node.y + node.height / 2;
    const y1 = cy - vSpan / 2;
    const y2 = cy + vSpan / 2;
    const latOut =
      sameSideIdx === 0
        ? 26
        : Math.max(...prevOnSide.map((p) => p.loopOut + p.pillWidth + 18));
    const zoneH = Math.max(vSpan, pill.height) + 8;
    const latZone: Rect =
      side === 'RIGHT'
        ? {
            x: node.x + node.width + 2,
            y: cy - zoneH / 2,
            width: latOut + pill.width + 10,
            height: zoneH,
          }
        : {
            x: node.x - latOut - pill.width - 12,
            y: cy - zoneH / 2,
            width: latOut + pill.width + 10,
            height: zoneH,
          };
    if (!ignoreClearance && !isClearRect(latZone)) return null;
    const xWall = side === 'RIGHT' ? node.x + node.width : node.x;
    const xBar = side === 'RIGHT' ? xWall + latOut : xWall - latOut;
    return {
      points: [
        { x: xWall, y: y1 },
        { x: xBar, y: y1 },
        { x: xBar, y: y2 },
        { x: xWall, y: y2 },
      ],
      record: {
        side,
        span: vSpan,
        pillWidth: pill.width,
        pillHeight: pill.height,
        loopOut: latOut,
      },
    };
  };

  let topBusy = 0;
  let botBusy = 0;
  let leftBusy = 0;
  let rightBusy = 0;
  for (const edge of nonSelfEdges) {
    for (let b = 0; b < edge.branches.length; b++) {
      const br = edge.branches[b];
      if (br.length < 2) continue;
      const checkPt = (pt: Point) => {
        if (Math.abs(pt.y - node.y) <= 2) topBusy++;
        else if (Math.abs(pt.y - (node.y + node.height)) <= 2) botBusy++;
        else if (Math.abs(pt.x - node.x) <= 2) leftBusy++;
        else if (Math.abs(pt.x - (node.x + node.width)) <= 2) rightBusy++;
      };
      if (edge.ast.sourceId === node.ast.id) checkPt(br[0]);
      const tid = edge.ast.targetIds[b] ?? edge.ast.sourceId;
      if (tid === node.ast.id) checkPt(br[br.length - 1]);
    }
  }

  const preferLateral =
    topBusy > 0 && botBusy > 0 && (leftBusy === 0 || rightBusy === 0);
  const sideOrder: Array<'TOP' | 'BOTTOM' | 'RIGHT' | 'LEFT'> = preferLateral
    ? loopIdx % 2 === 1
      ? ['LEFT', 'RIGHT', 'TOP', 'BOTTOM']
      : ['RIGHT', 'LEFT', 'TOP', 'BOTTOM']
    : loopIdx % 2 === 1
      ? ['BOTTOM', 'TOP', 'RIGHT', 'LEFT']
      : ['TOP', 'BOTTOM', 'RIGHT', 'LEFT'];

  for (const side of sideOrder) {
    const res =
      side === 'RIGHT' || side === 'LEFT'
        ? makeLateral(side, false)
        : makeTopOrBottom(side, false);
    if (res) return res;
  }

  return preferLateral
    ? makeLateral('RIGHT', true)!
    : makeTopOrBottom('TOP', true)!;
}

function isStrictAncestor(
  candidateAncestorId: string,
  nodeId: string,
  allNodes: PositionedNode[],
): boolean {
  const byId = new Map(allNodes.map((n) => [n.ast.id, n.ast]));
  let cur = byId.get(nodeId)?.parentId ?? null;
  while (cur) {
    if (cur === candidateAncestorId) return true;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

function isAncestorInAst(
  candidateAncestorId: string,
  nodeId: string,
  ast: StatechartAST,
): boolean {
  let cur = ast.nodes[nodeId]?.parentId ?? null;
  while (cur) {
    if (cur === candidateAncestorId) return true;
    cur = ast.nodes[cur]?.parentId ?? null;
  }
  return false;
}

function edgesShareStatePair(a: PositionedEdge, b: PositionedEdge): boolean {
  const pairKey = (e: PositionedEdge): string => {
    const t0 = e.ast.targetIds[0] ?? e.ast.sourceId;
    return e.ast.sourceId <= t0
      ? `${e.ast.sourceId}::${t0}`
      : `${t0}::${e.ast.sourceId}`;
  };
  return pairKey(a) === pairKey(b);
}

/**
 * Ensures no two segments from different transitions run parallel within 14px
 * perpendicular distance with overlapping projection ("No Highway Merges"),
 * and enforces >= 40px between parallel channels connecting the same state pair.
 */
function separateCollinearEdgeSegments(
  edges: PositionedEdge[],
  absNodes: Map<string, PositionedNode>,
  ast: StatechartAST,
): void {
  for (let pass = 0; pass < 14; pass++) {
    interface SegRef {
      edgeIdx: number;
      branchIdx: number;
      segIdx: number;
      horizontal: boolean;
      coord: number; // y for horizontal, x for vertical
      lo: number;
      hi: number;
    }

    const segs: SegRef[] = [];
    edges.forEach((edge, edgeIdx) => {
      edge.branches.forEach((pts, branchIdx) => {
        for (let s = 0; s < pts.length - 1; s++) {
          const p1 = pts[s];
          const p2 = pts[s + 1];
          const dx = Math.abs(p2.x - p1.x);
          const dy = Math.abs(p2.y - p1.y);
          if (dy < 1 && dx >= 7.5) {
            segs.push({
              edgeIdx,
              branchIdx,
              segIdx: s,
              horizontal: true,
              coord: (p1.y + p2.y) / 2,
              lo: Math.min(p1.x, p2.x),
              hi: Math.max(p1.x, p2.x),
            });
          } else if (dx < 1 && dy >= 7.5) {
            segs.push({
              edgeIdx,
              branchIdx,
              segIdx: s,
              horizontal: false,
              coord: (p1.x + p2.x) / 2,
              lo: Math.min(p1.y, p2.y),
              hi: Math.max(p1.y, p2.y),
            });
          }
        }
      });
    });

    let changed = false;
    const mutatedBranches = new Set<string>();
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const a = segs[i];
        const b = segs[j];
        if (a.edgeIdx === b.edgeIdx) continue;
        if (a.horizontal !== b.horizontal) continue;
        const keyA = `${a.edgeIdx}:${a.branchIdx}`;
        const keyB = `${b.edgeIdx}:${b.branchIdx}`;
        if (mutatedBranches.has(keyA) || mutatedBranches.has(keyB)) continue;

        const overlap = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
        if (overlap <= 7.5) continue;

        const minSep = edgesShareStatePair(edges[a.edgeIdx], edges[b.edgeIdx])
          ? 40
          : 20;
        const perpDist = Math.abs(a.coord - b.coord);
        if (perpDist >= minSep) continue;

        const push = (minSep - perpDist) / 2 + 1;
        const sign = a.coord <= b.coord ? -1 : 1;

        const lenBeforeA = edges[a.edgeIdx].branches[a.branchIdx].length;
        const lenBeforeB = edges[b.edgeIdx].branches[b.branchIdx].length;
        shiftSegmentPerpendicular(
          edges[a.edgeIdx],
          a.branchIdx,
          a.segIdx,
          a.horizontal,
          sign * push,
          absNodes,
          ast,
        );
        shiftSegmentPerpendicular(
          edges[b.edgeIdx],
          b.branchIdx,
          b.segIdx,
          b.horizontal,
          -sign * push,
          absNodes,
          ast,
        );
        if (edges[a.edgeIdx].branches[a.branchIdx].length !== lenBeforeA) {
          mutatedBranches.add(keyA);
        }
        if (edges[b.edgeIdx].branches[b.branchIdx].length !== lenBeforeB) {
          mutatedBranches.add(keyB);
        }
        a.coord += sign * push;
        b.coord -= sign * push;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

function shiftSegmentPerpendicular(
  edge: PositionedEdge,
  branchIdx: number,
  segIdx: number,
  horizontal: boolean,
  delta: number,
  absNodes: Map<string, PositionedNode>,
  ast: StatechartAST,
): void {
  const pts = edge.branches[branchIdx];
  const n = pts.length;
  const i1 = segIdx;
  const i2 = segIdx + 1;
  if (i2 >= n) return;

  const tid = edge.ast.targetIds[branchIdx] ?? edge.ast.sourceId;

  const canSlideOnWall = (
    pt: Point,
    nodeId: string,
    horiz: boolean,
  ): boolean => {
    const node = absNodes.get(nodeId);
    if (!node) return true;
    const tol =
      node.ast.type === 'history' &&
      !(node.ast.key === 'history' && node.width > 45)
        ? 5.5
        : 2.0;
    if (horiz) {
      return (
        Math.abs(pt.x - node.x) <= tol ||
        Math.abs(pt.x - (node.x + node.width)) <= tol
      );
    }
    return (
      Math.abs(pt.y - node.y) <= tol ||
      Math.abs(pt.y - (node.y + node.height)) <= tol
    );
  };

  const clampCoordToNode = (
    pt: Point,
    val: number,
    nodeId: string,
    peerId: string,
    horiz: boolean,
  ): number => {
    const node = absNodes.get(nodeId);
    if (!node) return val;
    // Never pull an endpoint inward off its snapped wall if the segment runs tangent to the wall!
    if (!canSlideOnWall(pt, nodeId, horiz)) {
      return horiz ? pt.y : pt.x;
    }
    if (
      node.ast.type === 'history' &&
      !(node.ast.key === 'history' && node.width > 45)
    ) {
      if (horiz) {
        return clamp(val, node.y + 4, node.y + node.height - 4);
      }
      if (node.ast.key === 'history') {
        return clamp(val, node.x + 4, node.x + node.width - 4);
      }
      const rx = Math.min(14, node.height / 2);
      return clamp(val, node.x + rx, node.x + node.width - rx);
    }
    const margin = nodeCornerMargin(node);
    if (horiz) {
      const inward = isAncestorInAst(nodeId, peerId, ast);
      const { minY, maxY } = nodeAllowedYRange(node, inward);
      return clamp(val, minY, maxY);
    }
    return clamp(val, node.x + margin, node.x + node.width - margin);
  };

  const STUB = 6.5;

  if (horizontal) {
    if (n === 2) {
      const targetY = pts[0].y + delta;
      const y0 = clampCoordToNode(
        pts[0],
        targetY,
        edge.ast.sourceId,
        tid,
        true,
      );
      const y1 = clampCoordToNode(
        pts[1],
        targetY,
        tid,
        edge.ast.sourceId,
        true,
      );
      const segDx = pts[1].x - pts[0].x;
      if (
        Math.abs(y0 - targetY) <= 1.5 &&
        Math.abs(y1 - targetY) <= 1.5 &&
        Math.abs(y0 - y1) <= 0.5
      ) {
        pts[0].y = (y0 + y1) / 2;
        pts[1].y = (y0 + y1) / 2;
      } else if (Math.abs(segDx) > 28) {
        const sx = segDx >= 0 ? 1 : -1;
        edge.branches[branchIdx] = simplifyOrthogonalPolyline([
          { x: pts[0].x, y: y0 },
          { x: pts[0].x + sx * STUB, y: y0 },
          { x: pts[0].x + sx * STUB, y: targetY },
          { x: pts[1].x - sx * STUB, y: targetY },
          { x: pts[1].x - sx * STUB, y: y1 },
          { x: pts[1].x, y: y1 },
        ]);
      } else if (Math.abs(y0 - y1) <= 0.5) {
        pts[0].y = (y0 + y1) / 2;
        pts[1].y = (y0 + y1) / 2;
      } else {
        const midX = (pts[0].x + pts[1].x) / 2;
        edge.branches[branchIdx] = [
          { x: pts[0].x, y: y0 },
          { x: midX, y: y0 },
          { x: midX, y: y1 },
          { x: pts[1].x, y: y1 },
        ];
      }
      return;
    }

    const desiredY = pts[i1].y + delta;
    const segDx = pts[i2].x - pts[i1].x;

    if (i1 === 0) {
      if (!canSlideOnWall(pts[0], edge.ast.sourceId, true)) return;
      const y0 = clampCoordToNode(
        pts[0],
        desiredY,
        edge.ast.sourceId,
        tid,
        true,
      );
      if (Math.abs(y0 - desiredY) > 1.5 && Math.abs(segDx) > 22) {
        const sx = segDx >= 0 ? 1 : -1;
        const stubX = pts[0].x + sx * STUB;
        pts.splice(
          0,
          2,
          { x: pts[0].x, y: y0 },
          { x: stubX, y: y0 },
          { x: stubX, y: desiredY },
          { x: pts[1].x, y: desiredY },
        );
        return;
      }
      pts[0].y = y0;
      pts[1].y = y0;
      return;
    }

    if (i2 === n - 1) {
      if (!canSlideOnWall(pts[n - 1], tid, true)) return;
      const yn = clampCoordToNode(
        pts[n - 1],
        desiredY,
        tid,
        edge.ast.sourceId,
        true,
      );
      if (Math.abs(yn - desiredY) > 1.5 && Math.abs(segDx) > 22) {
        const sx = segDx >= 0 ? 1 : -1;
        const stubX = pts[n - 1].x - sx * STUB;
        pts.splice(
          n - 2,
          2,
          { x: pts[n - 2].x, y: desiredY },
          { x: stubX, y: desiredY },
          { x: stubX, y: yn },
          { x: pts[n - 1].x, y: yn },
        );
        return;
      }
      pts[n - 1].y = yn;
      pts[n - 2].y = yn;
      return;
    }

    let clampedY = desiredY;
    if (i1 === 1) {
      const dy0 = pts[1].y - pts[0].y;
      if (dy0 > 1) clampedY = Math.max(clampedY, pts[0].y + 8);
      else if (dy0 < -1) clampedY = Math.min(clampedY, pts[0].y - 8);
    }
    if (i2 === n - 2) {
      const dyn = pts[n - 1].y - pts[n - 2].y;
      if (dyn > 1) clampedY = Math.min(clampedY, pts[n - 1].y - 8);
      else if (dyn < -1) clampedY = Math.max(clampedY, pts[n - 1].y + 8);
    }
    pts[i1].y = clampedY;
    pts[i2].y = clampedY;
  } else {
    if (n === 2) {
      const targetX = pts[0].x + delta;
      const x0 = clampCoordToNode(
        pts[0],
        targetX,
        edge.ast.sourceId,
        tid,
        false,
      );
      const x1 = clampCoordToNode(
        pts[1],
        targetX,
        tid,
        edge.ast.sourceId,
        false,
      );
      const segDy = pts[1].y - pts[0].y;
      if (
        Math.abs(x0 - targetX) <= 1.5 &&
        Math.abs(x1 - targetX) <= 1.5 &&
        Math.abs(x0 - x1) <= 0.5
      ) {
        pts[0].x = (x0 + x1) / 2;
        pts[1].x = (x0 + x1) / 2;
      } else if (Math.abs(segDy) > 28) {
        const sy = segDy >= 0 ? 1 : -1;
        edge.branches[branchIdx] = simplifyOrthogonalPolyline([
          { x: x0, y: pts[0].y },
          { x: x0, y: pts[0].y + sy * STUB },
          { x: targetX, y: pts[0].y + sy * STUB },
          { x: targetX, y: pts[1].y - sy * STUB },
          { x: x1, y: pts[1].y - sy * STUB },
          { x: x1, y: pts[1].y },
        ]);
      } else if (Math.abs(x0 - x1) <= 0.5) {
        pts[0].x = (x0 + x1) / 2;
        pts[1].x = (x0 + x1) / 2;
      } else {
        const midY = (pts[0].y + pts[1].y) / 2;
        edge.branches[branchIdx] = [
          { x: x0, y: pts[0].y },
          { x: x0, y: midY },
          { x: x1, y: midY },
          { x: x1, y: pts[1].y },
        ];
      }
      return;
    }

    const desiredX = pts[i1].x + delta;
    const segDy = pts[i2].y - pts[i1].y;

    if (i1 === 0) {
      if (!canSlideOnWall(pts[0], edge.ast.sourceId, false)) return;
      const x0 = clampCoordToNode(
        pts[0],
        desiredX,
        edge.ast.sourceId,
        tid,
        false,
      );
      if (Math.abs(x0 - desiredX) > 1.5 && Math.abs(segDy) > 22) {
        const sy = segDy >= 0 ? 1 : -1;
        const stubY = pts[0].y + sy * STUB;
        pts.splice(
          0,
          2,
          { x: x0, y: pts[0].y },
          { x: x0, y: stubY },
          { x: desiredX, y: stubY },
          { x: desiredX, y: pts[1].y },
        );
        return;
      }
      pts[0].x = x0;
      pts[1].x = x0;
      return;
    }

    if (i2 === n - 1) {
      if (!canSlideOnWall(pts[n - 1], tid, false)) return;
      const xn = clampCoordToNode(
        pts[n - 1],
        desiredX,
        tid,
        edge.ast.sourceId,
        false,
      );
      if (Math.abs(xn - desiredX) > 1.5 && Math.abs(segDy) > 22) {
        const sy = segDy >= 0 ? 1 : -1;
        const stubY = pts[n - 1].y - sy * STUB;
        pts.splice(
          n - 2,
          2,
          { x: desiredX, y: pts[n - 2].y },
          { x: desiredX, y: stubY },
          { x: xn, y: stubY },
          { x: xn, y: pts[n - 1].y },
        );
        return;
      }
      pts[n - 1].x = xn;
      pts[n - 2].x = xn;
      return;
    }

    let clampedX = desiredX;
    if (i1 === 1) {
      const dx0 = pts[1].x - pts[0].x;
      if (dx0 > 1) clampedX = Math.max(clampedX, pts[0].x + 8);
      else if (dx0 < -1) clampedX = Math.min(clampedX, pts[0].x - 8);
    }
    if (i2 === n - 2) {
      const dxn = pts[n - 1].x - pts[n - 2].x;
      if (dxn > 1) clampedX = Math.min(clampedX, pts[n - 1].x - 8);
      else if (dxn < -1) clampedX = Math.max(clampedX, pts[n - 1].x + 8);
    }
    pts[i1].x = clampedX;
    pts[i2].x = clampedX;
  }
}

/**
 * Planar 2-opt uncrossing for same-state-pair multi-edges / bidirectional edges:
 * whenever two orthogonal polylines connecting the same `{u, v}` state pair cross
 * at `(xV, yH)`, swaps their tails with a 12px quadrant chamfer (`>= 16.97px` clearance)
 * without touching any region outside the two existing corridors.
 */
function uncrossSamePairEdges(edges: PositionedEdge[]): void {
  const byPair = new Map<string, PositionedEdge[]>();
  for (const edge of edges) {
    if (edge.branches.length !== 1) continue;
    const tid = edge.ast.targetIds[0];
    if (!tid || tid === edge.ast.sourceId) continue;
    const key = [edge.ast.sourceId, tid].sort().join('::');
    const list = byPair.get(key) ?? [];
    list.push(edge);
    byPair.set(key, list);
  }

  for (const [pairKey, group] of byPair.entries()) {
    if (group.length < 2) continue;
    const canonicalSrc = pairKey.split('::')[0];

    // Orient all polylines in `group` from `canonicalSrc` -> other endpoint
    const oriented = group.map((e) =>
      e.ast.sourceId === canonicalSrc
        ? e.branches[0].map((p) => ({ ...p }))
        : e.branches[0]
            .slice()
            .reverse()
            .map((p) => ({ ...p })),
    );

    for (let iter = 0; iter < 40; iter++) {
      let swapped = false;
      for (let a = 0; a < oriented.length && !swapped; a++) {
        for (let b = a + 1; b < oriented.length && !swapped; b++) {
          const pA = oriented[a];
          const pB = oriented[b];

          for (let iA = 0; iA < pA.length - 1 && !swapped; iA++) {
            const a1 = pA[iA];
            const a2 = pA[iA + 1];
            const aHoriz = Math.abs(a1.y - a2.y) < 1 && Math.abs(a2.x - a1.x) >= 2;
            const aVert = Math.abs(a1.x - a2.x) < 1 && Math.abs(a2.y - a1.y) >= 2;
            if (!aHoriz && !aVert) continue;

            for (let iB = 0; iB < pB.length - 1 && !swapped; iB++) {
              const b1 = pB[iB];
              const b2 = pB[iB + 1];
              const bHoriz =
                Math.abs(b1.y - b2.y) < 1 && Math.abs(b2.x - b1.x) >= 2;
              const bVert =
                Math.abs(b1.x - b2.x) < 1 && Math.abs(b2.y - b1.y) >= 2;
              if (aHoriz === bHoriz || (!bHoriz && !bVert)) continue;

              // Normalize so H is horizontal segment, V is vertical segment
              const h1 = aHoriz ? a1 : b1;
              const h2 = aHoriz ? a2 : b2;
              const v1 = aHoriz ? b1 : a1;
              const v2 = aHoriz ? b2 : a2;

              const yH = (h1.y + h2.y) / 2;
              const xV = (v1.x + v2.x) / 2;
              const minHX = Math.min(h1.x, h2.x);
              const maxHX = Math.max(h1.x, h2.x);
              const minVY = Math.min(v1.y, v2.y);
              const maxVY = Math.max(v1.y, v2.y);

              if (
                xV <= minHX + 1 ||
                xV >= maxHX - 1 ||
                yH <= minVY + 1 ||
                yH >= maxVY - 1
              ) {
                continue;
              }

              const sx = h2.x >= h1.x ? 1 : -1;
              const sy = v2.y >= v1.y ? 1 : -1;
              const hIdx = aHoriz ? iA : iB;
              const hLen = (aHoriz ? pA : pB).length;
              const vIdx = aHoriz ? iB : iA;
              const vLen = (aHoriz ? pB : pA).length;
              const hStartPad = hIdx === 0 ? 9 : 0;
              const hEndPad = hIdx === hLen - 2 ? 9 : 0;
              const vStartPad = vIdx === 0 ? 9 : 0;
              const vEndPad = vIdx === vLen - 2 ? 9 : 0;
              const chX1 = Math.min(
                20,
                Math.max(0, Math.abs(xV - h1.x) - hStartPad),
              );
              const chY1 = Math.min(
                20,
                Math.max(0, Math.abs(v2.y - yH) - vEndPad),
              );
              const chY2 = Math.min(
                20,
                Math.max(0, Math.abs(yH - v1.y) - vStartPad),
              );
              const chX2 = Math.min(
                20,
                Math.max(0, Math.abs(h2.x - xV) - hEndPad),
              );

              if (
                chX1 < 4 ||
                chX2 < 4 ||
                chY1 < 4 ||
                chY2 < 4 ||
                Math.hypot(chX2, chY1) < 16.5 ||
                Math.hypot(chX1, chY2) < 16.5 ||
                Math.hypot(chX1 + chX2, chY1 + chY2) < 18
              ) {
                continue;
              }

              // H-prefix -> V-suffix in quadrant (-sx, +sy)
              const hPrefixToVSuffix: Point[] = [
                ...(aHoriz ? pA.slice(0, iA + 1) : pB.slice(0, iB + 1)),
                { x: xV - sx * chX1, y: yH },
                { x: xV - sx * chX1, y: yH + sy * chY1 },
                { x: xV, y: yH + sy * chY1 },
                ...(aHoriz ? pB.slice(iB + 1) : pA.slice(iA + 1)),
              ];

              // V-prefix -> H-suffix in quadrant (+sx, -sy)
              const vPrefixToHSuffix: Point[] = [
                ...(aHoriz ? pB.slice(0, iB + 1) : pA.slice(0, iA + 1)),
                { x: xV, y: yH - sy * chY2 },
                { x: xV + sx * chX2, y: yH - sy * chY2 },
                { x: xV + sx * chX2, y: yH },
                ...(aHoriz ? pA.slice(iA + 1) : pB.slice(iB + 1)),
              ];

              if (aHoriz) {
                oriented[a] = simplifyOrthogonalPolyline(hPrefixToVSuffix);
                oriented[b] = simplifyOrthogonalPolyline(vPrefixToHSuffix);
              } else {
                oriented[b] = simplifyOrthogonalPolyline(hPrefixToVSuffix);
                oriented[a] = simplifyOrthogonalPolyline(vPrefixToHSuffix);
              }
              swapped = true;
            }
          }
        }
      }
      if (!swapped) break;
    }

    for (let idx = 0; idx < group.length; idx++) {
      const e = group[idx];
      e.branches[0] =
        e.ast.sourceId === canonicalSrc
          ? oriented[idx]
          : oriented[idx].slice().reverse();
    }
  }
}

/**
 * Projects endpoints on regular (non-haloed) circular/capsule history nodes directly
 * onto their exact curve along their existing horizontal/vertical segment direction
 * without ever flipping departure/arrival sides or introducing diagonal bends.
 */
function resnapRegularHistoryEndpoints(
  edges: PositionedEdge[],
  absNodes: Map<string, PositionedNode>,
): void {
  const repairCircularHistoryTail = (
    ptsIn: Point[],
    node: PositionedNode,
    selfEdge: PositionedEdge,
    selfBranchIdx: number,
  ): Point[] => {
    if (ptsIn.length < 2) return ptsIn;
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const r = Math.min(node.width, node.height) / 2;
    const maxOff = Math.min(r - 4.2, r * 0.68);

    const interiorPiercesCircle = (poly: Point[]): boolean => {
      const len = polylineLength(poly);
      for (let s = 2; s <= len - 2; s += 2) {
        const p = pointAtPolylineLength(poly, s);
        if (Math.hypot(p.x - cx, p.y - cy) < r - 0.15) return true;
      }
      return false;
    };

    const tailParallelPenalty = (poly: Point[], fromIdx: number): number => {
      let pen = 0;
      for (let s = Math.max(0, fromIdx); s < poly.length - 1; s++) {
        const a1 = poly[s];
        const a2 = poly[s + 1];
        const aH = Math.abs(a1.y - a2.y) < 1;
        const aV = Math.abs(a1.x - a2.x) < 1;
        if (!aH && !aV) continue;
        for (const oe of edges) {
          for (let ob = 0; ob < oe.branches.length; ob++) {
            if (oe === selfEdge && ob === selfBranchIdx) continue;
            const obr = oe.branches[ob];
            for (let k = 0; k < obr.length - 1; k++) {
              const b1 = obr[k];
              const b2 = obr[k + 1];
              if (aH && Math.abs(b1.y - b2.y) < 1) {
                const ov =
                  Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x)) -
                  Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x));
                const perp = Math.abs(a1.y - b1.y);
                if (ov > 6 && perp < 14) {
                  pen += 200_000 + (14 - perp) * 5000;
                }
              } else if (aV && Math.abs(b1.x - b2.x) < 1) {
                const ov =
                  Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y)) -
                  Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y));
                const perp = Math.abs(a1.x - b1.x);
                if (ov > 6 && perp < 14) {
                  pen += 200_000 + (14 - perp) * 5000;
                }
              }
            }
          }
        }
      }
      return pen;
    };

    const last = ptsIn.length - 1;
    const pEnd = ptsIn[last];
    const pPrev = ptsIn[last - 1];
    const isHoriz = Math.abs(pEnd.x - pPrev.x) >= Math.abs(pEnd.y - pPrev.y);
    let hadFastParallelConflict = false;

    // Fast path: if pPrev is already strictly outside `r + 6` and aligns cleanly without piercing or parallel overlap
    if (isHoriz) {
      const y = clamp(pPrev.y, cy - maxOff, cy + maxOff);
      const dy = y - cy;
      const rad = Math.sqrt(Math.max(0, r * r - dy * dy));
      if (
        (pPrev.x <= cx - r - 6 || pPrev.x >= cx + r + 6) &&
        Math.abs(y - pPrev.y) <= 0.5
      ) {
        const candEnd: Point = {
          x: pPrev.x <= cx ? cx - rad : cx + rad,
          y,
        };
        const cand = simplifyOrthogonalPolyline([
          ...ptsIn.slice(0, last - 1),
          { x: pPrev.x, y },
          candEnd,
        ]);
        if (!interiorPiercesCircle(cand)) {
          if (tailParallelPenalty(cand, cand.length - 3) === 0) return cand;
          hadFastParallelConflict = true;
        }
      }
    } else {
      const x = clamp(pPrev.x, cx - maxOff, cx + maxOff);
      const dx = x - cx;
      const rad = Math.sqrt(Math.max(0, r * r - dx * dx));
      if (
        (pPrev.y <= cy - r - 6 || pPrev.y >= cy + r + 6) &&
        Math.abs(x - pPrev.x) <= 0.5
      ) {
        const candEnd: Point = {
          x,
          y: pPrev.y <= cy ? cy - rad : cy + rad,
        };
        const cand = simplifyOrthogonalPolyline([
          ...ptsIn.slice(0, last - 1),
          { x, y: pPrev.y },
          candEnd,
        ]);
        if (!interiorPiercesCircle(cand)) {
          if (tailParallelPenalty(cand, cand.length - 3) === 0) return cand;
          hadFastParallelConflict = true;
        }
      }
    }

    // Otherwise, step back to last safe exterior vertex
    const safeDist = hadFastParallelConflict ? r + 28 : r + 8;
    let anchorIdx = 0;
    for (let k = last - 1; k >= 0; k--) {
      if (
        Math.abs(ptsIn[k].x - cx) >= safeDist ||
        Math.abs(ptsIn[k].y - cy) >= safeDist
      ) {
        anchorIdx = k;
        break;
      }
    }
    const prefix = ptsIn.slice(0, anchorIdx + 1);
    const anch = ptsIn[anchorIdx];

    const otherPorts: Point[] = [];
    for (const e of edges) {
      for (let b = 0; b < e.branches.length; b++) {
        if (e === selfEdge && b === selfBranchIdx) continue;
        const br = e.branches[b];
        if (br.length < 2) continue;
        if (e.ast.sourceId === node.ast.id) otherPorts.push(br[0]);
        const tid = e.ast.targetIds[b] ?? e.ast.sourceId;
        if (tid === node.ast.id) otherPorts.push(br[br.length - 1]);
      }
    }

    const rawOffsets = [
      clamp(anch.x - cx, -maxOff, maxOff),
      clamp(anch.y - cy, -maxOff, maxOff),
      0,
      -5,
      5,
      -8.5,
      8.5,
    ];
    const candidateTails: Point[][] = [];

    for (const stubClear of [10, 22, 34, 46]) {
      const boxL = cx - r - stubClear;
      const boxR = cx + r + stubClear;
      const boxT = cy - r - stubClear;
      const boxB = cy + r + stubClear;

      for (const rawOff of rawOffsets) {
        const off = clamp(rawOff, -maxOff, maxOff);
        const rad = Math.sqrt(Math.max(0, r * r - off * off));

        // TOP
        {
          const px = cx + off;
          const py = cy - rad;
          if (anch.y <= cy - r - 6 && stubClear === 10) {
            candidateTails.push([anch, { x: px, y: anch.y }, { x: px, y: py }]);
          } else {
            const outX =
              anch.x <= cx ? Math.min(anch.x, boxL) : Math.max(anch.x, boxR);
            candidateTails.push([
              anch,
              { x: outX, y: anch.y },
              { x: outX, y: boxT },
              { x: px, y: boxT },
              { x: px, y: py },
            ]);
          }
        }
        // BOTTOM
        {
          const px = cx + off;
          const py = cy + rad;
          if (anch.y >= cy + r + 6 && stubClear === 10) {
            candidateTails.push([anch, { x: px, y: anch.y }, { x: px, y: py }]);
          } else {
            const outX =
              anch.x <= cx ? Math.min(anch.x, boxL) : Math.max(anch.x, boxR);
            candidateTails.push([
              anch,
              { x: outX, y: anch.y },
              { x: outX, y: boxB },
              { x: px, y: boxB },
              { x: px, y: py },
            ]);
          }
        }
        // LEFT
        {
          const py = cy + off;
          const px = cx - rad;
          if (anch.x <= cx - r - 6 && stubClear === 10) {
            candidateTails.push([anch, { x: anch.x, y: py }, { x: px, y: py }]);
          } else {
            const outY =
              anch.y <= cy ? Math.min(anch.y, boxT) : Math.max(anch.y, boxB);
            candidateTails.push([
              anch,
              { x: anch.x, y: outY },
              { x: boxL, y: outY },
              { x: boxL, y: py },
              { x: px, y: py },
            ]);
          }
        }
        // RIGHT
        {
          const py = cy + off;
          const px = cx + rad;
          if (anch.x >= cx + r + 6 && stubClear === 10) {
            candidateTails.push([anch, { x: anch.x, y: py }, { x: px, y: py }]);
          } else {
            const outY =
              anch.y <= cy ? Math.min(anch.y, boxT) : Math.max(anch.y, boxB);
            candidateTails.push([
              anch,
              { x: anch.x, y: outY },
              { x: boxR, y: outY },
              { x: boxR, y: py },
              { x: px, y: py },
            ]);
          }
        }
      }
    }

    let bestPoly: Point[] | null = null;
    let bestScore = Infinity;

    for (const tail of candidateTails) {
      const full = simplifyOrthogonalPolyline([
        ...prefix.slice(0, -1),
        ...tail,
      ]);
      if (full.length < 2) continue;
      if (interiorPiercesCircle(full)) continue;

      const endP = full[full.length - 1];
      let score =
        polylineLength(tail) + Math.max(0, full.length - prefix.length) * 16;

      for (const op of otherPorts) {
        const dPort = Math.hypot(endP.x - op.x, endP.y - op.y);
        if (dPort < 8.5) {
          score += 50_000 + (8.5 - dPort) * 4000;
        }
      }

      const startCheckIdx = Math.max(0, prefix.length - 1);
      for (let s = startCheckIdx; s < full.length - 1; s++) {
        const a1 = full[s];
        const a2 = full[s + 1];
        const aH = Math.abs(a1.y - a2.y) < 1;
        const aV = Math.abs(a1.x - a2.x) < 1;
        if (!aH && !aV) continue;
        for (const oe of edges) {
          for (let ob = 0; ob < oe.branches.length; ob++) {
            if (oe === selfEdge && ob === selfBranchIdx) continue;
            const obr = oe.branches[ob];
            for (let k = 0; k < obr.length - 1; k++) {
              const b1 = obr[k];
              const b2 = obr[k + 1];
              if (aH && Math.abs(b1.y - b2.y) < 1) {
                const ov =
                  Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x)) -
                  Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x));
                const perp = Math.abs(a1.y - b1.y);
                if (ov > 6 && perp < 14) {
                  score += 200_000 + (14 - perp) * 5000;
                }
              } else if (aV && Math.abs(b1.x - b2.x) < 1) {
                const ov =
                  Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y)) -
                  Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y));
                const perp = Math.abs(a1.x - b1.x);
                if (ov > 6 && perp < 14) {
                  score += 200_000 + (14 - perp) * 5000;
                }
              }
            }
          }
        }
        if (score >= bestScore) break;
      }

      if (score < bestScore) {
        bestScore = score;
        bestPoly = full;
      }
    }

    return bestPoly ?? ptsIn;
  };

  const projectCapsuleEndpoint = (
    endPt: Point,
    adjPt: Point,
    node: PositionedNode,
  ): Point => {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const isHoriz = Math.abs(endPt.x - adjPt.x) >= Math.abs(endPt.y - adjPt.y);
    const rx = Math.min(14, node.height / 2);
    const maxCapOff = Math.min(Math.max(0, rx - 4.2), rx * 0.68);
    if (isHoriz) {
      const y = clamp(endPt.y, cy - maxCapOff, cy + maxCapOff);
      const dy = y - cy;
      const rad = Math.sqrt(Math.max(0, rx * rx - dy * dy));
      return {
        x: adjPt.x <= cx ? node.x + rx - rad : node.x + node.width - rx + rad,
        y,
      };
    }
    return {
      x: clamp(endPt.x, node.x + rx, node.x + node.width - rx),
      y: adjPt.y <= cy ? node.y : node.y + node.height,
    };
  };

  for (const edge of edges) {
    const srcNode = absNodes.get(edge.ast.sourceId);
    if (!srcNode) continue;
    for (let b = 0; b < edge.branches.length; b++) {
      let pts = edge.branches[b];
      if (pts.length < 2) continue;
      const tid = edge.ast.targetIds[b] ?? edge.ast.sourceId;
      const tgtNode = absNodes.get(tid);
      if (!tgtNode) continue;

      if (
        srcNode.ast.type === 'history' &&
        !(srcNode.ast.key === 'history' && srcNode.width > 45)
      ) {
        if (srcNode.ast.key === 'history') {
          pts = repairCircularHistoryTail(
            pts.slice().reverse(),
            srcNode,
            edge,
            b,
          ).reverse();
          edge.branches[b] = pts;
        } else {
          const isHoriz =
            Math.abs(pts[0].x - pts[1].x) >= Math.abs(pts[0].y - pts[1].y);
          const p = projectCapsuleEndpoint(pts[0], pts[1], srcNode);
          pts[0] = p;
          if (pts.length >= 3) {
            if (isHoriz) pts[1].y = p.y;
            else pts[1].x = p.x;
          }
        }
      }

      pts = edge.branches[b];
      if (
        pts.length >= 2 &&
        tgtNode.ast.type === 'history' &&
        !(tgtNode.ast.key === 'history' && tgtNode.width > 45)
      ) {
        if (tgtNode.ast.key === 'history') {
          edge.branches[b] = repairCircularHistoryTail(pts, tgtNode, edge, b);
        } else {
          const last = pts.length - 1;
          const isHoriz =
            Math.abs(pts[last].x - pts[last - 1].x) >=
            Math.abs(pts[last].y - pts[last - 1].y);
          const p = projectCapsuleEndpoint(pts[last], pts[last - 1], tgtNode);
          pts[last] = p;
          if (pts.length >= 3) {
            if (isHoriz) pts[last - 1].y = p.y;
            else pts[last - 1].x = p.x;
          }
        }
      }
    }
  }
}

function enforceStrictOrthogonalEdges(
  edges: PositionedEdge[],
  absNodes: Map<string, PositionedNode>,
): void {
  const prefersHorizAtPort = (pt: Point, node: PositionedNode | undefined): boolean => {
    if (!node) return true;
    if (node.ast.type === 'history' && !(node.ast.key === 'history' && node.width > 45)) {
      const cx = node.x + node.width / 2;
      const cy = node.y + node.height / 2;
      return Math.abs(pt.x - cx) >= Math.abs(pt.y - cy);
    }
    const dVertWall = Math.min(
      Math.abs(pt.x - node.x),
      Math.abs(pt.x - (node.x + node.width)),
    );
    const dHorizWall = Math.min(
      Math.abs(pt.y - node.y),
      Math.abs(pt.y - (node.y + node.height)),
    );
    return dVertWall <= dHorizWall;
  };

  for (const edge of edges) {
    const srcNode = absNodes.get(edge.ast.sourceId);
    for (let b = 0; b < edge.branches.length; b++) {
      const pts = edge.branches[b];
      if (pts.length < 2) continue;
      const tid = edge.ast.targetIds[b] ?? edge.ast.sourceId;
      const tgtNode = absNodes.get(tid);

      let hasDiag = false;
      for (let i = 0; i < pts.length - 1; i++) {
        if (
          Math.abs(pts[i + 1].x - pts[i].x) > 1.8 &&
          Math.abs(pts[i + 1].y - pts[i].y) > 1.8
        ) {
          hasDiag = true;
          break;
        }
      }

      let curPts = pts;
      if (hasDiag) {
        const out: Point[] = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
          const p1 = out[out.length - 1];
          const p2 = pts[i + 1];
          const dx = Math.abs(p2.x - p1.x);
          const dy = Math.abs(p2.y - p1.y);
          if (dx <= 1.8 || dy <= 1.8) {
            out.push(p2);
            continue;
          }

          const horizStart =
            out.length >= 2
              ? Math.abs(p1.x - out[out.length - 2].x) <
                Math.abs(p1.y - out[out.length - 2].y)
              : prefersHorizAtPort(p1, srcNode);
          const horizEnd =
            i + 2 < pts.length
              ? Math.abs(pts[i + 2].x - p2.x) < Math.abs(pts[i + 2].y - p2.y)
              : prefersHorizAtPort(p2, tgtNode);

          if (horizStart !== horizEnd) {
            out.push(horizStart ? { x: p2.x, y: p1.y } : { x: p1.x, y: p2.y });
          } else if (horizStart) {
            const midX = (p1.x + p2.x) / 2;
            out.push({ x: midX, y: p1.y }, { x: midX, y: p2.y });
          } else {
            const midY = (p1.y + p2.y) / 2;
            out.push({ x: p1.x, y: midY }, { x: p2.x, y: midY });
          }
          out.push(p2);
        }
        curPts = simplifyOrthogonalPolyline(out);
      }

      // Snap any sub-1.8px drift to exact 0.0px axis alignment
      const isCircHist = (n: PositionedNode | undefined): boolean =>
        Boolean(n && n.ast.type === 'history' && n.ast.key === 'history' && n.width <= 45);
      let snapped = false;
      if (curPts.length === 2) {
        const p0 = curPts[0];
        const p1 = curPts[1];
        const dx = Math.abs(p1.x - p0.x);
        const dy = Math.abs(p1.y - p0.y);
        if (dx > 0.005 && dx <= 1.8 && dy > 2.0) {
          if (
            tgtNode &&
            !isCircHist(tgtNode) &&
            p0.x >= tgtNode.x + nodeCornerMargin(tgtNode) - 0.5 &&
            p0.x <= tgtNode.x + tgtNode.width - nodeCornerMargin(tgtNode) + 0.5
          ) {
            p1.x = p0.x;
            snapped = true;
          } else if (
            srcNode &&
            !isCircHist(srcNode) &&
            p1.x >= srcNode.x + nodeCornerMargin(srcNode) - 0.5 &&
            p1.x <= srcNode.x + srcNode.width - nodeCornerMargin(srcNode) + 0.5
          ) {
            p0.x = p1.x;
            snapped = true;
          }
        } else if (dy > 0.005 && dy <= 1.8 && dx > 2.0) {
          if (
            tgtNode &&
            !isCircHist(tgtNode) &&
            p0.y >= tgtNode.y + nodeCornerMargin(tgtNode) - 0.5 &&
            p0.y <= tgtNode.y + tgtNode.height - nodeCornerMargin(tgtNode) + 0.5
          ) {
            p1.y = p0.y;
            snapped = true;
          } else if (
            srcNode &&
            !isCircHist(srcNode) &&
            p1.y >= srcNode.y + nodeCornerMargin(srcNode) - 0.5 &&
            p1.y <= srcNode.y + srcNode.height - nodeCornerMargin(srcNode) + 0.5
          ) {
            p0.y = p1.y;
            snapped = true;
          }
        }
      } else {
        for (let i = 0; i < curPts.length - 2; i++) {
          const a = curPts[i];
          const bPt = curPts[i + 1];
          const dx = Math.abs(bPt.x - a.x);
          const dy = Math.abs(bPt.y - a.y);
          if (dx > 0.005 && dx <= 1.8 && dy > 2.0) {
            bPt.x = a.x;
            snapped = true;
          } else if (dy > 0.005 && dy <= 1.8 && dx > 2.0) {
            bPt.y = a.y;
            snapped = true;
          }
        }
        const last = curPts.length - 1;
        const pen = curPts[last - 1];
        const end = curPts[last];
        const dxEnd = Math.abs(end.x - pen.x);
        const dyEnd = Math.abs(end.y - pen.y);
        if (dxEnd > 0.005 && dxEnd <= 1.8 && dyEnd > 2.0) {
          pen.x = end.x;
          snapped = true;
        } else if (dyEnd > 0.005 && dyEnd <= 1.8 && dxEnd > 2.0) {
          pen.y = end.y;
          snapped = true;
        }
      }

      edge.branches[b] = snapped ? simplifyOrthogonalPolyline(curPts) : curPts;
    }
  }
}

/**
 * Identifies structural chain-wrap and inter-stage bridge transitions in large
 * statecharts (`>= 35` states) that should be deferred from ELK's horizontal layer
 * assignment so wide sequential chains/stages fold cleanly into balanced 2D grids
 * (`< 8,000px` wide, avoiding Chromium 2x Retina 16,384px texture tile clipping).
 */
function computeFoldedTransitionIds(
  ast: StatechartAST,
  childrenByParent: Map<string | null, StateNodeAST[]>,
): Set<string> {
  const folded = new Set<string>();

  const directChildInside = (
    containerId: string,
    nodeId: string,
  ): string | null => {
    let cur: string | null = nodeId;
    while (cur && ast.nodes[cur]) {
      if (ast.nodes[cur].parentId === containerId) return cur;
      cur = ast.nodes[cur].parentId;
    }
    return null;
  };

  const countSubtree = (rootId: string): number => {
    let total = 1;
    for (const ch of childrenByParent.get(rootId) ?? []) {
      total += countSubtree(ch.id);
    }
    return total;
  };

  // Rule F1: Leaf compound containers with >= 7 sequential atomic children -> wrap every 3 states
  for (const [parentId, kids] of childrenByParent.entries()) {
    if (!parentId || ast.nodes[parentId]?.type !== 'compound') continue;
    if (kids.length >= 7 && kids.every((gc) => gc.type === 'atomic')) {
      for (let i = 0; i < kids.length - 1; i++) {
        if ((i + 1) % 3 === 0) {
          const u = kids[i].id;
          const v = kids[i + 1].id;
          for (const tr of ast.transitions) {
            if (
              tr.sourceId === u &&
              tr.targetIds.length === 1 &&
              tr.targetIds[0] === v
            ) {
              folded.add(tr.id);
            }
          }
        }
      }
    }
  }

  // Rule F2: Compound containers with >= 3 compound/parallel child stages -> fold single-link stage bridges
  for (const [parentId, kids] of childrenByParent.entries()) {
    if (!parentId || ast.nodes[parentId]?.type !== 'compound') continue;
    const stageKids = kids.filter(
      (k) => k.type === 'compound' || k.type === 'parallel',
    );
    if (stageKids.length < 3) continue;
    const stageRank = new Map(stageKids.map((k, idx) => [k.id, idx]));

    const sibEdges: Array<{ tr: TransitionAST; u: string; v: string }> = [];
    for (const tr of ast.transitions) {
      if (tr.targetIds.length !== 1) continue;
      const u = directChildInside(parentId, tr.sourceId);
      const v = directChildInside(parentId, tr.targetIds[0]);
      if (u && v && u !== v) {
        sibEdges.push({ tr, u, v });
      }
    }

    const canReach = (start: string, goal: string): boolean => {
      const seen = new Set<string>([start]);
      const q = [start];
      while (q.length > 0) {
        const cur = q.shift()!;
        if (cur === goal) return true;
        for (const e of sibEdges) {
          if (e.u === cur && !seen.has(e.v)) {
            seen.add(e.v);
            q.push(e.v);
          }
        }
      }
      return false;
    };

    const totalDesc = countSubtree(parentId);
    for (const { tr, u, v } of sibEdges) {
      if (!stageRank.has(u) || !stageRank.has(v)) continue;
      const pairLinks = sibEdges.filter((e) => e.u === u && e.v === v).length;
      if (pairLinks !== 1) continue;

      // F2a: One-way DAG bridge between stage SCCs
      if (!canReach(v, u)) {
        folded.add(tr.id);
        continue;
      }
      // F2b: Forward link between later stages (rank >= 1 -> rank > u) in very large containers
      const ru = stageRank.get(u)!;
      const rv = stageRank.get(v)!;
      if (totalDesc >= 40 && ru >= 1 && rv > ru) {
        folded.add(tr.id);
      }
    }
  }

  return folded;
}

/**
 * Routes a deferred fold transition post-ELK along a shortest obstacle-free,
 * container-respecting, collinear-safe Hanan orthogonal path.
 */
function routeDeferredFoldEdge(
  sourceId: string,
  targetId: string,
  existingEdges: PositionedEdge[],
  initials: PositionedInitialIndicator[],
  absNodes: Map<string, PositionedNode>,
  ast: StatechartAST,
  theme: ThemeTokens,
): Point[] {
  const srcNode = absNodes.get(sourceId)!;
  const tgtNode = absNodes.get(targetId)!;

  const forbiddenRects: Rect[] = [];
  const sharedAncestors: PositionedNode[] = [];
  const singleAncestors: PositionedNode[] = [];

  for (const node of absNodes.values()) {
    const uid = node.ast.id;
    const ancS = isAncestorInAst(uid, sourceId, ast);
    const ancT = isAncestorInAst(uid, targetId, ast);
    if (!ancS && !ancT) {
      if (uid === sourceId || uid === targetId) {
        if (node.width > 8 && node.height > 8) {
          forbiddenRects.push({
            x: node.x + 2,
            y: node.y + 2,
            width: node.width - 4,
            height: node.height - 4,
          });
        }
      } else {
        forbiddenRects.push({
          x: node.x - 4,
          y: node.y - 4,
          width: node.width + 8,
          height: node.height + 8,
        });
      }
    } else if (ancS && ancT) {
      sharedAncestors.push(node);
      forbiddenRects.push({
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.headerHeight + node.compartmentHeight + 8,
      });
    } else {
      singleAncestors.push(node);
      const titleW = measureTextWidth(node.ast.key, {
        fontFamily: 'sans',
        fontSize: theme.fontSizes.stateTitle,
        bold: true,
      });
      forbiddenRects.push({
        x: node.x + 6,
        y: node.y,
        width: Math.min(node.width - 12, titleW + 20),
        height: node.headerHeight + 2,
      });
      if (node.compartmentHeight > 0) {
        forbiddenRects.push({
          x: node.x + 4,
          y: node.y + node.headerHeight - 1,
          width: node.width - 8,
          height: node.compartmentHeight + 4,
        });
      }
    }
  }

  for (const init of initials) {
    forbiddenRects.push({
      x: init.cx - init.r - 4,
      y: init.cy - init.r - 4,
      width: init.r * 2 + 8,
      height: init.r * 2 + 8,
    });
  }

  let minBoundX = -Infinity;
  let maxBoundX = Infinity;
  let minBoundY = -Infinity;
  let maxBoundY = Infinity;
  for (const anc of sharedAncestors) {
    minBoundX = Math.max(minBoundX, anc.x + 18);
    maxBoundX = Math.min(maxBoundX, anc.x + anc.width - 18);
    minBoundY = Math.max(
      minBoundY,
      anc.y + anc.headerHeight + anc.compartmentHeight + 14,
    );
    maxBoundY = Math.min(maxBoundY, anc.y + anc.height - 18);
  }

  const segAllowed = (a: Point, b: Point, allowEndpointBoxes = false): boolean => {
    if (
      a.x < minBoundX - 0.5 ||
      a.x > maxBoundX + 0.5 ||
      a.y < minBoundY - 0.5 ||
      a.y > maxBoundY + 0.5 ||
      b.x < minBoundX - 0.5 ||
      b.x > maxBoundX + 0.5 ||
      b.y < minBoundY - 0.5 ||
      b.y > maxBoundY + 0.5
    ) {
      return false;
    }
    for (let idx = 0; idx < forbiddenRects.length; idx++) {
      const obs = forbiddenRects[idx];
      if (allowEndpointBoxes) {
        // Endpoint stub starts on perimeter of srcNode / tgtNode (`2px` inset already applied)
        if (distRectToSegment(obs, a, b) < 0.2) return false;
      } else {
        if (distRectToSegment(obs, a, b) < 0.5) return false;
      }
    }
    return true;
  };

  interface PortCandidate {
    pt: Point;
    stub: Point;
    dirCode: number;
  }

  const isPortFreeOnNode = (pt: Point, node: PositionedNode): boolean => {
    const minSep =
      node.ast.type === 'history' && node.width <= 45 ? 9.5 : 18.0;
    for (const e of existingEdges) {
      for (let b = 0; b < e.branches.length; b++) {
        const br = e.branches[b];
        if (br.length < 2) continue;
        if (
          e.ast.sourceId === node.ast.id &&
          Math.hypot(br[0].x - pt.x, br[0].y - pt.y) < minSep
        ) {
          return false;
        }
        const tid = e.ast.targetIds[b] ?? e.ast.sourceId;
        if (
          tid === node.ast.id &&
          Math.hypot(br[br.length - 1].x - pt.x, br[br.length - 1].y - pt.y) <
            minSep
        ) {
          return false;
        }
      }
    }
    for (const init of initials) {
      if (init.targetId === node.ast.id && init.points.length >= 2) {
        const pEnd = init.points[init.points.length - 1];
        if (Math.hypot(pEnd.x - pt.x, pEnd.y - pt.y) < minSep) return false;
      }
    }
    return true;
  };

  const buildPorts = (node: PositionedNode): PortCandidate[] => {
    const out: PortCandidate[] = [];
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;

    if (node.ast.type === 'history' && node.width <= 45) {
      const stubLen = 18;
      const r = Math.min(node.width, node.height) / 2;
      const offs = [0, -5, 5];
      for (const off of offs) {
        const rad = Math.sqrt(Math.max(0, r * r - off * off));
        const raw: PortCandidate[] = [
          {
            pt: { x: cx + off, y: cy - rad },
            stub: { x: cx + off, y: node.y - stubLen },
            dirCode: 4,
          },
          {
            pt: { x: cx + off, y: cy + rad },
            stub: { x: cx + off, y: node.y + node.height + stubLen },
            dirCode: 3,
          },
          {
            pt: { x: cx - rad, y: cy + off },
            stub: { x: node.x - stubLen, y: cy + off },
            dirCode: 2,
          },
          {
            pt: { x: cx + rad, y: cy + off },
            stub: { x: node.x + node.width + stubLen, y: cy + off },
            dirCode: 1,
          },
        ];
        for (const c of raw) {
          if (isPortFreeOnNode(c.pt, node) && segAllowed(c.pt, c.stub, true)) {
            out.push(c);
          }
        }
      }
      return out;
    }

    const margin = nodeCornerMargin(node);
    const yRange = nodeAllowedYRange(node, false);
    const stubLen = 20;
    const fracs = [0.5, 0.3, 0.7, 0.18, 0.82];

    for (const f of fracs) {
      const x =
        node.x + margin + Math.max(0, node.width - margin * 2) * f;
      const bot: PortCandidate = {
        pt: { x, y: node.y + node.height },
        stub: { x, y: node.y + node.height + stubLen },
        dirCode: 3,
      };
      const top: PortCandidate = {
        pt: { x, y: node.y },
        stub: { x, y: node.y - stubLen },
        dirCode: 4,
      };
      if (isPortFreeOnNode(bot.pt, node) && segAllowed(bot.pt, bot.stub, true)) {
        out.push(bot);
      }
      if (isPortFreeOnNode(top.pt, node) && segAllowed(top.pt, top.stub, true)) {
        out.push(top);
      }
    }

    for (const f of fracs) {
      const y =
        yRange.minY + Math.max(0, yRange.maxY - yRange.minY) * f;
      const right: PortCandidate = {
        pt: { x: node.x + node.width, y },
        stub: { x: node.x + node.width + stubLen, y },
        dirCode: 1,
      };
      const left: PortCandidate = {
        pt: { x: node.x, y },
        stub: { x: node.x - stubLen, y },
        dirCode: 2,
      };
      if (
        isPortFreeOnNode(right.pt, node) &&
        segAllowed(right.pt, right.stub, true)
      ) {
        out.push(right);
      }
      if (
        isPortFreeOnNode(left.pt, node) &&
        segAllowed(left.pt, left.stub, true)
      ) {
        out.push(left);
      }
    }

    return out;
  };

  const startPorts = buildPorts(srcNode);
  const goalPorts = buildPorts(tgtNode);

  if (startPorts.length === 0 || goalPorts.length === 0) {
    const fallback = snapEdgeEndpoints(
      srcNode,
      tgtNode,
      [
        { x: srcNode.x + srcNode.width / 2, y: srcNode.y + srcNode.height },
        { x: tgtNode.x + tgtNode.width / 2, y: tgtNode.y },
      ],
      ast,
    );
    return rerouteAroundPiercedObstacles(
      sourceId,
      targetId,
      fallback,
      absNodes,
      ast,
      theme,
    );
  }

  const protectedX = new Set<number>();
  const protectedY = new Set<number>();
  const rawX: number[] = [];
  const rawY: number[] = [];

  for (const p of [...startPorts, ...goalPorts]) {
    const sx = Math.round(p.stub.x * 100) / 100;
    const sy = Math.round(p.stub.y * 100) / 100;
    protectedX.add(sx);
    protectedY.add(sy);
    rawX.push(sx);
    rawY.push(sy);
  }

  const winMinX = Math.max(
    minBoundX,
    Math.min(srcNode.x, tgtNode.x) - 280,
  );
  const winMaxX = Math.min(
    maxBoundX,
    Math.max(srcNode.x + srcNode.width, tgtNode.x + tgtNode.width) + 280,
  );
  const winMinY = Math.max(
    minBoundY,
    Math.min(srcNode.y, tgtNode.y) - 280,
  );
  const winMaxY = Math.min(
    maxBoundY,
    Math.max(srcNode.y + srcNode.height, tgtNode.y + tgtNode.height) + 280,
  );

  for (const n of absNodes.values()) {
    if (
      n.x + n.width < winMinX - 80 ||
      n.x > winMaxX + 80 ||
      n.y + n.height < winMinY - 80 ||
      n.y > winMaxY + 80
    ) {
      continue;
    }
    rawX.push(
      n.x - 24,
      n.x - 46,
      n.x + n.width + 24,
      n.x + n.width + 46,
    );
    rawY.push(
      n.y - 24,
      n.y - 46,
      n.y + n.height + 24,
      n.y + n.height + 46,
    );
    if (n.ast.type === 'compound' || n.ast.type === 'parallel') {
      rawX.push(n.x + 26, n.x + n.width - 26);
      rawY.push(
        n.y + n.headerHeight + n.compartmentHeight + 24,
        n.y + n.height - 26,
      );
    }
  }

  const buildCompactAxis = (
    vals: number[],
    prot: Set<number>,
    lo: number,
    hi: number,
  ): number[] => {
    const clamped = vals
      .map((v) => Math.round(v * 100) / 100)
      .filter((v) => prot.has(v) || (v >= lo && v <= hi))
      .sort((a, b) => a - b);
    const dedup: number[] = [];
    for (const v of clamped) {
      if (prot.has(v)) {
        if (dedup.length > 0 && Math.abs(dedup[dedup.length - 1] - v) < 0.05) {
          continue;
        }
        if (
          dedup.length > 0 &&
          !prot.has(dedup[dedup.length - 1]) &&
          Math.abs(dedup[dedup.length - 1] - v) < 5
        ) {
          dedup[dedup.length - 1] = v;
        } else {
          dedup.push(v);
        }
      } else {
        if (dedup.length === 0 || Math.abs(dedup[dedup.length - 1] - v) >= 6) {
          dedup.push(v);
        }
      }
    }
    // Add midpoints across wide gaps so open corridors always have a centered lane
    const withMids: number[] = [];
    for (let i = 0; i < dedup.length; i++) {
      withMids.push(dedup[i]);
      if (i + 1 < dedup.length && dedup[i + 1] - dedup[i] >= 36) {
        withMids.push(Math.round(((dedup[i] + dedup[i + 1]) / 2) * 100) / 100);
      }
    }
    return withMids;
  };

  const xs = buildCompactAxis(rawX, protectedX, winMinX, winMaxX);
  const ys = buildCompactAxis(rawY, protectedY, winMinY, winMaxY);
  const nx = xs.length;
  const ny = ys.length;

  const findExactOrNearest = (arr: number[], v: number): number => {
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < arr.length; i++) {
      const d = Math.abs(arr[i] - v);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    return bestI;
  };

  // Pre-collect existing orthogonal segments in window for fast penalty evaluation
  const foreignSegs: Array<{
    horiz: boolean;
    coord: number;
    lo: number;
    hi: number;
  }> = [];
  for (const e of existingEdges) {
    for (const br of e.branches) {
      for (let s = 0; s < br.length - 1; s++) {
        const p1 = br[s];
        const p2 = br[s + 1];
        if (Math.abs(p1.y - p2.y) < 1) {
          const lo = Math.min(p1.x, p2.x);
          const hi = Math.max(p1.x, p2.x);
          if (hi >= winMinX - 40 && lo <= winMaxX + 40) {
            foreignSegs.push({ horiz: true, coord: p1.y, lo, hi });
          }
        } else if (Math.abs(p1.x - p2.x) < 1) {
          const lo = Math.min(p1.y, p2.y);
          const hi = Math.max(p1.y, p2.y);
          if (hi >= winMinY - 40 && lo <= winMaxY + 40) {
            foreignSegs.push({ horiz: false, coord: p1.x, lo, hi });
          }
        }
      }
    }
  }

  const stateCount = nx * ny * 5;
  const distArr = new Float64Array(stateCount).fill(Infinity);
  const prevArr = new Int32Array(stateCount).fill(-1);
  const originPortArr = new Int32Array(stateCount).fill(-1);
  const visited = new Uint8Array(stateCount);

  const heapStates: number[] = [];
  const heapCosts: number[] = [];
  const heapPush = (st: number, cost: number) => {
    let idx = heapStates.length;
    heapStates.push(st);
    heapCosts.push(cost);
    while (idx > 0) {
      const p = (idx - 1) >> 1;
      if (heapCosts[p] <= cost) break;
      heapStates[idx] = heapStates[p];
      heapCosts[idx] = heapCosts[p];
      idx = p;
    }
    heapStates[idx] = st;
    heapCosts[idx] = cost;
  };
  const heapPop = (): number => {
    const top = heapStates[0];
    const lastSt = heapStates.pop()!;
    const lastCost = heapCosts.pop()!;
    if (heapStates.length > 0) {
      let idx = 0;
      const len = heapStates.length;
      for (;;) {
        const l = (idx << 1) + 1;
        const rIdx = l + 1;
        let smallest = idx;
        if (l < len && heapCosts[l] < lastCost) smallest = l;
        if (
          rIdx < len &&
          heapCosts[rIdx] < (smallest === idx ? lastCost : heapCosts[smallest])
        ) {
          smallest = rIdx;
        }
        if (smallest === idx) break;
        heapStates[idx] = heapStates[smallest];
        heapCosts[idx] = heapCosts[smallest];
        idx = smallest;
      }
      heapStates[idx] = lastSt;
      heapCosts[idx] = lastCost;
    }
    return top;
  };

  for (let pIdx = 0; pIdx < startPorts.length; pIdx++) {
    const sp = startPorts[pIdx];
    const sx = findExactOrNearest(xs, sp.stub.x);
    const sy = findExactOrNearest(ys, sp.stub.y);
    const st = (sy * nx + sx) * 5 + sp.dirCode;
    const initCost = pIdx * 4;
    if (initCost < distArr[st]) {
      distArr[st] = initCost;
      originPortArr[st] = pIdx;
      heapPush(st, initCost);
    }
  }

  const goalByCell = new Map<number, number[]>();
  for (let gIdx = 0; gIdx < goalPorts.length; gIdx++) {
    const gp = goalPorts[gIdx];
    const gx = findExactOrNearest(xs, gp.stub.x);
    const gy = findExactOrNearest(ys, gp.stub.y);
    const cell = gy * nx + gx;
    const list = goalByCell.get(cell) ?? [];
    list.push(gIdx);
    goalByCell.set(cell, list);
  }

  const dirs = [
    { dx: 1, dy: 0, code: 1, opp: 2 },
    { dx: -1, dy: 0, code: 2, opp: 1 },
    { dx: 0, dy: 1, code: 3, opp: 4 },
    { dx: 0, dy: -1, code: 4, opp: 3 },
  ];

  let bestGoalState = -1;
  let bestGoalPortIdx = -1;
  let bestTotalCost = Infinity;

  while (heapStates.length > 0) {
    const u = heapPop();
    if (visited[u]) continue;
    visited[u] = 1;
    const dU = distArr[u];
    if (dU >= bestTotalCost) break;

    const uDir = u % 5;
    const cell = (u - uDir) / 5;
    const gList = goalByCell.get(cell);
    if (gList) {
      for (const gIdx of gList) {
        const gp = goalPorts[gIdx];
        // Disallow 180-degree reversal into the stub
        if (uDir === gp.dirCode) continue;
        const total = dU + gIdx * 4;
        if (total < bestTotalCost) {
          bestTotalCost = total;
          bestGoalState = u;
          bestGoalPortIdx = gIdx;
        }
      }
    }

    const ux = cell % nx;
    const uy = (cell - ux) / nx;
    const pA: Point = { x: xs[ux], y: ys[uy] };

    for (const mv of dirs) {
      if (uDir === mv.opp) continue;
      const vx = ux + mv.dx;
      const vy = uy + mv.dy;
      if (vx < 0 || vx >= nx || vy < 0 || vy >= ny) continue;
      const vState = (vy * nx + vx) * 5 + mv.code;
      if (visited[vState]) continue;

      const pB: Point = { x: xs[vx], y: ys[vy] };
      if (!segAllowed(pA, pB, false)) continue;

      const horiz = mv.dy === 0;
      const segLo = horiz ? Math.min(pA.x, pB.x) : Math.min(pA.y, pB.y);
      const segHi = horiz ? Math.max(pA.x, pB.x) : Math.max(pA.y, pB.y);
      const segCoord = horiz ? pA.y : pA.x;

      let stepCost =
        Math.abs(pB.x - pA.x) +
        Math.abs(pB.y - pA.y) +
        (uDir !== 0 && uDir !== mv.code ? 32 : 0);

      for (const fs of foreignSegs) {
        if (fs.horiz === horiz) {
          const ov = Math.min(segHi, fs.hi) - Math.max(segLo, fs.lo);
          if (ov > 4) {
            const perp = Math.abs(segCoord - fs.coord);
            if (perp < 19.5) {
              stepCost += 400_000 + (19.5 - perp) * 5000;
            }
          }
        } else {
          if (
            fs.coord > segLo + 0.5 &&
            fs.coord < segHi - 0.5 &&
            segCoord > fs.lo + 0.5 &&
            segCoord < fs.hi - 0.5
          ) {
            stepCost += 120;
          }
        }
      }

      if (horiz) {
        for (const anc of singleAncestors) {
          if (segHi > anc.x && segLo < anc.x + anc.width) {
            if (
              Math.abs(segCoord - anc.y) < 18 ||
              Math.abs(segCoord - (anc.y + anc.height)) < 18
            ) {
              stepCost += 600;
            }
          }
        }
      }

      const nd = dU + stepCost;
      if (nd < distArr[vState]) {
        distArr[vState] = nd;
        prevArr[vState] = u;
        originPortArr[vState] = originPortArr[u];
        heapPush(vState, nd);
      }
    }
  }

  if (bestGoalState !== -1 && bestGoalPortIdx !== -1) {
    const sPort = startPorts[originPortArr[bestGoalState]];
    const gPort = goalPorts[bestGoalPortIdx];
    const mid: Point[] = [];
    let cur = bestGoalState;
    while (cur !== -1) {
      const cDir = cur % 5;
      const cell = (cur - cDir) / 5;
      const cxIdx = cell % nx;
      const cyIdx = (cell - cxIdx) / nx;
      mid.push({ x: xs[cxIdx], y: ys[cyIdx] });
      cur = prevArr[cur];
    }
    mid.reverse();
    return simplifyOrthogonalPolyline([sPort.pt, ...mid, gPort.pt]);
  }

  const fallback = snapEdgeEndpoints(
    srcNode,
    tgtNode,
    [startPorts[0].pt, startPorts[0].stub, goalPorts[0].stub, goalPorts[0].pt],
    ast,
  );
  return rerouteAroundPiercedObstacles(
    sourceId,
    targetId,
    fallback,
    absNodes,
    ast,
    theme,
  );
}

/**
 * Reroutes multi-edge bundles (`k >= 3` transitions between the same state pair)
 * when ELK's `INCLUDE_CHILDREN` router wrapped them thousands of pixels around an
 * outer container instead of using a direct, non-crossing `>= 40px`-spaced parallel
 * orthogonal fan/U-corridor between the two states.
 */
function rerouteWraparoundMultiEdgeBundles(
  edges: PositionedEdge[],
  absNodes: Map<string, PositionedNode>,
  ast: StatechartAST,
  theme: ThemeTokens,
): void {
  const exactAxisDist = (
    a1: Point,
    a2: Point,
    b1: Point,
    b2: Point,
  ): number => {
    const minAX = Math.min(a1.x, a2.x);
    const maxAX = Math.max(a1.x, a2.x);
    const minAY = Math.min(a1.y, a2.y);
    const maxAY = Math.max(a1.y, a2.y);
    const minBX = Math.min(b1.x, b2.x);
    const maxBX = Math.max(b1.x, b2.x);
    const minBY = Math.min(b1.y, b2.y);
    const maxBY = Math.max(b1.y, b2.y);
    const dx = Math.max(0, minAX - maxBX, minBX - maxAX);
    const dy = Math.max(0, minAY - maxBY, minBY - maxAY);
    return Math.hypot(dx, dy);
  };

  const orthoPolyDist = (pA: Point[], pB: Point[]): number => {
    let best = Infinity;
    for (let i = 0; i < pA.length - 1; i++) {
      for (let j = 0; j < pB.length - 1; j++) {
        const d = exactAxisDist(pA[i], pA[i + 1], pB[j], pB[j + 1]);
        if (d < best) {
          best = d;
          if (best === 0) return 0;
        }
      }
    }
    return best;
  };

  const byPair = new Map<string, PositionedEdge[]>();
  for (const edge of edges) {
    if (edge.branches.length !== 1) continue;
    const tid = edge.ast.targetIds[0];
    if (!tid || tid === edge.ast.sourceId) continue;
    const key = [edge.ast.sourceId, tid].sort().join('::');
    const list = byPair.get(key) ?? [];
    list.push(edge);
    byPair.set(key, list);
  }

  for (const [pairKey, group] of byPair.entries()) {
    const k = group.length;
    if (k < 2) continue;

    const [idA, idB] = pairKey.split('::');
    const nodeA = absNodes.get(idA);
    const nodeB = absNodes.get(idB);
    if (!nodeA || !nodeB) continue;

    const cxA = nodeA.x + nodeA.width / 2;
    const cyA = nodeA.y + nodeA.height / 2;
    const cxB = nodeB.x + nodeB.width / 2;
    const cyB = nodeB.y + nodeB.height / 2;
    const manhattan = Math.abs(cxA - cxB) + Math.abs(cyA - cyB);
    const maxLen = Math.max(
      ...group.map((e) => polylineLength(e.branches[0])),
    );

    if (maxLen <= manhattan + 1800 || maxLen <= manhattan * 1.55) {
      continue;
    }

    // Orient from `rightNode` (larger center X) to `leftNode` (smaller center X)
    const rightNode = cxA >= cxB ? nodeA : nodeB;
    const leftNode = cxA >= cxB ? nodeB : nodeA;
    const rightId = rightNode.ast.id;
    const leftId = leftNode.ast.id;
    if (
      isAncestorInAst(rightId, leftId, ast) ||
      isAncestorInAst(leftId, rightId, ast)
    ) {
      continue;
    }

    const groupSet = new Set<PositionedEdge>(group);
    const foreignEdges = edges.filter((e) => !groupSet.has(e));

    // Build forbidden rects + ancestor border constraints
    const forbiddenRects: Rect[] = [];
    const sharedAncestors: PositionedNode[] = [];
    const singleAncestors: PositionedNode[] = [];

    for (const node of absNodes.values()) {
      const uid = node.ast.id;
      const ancR = isAncestorInAst(uid, rightId, ast);
      const ancL = isAncestorInAst(uid, leftId, ast);
      if (!ancR && !ancL) {
        if (uid === rightId || uid === leftId) {
          if (node.width > 8 && node.height > 8) {
            forbiddenRects.push({
              x: node.x + 2,
              y: node.y + 2,
              width: node.width - 4,
              height: node.height - 4,
            });
          }
        } else {
          forbiddenRects.push({
            x: node.x - 4,
            y: node.y - 4,
            width: node.width + 8,
            height: node.height + 8,
          });
        }
      } else if (ancR && ancL) {
        sharedAncestors.push(node);
        forbiddenRects.push({
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.headerHeight + node.compartmentHeight + 8,
        });
      } else {
        singleAncestors.push(node);
        const titleW = measureTextWidth(node.ast.key, {
          fontFamily: 'sans',
          fontSize: theme.fontSizes.stateTitle,
          bold: true,
        });
        forbiddenRects.push({
          x: node.x + 6,
          y: node.y,
          width: Math.min(node.width - 12, titleW + 20),
          height: node.headerHeight + 2,
        });
        if (node.compartmentHeight > 0) {
          forbiddenRects.push({
            x: node.x + 4,
            y: node.y + node.headerHeight - 1,
            width: node.width - 8,
            height: node.compartmentHeight + 4,
          });
        }
      }
    }

    const isBundleClean = (polys: Point[][]): boolean => {
      if (polys.length !== k) return false;

      // 1. Check sibling pairwise channel clearance >= 36px
      for (let i = 0; i < k; i++) {
        if (polys[i].length < 2) return false;
        for (let j = i + 1; j < k; j++) {
          if (orthoPolyDist(polys[i], polys[j]) < 36) return false;
        }
      }

      for (const rawPoly of polys) {
        const poly = simplifyOrthogonalPolyline(rawPoly);

        // 2. Shared ancestor strict containment (>= 20px inset from border & header band)
        for (const anc of sharedAncestors) {
          const minY = anc.y + anc.headerHeight + anc.compartmentHeight + 16;
          const maxY = anc.y + anc.height - 20;
          const minX = anc.x + 20;
          const maxX = anc.x + anc.width - 20;
          for (const p of poly) {
            if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) {
              return false;
            }
          }
        }

        // 3. Single-endpoint ancestor border clearance for horizontal label lanes
        for (const anc of singleAncestors) {
          for (let s = 0; s < poly.length - 1; s++) {
            const a = poly[s];
            const b = poly[s + 1];
            if (Math.abs(a.y - b.y) < 1 && Math.abs(b.x - a.x) > 45) {
              const segMinX = Math.min(a.x, b.x);
              const segMaxX = Math.max(a.x, b.x);
              if (segMaxX > anc.x && segMinX < anc.x + anc.width) {
                if (
                  Math.abs(a.y - anc.y) < 18 ||
                  Math.abs(a.y - (anc.y + anc.height)) < 18
                ) {
                  return false;
                }
              }
            }
          }
        }

        // 4. Forbidden obstacle piercing check (3.5px sampling)
        const totalLen = polylineLength(poly);
        for (let d = 7; d < totalLen - 7; d += 3.5) {
          const pt = pointAtPolylineLength(poly, d);
          for (const obs of forbiddenRects) {
            if (
              pt.x >= obs.x &&
              pt.x <= obs.x + obs.width &&
              pt.y >= obs.y &&
              pt.y <= obs.y + obs.height
            ) {
              return false;
            }
          }
        }

        // 5. Foreign edge parallel clearance & port spacing
        const pStart = poly[0];
        const pEnd = poly[poly.length - 1];
        for (const fe of foreignEdges) {
          for (let fb = 0; fb < fe.branches.length; fb++) {
            const fbr = fe.branches[fb];
            if (fbr.length < 2) continue;
            const fTid = fe.ast.targetIds[fb] ?? fe.ast.sourceId;
            if (
              fe.ast.sourceId === rightId &&
              Math.hypot(fbr[0].x - pStart.x, fbr[0].y - pStart.y) < 18
            ) {
              return false;
            }
            if (
              fTid === rightId &&
              Math.hypot(
                fbr[fbr.length - 1].x - pStart.x,
                fbr[fbr.length - 1].y - pStart.y,
              ) < 18
            ) {
              return false;
            }
            if (
              fe.ast.sourceId === leftId &&
              Math.hypot(fbr[0].x - pEnd.x, fbr[0].y - pEnd.y) < 18
            ) {
              return false;
            }
            if (
              fTid === leftId &&
              Math.hypot(
                fbr[fbr.length - 1].x - pEnd.x,
                fbr[fbr.length - 1].y - pEnd.y,
              ) < 18
            ) {
              return false;
            }

            for (let s = 0; s < poly.length - 1; s++) {
              const a1 = poly[s];
              const a2 = poly[s + 1];
              const aHoriz = Math.abs(a1.y - a2.y) < 1;
              for (let fs = 0; fs < fbr.length - 1; fs++) {
                const b1 = fbr[fs];
                const b2 = fbr[fs + 1];
                const bHoriz = Math.abs(b1.y - b2.y) < 1;
                const bVert = Math.abs(b1.x - b2.x) < 1;
                if (aHoriz && bHoriz) {
                  const ov =
                    Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x)) -
                    Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x));
                  if (ov > 6 && Math.abs(a1.y - b1.y) < 19.5) return false;
                } else if (!aHoriz && bVert) {
                  const ov =
                    Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y)) -
                    Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y));
                  if (ov > 6 && Math.abs(a1.x - b1.x) < 19.5) return false;
                }
              }
            }
          }
        }
      }

      return true;
    };

    const rLeft = rightNode.x;
    const rRight = rightNode.x + rightNode.width;
    const rBottom = rightNode.y + rightNode.height;
    const rMargin = Math.max(nodeCornerMargin(rightNode), 22);
    const rAvailW = rightNode.width - rMargin * 2;

    const lLeft = leftNode.x;
    const lRight = leftNode.x + leftNode.width;
    const lTop = leftNode.y;
    const lBottom = leftNode.y + leftNode.height;
    const lCx = lLeft + leftNode.width / 2;
    const lCy = lTop + leftNode.height / 2;

    // Build source departure prefixes (Option S1: BOTTOM wall, Option S2: RIGHT wall)
    const sourcePrefixesList: Array<Array<{ prefix: Point[]; xShaft: number }>> =
      [];
    if (rAvailW >= (k - 1) * 38) {
      const bottomPrefixes: Array<{ prefix: Point[]; xShaft: number }> = [];
      const shaftStep = Math.min(42, k > 1 ? rAvailW / (k - 1) : 0);
      for (let i = 0; i < k; i++) {
        const xS = rLeft + rMargin + i * shaftStep;
        bottomPrefixes.push({
          prefix: [{ x: xS, y: rBottom }],
          xShaft: xS,
        });
      }
      sourcePrefixesList.push(bottomPrefixes);
    }
    {
      const rYRange = nodeAllowedYRange(rightNode, false);
      const availH = rYRange.maxY - rYRange.minY;
      if (availH >= (k - 1) * 24) {
        const rightPrefixes: Array<{ prefix: Point[]; xShaft: number }> = [];
        for (let i = 0; i < k; i++) {
          // i = 0 lowest on right wall -> innermost xShaft; i = k-1 highest -> outermost xShaft
          const yDep = rYRange.maxY - (i * availH) / (k - 1);
          const xShaft = rRight + 28 + i * 40;
          rightPrefixes.push({
            prefix: [
              { x: rRight, y: yDep },
              { x: xShaft, y: yDep },
            ],
            xShaft,
          });
        }
        sourcePrefixesList.push(rightPrefixes);
      }
    }

    const candidatesToTry: Point[][][] = [];

    // Candidate Family 1: Direct L-Fan when `rightNode` sits well above `leftNode`
    if (
      rBottom + 44 < lTop - 28 &&
      leftNode.height >= Math.max(40, (k - 2) * 40 + 28)
    ) {
      for (const srcPrefixes of sourcePrefixesList) {
        const polys: Point[][] = [];
        const y0 = lTop - 28;
        const xTopEntry = lCx - 16;
        polys.push(
          simplifyOrthogonalPolyline([
            ...srcPrefixes[0].prefix,
            { x: srcPrefixes[0].xShaft, y: y0 },
            { x: xTopEntry, y: y0 },
            { x: xTopEntry, y: lTop },
          ]),
        );
        const sideCount = k - 1;
        const sideAvailH = leftNode.height - 28;
        const sideStep = Math.min(
          42,
          sideCount > 1 ? sideAvailH / (sideCount - 1) : 0,
        );
        for (let i = 1; i < k; i++) {
          const yLane = Math.max(y0 + 40, lTop + 14 + (i - 1) * sideStep);
          polys.push(
            simplifyOrthogonalPolyline([
              ...srcPrefixes[i].prefix,
              { x: srcPrefixes[i].xShaft, y: yLane },
              { x: lRight, y: yLane },
            ]),
          );
        }
        candidatesToTry.push(polys);
      }
    }

    // Candidate Family 2: Bottom U-Fan below intervening obstacles inside shared ancestors
    {
      let sharedMinX = -Infinity;
      let sharedMaxX = Infinity;
      let sharedMaxY = Infinity;
      for (const anc of sharedAncestors) {
        sharedMinX = Math.max(sharedMinX, anc.x);
        sharedMaxX = Math.min(sharedMaxX, anc.x + anc.width);
        sharedMaxY = Math.min(sharedMaxY, anc.y + anc.height);
      }

      const spanMinX = Math.max(sharedMinX, lLeft - 90);
      const spanMaxX = Math.min(sharedMaxX, rRight + 90);
      let maxObsBottom = Math.max(rBottom, lBottom);

      for (const node of absNodes.values()) {
        const uid = node.ast.id;
        if (
          isAncestorInAst(uid, rightId, ast) &&
          isAncestorInAst(uid, leftId, ast)
        ) {
          continue;
        }
        if (node.x + node.width < spanMinX || node.x > spanMaxX) continue;
        if (node.y + node.height > sharedMaxY - 4) continue;
        maxObsBottom = Math.max(maxObsBottom, node.y + node.height);
      }

      for (const fe of foreignEdges) {
        for (const fbr of fe.branches) {
          for (let fs = 0; fs < fbr.length - 1; fs++) {
            const p1 = fbr[fs];
            const p2 = fbr[fs + 1];
            if (Math.abs(p1.y - p2.y) < 1) {
              const segLo = Math.min(p1.x, p2.x);
              const segHi = Math.max(p1.x, p2.x);
              if (
                segHi >= spanMinX &&
                segLo <= spanMaxX &&
                p1.y <= maxObsBottom + 60 &&
                p1.y >= Math.min(rightNode.y, leftNode.y)
              ) {
                maxObsBottom = Math.max(maxObsBottom, p1.y);
              }
            }
          }
        }
      }

      const baseY = maxObsBottom + 38;
      const stepY = 42;

      for (const srcPrefixes of sourcePrefixesList) {
        // Build `k` nested target risers around `leftNode` (strictly decreasing X)
        const targetTails: Array<{ xRiser: number; tail: Point[] }> = [];
        if (k >= 5 && leftNode.width >= 150 && leftNode.height >= 140) {
          targetTails.push({
            xRiser: lRight + 68,
            tail: [
              { x: lRight + 68, y: lCy - 44 },
              { x: lRight, y: lCy - 44 },
            ],
          });
          targetTails.push({
            xRiser: lRight + 26,
            tail: [
              { x: lRight + 26, y: lCy + 16 },
              { x: lRight, y: lCy + 16 },
            ],
          });
          const mBot = k - 2;
          const bMargin = 22;
          const bAvail = leftNode.width - bMargin * 2;
          for (let b = 0; b < mBot; b++) {
            const xB =
              lRight - bMargin - (mBot > 1 ? (b * bAvail) / (mBot - 1) : bAvail / 2);
            targetTails.push({
              xRiser: xB,
              tail: [{ x: xB, y: lBottom }],
            });
          }
        } else if (k === 4 && leftNode.width >= 130) {
          targetTails.push({
            xRiser: lRight + 28,
            tail: [
              { x: lRight + 28, y: lCy },
              { x: lRight, y: lCy },
            ],
          });
          const bMargin = 20;
          const bAvail = leftNode.width - bMargin * 2;
          for (let b = 0; b < 3; b++) {
            const xB = lRight - bMargin - (b * bAvail) / 2;
            targetTails.push({
              xRiser: xB,
              tail: [{ x: xB, y: lBottom }],
            });
          }
        } else if (leftNode.width >= (k - 1) * 40 + 32) {
          const bMargin = 16;
          const bAvail = leftNode.width - bMargin * 2;
          for (let b = 0; b < k; b++) {
            const xB = lRight - bMargin - (b * bAvail) / (k - 1);
            targetTails.push({
              xRiser: xB,
              tail: [{ x: xB, y: lBottom }],
            });
          }
        }

        if (targetTails.length === k) {
          const polys: Point[][] = [];
          for (let i = 0; i < k; i++) {
            const yLane = baseY + i * stepY;
            polys.push(
              simplifyOrthogonalPolyline([
                ...srcPrefixes[i].prefix,
                { x: srcPrefixes[i].xShaft, y: yLane },
                { x: targetTails[i].xRiser, y: yLane },
                ...targetTails[i].tail,
              ]),
            );
          }
          candidatesToTry.push(polys);
        }
      }
    }

    for (const cand of candidatesToTry) {
      if (isBundleClean(cand)) {
        for (let i = 0; i < k; i++) {
          const e = group[i];
          e.branches[0] =
            e.ast.sourceId === rightId ? cand[i] : cand[i].slice().reverse();
        }
        break;
      }
    }
  }
}

/**
 * Shrinks haloed circular history nodes (`width > 45` during ELK layout) to their
 * centered `38x38` (`r = 19`) circle and routes all incident ELK halo-border endpoints
 * across the empty halo annulus onto `>= 19px`-separated hexagonal orthogonal circle ports.
 */
function connectHaloEdgesToHistoryCircles(
  edges: PositionedEdge[],
  absNodes: Map<string, PositionedNode>,
): void {
  const wrapAngle = (a: number): number => {
    let w = a;
    while (w <= -Math.PI) w += Math.PI * 2;
    while (w > Math.PI) w -= Math.PI * 2;
    return w;
  };

  const exactAxisSegDist = (
    a1: Point,
    a2: Point,
    b1: Point,
    b2: Point,
  ): number => {
    const minAX = Math.min(a1.x, a2.x);
    const maxAX = Math.max(a1.x, a2.x);
    const minAY = Math.min(a1.y, a2.y);
    const maxAY = Math.max(a1.y, a2.y);
    const minBX = Math.min(b1.x, b2.x);
    const maxBX = Math.max(b1.x, b2.x);
    const minBY = Math.min(b1.y, b2.y);
    const maxBY = Math.max(b1.y, b2.y);
    const dx = Math.max(0, minAX - maxBX, minBX - maxAX);
    const dy = Math.max(0, minAY - maxBY, minBY - maxAY);
    return Math.hypot(dx, dy);
  };

  const segDistToOrthoPoly = (a: Point, b: Point, poly: Point[]): number => {
    let best = Infinity;
    for (let k = 0; k < poly.length - 1; k++) {
      const d = exactAxisSegDist(a, b, poly[k], poly[k + 1]);
      if (d < best) {
        best = d;
        if (best === 0) return 0;
      }
    }
    return best;
  };

  for (const histNode of absNodes.values()) {
    if (
      histNode.ast.type !== 'history' ||
      histNode.ast.key !== 'history' ||
      histNode.width <= 45
    ) {
      continue;
    }

    const halo: Rect = {
      x: histNode.x,
      y: histNode.y,
      width: histNode.width,
      height: histNode.height,
    };
    const d = 38;
    const r = d / 2; // 19px
    const hCx = halo.x + halo.width / 2;
    const hCy = halo.y + halo.height / 2;

    // Shrink `histNode` to its centered 38x38 circle
    histNode.x = hCx - r;
    histNode.y = hCy - r;
    histNode.width = d;
    histNode.height = d;

    interface IncidentEndpoint {
      edge: PositionedEdge;
      branchIdx: number;
      isStart: boolean;
      pairKey: string;
      ptHalo: Point;
      pEntry: Point;
      angle: number;
    }

    const incidents: IncidentEndpoint[] = [];
    for (const edge of edges) {
      for (let b = 0; b < edge.branches.length; b++) {
        const br = edge.branches[b];
        if (br.length < 2) continue;
        const tid = edge.ast.targetIds[b] ?? edge.ast.sourceId;
        const pKey = [edge.ast.sourceId, tid].sort().join('::');

        const addEnd = (isStart: boolean) => {
          const ptHalo = isStart ? { ...br[0] } : { ...br[br.length - 1] };
          const dL = Math.abs(ptHalo.x - halo.x);
          const dR = Math.abs(ptHalo.x - (halo.x + halo.width));
          const dT = Math.abs(ptHalo.y - halo.y);
          const dB = Math.abs(ptHalo.y - (halo.y + halo.height));
          const m = Math.min(dL, dR, dT, dB);
          let pEntry: Point;
          if (m === dL) pEntry = { x: halo.x + 8, y: ptHalo.y };
          else if (m === dR) pEntry = { x: halo.x + halo.width - 8, y: ptHalo.y };
          else if (m === dT) pEntry = { x: ptHalo.x, y: halo.y + 8 };
          else pEntry = { x: ptHalo.x, y: halo.y + halo.height - 8 };

          incidents.push({
            edge,
            branchIdx: b,
            isStart,
            pairKey: pKey,
            ptHalo,
            pEntry,
            angle: Math.atan2(ptHalo.y - hCy, ptHalo.x - hCx),
          });
        };

        if (edge.ast.sourceId === histNode.ast.id) addEnd(true);
        if (tid === histNode.ast.id) addEnd(false);
      }
    }

    if (incidents.length === 0) continue;
    incidents.sort((a, b) => a.angle - b.angle);

    // Build 6 hexagonal orthogonal ports on the r=19 circle (each pair >= 19.0px apart)
    const off = 9.5;
    const rad = Math.sqrt(r * r - off * off);
    const stubOut = 16;
    interface CirclePort {
      pt: Point;
      stub: Point;
      angle: number;
    }
    const basePorts: CirclePort[] = [
      {
        pt: { x: hCx - off, y: hCy - rad },
        stub: { x: hCx - off, y: hCy - r - stubOut },
        angle: Math.atan2(-rad, -off),
      },
      {
        pt: { x: hCx + off, y: hCy - rad },
        stub: { x: hCx + off, y: hCy - r - stubOut },
        angle: Math.atan2(-rad, off),
      },
      {
        pt: { x: hCx + r, y: hCy },
        stub: { x: hCx + r + stubOut, y: hCy },
        angle: 0,
      },
      {
        pt: { x: hCx + off, y: hCy + rad },
        stub: { x: hCx + off, y: hCy + r + stubOut },
        angle: Math.atan2(rad, off),
      },
      {
        pt: { x: hCx - off, y: hCy + rad },
        stub: { x: hCx - off, y: hCy + r + stubOut },
        angle: Math.atan2(rad, -off),
      },
      {
        pt: { x: hCx - r, y: hCy },
        stub: { x: hCx - r - stubOut, y: hCy },
        angle: Math.PI,
      },
    ];

    const m = incidents.length;
    let assignedPorts: CirclePort[] = [];
    if (m <= basePorts.length) {
      let bestCost = Infinity;
      const chooseSubset = (start: number, chosen: number[]) => {
        if (chosen.length === m) {
          for (let rot = 0; rot < m; rot++) {
            let cost = 0;
            for (let i = 0; i < m; i++) {
              const p = basePorts[chosen[(i + rot) % m]];
              cost += Math.abs(wrapAngle(incidents[i].angle - p.angle));
            }
            if (cost < bestCost) {
              bestCost = cost;
              assignedPorts = [];
              for (let i = 0; i < m; i++) {
                assignedPorts.push(basePorts[chosen[(i + rot) % m]]);
              }
            }
          }
          return;
        }
        for (let idx = start; idx < basePorts.length; idx++) {
          chosen.push(idx);
          chooseSubset(idx + 1, chosen);
          chosen.pop();
        }
      };
      chooseSubset(0, []);
    } else {
      for (let i = 0; i < m; i++) {
        assignedPorts.push(basePorts[i % basePorts.length]);
      }
    }

    // Build compact Hanan grid inside `halo` (6px lattice + exact entry/stub coordinates)
    const xSet = new Set<number>();
    const ySet = new Set<number>();
    for (let x = halo.x + 8; x <= halo.x + halo.width - 8; x += 6) {
      xSet.add(Math.round(x * 100) / 100);
    }
    for (let y = halo.y + 8; y <= halo.y + halo.height - 8; y += 6) {
      ySet.add(Math.round(y * 100) / 100);
    }
    for (const inc of incidents) {
      xSet.add(Math.round(inc.pEntry.x * 100) / 100);
      ySet.add(Math.round(inc.pEntry.y * 100) / 100);
    }
    for (const p of assignedPorts) {
      xSet.add(Math.round(p.stub.x * 100) / 100);
      ySet.add(Math.round(p.stub.y * 100) / 100);
    }
    const xs = Array.from(xSet).sort((a, b) => a - b);
    const ys = Array.from(ySet).sort((a, b) => a - b);
    const nx = xs.length;
    const ny = ys.length;

    const findNearestIdx = (arr: number[], v: number): number => {
      let bestI = 0;
      let bestD = Infinity;
      for (let i = 0; i < arr.length; i++) {
        const dist = Math.abs(arr[i] - v);
        if (dist < bestD) {
          bestD = dist;
          bestI = i;
        }
      }
      return bestI;
    };

    const routeOrder = incidents
      .map((inc, i) => ({
        i,
        travel: Math.abs(wrapAngle(inc.angle - assignedPorts[i].angle)),
      }))
      .sort((a, b) => a.travel - b.travel);

    const routedAnnulusPolys: { pairKey: string; poly: Point[] }[] = [];

    for (const { i } of routeOrder) {
      const inc = incidents[i];
      const port = assignedPorts[i];

      const obstacles: { pairKey: string; poly: Point[] }[] = [
        ...routedAnnulusPolys,
      ];
      for (let j = 0; j < m; j++) {
        if (j === i) continue;
        obstacles.push({
          pairKey: incidents[j].pairKey,
          poly: [incidents[j].ptHalo, incidents[j].pEntry],
        });
        obstacles.push({
          pairKey: incidents[j].pairKey,
          poly: [assignedPorts[j].stub, assignedPorts[j].pt],
        });
      }

      const sx = findNearestIdx(xs, inc.pEntry.x);
      const sy = findNearestIdx(ys, inc.pEntry.y);
      const gx = findNearestIdx(xs, port.stub.x);
      const gy = findNearestIdx(ys, port.stub.y);

      const stateCount = nx * ny * 5;
      const distArr = new Float64Array(stateCount).fill(Infinity);
      const prevArr = new Int32Array(stateCount).fill(-1);
      const visited = new Uint8Array(stateCount);

      // Binary min-heap for O(E log V) Dijkstra (~1ms)
      const heapStates: number[] = [];
      const heapCosts: number[] = [];
      const heapPush = (st: number, cost: number) => {
        let idx = heapStates.length;
        heapStates.push(st);
        heapCosts.push(cost);
        while (idx > 0) {
          const p = (idx - 1) >> 1;
          if (heapCosts[p] <= cost) break;
          heapStates[idx] = heapStates[p];
          heapCosts[idx] = heapCosts[p];
          idx = p;
        }
        heapStates[idx] = st;
        heapCosts[idx] = cost;
      };
      const heapPop = (): number => {
        const top = heapStates[0];
        const lastSt = heapStates.pop()!;
        const lastCost = heapCosts.pop()!;
        if (heapStates.length > 0) {
          let idx = 0;
          const len = heapStates.length;
          for (;;) {
            const l = (idx << 1) + 1;
            const rIdx = l + 1;
            let smallest = idx;
            if (l < len && heapCosts[l] < lastCost) smallest = l;
            if (
              rIdx < len &&
              heapCosts[rIdx] <
                (smallest === idx ? lastCost : heapCosts[smallest])
            ) {
              smallest = rIdx;
            }
            if (smallest === idx) break;
            heapStates[idx] = heapStates[smallest];
            heapCosts[idx] = heapCosts[smallest];
            idx = smallest;
          }
          heapStates[idx] = lastSt;
          heapCosts[idx] = lastCost;
        }
        return top;
      };

      const startState = (sy * nx + sx) * 5 + 0;
      distArr[startState] = 0;
      heapPush(startState, 0);

      const dirs = [
        { dx: 1, dy: 0, code: 1, opp: 2 },
        { dx: -1, dy: 0, code: 2, opp: 1 },
        { dx: 0, dy: 1, code: 3, opp: 4 },
        { dx: 0, dy: -1, code: 4, opp: 3 },
      ];

      let bestGoalState = -1;
      while (heapStates.length > 0) {
        const u = heapPop();
        if (visited[u]) continue;
        visited[u] = 1;
        const bestD = distArr[u];

        const uDir = u % 5;
        const cell = (u - uDir) / 5;
        const ux = cell % nx;
        const uy = (cell - ux) / nx;
        if (ux === gx && uy === gy) {
          bestGoalState = u;
          break;
        }

        const pA: Point = { x: xs[ux], y: ys[uy] };
        for (const mv of dirs) {
          if (uDir === mv.opp) continue;
          const vx = ux + mv.dx;
          const vy = uy + mv.dy;
          if (vx < 0 || vx >= nx || vy < 0 || vy >= ny) continue;
          const vState = (vy * nx + vx) * 5 + mv.code;
          if (visited[vState]) continue;

          const pB: Point = { x: xs[vx], y: ys[vy] };
          const dCircle = distPointToSegment({ x: hCx, y: hCy }, pA, pB);
          if (dCircle < r + 2.5) continue;

          let stepCost =
            Math.abs(pB.x - pA.x) +
            Math.abs(pB.y - pA.y) +
            (uDir !== 0 && uDir !== mv.code ? 8 : 0);

          for (const obs of obstacles) {
            const req = obs.pairKey === inc.pairKey ? 17.0 : 8.5;
            const dObs = segDistToOrthoPoly(pA, pB, obs.poly);
            if (dObs < 1.5) {
              stepCost += 1_000_000;
            } else if (dObs < req) {
              stepCost += 50_000 + (req - dObs) * 5000;
            }
          }

          const nd = bestD + stepCost;
          if (nd < distArr[vState]) {
            distArr[vState] = nd;
            prevArr[vState] = u;
            heapPush(vState, nd);
          }
        }
      }

      const midPts: Point[] = [];
      if (bestGoalState !== -1) {
        let cur = bestGoalState;
        while (cur !== -1) {
          const cDir = cur % 5;
          const cell = (cur - cDir) / 5;
          const cxIdx = cell % nx;
          const cyIdx = (cell - cxIdx) / nx;
          midPts.push({ x: xs[cxIdx], y: ys[cyIdx] });
          cur = prevArr[cur];
        }
        midPts.reverse();
      } else {
        midPts.push(
          { ...inc.pEntry },
          { x: inc.pEntry.x, y: port.stub.y },
          { ...port.stub },
        );
      }

      const haloToCircle = simplifyOrthogonalPolyline([
        { ...inc.ptHalo },
        ...midPts,
        { ...port.pt },
      ]);
      routedAnnulusPolys.push({
        pairKey: inc.pairKey,
        poly: haloToCircle,
      });

      const br = inc.edge.branches[inc.branchIdx];
      if (inc.isStart) {
        const circleToHalo = haloToCircle.slice().reverse();
        inc.edge.branches[inc.branchIdx] = simplifyOrthogonalPolyline([
          ...circleToHalo,
          ...br.slice(1),
        ]);
      } else {
        inc.edge.branches[inc.branchIdx] = simplifyOrthogonalPolyline([
          ...br.slice(0, br.length - 1),
          ...haloToCircle,
        ]);
      }
    }
  }
}

/**
 * Unifies the start ports and initial trunk segment of multi-target fork hyperedges
 * (`targetIds.length >= 2`) so branches visibly share one source departure trunk
 * and fork junction before diverging to their orthogonal target states.
 */
function unifyHyperedgeTrunks(
  edges: PositionedEdge[],
  absNodes: Map<string, PositionedNode>,
  ast: StatechartAST,
  theme: ThemeTokens,
): void {
  const parallelOverlapPenalty = (
    poly: Point[],
    selfIdx: number,
  ): number => {
    let pen = 0;
    for (let i = 0; i < poly.length - 1; i++) {
      const a1 = poly[i];
      const a2 = poly[i + 1];
      const aHoriz = Math.abs(a1.y - a2.y) < 1;
      const aVert = Math.abs(a1.x - a2.x) < 1;
      if (!aHoriz && !aVert) continue;
      for (let j = 0; j < edges.length; j++) {
        if (j === selfIdx) continue;
        for (const fbr of edges[j].branches) {
          for (let k = 0; k < fbr.length - 1; k++) {
            const b1 = fbr[k];
            const b2 = fbr[k + 1];
            const bHoriz = Math.abs(b1.y - b2.y) < 1;
            const bVert = Math.abs(b1.x - b2.x) < 1;
            if (aHoriz && bHoriz) {
              const perp = Math.abs(a1.y - b1.y);
              const ov =
                Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x)) -
                Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x));
              if (ov > 6 && perp < 16) {
                pen += 500_000 + (16 - perp) * 10_000;
              }
            } else if (aVert && bVert) {
              const perp = Math.abs(a1.x - b1.x);
              const ov =
                Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y)) -
                Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y));
              if (ov > 6 && perp < 16) {
                pen += 500_000 + (16 - perp) * 10_000;
              }
            }
          }
        }
      }
    }
    return pen;
  };

  for (let eIdx = 0; eIdx < edges.length; eIdx++) {
    const edge = edges[eIdx];
    if (edge.branches.length < 2) continue;
    const srcNode = absNodes.get(edge.ast.sourceId);
    if (!srcNode || srcNode.ast.type === 'history') continue;

    const getStartSide = (
      p: Point,
    ): 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM' | null => {
      if (Math.abs(p.x - (srcNode.x + srcNode.width)) <= 4) return 'RIGHT';
      if (Math.abs(p.x - srcNode.x) <= 4) return 'LEFT';
      if (Math.abs(p.y - (srcNode.y + srcNode.height)) <= 4) return 'BOTTOM';
      if (Math.abs(p.y - srcNode.y) <= 4) return 'TOP';
      return null;
    };

    const sideCounts = new Map<'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM', number>();
    for (const br of edge.branches) {
      if (br.length < 2) continue;
      const s = getStartSide(br[0]);
      if (s) sideCounts.set(s, (sideCounts.get(s) ?? 0) + 1);
    }
    let side: 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM' = 'RIGHT';
    let bestCount = 0;
    for (const [s, cnt] of sideCounts.entries()) {
      if (cnt > bestCount) {
        bestCount = cnt;
        side = s;
      }
    }
    if (bestCount === 0) {
      const tgtCx =
        edge.ast.targetIds.reduce((acc, tid) => {
          const tn = absNodes.get(tid);
          return acc + (tn ? tn.x + tn.width / 2 : srcNode.x);
        }, 0) / edge.ast.targetIds.length;
      side = tgtCx >= srcNode.x + srcNode.width / 2 ? 'RIGHT' : 'LEFT';
    }

    const anyInward = edge.ast.targetIds.some((tid) =>
      isAncestorInAst(srcNode.ast.id, tid, ast),
    );
    const allInward = edge.ast.targetIds.every((tid) =>
      isAncestorInAst(srcNode.ast.id, tid, ast),
    );
    const margin = nodeCornerMargin(srcNode);
    const pillW = edge.label.width;
    const pillH = edge.label.height;

    const foreignPortsOnSrc: Point[] = [];
    for (let j = 0; j < edges.length; j++) {
      if (j === eIdx) continue;
      for (let b = 0; b < edges[j].branches.length; b++) {
        const fbr = edges[j].branches[b];
        if (fbr.length < 2) continue;
        if (edges[j].ast.sourceId === srcNode.ast.id) {
          foreignPortsOnSrc.push(fbr[0]);
        }
        const ftid = edges[j].ast.targetIds[b] ?? edges[j].ast.sourceId;
        if (ftid === srcNode.ast.id) {
          foreignPortsOnSrc.push(fbr[fbr.length - 1]);
        }
      }
    }

    if (side === 'RIGHT' || side === 'LEFT') {
      const yRange = nodeAllowedYRange(srcNode, anyInward);
      const avgY =
        edge.branches.reduce((acc, br) => acc + br[0].y, 0) /
        edge.branches.length;
      const startX = side === 'RIGHT' ? srcNode.x + srcNode.width : srcNode.x;
      const normalX =
        side === 'RIGHT' ? (allInward ? -1 : 1) : allInward ? 1 : -1;

      const yOffsets = [0, -6, 6, -12, 12, -18, 18, -24, 24, -30, 30];
      let bestBranches: Point[][] | null = null;
      let bestScore = Infinity;

      for (const dyOff of yOffsets) {
        const candY = clamp(avgY + dyOff, yRange.minY, yRange.maxY);
        const pStart: Point = { x: startX, y: candY };

        let portTooClose = false;
        for (const fp of foreignPortsOnSrc) {
          if (Math.hypot(fp.x - pStart.x, fp.y - pStart.y) < 14) {
            portTooClose = true;
            break;
          }
        }
        if (portTooClose) continue;

        let corridorMaxLen = 1800;
        for (const n of absNodes.values()) {
          if (
            n.ast.id === srcNode.ast.id ||
            isAncestorInAst(n.ast.id, srcNode.ast.id, ast)
          ) {
            continue;
          }
          if (
            candY + pillH / 2 + 4 < n.y - 10 ||
            candY - pillH / 2 - 4 > n.y + n.height + 10
          ) {
            continue;
          }
          const distToWall =
            normalX > 0
              ? n.x - 26 - startX
              : startX - (n.x + n.width + 26);
          if (distToWall > 8) {
            corridorMaxLen = Math.min(corridorMaxLen, distToWall);
          }
        }

        const baseTrunk = Math.min(
          Math.max(pillW + 48, 108),
          Math.max(36, corridorMaxLen),
        );
        const trunkCandidates = [
          baseTrunk,
          baseTrunk + 28,
          baseTrunk + 56,
          baseTrunk + 88,
        ].filter((L) => L >= 24 && L <= corridorMaxLen + 0.5);

        for (const trunkLen of trunkCandidates) {
          const forkX = startX + normalX * trunkLen;
          const pFork: Point = { x: forkX, y: candY };

          // Match each branch to its downstream horizontal corridor past `forkX`
          const branchSpecs = edge.branches.map((br, b) => {
            let matchIdx = -1;
            for (let s = 0; s < br.length - 1; s++) {
              if (
                Math.abs(br[s].y - br[s + 1].y) < 1 &&
                (br[s + 1].x - forkX) * normalX >= 32 &&
                Math.abs(br[s].y - candY) >= 12
              ) {
                matchIdx = s;
                break;
              }
            }
            const segY = matchIdx !== -1 ? br[matchIdx].y : br[Math.min(1, br.length - 1)].y;
            const vSign = Math.abs(segY - candY) < 2 ? 0 : segY > candY ? 1 : -1;
            return { b, br, matchIdx, segY, vSign, extraRank: 0 };
          });

          // Separate branches that turn vertically in the same direction so `pFork` stays a true fork
          for (const sign of [-1, 1]) {
            const sameSign = branchSpecs
              .filter((sp) => sp.vSign === sign)
              .sort((a, b) => Math.abs(b.segY - candY) - Math.abs(a.segY - candY));
            sameSign.forEach((sp, rIdx) => {
              sp.extraRank = rIdx;
            });
          }

          const built: Point[][] = new Array(edge.branches.length);
          let valid = true;
          let candScore =
            Math.abs(candY - avgY) * 2 + Math.abs(trunkLen - baseTrunk) * 0.4;

          for (const sp of branchSpecs) {
            const tid = edge.ast.targetIds[sp.b] ?? edge.ast.sourceId;
            const dropX = forkX + sp.extraRank * 36 * normalX;
            let raw: Point[];
            if (sp.matchIdx !== -1) {
              raw = [
                { ...pStart },
                { ...pFork },
                ...(sp.extraRank > 0 ? [{ x: dropX, y: candY }] : []),
                { x: dropX, y: sp.segY },
                ...sp.br.slice(sp.matchIdx + 1).map((p) => ({ ...p })),
              ];
            } else {
              raw = [
                { ...pStart },
                { ...pFork },
                ...(sp.extraRank > 0 ? [{ x: dropX, y: candY }] : []),
                { x: dropX, y: sp.segY },
                ...sp.br.slice(1).map((p) => ({ ...p })),
              ];
            }

            let unified = simplifyOrthogonalPolyline(raw);
            const rerouted = rerouteAroundPiercedObstacles(
              edge.ast.sourceId,
              tid,
              unified,
              absNodes,
              ast,
              theme,
            );
            if (rerouted !== unified) {
              candScore += 600_000;
              unified = rerouted;
            }
            if (
              unified.length < 2 ||
              Math.hypot(unified[0].x - pStart.x, unified[0].y - pStart.y) > 1 ||
              Math.abs(unified[1].y - candY) > 1 ||
              (unified[1].x - startX) * normalX < trunkLen - 1
            ) {
              valid = false;
              break;
            }
            candScore += parallelOverlapPenalty(unified, eIdx);
            built[sp.b] = unified;
          }
          if (!valid) continue;

          // Verify at least one clean pre-fork pill slot exists along `[pStart, pFork]`
          let bestSlotPen = 250_000;
          if (trunkLen >= pillW + 20) {
            for (const f of [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8]) {
              const cx = startX + normalX * (pillW / 2 + 10 + (trunkLen - pillW - 20) * f);
              const lRect: Rect = {
                x: cx - pillW / 2,
                y: candY - pillH / 2,
                width: pillW,
                height: pillH,
              };
              let slotPen = Math.abs(f - 0.5) * 10;
              for (let j = 0; j < edges.length; j++) {
                if (j === eIdx) continue;
                const dF = distRectToEdge(lRect, edges[j]);
                if (dF < 7) slotPen += 250_000;
                else if (dF < 15) slotPen += (15 - dF) * 15;
              }
              if (slotPen < bestSlotPen) bestSlotPen = slotPen;
            }
          }
          candScore += bestSlotPen;

          if (candScore < bestScore) {
            bestScore = candScore;
            bestBranches = built;
          }
        }
      }

      if (bestBranches) {
        edge.branches = bestBranches;
      }
    } else {
      const loX = srcNode.x + margin;
      const hiX = srcNode.x + srcNode.width - margin;
      const avgX =
        edge.branches.reduce((acc, br) => acc + br[0].x, 0) /
        edge.branches.length;
      const startY =
        side === 'BOTTOM' ? srcNode.y + srcNode.height : srcNode.y;
      const normalY =
        side === 'BOTTOM' ? (allInward ? -1 : 1) : allInward ? 1 : -1;

      const xOffsets = [0, -8, 8, -16, 16, -24, 24, -32, 32];
      let bestBranches: Point[][] | null = null;
      let bestScore = Infinity;

      for (const dxOff of xOffsets) {
        const candX = clamp(avgX + dxOff, loX, hiX);
        const pStart: Point = { x: candX, y: startY };

        let portTooClose = false;
        for (const fp of foreignPortsOnSrc) {
          if (Math.hypot(fp.x - pStart.x, fp.y - pStart.y) < 14) {
            portTooClose = true;
            break;
          }
        }
        if (portTooClose) continue;

        let corridorMaxLen = 1800;
        for (const n of absNodes.values()) {
          if (
            n.ast.id === srcNode.ast.id ||
            isAncestorInAst(n.ast.id, srcNode.ast.id, ast)
          ) {
            continue;
          }
          if (
            candX + pillW / 2 + 4 < n.x - 10 ||
            candX - pillW / 2 - 4 > n.x + n.width + 10
          ) {
            continue;
          }
          const distToWall =
            normalY > 0
              ? n.y - 26 - startY
              : startY - (n.y + n.height + 26);
          if (distToWall > 8) {
            corridorMaxLen = Math.min(corridorMaxLen, distToWall);
          }
        }

        const baseTrunk = Math.min(
          Math.max(pillH + 44, 84),
          Math.max(36, corridorMaxLen),
        );
        const trunkCandidates = [
          baseTrunk,
          baseTrunk + 28,
          baseTrunk + 56,
        ].filter((L) => L >= 24 && L <= corridorMaxLen + 0.5);

        for (const trunkLen of trunkCandidates) {
          const forkY = startY + normalY * trunkLen;
          const pFork: Point = { x: candX, y: forkY };

          const branchSpecs = edge.branches.map((br, b) => {
            let matchIdx = -1;
            for (let s = 0; s < br.length - 1; s++) {
              if (
                Math.abs(br[s].x - br[s + 1].x) < 1 &&
                (br[s + 1].y - forkY) * normalY >= 28 &&
                Math.abs(br[s].x - candX) >= 12
              ) {
                matchIdx = s;
                break;
              }
            }
            const segX =
              matchIdx !== -1
                ? br[matchIdx].x
                : br[Math.min(1, br.length - 1)].x;
            const hSign =
              Math.abs(segX - candX) < 2 ? 0 : segX > candX ? 1 : -1;
            return { b, br, matchIdx, segX, hSign, extraRank: 0 };
          });

          for (const sign of [-1, 1]) {
            const sameSign = branchSpecs
              .filter((sp) => sp.hSign === sign)
              .sort(
                (a, b) => Math.abs(b.segX - candX) - Math.abs(a.segX - candX),
              );
            sameSign.forEach((sp, rIdx) => {
              sp.extraRank = rIdx;
            });
          }

          const built: Point[][] = new Array(edge.branches.length);
          let valid = true;
          let candScore =
            Math.abs(candX - avgX) * 2 + Math.abs(trunkLen - baseTrunk) * 0.4;

          for (const sp of branchSpecs) {
            const tid = edge.ast.targetIds[sp.b] ?? edge.ast.sourceId;
            const dropY = forkY + sp.extraRank * 36 * normalY;
            const tailPts =
              sp.matchIdx !== -1
                ? sp.br.slice(sp.matchIdx + 1).map((p) => ({ ...p }))
                : sp.br.slice(1).map((p) => ({ ...p }));
            const raw: Point[] = [
              { ...pStart },
              { ...pFork },
              ...(sp.extraRank > 0 ? [{ x: candX, y: dropY }] : []),
              { x: sp.segX, y: dropY },
              ...tailPts,
            ];

            let unified = simplifyOrthogonalPolyline(raw);
            const rerouted = rerouteAroundPiercedObstacles(
              edge.ast.sourceId,
              tid,
              unified,
              absNodes,
              ast,
              theme,
            );
            if (rerouted !== unified) {
              candScore += 600_000;
              unified = rerouted;
            }
            if (
              unified.length < 2 ||
              Math.hypot(unified[0].x - pStart.x, unified[0].y - pStart.y) > 1 ||
              Math.abs(unified[1].x - candX) > 1 ||
              (unified[1].y - startY) * normalY < trunkLen - 1
            ) {
              valid = false;
              break;
            }
            candScore += parallelOverlapPenalty(unified, eIdx);
            built[sp.b] = unified;
          }
          if (!valid) continue;

          let bestSlotPen = 250_000;
          if (trunkLen >= pillH + 18) {
            for (const f of [0.5, 0.36, 0.64, 0.24, 0.76]) {
              const cy =
                startY +
                normalY * (pillH / 2 + 9 + (trunkLen - pillH - 18) * f);
              for (const xShift of [0, -(pillW / 2 + 5), pillW / 2 + 5]) {
                const lRect: Rect = {
                  x: candX + xShift - pillW / 2,
                  y: cy - pillH / 2,
                  width: pillW,
                  height: pillH,
                };
                let slotPen = Math.abs(f - 0.5) * 10 + (xShift !== 0 ? 6 : 0);
                for (let j = 0; j < edges.length; j++) {
                  if (j === eIdx) continue;
                  const dF = distRectToEdge(lRect, edges[j]);
                  if (dF < 7) slotPen += 250_000;
                  else if (dF < 15) slotPen += (15 - dF) * 15;
                }
                if (slotPen < bestSlotPen) bestSlotPen = slotPen;
              }
            }
          }
          candScore += bestSlotPen;

          if (candScore < bestScore) {
            bestScore = candScore;
            bestBranches = built;
          }
        }
      }

      if (bestBranches) {
        edge.branches = bestBranches;
      }
    }
  }
}

/**
 * Checks if any interior sampled point of `pts` pierces an unrelated `.state-box`
 * or compound header/compartment text band, and routes cleanly around it if needed.
 */
function rerouteAroundPiercedObstacles(
  sourceId: string,
  targetId: string,
  pts: Point[],
  absNodes: Map<string, PositionedNode>,
  ast: StatechartAST,
  theme: ThemeTokens,
): Point[] {
  const forbiddenRects: Rect[] = [];

  for (const node of absNodes.values()) {
    const uid = node.ast.id;
    const isAllowedAnc =
      isAncestorInAst(uid, sourceId, ast) ||
      isAncestorInAst(uid, targetId, ast);

    if (!isAllowedAnc) {
      if (uid === sourceId || uid === targetId) {
        // Interior of source/target itself (inset slightly so endpoints at perimeter don't trigger)
        if (node.width > 8 && node.height > 8) {
          forbiddenRects.push({
            x: node.x + 2,
            y: node.y + 2,
            width: node.width - 4,
            height: node.height - 4,
          });
        }
      } else {
        forbiddenRects.push({
          x: node.x - 2,
          y: node.y - 2,
          width: node.width + 4,
          height: node.height + 4,
        });
      }
    } else {
      // Allowed ancestor container: forbid crossing its header title or parent compartments
      const bothInside =
        (uid === sourceId || isAncestorInAst(uid, sourceId, ast)) &&
        (uid === targetId || isAncestorInAst(uid, targetId, ast));
      if (bothInside) {
        forbiddenRects.push({
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.headerHeight + node.compartmentHeight + 4,
        });
      } else {
        const titleW = measureTextWidth(node.ast.key, {
          fontFamily: 'sans',
          fontSize: theme.fontSizes.stateTitle,
          bold: true,
        });
        forbiddenRects.push({
          x: node.x + 8,
          y: node.y + 1,
          width: Math.min(node.width - 14, titleW + 18),
          height: node.headerHeight - 1,
        });
        if (node.compartmentHeight > 0) {
          forbiddenRects.push({
            x: node.x + 6,
            y: node.y + node.headerHeight - 1,
            width: node.width - 12,
            height: node.compartmentHeight + 2,
          });
        }
      }
    }
  }

  if (forbiddenRects.length === 0) return pts;

  const piercesObstacle = (poly: Point[]): Rect | null => {
    const totalLen = polylineLength(poly);
    if (totalLen <= 8) return null;
    for (let d = 4; d < totalLen - 4; d += 2.5) {
      const p = pointAtPolylineLength(poly, d);
      for (const obs of forbiddenRects) {
        if (
          p.x >= obs.x &&
          p.x <= obs.x + obs.width &&
          p.y >= obs.y &&
          p.y <= obs.y + obs.height
        ) {
          return obs;
        }
      }
    }
    return null;
  };

  const hit = piercesObstacle(pts);
  if (!hit) return pts;

  const pStart = pts[0];
  const pEnd = pts[pts.length - 1];
  const srcNode = absNodes.get(sourceId)!;
  const tgtNode = absNodes.get(targetId)!;
  const srcInward = isAncestorInAst(sourceId, targetId, ast);
  const tgtInward = isAncestorInAst(targetId, sourceId, ast);

  const stepFromWall = (
    pt: Point,
    node: PositionedNode,
    inward: boolean,
  ): Point => {
    const step = 18;
    const dL = Math.abs(pt.x - node.x);
    const dR = Math.abs(pt.x - (node.x + node.width));
    const dT = Math.abs(pt.y - node.y);
    const dB = Math.abs(pt.y - (node.y + node.height));
    const minD = Math.min(dL, dR, dT, dB);
    if (minD === dL) {
      return { x: pt.x + (inward ? step : -step), y: pt.y };
    }
    if (minD === dR) {
      return { x: pt.x + (inward ? -step : step), y: pt.y };
    }
    if (minD === dT) {
      return { x: pt.x, y: pt.y + (inward ? step : -step) };
    }
    return { x: pt.x, y: pt.y + (inward ? -step : step) };
  };

  const outPt = stepFromWall(pStart, srcNode, srcInward);
  const inPt = stepFromWall(pEnd, tgtNode, tgtInward);

  const spanMinX = Math.min(outPt.x, inPt.x) - 6;
  const spanMaxX = Math.max(outPt.x, inPt.x) + 6;
  const spanMinY = Math.min(outPt.y, inPt.y) - 6;
  const spanMaxY = Math.max(outPt.y, inPt.y) + 6;

  let localMinY = hit.y;
  let localMaxY = hit.y + hit.height;
  let globalMinY = hit.y;
  let globalMaxY = hit.y + hit.height;

  let localMinX = hit.x;
  let localMaxX = hit.x + hit.width;
  let globalMinX = hit.x;
  let globalMaxX = hit.x + hit.width;

  for (const obs of forbiddenRects) {
    globalMinY = Math.min(globalMinY, obs.y);
    globalMaxY = Math.max(globalMaxY, obs.y + obs.height);
    if (obs.x + obs.width >= spanMinX && obs.x <= spanMaxX) {
      localMinY = Math.min(localMinY, obs.y);
      localMaxY = Math.max(localMaxY, obs.y + obs.height);
    }

    globalMinX = Math.min(globalMinX, obs.x);
    globalMaxX = Math.max(globalMaxX, obs.x + obs.width);
    if (obs.y + obs.height >= spanMinY && obs.y <= spanMaxY) {
      localMinX = Math.min(localMinX, obs.x);
      localMaxX = Math.max(localMaxX, obs.x + obs.width);
    }
  }

  const candidatePolys: Point[][] = [];

  for (const laneY of [
    hit.y - 20,
    hit.y + hit.height + 20,
    localMinY - 24,
    localMaxY + 24,
    globalMinY - 28,
    globalMaxY + 28,
  ]) {
    candidatePolys.push(
      simplifyOrthogonalPolyline([
        pStart,
        outPt,
        { x: outPt.x, y: laneY },
        { x: inPt.x, y: laneY },
        inPt,
        pEnd,
      ]),
    );
  }

  for (const laneX of [
    hit.x - 20,
    hit.x + hit.width + 20,
    localMinX - 24,
    localMaxX + 24,
    globalMinX - 28,
    globalMaxX + 28,
  ]) {
    candidatePolys.push(
      simplifyOrthogonalPolyline([
        pStart,
        outPt,
        { x: laneX, y: outPt.y },
        { x: laneX, y: inPt.y },
        inPt,
        pEnd,
      ]),
    );
  }

  let bestClean: Point[] | null = null;
  let bestLen = Infinity;
  for (const cand of candidatePolys) {
    if (!piercesObstacle(cand)) {
      const len = polylineLength(cand);
      if (len < bestLen) {
        bestLen = len;
        bestClean = cand;
      }
    }
  }

  return bestClean ?? pts;
}

function polylineLength(pts: Point[]): number {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  }
  return total;
}

function pointAtPolylineLength(pts: Point[], targetDist: number): Point {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (targetDist <= 0) return { ...pts[0] };
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const segLen = Math.hypot(
      pts[i + 1].x - pts[i].x,
      pts[i + 1].y - pts[i].y,
    );
    if (acc + segLen >= targetDist && segLen > 0) {
      const t = (targetDist - acc) / segLen;
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
      };
    }
    acc += segLen;
  }
  return { ...pts[pts.length - 1] };
}

function distPointToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq, 0, 1);
  const projX = a.x + t * vx;
  const projY = a.y + t * vy;
  return Math.hypot(p.x - projX, p.y - projY);
}

function distPointToPolyline(p: Point, pts: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    best = Math.min(best, distPointToSegment(p, pts[i], pts[i + 1]));
  }
  return best;
}

function distPointToEdge(p: Point, edge: PositionedEdge): number {
  let best = Infinity;
  for (const br of edge.branches) {
    best = Math.min(best, distPointToPolyline(p, br));
  }
  return best;
}

function distRectToSegment(rect: Rect, a: Point, b: Point): number {
  const rRight = rect.x + rect.width;
  const rBottom = rect.y + rect.height;
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);

  // Exact O(1) closed-form Euclidean distance for orthogonal segments
  if (maxX - minX < 1e-3 || maxY - minY < 1e-3) {
    const dx = Math.max(0, rect.x - maxX, minX - rRight);
    const dy = Math.max(0, rect.y - maxY, minY - rBottom);
    return Math.hypot(dx, dy);
  }

  // General non-axis-aligned segment: Liang-Barsky clip test + endpoint/corner distances
  const dxSeg = b.x - a.x;
  const dySeg = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (
    clip(-dxSeg, a.x - rect.x) &&
    clip(dxSeg, rRight - a.x) &&
    clip(-dySeg, a.y - rect.y) &&
    clip(dySeg, rBottom - a.y)
  ) {
    return 0;
  }

  const dA = Math.hypot(
    Math.max(0, rect.x - a.x, a.x - rRight),
    Math.max(0, rect.y - a.y, a.y - rBottom),
  );
  const dB = Math.hypot(
    Math.max(0, rect.x - b.x, b.x - rRight),
    Math.max(0, rect.y - b.y, b.y - rBottom),
  );
  return Math.min(
    dA,
    dB,
    distPointToSegment({ x: rect.x, y: rect.y }, a, b),
    distPointToSegment({ x: rRight, y: rect.y }, a, b),
    distPointToSegment({ x: rect.x, y: rBottom }, a, b),
    distPointToSegment({ x: rRight, y: rBottom }, a, b),
  );
}

function distRectToPolyline(rect: Rect, pts: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distRectToSegment(rect, pts[i], pts[i + 1]);
    if (d === 0) return 0;
    if (d < best) best = d;
  }
  return best;
}

function distRectToEdge(rect: Rect, edge: PositionedEdge): number {
  let best = Infinity;
  for (const br of edge.branches) {
    best = Math.min(best, distRectToPolyline(rect, br));
    if (best === 0) return 0;
  }
  return best;
}

function rectIntersectsStateBorder(
  rect: Rect,
  node: PositionedNode,
  allowedContainers: Set<string>,
  margin = 3,
): boolean {
  const outer: Rect = {
    x: node.x - margin,
    y: node.y - margin,
    width: node.width + margin * 2,
    height: node.height + margin * 2,
  };
  if (!rectsIntersect(rect, outer, 0)) return false;

  // Only strict ancestor containers of an edge's endpoints may ever contain its label pill
  if (!allowedContainers.has(node.ast.id)) {
    return true;
  }

  // For allowed compound/parallel containers, forbid intersecting the 4 border walls or header+compartment band
  const headerBottom = node.y + node.headerHeight + node.compartmentHeight + 6;
  const strictlyInsideBody =
    rect.x >= node.x + 8 &&
    rect.x + rect.width <= node.x + node.width - 8 &&
    rect.y >= headerBottom &&
    rect.y + rect.height <= node.y + node.height - 8;

  return !strictlyInsideBody;
}

/**
 * Places every edge label pill so that:
 * 1. Zero overlap with any `.state-box` border/atomic body, `.initial-dot`, or other `.edge-label-bg`.
 * 2. Distance from pill to its own path <= 12px (0px when centered directly on its arrow shaft).
 * 3. Voronoi margin: distance from pill center to every OTHER edge path > dist(center, ownPath) + 11px.
 */
function placeAllEdgeLabels(
  edges: PositionedEdge[],
  nodes: PositionedNode[],
  initials: PositionedInitialIndicator[],
  ast: StatechartAST,
): void {
  const placedRects: Rect[] = [];

  const getAllowedContainers = (edge: PositionedEdge): Set<string> => {
    const allowed = new Set<string>();
    const addAncestors = (stateId: string) => {
      let cur = ast.nodes[stateId]?.parentId ?? null;
      while (cur) {
        allowed.add(cur);
        cur = ast.nodes[cur]?.parentId ?? null;
      }
    };
    addAncestors(edge.ast.sourceId);
    for (const tId of edge.ast.targetIds) {
      addAncestors(tId);
    }
    return allowed;
  };

  // Process shorter/tighter label corridors first (self-loops, multi-target pre-fork trunks, and short direct edges)
  // so longer single-target edges with multiple downstream segments can stagger cleanly around them.
  const order = edges
    .map((e, idx) => {
      const fullLen = Math.max(
        ...e.branches.map((br) => polylineLength(br)),
        0,
      );
      const effectiveLen =
        e.branches.length > 1 && e.branches.every((br) => br.length >= 2)
          ? Math.min(
              ...e.branches.map((br) =>
                Math.hypot(br[1].x - br[0].x, br[1].y - br[0].y),
              ),
            )
          : fullLen;
      return { idx, len: effectiveLen };
    })
    .sort((a, b) => a.len - b.len);

  for (const { idx } of order) {
    const edge = edges[idx];
    const poly = edge.branches[0] ?? [];
    const w = edge.label.width;
    const h = edge.label.height;
    const isSelf =
      edge.ast.targetIds.length === 1 &&
      edge.ast.targetIds[0] === edge.ast.sourceId;

    const candidates: { cx: number; cy: number; prefPenalty: number }[] = [];

    // Precompute true shared-trunk fork point for multi-target hyperedges
    let hyperForkPt: Point | null = null;
    let hyperTrunkDir: Point | null = null;
    let hyperTrunkLen = 0;
    if (
      edge.branches.length > 1 &&
      edge.branches.every((br) => br.length >= 2)
    ) {
      const p0 = edge.branches[0][0];
      const p1 = edge.branches[0][1];
      const d0 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      if (d0 > 1) {
        const ux = (p1.x - p0.x) / d0;
        const uy = (p1.y - p0.y) / d0;
        let minTrunk = d0;
        for (let b = 1; b < edge.branches.length; b++) {
          const br = edge.branches[b];
          minTrunk = Math.min(
            minTrunk,
            Math.hypot(br[1].x - br[0].x, br[1].y - br[0].y),
          );
        }
        hyperForkPt = { x: p0.x + ux * minTrunk, y: p0.y + uy * minTrunk };
        hyperTrunkDir = { x: ux, y: uy };
        hyperTrunkLen = minTrunk;
      }
    }

    if (isSelf && poly.length === 4) {
      // Place self-loop pill 5px OUTSIDE the outer loop bar so the full rounded
      // loop arch (`╭─────╮`) and downward arrowhead remain 100% visible!
      const midX = (poly[1].x + poly[2].x) / 2;
      const midY = (poly[1].y + poly[2].y) / 2;
      const isHorizBar = Math.abs(poly[1].y - poly[2].y) < 1;
      if (isHorizBar) {
        const sign = poly[1].y < poly[0].y ? -1 : 1;
        const outerCy = midY + sign * (h / 2 + 5);
        candidates.push({ cx: midX, cy: outerCy, prefPenalty: 0 });
        candidates.push({ cx: midX - 12, cy: outerCy, prefPenalty: 4 });
        candidates.push({ cx: midX + 12, cy: outerCy, prefPenalty: 4 });
        candidates.push({ cx: midX, cy: midY, prefPenalty: 35 });
      } else {
        const sign = poly[1].x > poly[0].x ? 1 : -1;
        const outerCx = midX + sign * (w / 2 + 5);
        const topLegY = Math.min(poly[1].y, poly[2].y);
        const botLegY = Math.max(poly[1].y, poly[2].y);
        const legOuterCx = poly[0].x + sign * (w / 2 + 6);
        candidates.push({ cx: outerCx, cy: midY, prefPenalty: 0 });
        candidates.push({
          cx: legOuterCx,
          cy: topLegY - (h / 2 + 5),
          prefPenalty: 4,
        });
        candidates.push({
          cx: legOuterCx,
          cy: botLegY + (h / 2 + 5),
          prefPenalty: 4,
        });
        if (Math.abs(poly[1].x - poly[0].x) >= w / 2 + 6) {
          candidates.push({ cx: midX, cy: midY, prefPenalty: 35 });
        }
      }
    } else {
      // Generate candidates along straight segments across all branches, supporting both horizontal and vertical segments cleanly
      const isMulti = edge.branches.length > 1;
      let hasLongHoriz = false;
      for (const br of edge.branches) {
        for (let s = 0; s < br.length - 1; s++) {
          if (
            Math.abs(br[s].y - br[s + 1].y) < 1 &&
            Math.abs(br[s + 1].x - br[s].x) >= w + 10
          ) {
            hasLongHoriz = true;
            break;
          }
        }
        if (hasLongHoriz) break;
      }

      for (let bIdx = 0; bIdx < edge.branches.length; bIdx++) {
        const br = edge.branches[bIdx];
        for (let s = 0; s < br.length - 1; s++) {
          const a = br[s];
          const b = isMulti && s === 0 && hyperForkPt ? hyperForkPt : br[s + 1];
          const segLen = Math.hypot(b.x - a.x, b.y - a.y);
          if (segLen < 12) continue;
          const isVert = Math.abs(b.x - a.x) < Math.abs(b.y - a.y);
          const nx = -(b.y - a.y) / segLen;
          const ny = (b.x - a.x) / segLen;
          const reqAlong = isVert ? h + 14 : w + 16;
          const trunkBonus =
            isMulti && s === 0 && segLen >= (isVert ? h + 10 : w + 12)
              ? -40
              : 0;
          const perpSpecs: Array<{ off: number; pen: number }> = isVert
            ? [
                { off: 0, pen: 0 },
                { off: -(w / 2 + 5), pen: 7 },
                { off: w / 2 + 5, pen: 7 },
                { off: -(w / 2 + 9), pen: 12 },
                { off: w / 2 + 9, pen: 12 },
                { off: -8, pen: 12 },
                { off: 8, pen: 12 },
              ]
            : [
                { off: 0, pen: 0 },
                { off: -8, pen: 12 },
                { off: 8, pen: 12 },
                { off: -12, pen: 18 },
                { off: 12, pen: 18 },
                { off: -(h / 2 + 5), pen: 9 },
                { off: h / 2 + 5, pen: 9 },
              ];
          const sfList =
            isMulti && s === 0
              ? [
                  0.5, 0.44, 0.56, 0.38, 0.62, 0.32, 0.68, 0.26, 0.74, 0.2,
                  0.8, 0.14, 0.86,
                ]
              : [
                  0.5, 0.42, 0.58, 0.34, 0.66, 0.25, 0.75, 0.18, 0.82, 0.12,
                  0.88,
                ];
          for (const sf of sfList) {
            const bx = a.x + (b.x - a.x) * sf;
            const by = a.y + (b.y - a.y) * sf;
            for (const { off, pen } of perpSpecs) {
              candidates.push({
                cx: bx + nx * off,
                cy: by + ny * off,
                prefPenalty:
                  trunkBonus +
                  (isVert ? (hasLongHoriz ? 28 : 4) : 0) +
                  pen +
                  Math.abs(sf - 0.5) * 16 +
                  (segLen < reqAlong ? 22 : 0) +
                  bIdx * 2,
              });
            }
          }
        }
      }

      // Fallback arc-length samples if polylines had only tiny segments
      if (candidates.length === 0) {
        for (const br of edge.branches) {
          const totalLen = polylineLength(br);
          if (totalLen > 1) {
            for (const f of [0.5, 0.35, 0.65, 0.25, 0.75]) {
              const pt = pointAtPolylineLength(br, totalLen * f);
              candidates.push({
                cx: pt.x,
                cy: pt.y,
                prefPenalty: Math.abs(f - 0.5) * 20,
              });
            }
          }
        }
      }
    }

    let bestCand = {
      cx: poly[0]?.x ?? 0,
      cy: poly[0]?.y ?? 0,
      score: Infinity,
    };
    const allowedContainers = getAllowedContainers(edge);

    for (const cand of candidates) {
      const rect: Rect = {
        x: cand.cx - w / 2,
        y: cand.cy - h / 2,
        width: w,
        height: h,
      };
      const center: Point = { x: cand.cx, y: cand.cy };

      let penalty = cand.prefPenalty;

      // 1. State border / body collision check
      for (const node of nodes) {
        if (rectIntersectsStateBorder(rect, node, allowedContainers, 4)) {
          penalty += 100_000;
        }
      }

      // 2. Initial dot collision check
      for (const init of initials) {
        const ir: Rect = {
          x: init.cx - init.r,
          y: init.cy - init.r,
          width: init.r * 2,
          height: init.r * 2,
        };
        if (rectsIntersect(rect, ir, 4)) {
          penalty += 100_000;
        }
      }

      // 3. Previously placed label collision check (>= 15px pill-to-pill clearance per ARCHITECTURE.md §5)
      for (const prev of placedRects) {
        if (rectsIntersect(rect, prev, 15)) {
          penalty += 100_000;
        }
      }

      // 4. Own path proximity (must be <= 14px; for multi-target hyperedges, must be <= 12px from EVERY branch)
      const dOwnRect = distRectToEdge(rect, edge);
      const dOwnCenter = distPointToEdge(center, edge);
      if (dOwnRect > 12) {
        penalty += 80_000 + (dOwnRect - 12) * 1000;
      } else {
        penalty += dOwnRect * 3;
      }
      if (edge.branches.length > 1) {
        let maxBrDist = 0;
        for (const br of edge.branches) {
          maxBrDist = Math.max(maxBrDist, distRectToPolyline(rect, br));
        }
        if (maxBrDist > 12) {
          penalty += 200_000 + (maxBrDist - 12) * 2000;
        } else {
          penalty += maxBrDist * 4;
        }
        if (hyperTrunkDir && hyperTrunkLen > 0) {
          const p0 = edge.branches[0][0];
          const proj =
            (cand.cx - p0.x) * hyperTrunkDir.x +
            (cand.cy - p0.y) * hyperTrunkDir.y;
          const halfSpan =
            (Math.abs(hyperTrunkDir.x) * w + Math.abs(hyperTrunkDir.y) * h) / 2;
          if (hyperTrunkLen >= halfSpan * 2 + 8) {
            if (proj - halfSpan < 4 || proj + halfSpan > hyperTrunkLen - 4) {
              penalty += 250_000;
            }
          } else if (proj < 6 || proj > hyperTrunkLen - 6) {
            penalty += 250_000;
          }
        }
      }

      if (penalty >= bestCand.score) continue;

      // 5. Voronoi nearest-neighbor attribution + foreign-path box clearance
      for (let j = 0; j < edges.length; j++) {
        if (j === idx) continue;
        const dOtherBox = distRectToEdge(rect, edges[j]);
        if (dOtherBox < 6.5) {
          penalty += 120_000 + (6.5 - dOtherBox) * 4000;
        } else if (dOtherBox < 14) {
          penalty += (14 - dOtherBox) * 6;
        }

        const dOther = distPointToEdge(center, edges[j]);
        const slack = dOther - (dOwnCenter + 8);
        if (slack <= 3) {
          penalty += 90_000 + (3 - slack) * 2000;
        } else if (slack < 14) {
          penalty += (14 - slack) * 8;
        }
        if (penalty >= bestCand.score) break;
      }

      if (penalty >= bestCand.score) continue;

      // 6. Keep comfortably clear of start, end, and fork-junction points across all branches
      for (const br of edge.branches) {
        if (br.length < 2) continue;
        const pStart = br[0];
        const pEnd = br[br.length - 1];
        const startRect: Rect = {
          x: pStart.x - 12,
          y: pStart.y - 8,
          width: 24,
          height: 16,
        };
        const endRect: Rect = {
          x: pEnd.x - 14,
          y: pEnd.y - 8,
          width: 28,
          height: 16,
        };
        if (rectsIntersect(rect, startRect, 0)) {
          penalty += 300;
        }
        if (rectsIntersect(rect, endRect, 0)) {
          penalty += 500;
        }
      }
      if (hyperForkPt) {
        const jRect: Rect = {
          x: hyperForkPt.x - 8,
          y: hyperForkPt.y - 8,
          width: 16,
          height: 16,
        };
        if (rectsIntersect(rect, jRect, 0)) {
          penalty += 400;
        }
      }

      if (penalty < bestCand.score) {
        bestCand = { cx: cand.cx, cy: cand.cy, score: penalty };
      }
    }

    const finalRect: Rect = {
      x: Math.round((bestCand.cx - w / 2) * 10) / 10,
      y: Math.round((bestCand.cy - h / 2) * 10) / 10,
      width: w,
      height: h,
    };
    edge.label.x = finalRect.x;
    edge.label.y = finalRect.y;
    placedRects.push(finalRect);
  }
}

function normalizeCanvasBounds(
  nodes: PositionedNode[],
  initials: PositionedInitialIndicator[],
  edges: PositionedEdge[],
  theme: ThemeTokens,
): PositionedDiagram {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const includePt = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const n of nodes) {
    includePt(n.x, n.y);
    includePt(n.x + n.width, n.y + n.height);
  }

  for (const init of initials) {
    includePt(init.cx - init.r, init.cy - init.r);
    includePt(init.cx + init.r, init.cy + init.r);
    for (const p of init.points) includePt(p.x, p.y);
  }

  for (const e of edges) {
    for (const br of e.branches) {
      for (const p of br) includePt(p.x, p.y);
    }
    includePt(e.label.x, e.label.y);
    includePt(e.label.x + e.label.width, e.label.y + e.label.height);
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 200;
    maxY = 120;
  }

  const pad = theme.spacing.canvasPadding;
  const shiftX = pad - minX;
  const shiftY = pad - minY;

  for (const n of nodes) {
    n.x = round2(n.x + shiftX);
    n.y = round2(n.y + shiftY);
    n.width = round2(n.width);
    n.height = round2(n.height);
  }

  for (const init of initials) {
    init.cx = round2(init.cx + shiftX);
    init.cy = round2(init.cy + shiftY);
    for (const p of init.points) {
      p.x = round2(p.x + shiftX);
      p.y = round2(p.y + shiftY);
    }
  }

  for (const e of edges) {
    for (const br of e.branches) {
      for (const p of br) {
        p.x = round2(p.x + shiftX);
        p.y = round2(p.y + shiftY);
      }
    }
    e.label.x = round2(e.label.x + shiftX);
    e.label.y = round2(e.label.y + shiftY);
  }

  const width = Math.ceil(maxX - minX + pad * 2);
  const height = Math.ceil(maxY - minY + pad * 2);

  return {
    width,
    height,
    theme,
    nodes,
    initialIndicators: initials,
    edges,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
