import type { Page } from 'playwright';
import type { StatechartAST } from '../ast/types.js';

export interface Gate2Violation {
  rule:
    | 'parent-containment-inset'
    | 'parent-header-clearance'
    | 'parallel-region-dashed'
    | 'history-node-shape'
    | 'sibling-overlap-clearance'
    | 'text-label-collision'
    | 'text-box-overflow'
    | 'divider-overlap'
    | 'atomic-node-proportion'
    | 'label-border-collision'
    | 'edge-obstacle-piercing'
    | 'terminal-tangent-direction'
    | 'collinear-edge-overlap'
    | 'multi-edge-channel-separation'
    | 'port-corner-clearance'
    | 'voronoi-label-attribution'
    | 'edge-label-multiline-wrap'
    | 'diagram-aspect-ratio'
    | 'orthogonal-edge-segments'
    | 'forward-edge-detour';
  elements: string[];
  message: string;
}

export interface LintGeometryOptions {
  skipAspectRatioCheck?: boolean;
}

export interface Gate2Result {
  passed: boolean;
  violations: Gate2Violation[];
  metrics: {
    minSiblingClearancePx: number | null;
    minParentInsetPx: number | null;
    textCollisionCount: number;
    maxLabelOwnPathDistPx: number;
    minVoronoiMarginPx: number | null;
    aspectRatioMax: number | null;
    maxLabelPillWidthPx: number;
  };
}

interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function boxesIntersectionArea(a: BBox, b: BBox): number {
  const ix = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const iy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (ix <= 0.05 || iy <= 0.05) return 0;
  return ix * iy;
}

function boxesEdgeClearance(a: BBox, b: BBox): number {
  const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width));
  const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height));
  if (dx === 0 && dy === 0) {
    // Overlapping or touching: return negative overlap depth if overlapping
    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return -Math.min(overlapX, overlapY);
  }
  return Math.hypot(dx, dy);
}

function pointToSegmentDist(px: number, py: number, s: Segment): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) {
    return Math.hypot(px - s.x1, py - s.y1);
  }
  const t = Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / lenSq));
  const projX = s.x1 + t * dx;
  const projY = s.y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function segmentIntersectsSegment(a: Segment, b: Segment): boolean {
  const ccw = (p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number) =>
    (p3y - p1y) * (p2x - p1x) > (p2y - p1y) * (p3x - p1x);
  return (
    ccw(a.x1, a.y1, b.x1, b.y1, b.x2, b.y2) !== ccw(a.x2, a.y2, b.x1, b.y1, b.x2, b.y2) &&
    ccw(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1) !== ccw(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2)
  );
}

function boxToSegmentDist(box: BBox, seg: Segment): number {
  // 0 if either endpoint is inside box
  const inside = (x: number, y: number) =>
    x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
  if (inside(seg.x1, seg.y1) || inside(seg.x2, seg.y2)) {
    return 0;
  }
  const edges: Segment[] = [
    { x1: box.x, y1: box.y, x2: box.x + box.width, y2: box.y },
    { x1: box.x + box.width, y1: box.y, x2: box.x + box.width, y2: box.y + box.height },
    { x1: box.x + box.width, y1: box.y + box.height, x2: box.x, y2: box.y + box.height },
    { x1: box.x, y1: box.y + box.height, x2: box.x, y2: box.y },
  ];
  for (const e of edges) {
    if (segmentIntersectsSegment(seg, e)) return 0;
  }
  const corners: Point[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
  let best = Infinity;
  for (const c of corners) {
    best = Math.min(best, pointToSegmentDist(c.x, c.y, seg));
  }
  for (const e of edges) {
    best = Math.min(best, pointToSegmentDist(seg.x1, seg.y1, e));
    best = Math.min(best, pointToSegmentDist(seg.x2, seg.y2, e));
  }
  return best;
}

function pointToPolylineDist(pt: Point, segments: Segment[]): number {
  if (segments.length === 0) return Infinity;
  let best = Infinity;
  for (const seg of segments) {
    const d = pointToSegmentDist(pt.x, pt.y, seg);
    if (d < best) best = d;
  }
  return best;
}

function segmentToSegmentDist(a: Segment, b: Segment): number {
  if (segmentIntersectsSegment(a, b)) return 0;
  return Math.min(
    pointToSegmentDist(a.x1, a.y1, b),
    pointToSegmentDist(a.x2, a.y2, b),
    pointToSegmentDist(b.x1, b.y1, a),
    pointToSegmentDist(b.x2, b.y2, a),
  );
}

function polylineToPolylineDist(segsA: Segment[], segsB: Segment[]): number {
  if (segsA.length === 0 || segsB.length === 0) return Infinity;
  let best = Infinity;
  for (const sA of segsA) {
    for (const sB of segsB) {
      const d = segmentToSegmentDist(sA, sB);
      if (d < best) {
        best = d;
        if (best === 0) return 0;
      }
    }
  }
  return best;
}

function boxToPolylineDist(box: BBox, segments: Segment[]): number {
  if (segments.length === 0) return Infinity;
  let best = Infinity;
  for (const seg of segments) {
    const d = boxToSegmentDist(box, seg);
    if (d < best) best = d;
    if (best === 0) return 0;
  }
  return best;
}

/**
 * Parses an SVG path `d` attribute into straight segments (transformed by `m`),
 * subdividing long curves (> 16px chord) while skipping short corner fillets.
 */
function parsePathToStraightSegments(
  d: string,
  m: { a: number; b: number; c: number; d: number; e: number; f: number },
): Segment[] {
  const tx = (x: number, y: number): Point => ({
    x: m.a * x + m.c * y + m.e,
    y: m.b * x + m.d * y + m.f,
  });

  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!tokens) return [];

  const segments: Segment[] = [];
  let idx = 0;
  let cmd = '';
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;

  const nextNum = (): number => parseFloat(tokens[idx++] || '0');
  const hasMoreNumbers = (): boolean =>
    idx < tokens.length && !/^[a-zA-Z]$/.test(tokens[idx]);

  while (idx < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[idx])) {
      cmd = tokens[idx++];
    }
    const isRel = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();

    if (upper === 'M') {
      let first = true;
      while (hasMoreNumbers()) {
        const nx = nextNum() + (isRel ? curX : 0);
        const ny = nextNum() + (isRel ? curY : 0);
        if (first) {
          curX = nx;
          curY = ny;
          startX = nx;
          startY = ny;
          first = false;
        } else {
          const p1 = tx(curX, curY);
          const p2 = tx(nx, ny);
          segments.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
          curX = nx;
          curY = ny;
        }
      }
    } else if (upper === 'L') {
      while (hasMoreNumbers()) {
        const nx = nextNum() + (isRel ? curX : 0);
        const ny = nextNum() + (isRel ? curY : 0);
        const p1 = tx(curX, curY);
        const p2 = tx(nx, ny);
        segments.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
        curX = nx;
        curY = ny;
      }
    } else if (upper === 'H') {
      while (hasMoreNumbers()) {
        const nx = nextNum() + (isRel ? curX : 0);
        const p1 = tx(curX, curY);
        const p2 = tx(nx, curY);
        segments.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
        curX = nx;
      }
    } else if (upper === 'V') {
      while (hasMoreNumbers()) {
        const ny = nextNum() + (isRel ? curY : 0);
        const p1 = tx(curX, curY);
        const p2 = tx(curX, ny);
        segments.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
        curY = ny;
      }
    } else if (upper === 'Q') {
      while (hasMoreNumbers()) {
        const cx = nextNum() + (isRel ? curX : 0);
        const cy = nextNum() + (isRel ? curY : 0);
        const nx = nextNum() + (isRel ? curX : 0);
        const ny = nextNum() + (isRel ? curY : 0);
        const p0 = tx(curX, curY);
        const pc = tx(cx, cy);
        const p2 = tx(nx, ny);
        const chord = Math.hypot(p2.x - p0.x, p2.y - p0.y);
        if (chord > 16) {
          const steps = 4;
          let prev = p0;
          for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const mt = 1 - t;
            const pt = {
              x: mt * mt * p0.x + 2 * mt * t * pc.x + t * t * p2.x,
              y: mt * mt * p0.y + 2 * mt * t * pc.y + t * t * p2.y,
            };
            segments.push({ x1: prev.x, y1: prev.y, x2: pt.x, y2: pt.y });
            prev = pt;
          }
        }
        curX = nx;
        curY = ny;
      }
    } else if (upper === 'C') {
      while (hasMoreNumbers()) {
        const c1x = nextNum() + (isRel ? curX : 0);
        const c1y = nextNum() + (isRel ? curY : 0);
        const c2x = nextNum() + (isRel ? curX : 0);
        const c2y = nextNum() + (isRel ? curY : 0);
        const nx = nextNum() + (isRel ? curX : 0);
        const ny = nextNum() + (isRel ? curY : 0);
        const p0 = tx(curX, curY);
        const pc1 = tx(c1x, c1y);
        const pc2 = tx(c2x, c2y);
        const p3 = tx(nx, ny);
        const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
        if (chord > 16) {
          const steps = 6;
          let prev = p0;
          for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const mt = 1 - t;
            const pt = {
              x:
                mt * mt * mt * p0.x +
                3 * mt * mt * t * pc1.x +
                3 * mt * t * t * pc2.x +
                t * t * t * p3.x,
              y:
                mt * mt * mt * p0.y +
                3 * mt * mt * t * pc1.y +
                3 * mt * t * t * pc2.y +
                t * t * t * p3.y,
            };
            segments.push({ x1: prev.x, y1: prev.y, x2: pt.x, y2: pt.y });
            prev = pt;
          }
        }
        curX = nx;
        curY = ny;
      }
    } else if (upper === 'A') {
      while (hasMoreNumbers()) {
        nextNum(); // rx
        nextNum(); // ry
        nextNum(); // rot
        nextNum(); // large-arc
        nextNum(); // sweep
        const nx = nextNum() + (isRel ? curX : 0);
        const ny = nextNum() + (isRel ? curY : 0);
        curX = nx;
        curY = ny;
      }
    } else if (upper === 'Z') {
      const p1 = tx(curX, curY);
      const p2 = tx(startX, startY);
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) > 0.5) {
        segments.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
      }
      curX = startX;
      curY = startY;
    } else {
      // Skip unknown or S/T params safely
      while (hasMoreNumbers()) nextNum();
    }
  }

  return segments;
}

/**
 * Extracts ONLY explicit linear (`L` / `M`-continuation) segments from a path `d`
 * (ignoring `Q`/`C`/`A` curves) so Gate 2 can enforce strict orthogonal routing.
 */
function parsePathExplicitLinearSegments(
  d: string,
  m: { a: number; b: number; c: number; d: number; e: number; f: number },
): Segment[] {
  const tx = (x: number, y: number): Point => ({
    x: m.a * x + m.c * y + m.e,
    y: m.b * x + m.d * y + m.f,
  });

  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!tokens) return [];

  const segments: Segment[] = [];
  let idx = 0;
  let cmd = '';
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;

  const nextNum = (): number => parseFloat(tokens[idx++] || '0');
  const hasMoreNumbers = (): boolean =>
    idx < tokens.length && !/^[a-zA-Z]$/.test(tokens[idx]);

  while (idx < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[idx])) {
      cmd = tokens[idx++];
    }
    const isRel = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();

    if (upper === 'M') {
      let first = true;
      while (hasMoreNumbers()) {
        const nx = nextNum() + (isRel ? curX : 0);
        const ny = nextNum() + (isRel ? curY : 0);
        if (first) {
          curX = nx;
          curY = ny;
          startX = nx;
          startY = ny;
          first = false;
        } else {
          const p1 = tx(curX, curY);
          const p2 = tx(nx, ny);
          segments.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
          curX = nx;
          curY = ny;
        }
      }
    } else if (upper === 'L') {
      while (hasMoreNumbers()) {
        const nx = nextNum() + (isRel ? curX : 0);
        const ny = nextNum() + (isRel ? curY : 0);
        const p1 = tx(curX, curY);
        const p2 = tx(nx, ny);
        segments.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
        curX = nx;
        curY = ny;
      }
    } else if (upper === 'H') {
      while (hasMoreNumbers()) {
        curX = nextNum() + (isRel ? curX : 0);
      }
    } else if (upper === 'V') {
      while (hasMoreNumbers()) {
        curY = nextNum() + (isRel ? curY : 0);
      }
    } else if (upper === 'Q') {
      while (hasMoreNumbers()) {
        nextNum();
        nextNum();
        curX = nextNum() + (isRel ? curX : 0);
        curY = nextNum() + (isRel ? curY : 0);
      }
    } else if (upper === 'C') {
      while (hasMoreNumbers()) {
        nextNum();
        nextNum();
        nextNum();
        nextNum();
        curX = nextNum() + (isRel ? curX : 0);
        curY = nextNum() + (isRel ? curY : 0);
      }
    } else if (upper === 'A') {
      while (hasMoreNumbers()) {
        nextNum();
        nextNum();
        nextNum();
        nextNum();
        nextNum();
        curX = nextNum() + (isRel ? curX : 0);
        curY = nextNum() + (isRel ? curY : 0);
      }
    } else if (upper === 'Z') {
      curX = startX;
      curY = startY;
    } else {
      while (hasMoreNumbers()) nextNum();
    }
  }

  return segments;
}

/**
 * Runs Gate 2 (Deterministic Geometric Linter) in Playwright on a rendered SVG,
 * enforcing all 6 geometric rules from RULES_OF_ENGAGEMENT.md.
 */
export async function lintSvgGeometry(
  page: Page,
  svgSelector = 'svg',
  ast: StatechartAST,
  options: LintGeometryOptions = {},
): Promise<Gate2Result> {
  // Build ancestor map from AST
  const ancestorsOf = new Map<string, Set<string>>();
  for (const stateId of Object.keys(ast.nodes)) {
    const set = new Set<string>();
    let cur = ast.nodes[stateId]?.parentId ?? null;
    while (cur) {
      set.add(cur);
      cur = ast.nodes[cur]?.parentId ?? null;
    }
    ancestorsOf.set(stateId, set);
  }

  await page.evaluate('window.__name = window.__name || ((fn) => fn)');
  const domGeometry = await page.evaluate(
    (arg: { selector: string; astTransitions: StatechartAST['transitions'] }) => {
      const svgEl = document.querySelector(arg.selector);
      if (!svgEl || !(svgEl instanceof SVGSVGElement)) {
        return null;
      }

      const astTrMap = new Map(arg.astTransitions.map((t) => [t.id, t]));

      const vb = svgEl.viewBox.baseVal;
      const viewBox = {
        width:
          vb && vb.width > 0
            ? vb.width
            : parseFloat(svgEl.getAttribute('width') || '0'),
        height:
          vb && vb.height > 0
            ? vb.height
            : parseFloat(svgEl.getAttribute('height') || '0'),
      };

      const measureCanvas = document.createElement('canvas');
      const measureCtx = measureCanvas.getContext('2d');
      function measureTextPx(text: string, font: string): number {
        if (!measureCtx) return text.length * 6.4;
        measureCtx.font = font;
        return measureCtx.measureText(text).width;
      }

    const svgCTM = svgEl.getScreenCTM() || svgEl.getCTM();
    const svgCTMInv = svgCTM ? svgCTM.inverse() : null;

    function getMatrix(el: SVGGraphicsElement) {
      const ctm = el.getScreenCTM() || el.getCTM();
      if (!ctm || !svgCTMInv) {
        return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
      }
      const m = svgCTMInv.multiply(ctm);
      return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
    }

    function toRootPoint(el: SVGGraphicsElement, x: number, y: number) {
      const m = getMatrix(el);
      return {
        x: m.a * x + m.c * y + m.e,
        y: m.b * x + m.d * y + m.f,
      };
    }

    function getRootBBox(el: SVGGraphicsElement) {
      const b = el.getBBox();
      const p1 = toRootPoint(el, b.x, b.y);
      const p2 = toRootPoint(el, b.x + b.width, b.y);
      const p3 = toRootPoint(el, b.x + b.width, b.y + b.height);
      const p4 = toRootPoint(el, b.x, b.y + b.height);
      const minX = Math.min(p1.x, p2.x, p3.x, p4.x);
      const maxX = Math.max(p1.x, p2.x, p3.x, p4.x);
      const minY = Math.min(p1.y, p2.y, p3.y, p4.y);
      const maxY = Math.max(p1.y, p2.y, p3.y, p4.y);
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    const states: Array<{
      id: string;
      parentId: string | null;
      type: string;
      shapeKind: 'rect' | 'circle';
      rx: number;
      strokeDasharray: string;
      box: { x: number; y: number; width: number; height: number };
      titleBox: { x: number; y: number; width: number; height: number } | null;
      compartmentTextBoxes: Array<{
        id: string;
        box: { x: number; y: number; width: number; height: number };
      }>;
      tagBoxes: Array<{
        id: string;
        box: { x: number; y: number; width: number; height: number };
      }>;
      dividerYs: number[];
    }> = [];

    for (const nodeEl of Array.from(svgEl.querySelectorAll('g.state-node'))) {
      const id = nodeEl.getAttribute('data-state-id') || '';
      const rawParent = nodeEl.getAttribute('data-parent-id') || '';
      const parentId = rawParent.length > 0 ? rawParent : null;
      const type = nodeEl.getAttribute('data-state-type') || 'atomic';

      const boxEl = Array.from(nodeEl.querySelectorAll('.state-box')).find(
        (el) => el.closest('g.state-node') === nodeEl,
      ) as SVGGraphicsElement | undefined;
      if (!boxEl) continue;

      const shapeKind = boxEl.tagName.toLowerCase() === 'circle' ? 'circle' : 'rect';
      const rx =
        shapeKind === 'rect' ? parseFloat(boxEl.getAttribute('rx') || '0') || 0 : 0;
      const attrDash = (boxEl.getAttribute('stroke-dasharray') || '').trim();
      const styleDash = (window.getComputedStyle(boxEl).strokeDasharray || '').trim();
      const strokeDasharray = attrDash || styleDash;
      const box = getRootBBox(boxEl);

      const titleEl = Array.from(nodeEl.querySelectorAll('text.state-title')).find(
        (el) => el.closest('g.state-node') === nodeEl,
      ) as SVGGraphicsElement | undefined;
      const titleBox = titleEl ? getRootBBox(titleEl) : null;

      const compartmentTextBoxes: Array<{
        id: string;
        box: { x: number; y: number; width: number; height: number };
      }> = [];
      const compEls = Array.from(nodeEl.querySelectorAll('g.state-compartment')).filter(
        (el) => el.closest('g.state-node') === nodeEl,
      );
      compEls.forEach((compEl) => {
        const kind = compEl.getAttribute('data-compartment') || 'comp';
        if (kind === 'tags') return;
        Array.from(compEl.querySelectorAll('text')).forEach((tEl, idx) => {
          if (tEl.closest('g.state-tag')) return;
          compartmentTextBoxes.push({
            id: `${id}:${kind}[${idx}]`,
            box: getRootBBox(tEl as SVGGraphicsElement),
          });
        });
      });

      const tagBoxes: Array<{
        id: string;
        box: { x: number; y: number; width: number; height: number };
      }> = [];
      const tagEls = Array.from(nodeEl.querySelectorAll('g.state-tag')).filter(
        (el) => el.closest('g.state-node') === nodeEl,
      );
      tagEls.forEach((tagEl, idx) => {
        tagBoxes.push({
          id: `${id}:tag[${idx}]`,
          box: getRootBBox(tagEl as SVGGraphicsElement),
        });
      });

      const dividerEls = Array.from(
        nodeEl.querySelectorAll(
          '.state-divider, .compartment-divider, .compartment-bottom-divider',
        ),
      ).filter((el) => el.closest('g.state-node') === nodeEl);
      const dividerYs = dividerEls.map(
        (el) => getRootBBox(el as SVGGraphicsElement).y,
      );

      states.push({
        id,
        parentId,
        type,
        shapeKind,
        rx,
        strokeDasharray,
        box,
        titleBox,
        compartmentTextBoxes,
        tagBoxes,
        dividerYs,
      });
    }

    const initialDots: Array<{
      id: string;
      parentId: string | null;
      targetId: string;
      box: { x: number; y: number; width: number; height: number };
      edgeBox: { x: number; y: number; width: number; height: number } | null;
      interiorSamples: Array<{ x: number; y: number }>;
    }> = [];

    for (const initEl of Array.from(svgEl.querySelectorAll('g.initial-indicator'))) {
      const pAttr = initEl.getAttribute('data-parent-id') || '__root__';
      const parentId = pAttr === '__root__' ? null : pAttr;
      const targetId = initEl.getAttribute('data-target-id') || '';
      const dotEl = initEl.querySelector('.initial-dot') as SVGGraphicsElement | null;
      const edgeEl = initEl.querySelector('path.initial-edge') as SVGPathElement | null;
      const interiorSamples: Array<{ x: number; y: number }> = [];
      let edgeBox: { x: number; y: number; width: number; height: number } | null = null;
      if (edgeEl) {
        edgeBox = getRootBBox(edgeEl);
        const total = edgeEl.getTotalLength();
        for (let d = 6; d <= total - 6; d += 4) {
          const pt = edgeEl.getPointAtLength(d);
          interiorSamples.push(toRootPoint(edgeEl, pt.x, pt.y));
        }
      }
      if (dotEl) {
        initialDots.push({
          id: `initial:${pAttr}->${targetId}`,
          parentId,
          targetId,
          box: getRootBBox(dotEl),
          edgeBox,
          interiorSamples,
        });
      }
    }

    const edges: Array<{
      id: string;
      sourceId: string;
      targetIds: string[];
      labelBox: { x: number; y: number; width: number; height: number } | null;
      clauseCount: number;
      maxAtomicTokenWidthPx: number;
      paths: Array<{
        d: string;
        branchTargetId: string | null;
        hasMarkerEnd: boolean;
        matrix: { a: number; b: number; c: number; d: number; e: number; f: number };
        totalLength: number;
        startPt: { x: number; y: number } | null;
        endPt: { x: number; y: number } | null;
        startTangent: { x: number; y: number } | null;
        endTangent: { x: number; y: number } | null;
        interiorSamples2px: Array<{ x: number; y: number }>;
        densePoints2px: Array<{ x: number; y: number }>;
      }>;
    }> = [];

    const knownStateIdSet = new Set(states.map((s) => s.id));
    const knownStateIdsSorted = states
      .map((s) => s.id)
      .sort((a, b) => b.length - a.length);

    function parseTargetIdsAttr(rawAttr: string): string[] {
      const trimmed = rawAttr.trim();
      if (!trimmed) return [];
      if (knownStateIdSet.has(trimmed)) return [trimmed];

      const result: string[] = [];
      let rem = trimmed;
      while (rem.length > 0) {
        const matched = knownStateIdsSorted.find(
          (id) => rem === id || rem.startsWith(`${id},`),
        );
        if (matched) {
          result.push(matched);
          rem = rem.slice(matched.length).replace(/^,\s*/, '');
        } else {
          const nextComma = rem.indexOf(',');
          if (nextComma === -1) {
            result.push(rem.trim());
            break;
          }
          result.push(rem.slice(0, nextComma).trim());
          rem = rem.slice(nextComma + 1).trim();
        }
      }
      return result.filter(Boolean);
    }

    for (const edgeGroup of Array.from(svgEl.querySelectorAll('g.transition-edge'))) {
      const id = edgeGroup.getAttribute('data-edge-id') || '';
      const sourceId = edgeGroup.getAttribute('data-edge-source') || '';
      const targetIds = parseTargetIdsAttr(
        edgeGroup.getAttribute('data-edge-targets') || '',
      );

      const labelBgEl = edgeGroup.querySelector(
        'g.edge-label .edge-label-bg',
      ) as SVGGraphicsElement | null;
      const labelTextEl = edgeGroup.querySelector(
        'g.edge-label text.edge-label-text',
      ) as SVGGraphicsElement | null;
      const labelBox = labelBgEl ? getRootBBox(labelBgEl) : null;

      // Measure atomic clause widths for `edge-label-multiline-wrap`
      const tr = astTrMap.get(id);
      const rawDataEvent = edgeGroup.getAttribute('data-edge-event') || '';
      const eventStr = tr ? tr.eventType : rawDataEvent;
      const guardStr = tr
        ? tr.guard
        : edgeGroup.getAttribute('data-edge-guard') || null;
      const rawDataActions = edgeGroup.getAttribute('data-edge-actions') || '';
      const actionsArr = tr
        ? tr.actions
        : rawDataActions
          ? rawDataActions
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [];

      const rawRenderedTxt = (labelTextEl?.textContent || '').trim();
      const orderPfxMatch = rawRenderedTxt.match(/^(\[#\d+\]\s+)/);
      const eventClause = `${orderPfxMatch ? orderPfxMatch[1] : ''}${eventStr}`;
      const eventFont =
        '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      const monoFont =
        '400 10.5px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

      const clauseWidths: number[] = [measureTextPx(eventClause, eventFont)];
      if (guardStr && guardStr.length > 0) {
        clauseWidths.push(measureTextPx(`[${guardStr}]`, monoFont));
      }
      actionsArr.forEach((act, idx) => {
        const prefix = idx === 0 ? '/ ' : '';
        const suffix = idx < actionsArr.length - 1 ? ',' : '';
        clauseWidths.push(measureTextPx(`${prefix}${act}${suffix}`, monoFont));
      });
      const clauseCount = clauseWidths.length;
      const maxAtomicTokenWidthPx = Math.max(...clauseWidths);

      const pathEls = Array.from(
        edgeGroup.querySelectorAll('path.edge-path'),
      ) as SVGPathElement[];

      const paths = pathEls.map((pEl) => {
        const d = pEl.getAttribute('d') || '';
        const rawBranchTarget = (pEl.getAttribute('data-edge-target') || '').trim();
        const branchTargetId = rawBranchTarget.length > 0 ? rawBranchTarget : null;
        const hasMarkerEnd =
          (pEl.getAttribute('marker-end') || '').includes('url(') ||
          window.getComputedStyle(pEl).markerEnd.includes('url(');
        const matrix = getMatrix(pEl);
        const totalLength = pEl.getTotalLength();

        let startPt: { x: number; y: number } | null = null;
        let endPt: { x: number; y: number } | null = null;
        let startTangent: { x: number; y: number } | null = null;
        let endTangent: { x: number; y: number } | null = null;

        if (totalLength > 0) {
          const p0Local = pEl.getPointAtLength(0);
          const pEndLocal = pEl.getPointAtLength(totalLength);
          startPt = toRootPoint(pEl, p0Local.x, p0Local.y);
          endPt = toRootPoint(pEl, pEndLocal.x, pEndLocal.y);

          if (totalLength >= 0.5) {
            const s1 = Math.min(1.5, totalLength);
            const p1Local = pEl.getPointAtLength(s1);
            const p1 = toRootPoint(pEl, p1Local.x, p1Local.y);
            const dx0 = p1.x - startPt.x;
            const dy0 = p1.y - startPt.y;
            const len0 = Math.hypot(dx0, dy0);
            if (len0 > 1e-6) {
              startTangent = { x: dx0 / len0, y: dy0 / len0 };
            }

            const sPrev = Math.max(0, totalLength - 1.5);
            const pPrevLocal = pEl.getPointAtLength(sPrev);
            const pPrev = toRootPoint(pEl, pPrevLocal.x, pPrevLocal.y);
            const dxE = endPt.x - pPrev.x;
            const dyE = endPt.y - pPrev.y;
            const lenE = Math.hypot(dxE, dyE);
            if (lenE > 1e-6) {
              endTangent = { x: dxE / lenE, y: dyE / lenE };
            }
          }
        }

        const interiorSamples2px: Array<{ x: number; y: number }> = [];
        for (let s = 2; s <= totalLength - 2; s += 2) {
          const pt = pEl.getPointAtLength(s);
          interiorSamples2px.push(toRootPoint(pEl, pt.x, pt.y));
        }
        if (totalLength > 2.0 && interiorSamples2px.length === 0) {
          const pt = pEl.getPointAtLength(totalLength / 2);
          interiorSamples2px.push(toRootPoint(pEl, pt.x, pt.y));
        }

        const densePoints2px: Array<{ x: number; y: number }> = [];
        if (totalLength > 0) {
          const steps = Math.max(1, Math.ceil(totalLength / 2));
          for (let i = 0; i <= steps; i++) {
            const pt = pEl.getPointAtLength((i / steps) * totalLength);
            densePoints2px.push(toRootPoint(pEl, pt.x, pt.y));
          }
        }

        return {
          d,
          branchTargetId,
          hasMarkerEnd,
          matrix,
          totalLength,
          startPt,
          endPt,
          startTangent,
          endTangent,
          interiorSamples2px,
          densePoints2px,
        };
      });

      edges.push({
        id,
        sourceId,
        targetIds,
        labelBox,
        clauseCount,
        maxAtomicTokenWidthPx,
        paths,
      });
    }

      return { viewBox, states, initialDots, edges };
    },
    { selector: svgSelector, astTransitions: ast.transitions },
  );

  if (!domGeometry) {
    return {
      passed: false,
      violations: [
        {
          rule: 'text-label-collision',
          elements: [svgSelector],
          message: `SVG element matching "${svgSelector}" not found`,
        },
      ],
      metrics: {
        minSiblingClearancePx: null,
        minParentInsetPx: null,
        textCollisionCount: 0,
        maxLabelOwnPathDistPx: 0,
        minVoronoiMarginPx: null,
        aspectRatioMax: null,
        maxLabelPillWidthPx: 0,
      },
    };
  }

  const geom = domGeometry;
  const violations: Gate2Violation[] = [];
  const stateMap = new Map(geom.states.map((s) => [s.id, s]));

  // =========================================================================
  // Phase 5 Compactness Guardrails:
  //   - `diagram-aspect-ratio` (<= 3.5:1 for >= 2 states under default AUTO)
  //   - `edge-label-multiline-wrap` (splittable multi-clause pill <= 280px)
  // =========================================================================
  const aspectRatioMax =
    geom.viewBox.width > 0 && geom.viewBox.height > 0
      ? Math.max(
          geom.viewBox.width / geom.viewBox.height,
          geom.viewBox.height / geom.viewBox.width,
        )
      : null;

  if (
    !options.skipAspectRatioCheck &&
    geom.states.length >= 2 &&
    aspectRatioMax !== null &&
    aspectRatioMax > 3.5
  ) {
    violations.push({
      rule: 'diagram-aspect-ratio',
      elements: ['svg'],
      message: `Diagram viewBox (${geom.viewBox.width.toFixed(1)}x${geom.viewBox.height.toFixed(1)}) has extreme aspect ratio ${aspectRatioMax.toFixed(2)}:1 (max 3.50:1 allowed for >= 2 states)`,
    });
  }

  let maxLabelPillWidthPx = 0;
  for (const edge of geom.edges) {
    if (!edge.labelBox) continue;
    maxLabelPillWidthPx = Math.max(maxLabelPillWidthPx, edge.labelBox.width);
    if (edge.clauseCount >= 2) {
      if (edge.maxAtomicTokenWidthPx <= 250.0 && edge.labelBox.width > 280.0) {
        violations.push({
          rule: 'edge-label-multiline-wrap',
          elements: [edge.id],
          message: `Transition "${edge.id}" has a splittable ${edge.clauseCount}-clause label with .edge-label-bg width ${edge.labelBox.width.toFixed(1)}px > 280px (max atomic token width is ${edge.maxAtomicTokenWidthPx.toFixed(1)}px <= 250px; must wrap onto stacked lines)`,
        });
      } else if (
        edge.maxAtomicTokenWidthPx > 250.0 &&
        edge.labelBox.width > edge.maxAtomicTokenWidthPx + 40.0
      ) {
        violations.push({
          rule: 'edge-label-multiline-wrap',
          elements: [edge.id],
          message: `Transition "${edge.id}" has a splittable ${edge.clauseCount}-clause label with .edge-label-bg width ${edge.labelBox.width.toFixed(1)}px > ${(edge.maxAtomicTokenWidthPx + 40.0).toFixed(1)}px (must wrap clauses onto stacked lines)`,
        });
      }
    }
  }

  // Precompute header + parent-compartment band bottom Y for every container state
  const headerZoneBottomY = new Map<string, number>();
  for (const st of domGeometry.states) {
    let bottomY = st.box.y;
    if (st.titleBox) {
      bottomY = Math.max(bottomY, st.titleBox.y + st.titleBox.height);
    }
    for (const dy of st.dividerYs) {
      bottomY = Math.max(bottomY, dy);
    }
    for (const c of st.compartmentTextBoxes) {
      bottomY = Math.max(bottomY, c.box.y + c.box.height);
    }
    for (const t of st.tagBoxes) {
      bottomY = Math.max(bottomY, t.box.y + t.box.height);
    }
    headerZoneBottomY.set(st.id, bottomY);
  }

  // =========================================================================
  // Rule 1: Strict Parent Containment (>= 8px inset) & Header/Compartment Clearance
  // =========================================================================
  let minParentInsetPx: number | null = null;
  for (const child of domGeometry.states) {
    if (!child.parentId) continue;
    const parent = stateMap.get(child.parentId);
    if (!parent) continue;

    if (parent.type === 'parallel' || ast.nodes[parent.id]?.type === 'parallel') {
      const dash = child.strokeDasharray;
      if (!dash || dash === 'none' || dash === '0px' || dash === '0') {
        violations.push({
          rule: 'parallel-region-dashed',
          elements: [child.id, parent.id],
          message: `Direct child region "${child.id}" inside parallel state "${parent.id}" must render a dashed .state-box border (got stroke-dasharray="${dash || 'none'}")`,
        });
      }
    }

    const leftInset = child.box.x - parent.box.x;
    const topInset = child.box.y - parent.box.y;
    const rightInset = parent.box.x + parent.box.width - (child.box.x + child.box.width);
    const bottomInset = parent.box.y + parent.box.height - (child.box.y + child.box.height);
    const minInset = Math.min(leftInset, topInset, rightInset, bottomInset);

    minParentInsetPx =
      minParentInsetPx === null ? minInset : Math.min(minParentInsetPx, minInset);

    if (minInset < 7.95) {
      violations.push({
        rule: 'parent-containment-inset',
        elements: [child.id, parent.id],
        message: `Child "${child.id}" is inset by only ${minInset.toFixed(2)}px inside parent "${parent.id}" (left=${leftInset.toFixed(1)}, top=${topInset.toFixed(1)}, right=${rightInset.toFixed(1)}, bottom=${bottomInset.toFixed(1)}; min 8px required)`,
      });
    }

    const parentBandBottom = headerZoneBottomY.get(parent.id) ?? parent.box.y;
    if (child.box.y < parentBandBottom + 1.5) {
      violations.push({
        rule: 'parent-header-clearance',
        elements: [child.id, `${parent.id}:header-zone`],
        message: `Child "${child.id}" top (y=${child.box.y.toFixed(1)}) intrudes into parent "${parent.id}" header/compartment band (bottom y=${parentBandBottom.toFixed(1)})`,
      });
    }

    if (parent.titleBox && boxesIntersectionArea(child.box, parent.titleBox) > 0) {
      violations.push({
        rule: 'parent-header-clearance',
        elements: [child.id, `${parent.id}:title`],
        message: `Child "${child.id}" overlaps parent "${parent.id}" title header`,
      });
    }

    for (const comp of parent.compartmentTextBoxes) {
      if (boxesIntersectionArea(child.box, comp.box) > 0) {
        violations.push({
          rule: 'parent-header-clearance',
          elements: [child.id, comp.id],
          message: `Child "${child.id}" overlaps parent compartment row "${comp.id}"`,
        });
      }
    }

    for (const tag of parent.tagBoxes) {
      if (boxesIntersectionArea(child.box, tag.box) > 0) {
        violations.push({
          rule: 'parent-header-clearance',
          elements: [child.id, tag.id],
          message: `Child "${child.id}" overlaps parent tag "${tag.id}"`,
        });
      }
    }
  }

  // Compound initial-indicator clearance from parent borders, parent header/compartment band, and sibling states
  for (const dot of domGeometry.initialDots) {
    const allowedDotContainers = new Set<string>();
    if (dot.parentId) {
      allowedDotContainers.add(dot.parentId);
      for (const anc of ancestorsOf.get(dot.parentId) ?? []) {
        allowedDotContainers.add(anc);
      }
      const parent = stateMap.get(dot.parentId);
      if (parent) {
        const parentBandBottom = headerZoneBottomY.get(parent.id) ?? parent.box.y;
        if (dot.box.y < parentBandBottom + 1.5) {
          violations.push({
            rule: 'parent-header-clearance',
            elements: [dot.id, `${parent.id}:header-zone`],
            message: `Compound initial dot "${dot.id}" (y=${dot.box.y.toFixed(1)}) intrudes into parent "${parent.id}" header/compartment band (bottom y=${parentBandBottom.toFixed(1)})`,
          });
        }
        if (dot.edgeBox && dot.edgeBox.y < parentBandBottom + 1.0) {
          violations.push({
            rule: 'parent-header-clearance',
            elements: [dot.id, `${parent.id}:header-zone`],
            message: `Compound initial edge "${dot.id}" (y=${dot.edgeBox.y.toFixed(1)}) intrudes into parent "${parent.id}" header/compartment band (bottom y=${parentBandBottom.toFixed(1)})`,
          });
        }
      }
    }
    for (const st of domGeometry.states) {
      if (allowedDotContainers.has(st.id)) continue;
      if (boxesIntersectionArea(dot.box, st.box) > 0) {
        violations.push({
          rule: 'sibling-overlap-clearance',
          elements: [dot.id, st.id],
          message: `Initial pseudostate dot "${dot.id}" overlaps state box "${st.id}"`,
        });
      }
    }
  }

  // =========================================================================
  // Rule 2: Sibling State Non-Overlap (>= 12px edge-to-edge clearance)
  // =========================================================================
  let minSiblingClearancePx: number | null = null;
  for (let i = 0; i < domGeometry.states.length; i++) {
    for (let j = i + 1; j < domGeometry.states.length; j++) {
      const a = domGeometry.states[i];
      const b = domGeometry.states[j];
      if ((a.parentId ?? null) !== (b.parentId ?? null)) continue;

      const clearance = boxesEdgeClearance(a.box, b.box);
      minSiblingClearancePx =
        minSiblingClearancePx === null
          ? clearance
          : Math.min(minSiblingClearancePx, clearance);

      if (boxesIntersectionArea(a.box, b.box) > 0 || clearance < 11.95) {
        violations.push({
          rule: 'sibling-overlap-clearance',
          elements: [a.id, b.id],
          message: `Sibling states "${a.id}" and "${b.id}" have clearance ${clearance.toFixed(2)}px (min 12px required)`,
        });
      }
    }
  }

  // =========================================================================
  // Rule 3: Zero Text & Label Collisions (+ state text fitting inside state box)
  // =========================================================================
  const textAndLabelItems: Array<{ id: string; box: BBox }> = [];

  for (const st of domGeometry.states) {
    if (st.type === 'history') {
      const isCircle =
        st.shapeKind === 'circle' && Math.abs(st.box.width - st.box.height) <= 1.5;
      const isCapsule =
        st.shapeKind === 'rect' && st.rx >= st.box.height / 2 - 2.0;
      if (!isCircle && !isCapsule) {
        violations.push({
          rule: 'history-node-shape',
          elements: [st.id],
          message: `History pseudostate "${st.id}" must render as a circle or rounded capsule (got kind=${st.shapeKind}, rx=${st.rx.toFixed(1)}, size=${st.box.width.toFixed(1)}x${st.box.height.toFixed(1)})`,
        });
      }
    }
    const innerPad = st.type === 'history' ? 0.5 : 2.0;
    if (st.titleBox) {
      textAndLabelItems.push({ id: `title:${st.id}`, box: st.titleBox });
      if (
        st.titleBox.x < st.box.x + innerPad ||
        st.titleBox.y < st.box.y + innerPad ||
        st.titleBox.x + st.titleBox.width > st.box.x + st.box.width - innerPad ||
        st.titleBox.y + st.titleBox.height > st.box.y + st.box.height - innerPad
      ) {
        violations.push({
          rule: 'text-box-overflow',
          elements: [`title:${st.id}`, st.id],
          message: `State title "${st.id}" (${st.titleBox.width.toFixed(1)}x${st.titleBox.height.toFixed(1)}) touches or overflows its .state-box (${st.box.width.toFixed(1)}x${st.box.height.toFixed(1)})`,
        });
      }
      for (const divY of st.dividerYs) {
        if (divY >= st.titleBox.y - 1.0 && divY <= st.titleBox.y + st.titleBox.height + 1.0) {
          violations.push({
            rule: 'divider-overlap',
            elements: [`title:${st.id}`, st.id],
            message: `State "${st.id}" divider line (y=${divY.toFixed(1)}) intersects .state-title (${st.titleBox.y.toFixed(1)}..${(st.titleBox.y + st.titleBox.height).toFixed(1)})`,
          });
        }
      }
    }
    for (const c of st.compartmentTextBoxes) {
      textAndLabelItems.push({ id: c.id, box: c.box });
      if (
        c.box.x < st.box.x + 2.0 ||
        c.box.y < st.box.y + 2.0 ||
        c.box.x + c.box.width > st.box.x + st.box.width - 2.0 ||
        c.box.y + c.box.height > st.box.y + st.box.height - 2.0
      ) {
        violations.push({
          rule: 'text-box-overflow',
          elements: [c.id, st.id],
          message: `Compartment row "${c.id}" (${c.box.width.toFixed(1)}px wide) touches or overflows state "${st.id}" .state-box (${st.box.width.toFixed(1)}px wide)`,
        });
      }
      for (const divY of st.dividerYs) {
        if (divY >= c.box.y - 1.0 && divY <= c.box.y + c.box.height + 1.0) {
          violations.push({
            rule: 'divider-overlap',
            elements: [c.id, st.id],
            message: `State "${st.id}" divider line (y=${divY.toFixed(1)}) intersects compartment row "${c.id}" (${c.box.y.toFixed(1)}..${(c.box.y + c.box.height).toFixed(1)})`,
          });
        }
      }
    }
    for (const t of st.tagBoxes) {
      textAndLabelItems.push({ id: t.id, box: t.box });
      if (
        t.box.x < st.box.x + 2.0 ||
        t.box.y < st.box.y + 2.0 ||
        t.box.x + t.box.width > st.box.x + st.box.width - 2.0 ||
        t.box.y + t.box.height > st.box.y + st.box.height - 2.0
      ) {
        violations.push({
          rule: 'text-box-overflow',
          elements: [t.id, st.id],
          message: `Tag "${t.id}" touches or overflows state "${st.id}" .state-box`,
        });
      }
      for (const divY of st.dividerYs) {
        if (divY >= t.box.y - 1.0 && divY <= t.box.y + t.box.height + 1.0) {
          violations.push({
            rule: 'divider-overlap',
            elements: [t.id, st.id],
            message: `State "${st.id}" divider line (y=${divY.toFixed(1)}) intersects tag "${t.id}"`,
          });
        }
      }
    }

    // Compact atomic/final node proportion check (avoid unnecessary vertical bloat)
    if (st.type === 'atomic' || st.type === 'final') {
      const incidentEdges = domGeometry.edges.filter(
        (e) => e.sourceId === st.id || e.targetIds.includes(st.id),
      ).length;
      const compRows = st.compartmentTextBoxes.length + (st.tagBoxes.length > 0 ? Math.ceil(st.tagBoxes.length / 2) : 0);
      const expectedContentH = 40 + compRows * 22 + st.dividerYs.length * 14;
      const expectedPortH = 28 + Math.max(1, incidentEdges) * 44;
      const maxAllowedHeight = Math.max(expectedContentH, expectedPortH, 68) + 64;
      if (st.box.height > maxAllowedHeight) {
        violations.push({
          rule: 'atomic-node-proportion',
          elements: [st.id],
          message: `Atomic/final state "${st.id}" has bloated height ${st.box.height.toFixed(1)}px (max reasonable height ${maxAllowedHeight}px for ${compRows} compartment rows and ${incidentEdges} incident transitions)`,
        });
      }
    }
  }

  for (const edge of domGeometry.edges) {
    if (edge.labelBox) {
      textAndLabelItems.push({ id: `label:${edge.id}`, box: edge.labelBox });
    }
  }

  let textCollisionCount = 0;
  for (let i = 0; i < textAndLabelItems.length; i++) {
    for (let j = i + 1; j < textAndLabelItems.length; j++) {
      const a = textAndLabelItems[i];
      const b = textAndLabelItems[j];
      const area = boxesIntersectionArea(a.box, b.box);
      if (area > 0) {
        textCollisionCount++;
        violations.push({
          rule: 'text-label-collision',
          elements: [a.id, b.id],
          message: `"${a.id}" and "${b.id}" collide (intersectionArea=${area.toFixed(1)}px²)`,
        });
      } else if (a.id.startsWith('label:') && b.id.startsWith('label:')) {
        const labelClearance = boxesEdgeClearance(a.box, b.box);
        if (labelClearance < 13.95) {
          violations.push({
            rule: 'multi-edge-channel-separation',
            elements: [a.id, b.id],
            message: `Transition label pills "${a.id}" and "${b.id}" have edge-to-edge clearance ${labelClearance.toFixed(2)}px (min 14px required per ARCHITECTURE.md §5)`,
          });
        }
      }
    }
  }

  // Check `.edge-label-bg` against `.state-box` borders/interiors and `.initial-dot`
  for (const edge of domGeometry.edges) {
    if (!edge.labelBox) continue;
    const lb = edge.labelBox;

    // Permitted enclosing containers = strict ancestors of sourceId or any targetId
    const allowedContainers = new Set<string>();
    for (const anc of ancestorsOf.get(edge.sourceId) ?? []) {
      allowedContainers.add(anc);
    }
    for (const tId of edge.targetIds) {
      for (const anc of ancestorsOf.get(tId) ?? []) {
        allowedContainers.add(anc);
      }
    }

    for (const st of domGeometry.states) {
      const area = boxesIntersectionArea(lb, st.box);
      if (area <= 0) continue;

      if (!allowedContainers.has(st.id)) {
        violations.push({
          rule: 'label-border-collision',
          elements: [`label:${edge.id}`, st.id],
          message: `Edge label "${edge.id}" overlaps state box "${st.id}" (intersectionArea=${area.toFixed(1)}px²)`,
        });
      } else {
        // Allowed ancestor container: label must lie strictly inside without crossing the container's border
        const strictlyInside =
          lb.x >= st.box.x + 1.5 &&
          lb.y >= st.box.y + 1.5 &&
          lb.x + lb.width <= st.box.x + st.box.width - 1.5 &&
          lb.y + lb.height <= st.box.y + st.box.height - 1.5;
        if (!strictlyInside) {
          violations.push({
            rule: 'label-border-collision',
            elements: [`label:${edge.id}`, st.id],
            message: `Edge label "${edge.id}" intersects the border of ancestor container "${st.id}"`,
          });
        } else if (st.type === 'compound' || st.type === 'parallel') {
          const bandBottom = headerZoneBottomY.get(st.id) ?? st.box.y;
          if (lb.y < bandBottom + 1.5) {
            violations.push({
              rule: 'parent-header-clearance',
              elements: [`label:${edge.id}`, `${st.id}:header-zone`],
              message: `Edge label "${edge.id}" (y=${lb.y.toFixed(1)}) intrudes into ancestor "${st.id}" header/compartment band (bottom y=${bandBottom.toFixed(1)})`,
            });
          }
        }
      }
    }

    for (const dot of domGeometry.initialDots) {
      if (boxesIntersectionArea(lb, dot.box) > 0) {
        violations.push({
          rule: 'label-border-collision',
          elements: [`label:${edge.id}`, dot.id],
          message: `Edge label "${edge.id}" overlaps initial pseudostate dot "${dot.id}"`,
        });
      }
    }
  }

  // =========================================================================
  // Rule 4: Edge Obstacle Avoidance & Terminal Tangent Orientation
  // =========================================================================
  function shapeSignedDistance(pt: Point, st: (typeof geom.states)[number]): number {
    const hw = st.box.width / 2;
    const hh = st.box.height / 2;
    const cx = st.box.x + hw;
    const cy = st.box.y + hh;
    if (st.shapeKind === 'circle') {
      return Math.hypot(pt.x - cx, pt.y - cy) - hw;
    }
    const rad = Math.min(Math.max(0, st.rx), hw, hh);
    const qx = Math.abs(pt.x - cx) - (hw - rad);
    const qy = Math.abs(pt.y - cy) - (hh - rad);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
  }

  function isPointStrictlyInsideState(pt: Point, st: (typeof geom.states)[number]): boolean {
    return shapeSignedDistance(pt, st) < -0.5;
  }

  function outwardNormalOfShape(pt: Point, st: (typeof geom.states)[number]): Point {
    const hw = st.box.width / 2;
    const hh = st.box.height / 2;
    const cx = st.box.x + hw;
    const cy = st.box.y + hh;
    if (st.shapeKind === 'circle') {
      const dx = pt.x - cx;
      const dy = pt.y - cy;
      const len = Math.hypot(dx, dy);
      return len > 1e-6 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 };
    }
    const rad = Math.min(Math.max(0, st.rx), hw, hh);
    const dx = pt.x - cx;
    const dy = pt.y - cy;
    const sx = Math.max(-(hw - rad), Math.min(hw - rad, dx));
    const sy = Math.max(-(hh - rad), Math.min(hh - rad, dy));
    const vx = dx - sx;
    const vy = dy - sy;
    const vLen = Math.hypot(vx, vy);
    if (vLen > 1e-4) {
      return { x: vx / vLen, y: vy / vLen };
    }
    const dLeft = Math.abs(pt.x - st.box.x);
    const dRight = Math.abs(pt.x - (st.box.x + st.box.width));
    const dTop = Math.abs(pt.y - st.box.y);
    const dBottom = Math.abs(pt.y - (st.box.y + st.box.height));
    const m = Math.min(dLeft, dRight, dTop, dBottom);
    if (m === dLeft) return { x: -1, y: 0 };
    if (m === dRight) return { x: 1, y: 0 };
    if (m === dTop) return { x: 0, y: -1 };
    return { x: 0, y: 1 };
  }

  for (const edge of domGeometry.edges) {
    const unionAllowedContainers = new Set<string>();
    for (const anc of ancestorsOf.get(edge.sourceId) ?? []) {
      unionAllowedContainers.add(anc);
    }
    for (const tId of edge.targetIds) {
      for (const anc of ancestorsOf.get(tId) ?? []) {
        unionAllowedContainers.add(anc);
      }
    }

    const srcSt = stateMap.get(edge.sourceId);
    const sourceIsTargetAncestor = edge.targetIds.some(
      (tId) => ancestorsOf.get(tId)?.has(edge.sourceId) ?? false,
    );
    const sourceAncestors = ancestorsOf.get(edge.sourceId) ?? new Set<string>();

    const piercedStates = new Set<string>();
    for (const p of edge.paths) {
      let pathAllowed = unionAllowedContainers;
      if (p.branchTargetId && ancestorsOf.has(p.branchTargetId)) {
        pathAllowed = new Set<string>();
        for (const anc of ancestorsOf.get(edge.sourceId) ?? []) {
          pathAllowed.add(anc);
        }
        for (const anc of ancestorsOf.get(p.branchTargetId) ?? []) {
          pathAllowed.add(anc);
        }
      }
      for (const sample of p.interiorSamples2px) {
        for (const st of domGeometry.states) {
          if (pathAllowed.has(st.id)) continue;
          if (isPointStrictlyInsideState(sample, st)) {
            if (!piercedStates.has(st.id)) {
              piercedStates.add(st.id);
              violations.push({
                rule: 'edge-obstacle-piercing',
                elements: [edge.id, st.id],
                message: `Transition "${edge.id}" (${edge.sourceId} -> ${edge.targetIds.join(',')}) pierces interior of state "${st.id}" at (${sample.x.toFixed(1)}, ${sample.y.toFixed(1)})`,
              });
            }
          }
        }
      }

      // Terminal departure tangent check at s in [0, 1.5]
      if (
        srcSt &&
        p.startPt &&
        p.startTangent &&
        !sourceIsTargetAncestor &&
        Math.abs(shapeSignedDistance(p.startPt, srcSt)) <= 3.5
      ) {
        const nOut = outwardNormalOfShape(p.startPt, srcSt);
        const dotOut = p.startTangent.x * nOut.x + p.startTangent.y * nOut.y;
        if (dotOut < 0.5) {
          violations.push({
            rule: 'terminal-tangent-direction',
            elements: [edge.id, edge.sourceId],
            message: `Transition "${edge.id}" departs "${edge.sourceId}" at (${p.startPt.x.toFixed(1)}, ${p.startPt.y.toFixed(1)}) inward or tangentially (dotOut=${dotOut.toFixed(2)}, min 0.50 outward required)`,
          });
        }
      }

      // Terminal arrival tangent check at s in [len - 1.5, len] on marked paths
      if (p.hasMarkerEnd && p.endPt && p.endTangent && edge.targetIds.length > 0) {
        let resolvedTargetId: string | null =
          p.branchTargetId && stateMap.has(p.branchTargetId) ? p.branchTargetId : null;
        if (!resolvedTargetId) {
          if (edge.targetIds.length === 1) {
            resolvedTargetId = edge.targetIds[0];
          } else {
            let bestDist = Infinity;
            for (const candId of edge.targetIds) {
              const candSt = stateMap.get(candId);
              if (!candSt) continue;
              const d = Math.abs(shapeSignedDistance(p.endPt, candSt));
              if (d < bestDist) {
                bestDist = d;
                resolvedTargetId = candId;
              }
            }
          }
        }
        if (resolvedTargetId && !sourceAncestors.has(resolvedTargetId)) {
          const tgtSt = stateMap.get(resolvedTargetId);
          if (tgtSt && Math.abs(shapeSignedDistance(p.endPt, tgtSt)) <= 3.5) {
            const nOut = outwardNormalOfShape(p.endPt, tgtSt);
            const dotIn = p.endTangent.x * -nOut.x + p.endTangent.y * -nOut.y;
            if (dotIn < 0.5) {
              violations.push({
                rule: 'terminal-tangent-direction',
                elements: [edge.id, resolvedTargetId],
                message: `Transition "${edge.id}" arrives at "${resolvedTargetId}" (${p.endPt.x.toFixed(1)}, ${p.endPt.y.toFixed(1)}) with inverted or grazing arrowhead tangent (dotIn=${dotIn.toFixed(2)}, min 0.50 inward required)`,
              });
            }
          }
        }
      }
    }
  }

  // Also verify initial indicator edges don't pierce unrelated boxes
  for (const dot of domGeometry.initialDots) {
    const allowed = new Set<string>();
    if (dot.parentId) {
      allowed.add(dot.parentId);
      for (const anc of ancestorsOf.get(dot.parentId) ?? []) {
        allowed.add(anc);
      }
    }
    for (const sample of dot.interiorSamples) {
      for (const st of domGeometry.states) {
        if (allowed.has(st.id)) continue;
        if (isPointStrictlyInsideState(sample, st)) {
          violations.push({
            rule: 'edge-obstacle-piercing',
            elements: [dot.id, st.id],
            message: `Initial indicator edge "${dot.id}" pierces state "${st.id}" at (${sample.x.toFixed(1)}, ${sample.y.toFixed(1)})`,
          });
          break;
        }
      }
    }
  }

  // =========================================================================
  // Rule 5: Strict Orthogonal Edge Segments, Forward-Edge Detour Cap & No Collinear Overlaps
  // =========================================================================
  const orderedAncestorsOf = (stateId: string): string[] => {
    const res: string[] = [];
    let cur = ast.nodes[stateId]?.parentId ?? null;
    while (cur) {
      res.push(cur);
      cur = ast.nodes[cur]?.parentId ?? null;
    }
    return res;
  };

  const isDescendantInScope = (stateId: string, scopeAnc: string | null): boolean =>
    scopeAnc === null ? true : (ancestorsOf.get(stateId)?.has(scopeAnc) ?? false);

  const lcaOfPair = (u: string, v: string): string | null => {
    const aSet = ancestorsOf.get(u) ?? new Set<string>();
    for (const b of orderedAncestorsOf(v)) {
      if (aSet.has(b)) return b;
    }
    return null;
  };

  const scopeAdjCache = new Map<string, Map<string, Set<string>>>();
  const getScopeAdjacency = (scopeAnc: string | null): Map<string, Set<string>> => {
    const key = scopeAnc ?? '__root__';
    const cached = scopeAdjCache.get(key);
    if (cached) return cached;

    const adj = new Map<string, Set<string>>();
    const addEdge = (from: string, to: string) => {
      let s = adj.get(from);
      if (!s) {
        s = new Set<string>();
        adj.set(from, s);
      }
      s.add(to);
    };

    const allNodes = Object.values(ast.nodes);
    for (const n of allNodes) {
      if (!isDescendantInScope(n.id, scopeAnc)) continue;
      if (n.type === 'compound' && n.initialTargetId) {
        addEdge(n.id, n.initialTargetId);
      } else if (n.type === 'parallel') {
        for (const c of allNodes) {
          if (c.parentId === n.id) addEdge(n.id, c.id);
        }
      } else if (n.type === 'history' && n.parentId) {
        for (const c of allNodes) {
          if (c.id !== n.id && (ancestorsOf.get(c.id)?.has(n.parentId) ?? false)) {
            addEdge(n.id, c.id);
          }
        }
      }
    }

    for (const tr of ast.transitions) {
      if (!isDescendantInScope(tr.sourceId, scopeAnc)) continue;
      for (const tId of tr.targetIds) {
        if (!isDescendantInScope(tId, scopeAnc)) continue;
        addEdge(tr.sourceId, tId);
        for (const n of allNodes) {
          if (ancestorsOf.get(n.id)?.has(tr.sourceId)) {
            addEdge(n.id, tId);
          }
        }
      }
    }

    scopeAdjCache.set(key, adj);
    return adj;
  };

  const canReachWithinScope = (
    startId: string,
    goalId: string,
    scopeAnc: string | null,
  ): boolean => {
    const adj = getScopeAdjacency(scopeAnc);
    const goals = new Set<string>([goalId]);
    for (const nId of Object.keys(ast.nodes)) {
      if (ancestorsOf.get(nId)?.has(goalId)) goals.add(nId);
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

  for (const edge of domGeometry.edges) {
    for (const p of edge.paths) {
      for (const s of parsePathExplicitLinearSegments(p.d, p.matrix)) {
        const dx = Math.abs(s.x2 - s.x1);
        const dy = Math.abs(s.y2 - s.y1);
        if (dx > 2.0 && dy > 2.0) {
          violations.push({
            rule: 'orthogonal-edge-segments',
            elements: [edge.id],
            message: `Transition "${edge.id}" contains non-orthogonal diagonal segment (${s.x1.toFixed(1)}, ${s.y1.toFixed(1)}) -> (${s.x2.toFixed(1)}, ${s.y2.toFixed(1)}) (dx=${dx.toFixed(1)}px, dy=${dy.toFixed(1)}px)`,
          });
          break;
        }
      }
    }

    // Non-cycle forward-edge detour & upside-down roller-coaster wrap check
    if (edge.targetIds.length === 1 && edge.paths.length === 1) {
      const targetId = edge.targetIds[0];
      const p0 = edge.paths[0];
      if (
        edge.sourceId !== targetId &&
        p0.startPt &&
        p0.endPt &&
        !(ancestorsOf.get(edge.sourceId)?.has(targetId) ?? false) &&
        !(ancestorsOf.get(targetId)?.has(edge.sourceId) ?? false)
      ) {
        const scopeAnc = lcaOfPair(edge.sourceId, targetId);
        const isCyclic = canReachWithinScope(targetId, edge.sourceId, scopeAnc);
        if (!isCyclic) {
          const directDist = Math.hypot(
            p0.endPt.x - p0.startPt.x,
            p0.endPt.y - p0.startPt.y,
          );
          const maxAllowedLen = Math.max(3.5 * directDist, directDist + 480);
          const upwardClimbPx = p0.startPt.y - p0.endPt.y;
          const srcType = ast.nodes[edge.sourceId]?.type;

          if (p0.totalLength > maxAllowedLen) {
            violations.push({
              rule: 'forward-edge-detour',
              elements: [edge.id],
              message: `Non-cycle forward transition "${edge.id}" (${edge.sourceId} -> ${targetId}) takes an excessive S-maze/roller-coaster detour of ${p0.totalLength.toFixed(0)}px vs ${directDist.toFixed(0)}px direct distance (max ${maxAllowedLen.toFixed(0)}px allowed)`,
            });
          } else if (srcType !== 'history' && upwardClimbPx > 500) {
            violations.push({
              rule: 'forward-edge-detour',
              elements: [edge.id],
              message: `Non-cycle forward transition "${edge.id}" (${edge.sourceId} -> ${targetId}) climbs ${upwardClimbPx.toFixed(0)}px upward against top-to-bottom reading flow (max 500px upward climb allowed)`,
            });
          }
        }
      }
    }
  }

  const edgeSegmentsList = domGeometry.edges.map((edge) => {
    const segs: Segment[] = [];
    for (const p of edge.paths) {
      for (const s of parsePathToStraightSegments(p.d, p.matrix)) {
        if (Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= 2.0) {
          segs.push(s);
        }
      }
    }
    return { edgeId: edge.id, segments: segs };
  });

  for (let i = 0; i < edgeSegmentsList.length; i++) {
    for (let j = i + 1; j < edgeSegmentsList.length; j++) {
      const eA = edgeSegmentsList[i];
      const eB = edgeSegmentsList[j];
      let reportedPair = false;

      for (const sA of eA.segments) {
        if (reportedPair) break;
        const lenA = Math.hypot(sA.x2 - sA.x1, sA.y2 - sA.y1);
        const ux = (sA.x2 - sA.x1) / lenA;
        const uy = (sA.y2 - sA.y1) / lenA;
        const nx = -uy;
        const ny = ux;

        for (const sB of eB.segments) {
          const lenB = Math.hypot(sB.x2 - sB.x1, sB.y2 - sB.y1);
          const vx = (sB.x2 - sB.x1) / lenB;
          const vy = (sB.y2 - sB.y1) / lenB;

          // Parallel check (< ~5 degrees)
          const cross = Math.abs(ux * vy - uy * vx);
          if (cross >= 0.087) continue;

          // Perpendicular distances from sB endpoints to line of sA
          const perp1 = Math.abs((sB.x1 - sA.x1) * nx + (sB.y1 - sA.y1) * ny);
          const perp2 = Math.abs((sB.x2 - sA.x1) * nx + (sB.y2 - sA.y1) * ny);
          if (Math.max(perp1, perp2) >= 4.0) continue;

          // Project onto uA relative to sA.start
          const projA1 = 0;
          const projA2 = lenA;
          const b1 = (sB.x1 - sA.x1) * ux + (sB.y1 - sA.y1) * uy;
          const b2 = (sB.x2 - sA.x1) * ux + (sB.y2 - sA.y1) * uy;
          const minB = Math.min(b1, b2);
          const maxB = Math.max(b1, b2);

          const overlap = Math.min(projA2, maxB) - Math.max(projA1, minB);
          if (overlap > 8.0) {
            reportedPair = true;
            violations.push({
              rule: 'collinear-edge-overlap',
              elements: [eA.edgeId, eB.edgeId],
              message: `Transitions "${eA.edgeId}" and "${eB.edgeId}" share a collinear/parallel segment within ${Math.max(perp1, perp2).toFixed(1)}px overlapping for ${overlap.toFixed(1)}px (max 8px allowed)`,
            });
            break;
          }
        }
      }
    }
  }

  // =========================================================================
  // Rule 6: Voronoi / Nearest-Neighbor Label Attribution
  // =========================================================================
  const edgePolylines = domGeometry.edges.map((edge) => {
    const polySegments: Segment[] = [];
    const unmarkedTrunkSegments: Segment[] = [];
    const markedBranchPolylines: Array<{ targetLabel: string; segments: Segment[] }> = [];

    edge.paths.forEach((p, idx) => {
      const pSegs: Segment[] = [];
      for (let k = 0; k + 1 < p.densePoints2px.length; k++) {
        const seg = {
          x1: p.densePoints2px[k].x,
          y1: p.densePoints2px[k].y,
          x2: p.densePoints2px[k + 1].x,
          y2: p.densePoints2px[k + 1].y,
        };
        polySegments.push(seg);
        pSegs.push(seg);
      }
      if (p.hasMarkerEnd) {
        markedBranchPolylines.push({
          targetLabel: p.branchTargetId || `branch#${idx}`,
          segments: pSegs,
        });
      } else {
        unmarkedTrunkSegments.push(...pSegs);
      }
    });

    const perBranchPolylines = markedBranchPolylines.map((br) => ({
      targetLabel: br.targetLabel,
      segments:
        unmarkedTrunkSegments.length > 0
          ? [...unmarkedTrunkSegments, ...br.segments]
          : br.segments,
    }));

    return {
      edgeId: edge.id,
      sourceId: edge.sourceId,
      targetIds: edge.targetIds,
      labelBox: edge.labelBox,
      polySegments,
      perBranchPolylines,
    };
  });

  // Transition wires must never cut across state titles, compartment rows, or #tag badges
  for (const ep of edgePolylines) {
    if (ep.polySegments.length === 0) continue;
    for (const st of domGeometry.states) {
      if (st.titleBox && boxToPolylineDist(st.titleBox, ep.polySegments) < 1.0) {
        violations.push({
          rule: 'text-label-collision',
          elements: [ep.edgeId, `title:${st.id}`],
          message: `Transition wire "${ep.edgeId}" cuts across or touches state title "${st.id}"`,
        });
      }
      for (const comp of st.compartmentTextBoxes) {
        if (boxToPolylineDist(comp.box, ep.polySegments) < 1.0) {
          violations.push({
            rule: 'text-label-collision',
            elements: [ep.edgeId, comp.id],
            message: `Transition wire "${ep.edgeId}" cuts across or touches compartment row "${comp.id}"`,
          });
        }
      }
      for (const tag of st.tagBoxes) {
        if (boxToPolylineDist(tag.box, ep.polySegments) < 1.0) {
          violations.push({
            rule: 'text-label-collision',
            elements: [ep.edgeId, tag.id],
            message: `Transition wire "${ep.edgeId}" cuts across or touches tag "${tag.id}"`,
          });
        }
      }
    }
  }

  // Port corner-clearance check on rounded rectangular state boxes
  const checkPortCornerClearance = (
    pt: Point,
    stId: string,
    edgeId: string,
    role: 'start' | 'end',
  ) => {
    const st = stateMap.get(stId);
    if (!st || st.shapeKind !== 'rect' || st.rx <= 0) return;
    if (st.type === 'history' && st.rx >= st.box.height / 2 - 2.0) return;
    const { x, y, width, height } = st.box;
    const onVerticalFace =
      Math.abs(pt.x - x) <= 2.5 || Math.abs(pt.x - (x + width)) <= 2.5;
    const onHorizontalFace =
      Math.abs(pt.y - y) <= 2.5 || Math.abs(pt.y - (y + height)) <= 2.5;

    if (onVerticalFace && !onHorizontalFace) {
      const cornerOffset = Math.min(pt.y - y, y + height - pt.y);
      const minRequired = Math.min(st.rx + 3.0, height / 3 - 0.5);
      if (cornerOffset < minRequired) {
        violations.push({
          rule: 'port-corner-clearance',
          elements: [edgeId, stId],
          message: `Transition "${edgeId}" ${role} port at (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)}) is only ${cornerOffset.toFixed(1)}px from corner of "${stId}" (rx=${st.rx}px; min ${minRequired.toFixed(1)}px required to prevent arrowhead overhang)`,
        });
      }
    } else if (onHorizontalFace && !onVerticalFace) {
      const cornerOffset = Math.min(pt.x - x, x + width - pt.x);
      const minRequired = Math.min(st.rx + 3.0, width / 3 - 0.5);
      if (cornerOffset < minRequired) {
        violations.push({
          rule: 'port-corner-clearance',
          elements: [edgeId, stId],
          message: `Transition "${edgeId}" ${role} port at (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)}) is only ${cornerOffset.toFixed(1)}px from corner of "${stId}" (rx=${st.rx}px; min ${minRequired.toFixed(1)}px required to prevent arrowhead overhang)`,
        });
      }
    }
  };

  for (const edge of domGeometry.edges) {
    if (edge.targetIds.length === 1 && edge.paths.length === 1) {
      const pts = edge.paths[0].densePoints2px;
      if (pts.length >= 2) {
        checkPortCornerClearance(pts[0], edge.sourceId, edge.id, 'start');
        checkPortCornerClearance(
          pts[pts.length - 1],
          edge.targetIds[0],
          edge.id,
          'end',
        );
      }
    } else if (edge.targetIds.length >= 2) {
      const srcSt = stateMap.get(edge.sourceId);
      for (const p of edge.paths) {
        const pts = p.densePoints2px;
        if (pts.length < 2) continue;
        if (srcSt && boxToSegmentDist(srcSt.box, { x1: pts[0].x, y1: pts[0].y, x2: pts[0].x, y2: pts[0].y }) <= 4.0) {
          checkPortCornerClearance(pts[0], edge.sourceId, edge.id, 'start');
        }
        if (p.hasMarkerEnd && p.branchTargetId) {
          checkPortCornerClearance(
            pts[pts.length - 1],
            p.branchTargetId,
            edge.id,
            'end',
          );
        }
      }
    }
  }

  // Multi-edge & bidirectional path channel separation (>= 14px per ARCHITECTURE.md §5)
  const edgePairKey = (e: (typeof edgePolylines)[number]): string | null => {
    if (e.targetIds.length === 0) return null;
    if (e.targetIds.length === 1) {
      return [e.sourceId, e.targetIds[0]].sort().join('::');
    }
    return `${e.sourceId}=>${[...e.targetIds].sort().join(',')}`;
  };

  for (let i = 0; i < edgePolylines.length; i++) {
    const eA = edgePolylines[i];
    const pairA = edgePairKey(eA);
    if (!pairA) continue;

    for (let j = i + 1; j < edgePolylines.length; j++) {
      const eB = edgePolylines[j];
      const pairB = edgePairKey(eB);
      if (pairA !== pairB) continue;

      const channelSep = polylineToPolylineDist(eA.polySegments, eB.polySegments);
      if (channelSep < 13.95) {
        violations.push({
          rule: 'multi-edge-channel-separation',
          elements: [eA.edgeId, eB.edgeId],
          message: `Multi/bidirectional transitions "${eA.edgeId}" and "${eB.edgeId}" between the same state pair have path channel separation ${channelSep.toFixed(2)}px (min 14px required per ARCHITECTURE.md §5)`,
        });
      }
    }
  }

  let maxLabelOwnPathDistPx = 0;
  let minVoronoiMarginPx: number | null = null;

  for (let i = 0; i < edgePolylines.length; i++) {
    const eOwn = edgePolylines[i];
    if (!eOwn.labelBox) continue;

    const lb = eOwn.labelBox;
    const center: Point = {
      x: lb.x + lb.width / 2,
      y: lb.y + lb.height / 2,
    };

    const ownBoxDist = boxToPolylineDist(lb, eOwn.polySegments);
    maxLabelOwnPathDistPx = Math.max(maxLabelOwnPathDistPx, ownBoxDist);

    if (ownBoxDist > 14.0) {
      violations.push({
        rule: 'voronoi-label-attribution',
        elements: [eOwn.edgeId],
        message: `Label box for "${eOwn.edgeId}" is ${ownBoxDist.toFixed(2)}px from its own transition path (max 14px allowed)`,
      });
    } else if (eOwn.targetIds.length >= 2 && eOwn.perBranchPolylines.length >= 2) {
      // Multi-target hyperedge label must sit on the shared pre-fork trunk (<= 14px from EVERY branch)
      for (const br of eOwn.perBranchPolylines) {
        const brDist = boxToPolylineDist(lb, br.segments);
        maxLabelOwnPathDistPx = Math.max(maxLabelOwnPathDistPx, brDist);
        if (brDist > 14.0) {
          violations.push({
            rule: 'voronoi-label-attribution',
            elements: [eOwn.edgeId, br.targetLabel],
            message: `Multi-target hyperedge "${eOwn.edgeId}" label pill is ${brDist.toFixed(1)}px from branch "${br.targetLabel}" (must sit on shared pre-fork trunk within <= 14px of every branch)`,
          });
        }
      }
    }

    const ownCenterDist = pointToPolylineDist(center, eOwn.polySegments);

    for (let j = 0; j < edgePolylines.length; j++) {
      if (i === j) continue;
      const eOther = edgePolylines[j];
      const otherBoxDist = boxToPolylineDist(lb, eOther.polySegments);
      if (otherBoxDist < 4.0) {
        violations.push({
          rule: 'voronoi-label-attribution',
          elements: [eOwn.edgeId, eOther.edgeId],
          message: `Label pill box for "${eOwn.edgeId}" intersects or comes within ${otherBoxDist.toFixed(1)}px of foreign transition path "${eOther.edgeId}" (min 4.0px clearance required)`,
        });
      }

      const otherCenterDist = pointToPolylineDist(center, eOther.polySegments);
      const margin = otherCenterDist - ownCenterDist;

      minVoronoiMarginPx =
        minVoronoiMarginPx === null ? margin : Math.min(minVoronoiMarginPx, margin);

      if (!(otherCenterDist > ownCenterDist + 8.0)) {
        violations.push({
          rule: 'voronoi-label-attribution',
          elements: [eOwn.edgeId, eOther.edgeId],
          message: `Label center for "${eOwn.edgeId}" (${center.x.toFixed(1)}, ${center.y.toFixed(1)}) is ${ownCenterDist.toFixed(1)}px from its own path vs ${otherCenterDist.toFixed(1)}px from "${eOther.edgeId}" (margin=${margin.toFixed(1)}px, must be > 8.0px)`,
        });
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    metrics: {
      minSiblingClearancePx,
      minParentInsetPx,
      textCollisionCount,
      maxLabelOwnPathDistPx,
      minVoronoiMarginPx,
      aspectRatioMax,
      maxLabelPillWidthPx,
    },
  };
}
