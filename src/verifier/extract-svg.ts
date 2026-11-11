import type { Page } from 'playwright';
import type {
  InternalTransitionRowAST,
  InvocationAST,
  StateNodeAST,
  StateNodeType,
  StatechartAST,
  TransitionAST,
} from '../ast/types.js';

export interface Gate1Violation {
  rule:
    | 'svg-root'
    | 'visibility'
    | 'text-truthfulness'
    | 'endpoint-connectivity'
    | 'marker-validity'
    | 'endpoint-separation'
    | 'hierarchy-containment';
  elementId: string;
  message: string;
}

export interface Gate1InspectionResult {
  ast: StatechartAST;
  violations: Gate1Violation[];
  metrics: {
    stateCount: number;
    transitionCount: number;
    maxEndpointDistancePx: number;
    minSelfLoopSeparationPx: number | null;
    viewBox: { x: number; y: number; width: number; height: number };
  };
}

function splitTopLevelCommas(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      const piece = raw.slice(start, i).trim();
      if (piece.length > 0) parts.push(piece);
      start = i + 1;
    }
  }
  const tail = raw.slice(start).trim();
  if (tail.length > 0) parts.push(tail);
  return parts;
}

/**
 * Parses a visible transition or internal-row label string back into
 * `{ eventType, guard, actions }` per ARCHITECTURE.md Section 3.3:
 * - `<eventType>`
 * - `<eventType> [<guard>]`
 * - `<eventType> / <action1>, <action2>`
 * - `<eventType> [<guard>] / <action1>, <action2>`
 * Also tolerates optional priority prefix `[#N] `.
 */
export function parseTransitionLabelText(rawText: string): {
  eventType: string;
  guard: string | null;
  actions: string[];
  explicitOrder: number | null;
} {
  let text = rawText.replace(/\s+/g, ' ').trim();
  let explicitOrder: number | null = null;
  const orderMatch = text.match(/^\[#(\d+)\]\s+/);
  if (orderMatch) {
    explicitOrder = parseInt(orderMatch[1], 10) - 1;
    text = text.slice(orderMatch[0].length);
  }

  // Find ` / ` outside `[...]` brackets for actions
  let bracketDepth = 0;
  let slashIndex = -1;
  for (let i = 0; i < text.length - 2; i++) {
    const ch = text[i];
    if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (
      bracketDepth === 0 &&
      text[i] === ' ' &&
      text[i + 1] === '/' &&
      text[i + 2] === ' '
    ) {
      slashIndex = i;
      break;
    }
  }

  let leftPart = text;
  let actions: string[] = [];
  if (slashIndex !== -1) {
    leftPart = text.slice(0, slashIndex).trim();
    const actionsStr = text.slice(slashIndex + 3).trim();
    actions = splitTopLevelCommas(actionsStr);
  }

  let eventType = leftPart;
  let guard: string | null = null;

  if (leftPart.endsWith(']')) {
    // Match outermost ` [` that starts the guard clause
    let depth = 0;
    let openIdx = -1;
    for (let i = leftPart.length - 1; i >= 0; i--) {
      if (leftPart[i] === ']') depth++;
      else if (leftPart[i] === '[') {
        depth--;
        if (depth === 0) {
          openIdx = i;
          break;
        }
      }
    }
    if (openIdx > 0 && leftPart[openIdx - 1] === ' ') {
      eventType = leftPart.slice(0, openIdx - 1).trim();
      guard = leftPart.slice(openIdx + 1, leftPart.length - 1).trim() || null;
    }
  }

  return { eventType, guard, actions, explicitOrder };
}

/**
 * Runs Gate 1 inspection inside headless Chromium via Playwright:
 * reconstructs the canonical `StatechartAST` from rendered DOM + visible text,
 * and performs all Anti-Lying Geometry Cross-Checks.
 */
export async function inspectGate1(
  page: Page,
  svgSelector = 'svg',
): Promise<Gate1InspectionResult> {
  await page.evaluate('window.__name = window.__name || ((fn) => fn)');
  const rawResult = await page.evaluate((selector: string) => {
    const violations: Array<{
      rule:
        | 'svg-root'
        | 'visibility'
        | 'text-truthfulness'
        | 'endpoint-connectivity'
        | 'marker-validity'
        | 'endpoint-separation'
        | 'hierarchy-containment';
      elementId: string;
      message: string;
    }> = [];

    const svgEl = document.querySelector(selector);
    if (!svgEl || !(svgEl instanceof SVGSVGElement)) {
      return {
        missingSvg: true as const,
        violations: [
          {
            rule: 'svg-root' as const,
            elementId: selector,
            message: `Root <svg> matching selector "${selector}" not found`,
          },
        ],
      };
    }
    const rootSvg: SVGSVGElement = svgEl;

    const vb = svgEl.viewBox.baseVal;
    const viewBox = {
      x: vb && vb.width > 0 ? vb.x : 0,
      y: vb && vb.height > 0 ? vb.y : 0,
      width:
        vb && vb.width > 0
          ? vb.width
          : parseFloat(svgEl.getAttribute('width') || '0'),
      height:
        vb && vb.height > 0
          ? vb.height
          : parseFloat(svgEl.getAttribute('height') || '0'),
    };

    if (!(viewBox.width > 0 && viewBox.height > 0)) {
      violations.push({
        rule: 'svg-root',
        elementId: 'svg',
        message: `Invalid <svg> viewBox dimensions: ${viewBox.width}x${viewBox.height}`,
      });
    }

    const svgCTM = svgEl.getScreenCTM() || svgEl.getCTM();
    const svgCTMInv = svgCTM ? svgCTM.inverse() : null;

    function toRootPoint(el: SVGGraphicsElement, x: number, y: number): { x: number; y: number } {
      const ctm = el.getScreenCTM() || el.getCTM();
      if (!ctm || !svgCTMInv) return { x, y };
      const m = svgCTMInv.multiply(ctm);
      return {
        x: m.a * x + m.c * y + m.e,
        y: m.b * x + m.d * y + m.f,
      };
    }

    function getRootBBox(el: SVGGraphicsElement): {
      x: number;
      y: number;
      width: number;
      height: number;
    } {
      const b = el.getBBox();
      const p1 = toRootPoint(el, b.x, b.y);
      const p2 = toRootPoint(el, b.x + b.width, b.y);
      const p3 = toRootPoint(el, b.x + b.width, b.y + b.height);
      const p4 = toRootPoint(el, b.x, b.y + b.height);
      const minX = Math.min(p1.x, p2.x, p3.x, p4.x);
      const maxX = Math.max(p1.x, p2.x, p3.x, p4.x);
      const minY = Math.min(p1.y, p2.y, p3.y, p4.y);
      const maxY = Math.max(p1.y, p2.y, p3.y, p4.y);
      return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      };
    }

    function getEffectiveOpacity(el: Element): number {
      let cur: Element | null = el;
      let opacity = 1;
      while (cur && cur !== rootSvg.parentElement) {
        const style = window.getComputedStyle(cur);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return 0;
        }
        const op = parseFloat(style.opacity || '1');
        if (!Number.isNaN(op)) {
          opacity *= op;
        }
        cur = cur.parentElement;
      }
      return opacity;
    }

    function checkVisibility(
      el: SVGGraphicsElement,
      elementId: string,
      isPath = false,
    ): { x: number; y: number; width: number; height: number } {
      const opacity = getEffectiveOpacity(el);
      if (opacity <= 0) {
        violations.push({
          rule: 'visibility',
          elementId,
          message: `Element "${elementId}" is invisible (effective opacity=${opacity})`,
        });
      }
      const bbox = getRootBBox(el);
      if (isPath && el instanceof SVGGeometryElement) {
        const totalLen = el.getTotalLength();
        if (!(totalLen > 0) || (bbox.width <= 0 && bbox.height <= 0)) {
          violations.push({
            rule: 'visibility',
            elementId,
            message: `Path "${elementId}" has zero length or degenerate bounds (totalLength=${totalLen.toFixed(2)})`,
          });
        }
      } else {
        if (!(bbox.width > 0 && bbox.height > 0)) {
          violations.push({
            rule: 'visibility',
            elementId,
            message: `Element "${elementId}" has non-positive dimensions (${bbox.width.toFixed(2)}x${bbox.height.toFixed(2)})`,
          });
        }
      }

      const eps = 1.0; // 1px tolerance for stroke half-width at border
      if (
        bbox.x < viewBox.x - eps ||
        bbox.y < viewBox.y - eps ||
        bbox.x + bbox.width > viewBox.x + viewBox.width + eps ||
        bbox.y + bbox.height > viewBox.y + viewBox.height + eps
      ) {
        violations.push({
          rule: 'visibility',
          elementId,
          message: `Element "${elementId}" bbox (${bbox.x.toFixed(1)}, ${bbox.y.toFixed(1)}, ${bbox.width.toFixed(1)}x${bbox.height.toFixed(1)}) overflows root viewBox (${viewBox.x}, ${viewBox.y}, ${viewBox.width}x${viewBox.height})`,
        });
      }
      return bbox;
    }

    interface ShapePerimeterInfo {
      kind: 'rect' | 'circle';
      bbox: { x: number; y: number; width: number; height: number };
      rx: number;
      cx: number;
      cy: number;
      r: number;
    }

    function extractShapePerimeter(shapeEl: SVGGraphicsElement): ShapePerimeterInfo {
      const bbox = getRootBBox(shapeEl);
      const tag = shapeEl.tagName.toLowerCase();
      if (tag === 'circle') {
        const r = bbox.width / 2;
        return {
          kind: 'circle',
          bbox,
          rx: r,
          cx: bbox.x + bbox.width / 2,
          cy: bbox.y + bbox.height / 2,
          r,
        };
      }
      const rawRx = parseFloat(shapeEl.getAttribute('rx') || '0') || 0;
      const clampedRx = Math.min(
        Math.max(0, rawRx),
        bbox.width / 2,
        bbox.height / 2,
      );
      return {
        kind: 'rect',
        bbox,
        rx: clampedRx,
        cx: bbox.x + bbox.width / 2,
        cy: bbox.y + bbox.height / 2,
        r: 0,
      };
    }

    function distanceToShapePerimeter(
      px: number,
      py: number,
      shape: ShapePerimeterInfo,
    ): number {
      if (shape.kind === 'circle') {
        return Math.abs(Math.hypot(px - shape.cx, py - shape.cy) - shape.r);
      }
      // Signed distance to rounded rectangle perimeter (and sharp rectangle perimeter min)
      const { x, y, width, height } = shape.bbox;
      const hw = width / 2;
      const hh = height / 2;
      const cx = x + hw;
      const cy = y + hh;

      const calcRoundedSdf = (rad: number): number => {
        const qx = Math.abs(px - cx) - (hw - rad);
        const qy = Math.abs(py - cy) - (hh - rad);
        const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
        const inside = Math.min(Math.max(qx, qy), 0);
        return Math.abs(outside + inside - rad);
      };

      const dRounded = calcRoundedSdf(shape.rx);
      return dRounded;
    }

    function validateMarkerEnd(pathEl: SVGGeometryElement, elementId: string): void {
      const style = window.getComputedStyle(pathEl);
      const attrMarker = pathEl.getAttribute('marker-end') || style.markerEnd || '';
      const match = attrMarker.match(/url\(["']?#([^"')]+)["']?\)/);
      if (!match) {
        violations.push({
          rule: 'marker-validity',
          elementId,
          message: `Path "${elementId}" is missing a valid marker-end="url(#...)" reference (got "${attrMarker}")`,
        });
        return;
      }
      const markerId = match[1];
      const markerEl = svgEl!.querySelector(`#${CSS.escape(markerId)}`);
      if (!markerEl || markerEl.tagName.toLowerCase() !== 'marker') {
        violations.push({
          rule: 'marker-validity',
          elementId,
          message: `Path "${elementId}" references missing <marker id="${markerId}">`,
        });
        return;
      }
      const markerChildren = markerEl.querySelectorAll('path, polygon, polyline, circle, rect, line');
      if (markerChildren.length === 0) {
        violations.push({
          rule: 'marker-validity',
          elementId,
          message: `<marker id="${markerId}"> referenced by "${elementId}" has no visible geometry children`,
        });
        return;
      }
      const mWidth = parseFloat(markerEl.getAttribute('markerWidth') || '3');
      const mHeight = parseFloat(markerEl.getAttribute('markerHeight') || '3');
      if (!(mWidth > 0 && mHeight > 0)) {
        violations.push({
          rule: 'marker-validity',
          elementId,
          message: `<marker id="${markerId}"> has non-positive markerWidth/markerHeight`,
        });
      }
    }

    // 1. Collect all `.state-node` elements
    const stateShapes = new Map<string, ShapePerimeterInfo>();
    const rawNodes: Array<{
      id: string;
      dataKey: string;
      visibleTitleText: string;
      type: string;
      historyKind: string | null;
      parentId: string | null;
      dataInitialTarget: string | null;
      boxStrokeDasharray: string;
      entryRows: Array<{ dataAction: string; text: string }>;
      exitRows: Array<{ dataAction: string; text: string }>;
      invokeRows: Array<{ dataSrc: string; dataId: string | null; text: string }>;
      internalRows: Array<{
        dataEvent: string;
        dataOrder: number;
        dataGuard: string | null;
        dataActions: string[];
        text: string;
      }>;
      tagRows: Array<{ dataTag: string; text: string }>;
    }> = [];

    const stateNodeEls = Array.from(svgEl.querySelectorAll('g.state-node'));
    function splitActionAttr(raw: string): string[] {
      if (!raw) return [];
      const parts: string[] = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
        else if (ch === ',' && depth === 0) {
          const piece = raw.slice(start, i).trim();
          if (piece.length > 0) parts.push(piece);
          start = i + 1;
        }
      }
      const tail = raw.slice(start).trim();
      if (tail.length > 0) parts.push(tail);
      return parts;
    }

    for (const nodeEl of stateNodeEls) {
      const id = nodeEl.getAttribute('data-state-id') || '';
      const dataKey = nodeEl.getAttribute('data-state-key') || '';
      const type = nodeEl.getAttribute('data-state-type') || 'atomic';
      const rawParent = nodeEl.getAttribute('data-parent-id') || '';
      const parentId = rawParent.length > 0 ? rawParent : null;
      const rawInit = nodeEl.getAttribute('data-initial-target') || '';
      const dataInitialTarget = rawInit.length > 0 ? rawInit : null;
      const rawHist = nodeEl.getAttribute('data-history-kind') || '';
      const historyKind =
        rawHist === 'shallow' || rawHist === 'deep' ? rawHist : null;

      // Direct `.state-box` belonging to this `.state-node` (not nested child state-nodes)
      const boxEl = Array.from(nodeEl.querySelectorAll('.state-box')).find(
        (el) => el.closest('g.state-node') === nodeEl,
      ) as SVGGraphicsElement | undefined;

      let boxStrokeDasharray = '';
      if (!boxEl) {
        violations.push({
          rule: 'visibility',
          elementId: id || 'unknown-state',
          message: `State node "${id}" is missing its primary .state-box element`,
        });
      } else {
        checkVisibility(boxEl, `state-box:${id}`, false);
        const shapeInfo = extractShapePerimeter(boxEl);
        stateShapes.set(id, shapeInfo);
        const attrDash = (boxEl.getAttribute('stroke-dasharray') || '').trim();
        const styleDash = (window.getComputedStyle(boxEl).strokeDasharray || '').trim();
        boxStrokeDasharray = attrDash || styleDash;

        if (type === 'history') {
          const isCircle = shapeInfo.kind === 'circle';
          const isCapsule =
            shapeInfo.kind === 'rect' &&
            shapeInfo.rx >= shapeInfo.bbox.height / 2 - 2.0;
          if (!isCircle && !isCapsule) {
            violations.push({
              rule: 'visibility',
              elementId: `state-box:${id}`,
              message: `History state "${id}" .state-box must be a circle or rounded capsule (got kind=${shapeInfo.kind}, rx=${shapeInfo.rx.toFixed(1)}, height=${shapeInfo.bbox.height.toFixed(1)})`,
            });
          }
        }
      }

      const titleEl = Array.from(nodeEl.querySelectorAll('text.state-title')).find(
        (el) => el.closest('g.state-node') === nodeEl,
      ) as SVGGraphicsElement | undefined;

      let visibleTitleText = '';
      let titleBox: { x: number; y: number; width: number; height: number } | null = null;
      if (!titleEl) {
        violations.push({
          rule: 'visibility',
          elementId: `state-title:${id}`,
          message: `State node "${id}" is missing its <text class="state-title"> element`,
        });
      } else {
        titleBox = checkVisibility(titleEl, `state-title:${id}`, false);
        visibleTitleText = (titleEl.textContent || '').trim();
      }

      const dividerEl = Array.from(nodeEl.querySelectorAll('.state-divider')).find(
        (el) => el.closest('g.state-node') === nodeEl,
      ) as SVGGraphicsElement | undefined;
      const dividerBox = dividerEl ? getRootBBox(dividerEl) : null;
      const compartmentElementBoxes: Array<{
        label: string;
        box: { x: number; y: number; width: number; height: number };
      }> = [];

      // Compartments belonging directly to this `nodeEl`
      const compartmentEls = Array.from(
        nodeEl.querySelectorAll('g.state-compartment'),
      ).filter((el) => el.closest('g.state-node') === nodeEl);

      const entryRows: Array<{ dataAction: string; text: string }> = [];
      const exitRows: Array<{ dataAction: string; text: string }> = [];
      const invokeRows: Array<{ dataSrc: string; dataId: string | null; text: string }> = [];
      const internalRows: Array<{
        dataEvent: string;
        dataOrder: number;
        dataGuard: string | null;
        dataActions: string[];
        text: string;
      }> = [];
      const tagRows: Array<{ dataTag: string; text: string }> = [];

      for (const compEl of compartmentEls) {
        const kind = compEl.getAttribute('data-compartment') || '';
        if (kind === 'entry') {
          const texts = Array.from(compEl.querySelectorAll('text'));
          texts.forEach((tEl, idx) => {
            const cb = checkVisibility(tEl as SVGGraphicsElement, `entry:${id}:${idx}`, false);
            compartmentElementBoxes.push({ label: `entry:${id}:${idx}`, box: cb });
            entryRows.push({
              dataAction: tEl.getAttribute('data-entry-action') || '',
              text: (tEl.textContent || '').trim(),
            });
          });
        } else if (kind === 'exit') {
          const texts = Array.from(compEl.querySelectorAll('text'));
          texts.forEach((tEl, idx) => {
            const cb = checkVisibility(tEl as SVGGraphicsElement, `exit:${id}:${idx}`, false);
            compartmentElementBoxes.push({ label: `exit:${id}:${idx}`, box: cb });
            exitRows.push({
              dataAction: tEl.getAttribute('data-exit-action') || '',
              text: (tEl.textContent || '').trim(),
            });
          });
        } else if (kind === 'invoke') {
          const texts = Array.from(compEl.querySelectorAll('text'));
          texts.forEach((tEl, idx) => {
            const cb = checkVisibility(tEl as SVGGraphicsElement, `invoke:${id}:${idx}`, false);
            compartmentElementBoxes.push({ label: `invoke:${id}:${idx}`, box: cb });
            const rawInvId = tEl.getAttribute('data-invoke-id') || '';
            invokeRows.push({
              dataSrc: tEl.getAttribute('data-invoke-src') || '',
              dataId: rawInvId.length > 0 ? rawInvId : null,
              text: (tEl.textContent || '').trim(),
            });
          });
        } else if (kind === 'internal') {
          const texts = Array.from(compEl.querySelectorAll('text'));
          texts.forEach((tEl, idx) => {
            const cb = checkVisibility(tEl as SVGGraphicsElement, `internal:${id}:${idx}`, false);
            compartmentElementBoxes.push({ label: `internal:${id}:${idx}`, box: cb });
            const rawGuard = tEl.getAttribute('data-internal-guard') || '';
            const rawActions = tEl.getAttribute('data-internal-actions') || '';
            internalRows.push({
              dataEvent: tEl.getAttribute('data-internal-event') || '',
              dataOrder: parseInt(tEl.getAttribute('data-internal-order') || '0', 10),
              dataGuard: rawGuard.length > 0 ? rawGuard : null,
              dataActions: splitActionAttr(rawActions),
              text: (tEl.textContent || '').trim(),
            });
          });
        }
      }

      // Tags belonging directly to this `nodeEl`
      const directTagEls = Array.from(nodeEl.querySelectorAll('g.state-tag')).filter(
        (el) => el.closest('g.state-node') === nodeEl,
      );
      directTagEls.forEach((tagEl, idx) => {
        const tagGroupBox = getRootBBox(tagEl as SVGGraphicsElement);
        compartmentElementBoxes.push({ label: `tag:${id}:${idx}`, box: tagGroupBox });
        const tEl = tagEl.querySelector('text') as SVGGraphicsElement | null;
        if (tEl) {
          checkVisibility(tEl, `tag:${id}:${idx}`, false);
          tagRows.push({
            dataTag: tagEl.getAttribute('data-tag') || '',
            text: (tEl.textContent || '').trim(),
          });
        }
      });

      // Header/Compartment divider & strict `.state-box` containment check
      const requiresHeaderDivider =
        compartmentElementBoxes.length > 0 || type === 'compound' || type === 'parallel';
      if (requiresHeaderDivider) {
        const stateShape = stateShapes.get(id);
        if (!dividerEl || !dividerBox || getEffectiveOpacity(dividerEl) <= 0) {
          violations.push({
            rule: 'visibility',
            elementId: `state-divider:${id}`,
            message: `State "${id}" (type="${type}", compartments=${compartmentElementBoxes.length}) is missing a visible .state-divider line`,
          });
        } else {
          if (titleBox && titleBox.y + titleBox.height > dividerBox.y + 1.5) {
            violations.push({
              rule: 'visibility',
              elementId: `state-divider:${id}`,
              message: `State "${id}" title bottom (${(titleBox.y + titleBox.height).toFixed(1)}) crosses .state-divider y=${dividerBox.y.toFixed(1)}`,
            });
          }
          for (const ce of compartmentElementBoxes) {
            if (ce.box.y < dividerBox.y - 1.5) {
              violations.push({
                rule: 'visibility',
                elementId: ce.label,
                message: `Compartment element "${ce.label}" (y=${ce.box.y.toFixed(1)}) lies above .state-divider (y=${dividerBox.y.toFixed(1)})`,
              });
            }
            if (stateShape) {
              const sb = stateShape.bbox;
              if (
                ce.box.x < sb.x + 1.0 ||
                ce.box.y < sb.y + 1.0 ||
                ce.box.x + ce.box.width > sb.x + sb.width - 1.0 ||
                ce.box.y + ce.box.height > sb.y + sb.height - 1.0
              ) {
                violations.push({
                  rule: 'visibility',
                  elementId: ce.label,
                  message: `Compartment element "${ce.label}" (${ce.box.x.toFixed(1)}, ${ce.box.y.toFixed(1)}, ${ce.box.width.toFixed(1)}x${ce.box.height.toFixed(1)}) does not fit strictly inside state "${id}" .state-box (${sb.x.toFixed(1)}, ${sb.y.toFixed(1)}, ${sb.width.toFixed(1)}x${sb.height.toFixed(1)})`,
                });
              }
            }
          }
        }
      }

      rawNodes.push({
        id,
        dataKey,
        visibleTitleText,
        type,
        historyKind,
        parentId,
        dataInitialTarget,
        boxStrokeDasharray,
        entryRows,
        exitRows,
        invokeRows,
        internalRows,
        tagRows,
      });
    }

    const rawNodeById = new Map(rawNodes.map((n) => [n.id, n]));

    // Physical Hierarchy Containment + Parallel Dashed Region check
    for (const node of rawNodes) {
      if (node.parentId) {
        const parentNode = rawNodeById.get(node.parentId);
        const childShape = stateShapes.get(node.id);
        const parentShape = stateShapes.get(node.parentId);
        if (parentNode && parentNode.type === 'parallel') {
          const dash = node.boxStrokeDasharray;
          if (!dash || dash === 'none' || dash === '0px' || dash === '0') {
            violations.push({
              rule: 'visibility',
              elementId: `state-box:${node.id}`,
              message: `Direct child region "${node.id}" of parallel state "${node.parentId}" must have a visible dashed border (stroke-dasharray), got "${dash || 'none'}"`,
            });
          }
        }
        if (!parentShape) {
          violations.push({
            rule: 'hierarchy-containment',
            elementId: node.id,
            message: `State "${node.id}" declares parentId="${node.parentId}", which does not exist in rendered .state-node elements`,
          });
        } else if (childShape) {
          const cb = childShape.bbox;
          const pb = parentShape.bbox;
          if (
            !(
              cb.x > pb.x &&
              cb.y > pb.y &&
              cb.x + cb.width < pb.x + pb.width &&
              cb.y + cb.height < pb.y + pb.height
            )
          ) {
            violations.push({
              rule: 'hierarchy-containment',
              elementId: node.id,
              message: `Child "${node.id}" bbox (${cb.x.toFixed(1)}, ${cb.y.toFixed(1)}, ${cb.width.toFixed(1)}x${cb.height.toFixed(1)}) does not lie strictly inside parent "${node.parentId}" bbox (${pb.x.toFixed(1)}, ${pb.y.toFixed(1)}, ${pb.width.toFixed(1)}x${pb.height.toFixed(1)})`,
            });
          }
        }
      }
    }

    // 2. Initial Pseudostate Indicators (`g.initial-indicator`)
    const initialMap = new Map<string, string>();
    const initialEls = Array.from(svgEl.querySelectorAll('g.initial-indicator'));
    let maxEndpointDistancePx = 0;

    for (const initEl of initialEls) {
      const parentKey = initEl.getAttribute('data-parent-id') || '__root__';
      const targetId = initEl.getAttribute('data-target-id') || '';
      initialMap.set(parentKey, targetId);

      const dotEl = initEl.querySelector('.initial-dot') as SVGGraphicsElement | null;
      const edgeEl = initEl.querySelector('path.initial-edge') as SVGPathElement | null;

      let dotShape: ShapePerimeterInfo | null = null;
      if (!dotEl) {
        violations.push({
          rule: 'visibility',
          elementId: `initial-dot:${parentKey}`,
          message: `Initial indicator for "${parentKey}" is missing .initial-dot`,
        });
      } else {
        checkVisibility(dotEl, `initial-dot:${parentKey}`, false);
        dotShape = extractShapePerimeter(dotEl);
      }

      if (!edgeEl) {
        violations.push({
          rule: 'visibility',
          elementId: `initial-edge:${parentKey}`,
          message: `Initial indicator for "${parentKey}" is missing path.initial-edge`,
        });
      } else {
        checkVisibility(edgeEl, `initial-edge:${parentKey}`, true);
        validateMarkerEnd(edgeEl, `initial-edge:${parentKey}`);

        const totalLen = edgeEl.getTotalLength();
        if (totalLen > 0) {
          const pStartLocal = edgeEl.getPointAtLength(0);
          const pStart = toRootPoint(edgeEl, pStartLocal.x, pStartLocal.y);
          if (dotShape) {
            const distStart = distanceToShapePerimeter(pStart.x, pStart.y, dotShape);
            maxEndpointDistancePx = Math.max(maxEndpointDistancePx, distStart);
            if (distStart > 3.5) {
              violations.push({
                rule: 'endpoint-connectivity',
                elementId: `initial-edge:${parentKey}`,
                message: `Initial edge start (${pStart.x.toFixed(1)}, ${pStart.y.toFixed(1)}) is ${distStart.toFixed(2)}px from .initial-dot perimeter (max 3.5px)`,
              });
            }
          }

          const pEndLocal = edgeEl.getPointAtLength(totalLen);
          const pEnd = toRootPoint(edgeEl, pEndLocal.x, pEndLocal.y);
          const targetShape = stateShapes.get(targetId);
          if (!targetShape) {
            violations.push({
              rule: 'endpoint-connectivity',
              elementId: `initial-edge:${parentKey}`,
              message: `Initial indicator targets missing state "${targetId}"`,
            });
          } else {
            const distEnd = distanceToShapePerimeter(pEnd.x, pEnd.y, targetShape);
            maxEndpointDistancePx = Math.max(maxEndpointDistancePx, distEnd);
            if (distEnd > 3.5) {
              violations.push({
                rule: 'endpoint-connectivity',
                elementId: `initial-edge:${parentKey}`,
                message: `Initial edge end (${pEnd.x.toFixed(1)}, ${pEnd.y.toFixed(1)}) is ${distEnd.toFixed(2)}px from target "${targetId}" perimeter (max 3.5px)`,
              });
            }
          }
        }
      }

      // Compound initial-indicator physical containment inside parent `.state-box`
      if (parentKey !== '__root__') {
        const parentShape = stateShapes.get(parentKey);
        if (!parentShape) {
          violations.push({
            rule: 'hierarchy-containment',
            elementId: `initial-indicator:${parentKey}`,
            message: `Compound initial-indicator references missing data-parent-id="${parentKey}"`,
          });
        } else {
          const pb = parentShape.bbox;
          if (dotShape) {
            const db = dotShape.bbox;
            if (
              !(
                db.x > pb.x &&
                db.y > pb.y &&
                db.x + db.width < pb.x + pb.width &&
                db.y + db.height < pb.y + pb.height
              )
            ) {
              violations.push({
                rule: 'hierarchy-containment',
                elementId: `initial-dot:${parentKey}`,
                message: `Compound initial-dot for "${parentKey}" (${db.x.toFixed(1)}, ${db.y.toFixed(1)}, ${db.width.toFixed(1)}x${db.height.toFixed(1)}) lies outside parent .state-box (${pb.x.toFixed(1)}, ${pb.y.toFixed(1)}, ${pb.width.toFixed(1)}x${pb.height.toFixed(1)})`,
              });
            }
          }
          if (edgeEl) {
            const eb = getRootBBox(edgeEl);
            if (
              !(
                eb.x > pb.x &&
                eb.y > pb.y &&
                eb.x + eb.width < pb.x + pb.width &&
                eb.y + eb.height < pb.y + pb.height
              )
            ) {
              violations.push({
                rule: 'hierarchy-containment',
                elementId: `initial-edge:${parentKey}`,
                message: `Compound initial-edge for "${parentKey}" (${eb.x.toFixed(1)}, ${eb.y.toFixed(1)}, ${eb.width.toFixed(1)}x${eb.height.toFixed(1)}) lies outside parent .state-box (${pb.x.toFixed(1)}, ${pb.y.toFixed(1)}, ${pb.width.toFixed(1)}x${pb.height.toFixed(1)})`,
              });
            }
          }
          const targetNode = rawNodes.find((n) => n.id === targetId);
          if (targetNode && targetNode.parentId !== parentKey) {
            violations.push({
              rule: 'hierarchy-containment',
              elementId: `initial-indicator:${parentKey}`,
              message: `Compound initial-indicator for "${parentKey}" targets "${targetId}" whose parentId is "${targetNode.parentId ?? ''}"`,
            });
          }
        }
      }
    }

    // 3. Transition Edges (`g.transition-edge`)
    let minSelfLoopSeparationPx: number | null = null;
    const rawEdges: Array<{
      dataId: string;
      sourceId: string;
      targetIds: string[];
      dataEvent: string;
      dataOrder: number;
      dataGuard: string | null;
      dataActions: string[];
      labelText: string;
    }> = [];

    // Helper to split comma-separated target IDs safely even when state IDs contain commas (e.g. "harel-product.B,E")
    const knownStateIdsSorted = Array.from(stateShapes.keys()).sort(
      (a, b) => b.length - a.length,
    );
    function parseTargetIdsAttr(rawAttr: string): string[] {
      const trimmed = rawAttr.trim();
      if (!trimmed) return [];
      if (stateShapes.has(trimmed)) return [trimmed];

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
      return result.filter(Boolean).sort((a, b) => a.localeCompare(b));
    }

    const edgeEls = Array.from(svgEl.querySelectorAll('g.transition-edge'));
    for (const edgeGroup of edgeEls) {
      const dataId = edgeGroup.getAttribute('data-edge-id') || '';
      const sourceId = edgeGroup.getAttribute('data-edge-source') || '';
      const rawTargets = edgeGroup.getAttribute('data-edge-targets') || '';
      const targetIds = parseTargetIdsAttr(rawTargets);
      const dataEvent = edgeGroup.getAttribute('data-edge-event') || '';
      const dataOrder = parseInt(edgeGroup.getAttribute('data-edge-order') || '0', 10);
      const rawGuard = edgeGroup.getAttribute('data-edge-guard') || '';
      const dataGuard = rawGuard.length > 0 ? rawGuard : null;
      const rawActions = edgeGroup.getAttribute('data-edge-actions') || '';
      const dataActions = splitActionAttr(rawActions);

      const pathEls = Array.from(
        edgeGroup.querySelectorAll('path.edge-path'),
      ) as SVGPathElement[];

      if (pathEls.length === 0) {
        violations.push({
          rule: 'visibility',
          elementId: dataId || 'unknown-edge',
          message: `Transition "${dataId}" has no <path class="edge-path"> elements`,
        });
      }

      const sourceShape = stateShapes.get(sourceId);
      if (!sourceShape) {
        violations.push({
          rule: 'endpoint-connectivity',
          elementId: dataId,
          message: `Transition "${dataId}" references missing source state "${sourceId}"`,
        });
      }

      if (targetIds.length === 1 && pathEls.length === 1) {
        const pathEl = pathEls[0];
        checkVisibility(pathEl, `edge-path:${dataId}`, true);
        validateMarkerEnd(pathEl, `edge-path:${dataId}`);

        const totalLen = pathEl.getTotalLength();
        if (totalLen > 0) {
          const pStartLocal = pathEl.getPointAtLength(0);
          const pEndLocal = pathEl.getPointAtLength(totalLen);
          const pStart = toRootPoint(pathEl, pStartLocal.x, pStartLocal.y);
          const pEnd = toRootPoint(pathEl, pEndLocal.x, pEndLocal.y);

          if (sourceShape) {
            const dStart = distanceToShapePerimeter(pStart.x, pStart.y, sourceShape);
            maxEndpointDistancePx = Math.max(maxEndpointDistancePx, dStart);
            if (dStart > 3.5) {
              violations.push({
                rule: 'endpoint-connectivity',
                elementId: dataId,
                message: `Transition "${dataId}" start (${pStart.x.toFixed(1)}, ${pStart.y.toFixed(1)}) is ${dStart.toFixed(2)}px from source "${sourceId}" perimeter (max 3.5px)`,
              });
            }
          }

          const targetId = targetIds[0];
          const targetShape = stateShapes.get(targetId);
          if (!targetShape) {
            violations.push({
              rule: 'endpoint-connectivity',
              elementId: dataId,
              message: `Transition "${dataId}" references missing target state "${targetId}"`,
            });
          } else {
            const dEnd = distanceToShapePerimeter(pEnd.x, pEnd.y, targetShape);
            maxEndpointDistancePx = Math.max(maxEndpointDistancePx, dEnd);
            if (dEnd > 3.5) {
              violations.push({
                rule: 'endpoint-connectivity',
                elementId: dataId,
                message: `Transition "${dataId}" end (${pEnd.x.toFixed(1)}, ${pEnd.y.toFixed(1)}) is ${dEnd.toFixed(2)}px from target "${targetId}" perimeter (max 3.5px)`,
              });
            }
          }

          const sep = Math.hypot(pEnd.x - pStart.x, pEnd.y - pStart.y);
          if (sourceId === targetId) {
            minSelfLoopSeparationPx =
              minSelfLoopSeparationPx === null
                ? sep
                : Math.min(minSelfLoopSeparationPx, sep);
          }
          if (sep < 10) {
            violations.push({
              rule: 'endpoint-separation',
              elementId: dataId,
              message: `Transition "${dataId}" start and end points are separated by only ${sep.toFixed(2)}px (min 10px required)`,
            });
          }
        }
      } else if (pathEls.length > 0) {
        // Multi-target hyperedge (trunk + branch paths or per-target paths)
        const startPoints: Array<{ x: number; y: number }> = [];
        const endPointsWithMarker: Array<{ x: number; y: number; pathIdx: number }> = [];

        pathEls.forEach((pEl, idx) => {
          checkVisibility(pEl, `edge-path:${dataId}:${idx}`, true);
          const len = pEl.getTotalLength();
          if (len > 0) {
            const ps = toRootPoint(pEl, pEl.getPointAtLength(0).x, pEl.getPointAtLength(0).y);
            const pe = toRootPoint(
              pEl,
              pEl.getPointAtLength(len).x,
              pEl.getPointAtLength(len).y,
            );
            startPoints.push(ps);
            const hasMarker =
              (pEl.getAttribute('marker-end') || '').includes('url(') ||
              window.getComputedStyle(pEl).markerEnd.includes('url(');
            if (hasMarker) {
              validateMarkerEnd(pEl, `edge-path:${dataId}:${idx}`);
              endPointsWithMarker.push({ x: pe.x, y: pe.y, pathIdx: idx });
            }
          }
        });

        if (sourceShape && startPoints.length > 0) {
          const startDists = startPoints.map((pt) =>
            distanceToShapePerimeter(pt.x, pt.y, sourceShape),
          );
          const minStartDist = Math.min(...startDists);
          maxEndpointDistancePx = Math.max(maxEndpointDistancePx, minStartDist);
          if (minStartDist > 3.5) {
            violations.push({
              rule: 'endpoint-connectivity',
              elementId: dataId,
              message: `Hyperedge "${dataId}" closest start point is ${minStartDist.toFixed(2)}px from source "${sourceId}" perimeter (max 3.5px)`,
            });
          }

          if (targetIds.length >= 2) {
            // Require all branches starting at source (or all root-to-leaf branches) to share a single merged source port (<= 1.0px spread)
            const sourceAttachedStarts =
              endPointsWithMarker.length === pathEls.length
                ? startPoints
                : startPoints.filter((_, idx) => startDists[idx] <= 4.0);
            if (sourceAttachedStarts.length >= 2) {
              let maxSpread = 0;
              for (let i = 1; i < sourceAttachedStarts.length; i++) {
                const sp = Math.hypot(
                  sourceAttachedStarts[i].x - sourceAttachedStarts[0].x,
                  sourceAttachedStarts[i].y - sourceAttachedStarts[0].y,
                );
                if (sp > maxSpread) maxSpread = sp;
              }
              if (maxSpread > 1.0) {
                violations.push({
                  rule: 'endpoint-connectivity',
                  elementId: dataId,
                  message: `Hyperedge "${dataId}" branches do not share a single merged source port on "${sourceId}" (start spread=${maxSpread.toFixed(2)}px, max 1.0px allowed)`,
                });
              }
            }
          }
        }

        const forkDecorEl = edgeGroup.querySelector(
          '.fork-bar, .fork-junction',
        ) as SVGGraphicsElement | null;
        if (targetIds.length >= 2 && !forkDecorEl) {
          violations.push({
            rule: 'visibility',
            elementId: `fork-junction:${dataId}`,
            message: `Multi-target hyperedge "${dataId}" (${targetIds.length} targets) is missing a visible .fork-junction or .fork-bar element`,
          });
        } else if (forkDecorEl) {
          checkVisibility(forkDecorEl, `fork-bar:${dataId}`, false);
        }

        if (endPointsWithMarker.length < targetIds.length) {
          violations.push({
            rule: 'marker-validity',
            elementId: dataId,
            message: `Hyperedge "${dataId}" targets ${targetIds.length} states (${targetIds.join(', ')}) but only ${endPointsWithMarker.length} branch path(s) carry a valid marker-end`,
          });
        }

        const usedEndpointIndices = new Set<number>();
        for (const tId of targetIds) {
          const tShape = stateShapes.get(tId);
          if (!tShape) {
            violations.push({
              rule: 'endpoint-connectivity',
              elementId: dataId,
              message: `Hyperedge "${dataId}" references missing target state "${tId}"`,
            });
            continue;
          }
          if (endPointsWithMarker.length === 0) {
            violations.push({
              rule: 'marker-validity',
              elementId: dataId,
              message: `Hyperedge "${dataId}" has no branch path with a valid marker-end`,
            });
            continue;
          }
          let bestDist = Infinity;
          let bestIdx = -1;
          endPointsWithMarker.forEach((pt, idx) => {
            if (usedEndpointIndices.has(idx)) return;
            const d = distanceToShapePerimeter(pt.x, pt.y, tShape);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = idx;
            }
          });
          if (bestIdx === -1) {
            bestDist = Math.min(
              ...endPointsWithMarker.map((pt) =>
                distanceToShapePerimeter(pt.x, pt.y, tShape),
              ),
            );
          } else {
            usedEndpointIndices.add(bestIdx);
          }
          maxEndpointDistancePx = Math.max(maxEndpointDistancePx, bestDist);
          if (bestDist > 3.5) {
            violations.push({
              rule: 'endpoint-connectivity',
              elementId: dataId,
              message: `Hyperedge "${dataId}" closest distinct marked branch end is ${bestDist.toFixed(2)}px from target "${tId}" perimeter (max 3.5px)`,
            });
          }
        }
      }

      const labelBgEl = edgeGroup.querySelector(
        'g.edge-label .edge-label-bg',
      ) as SVGGraphicsElement | null;
      const labelTextEl = edgeGroup.querySelector(
        'g.edge-label text.edge-label-text',
      ) as SVGGraphicsElement | null;

      let labelText = '';
      if (!labelBgEl || !labelTextEl) {
        violations.push({
          rule: 'visibility',
          elementId: `edge-label:${dataId}`,
          message: `Transition "${dataId}" is missing .edge-label-bg or text.edge-label-text`,
        });
      } else {
        const bgBox = checkVisibility(labelBgEl, `edge-label-bg:${dataId}`, false);
        const txtBox = checkVisibility(labelTextEl, `edge-label-text:${dataId}`, false);
        const lineTspans = Array.from(
          labelTextEl.querySelectorAll('tspan.edge-label-line'),
        ) as SVGGraphicsElement[];
        labelText =
          lineTspans.length > 0
            ? lineTspans
                .map((t) => (t.textContent || '').trim())
                .filter(Boolean)
                .join(' ')
            : (labelTextEl.textContent || '').trim();

        // Check that visible text fits inside its own `.edge-label-bg` pill
        const padTol = 2.0;
        if (
          txtBox.x < bgBox.x - padTol ||
          txtBox.y < bgBox.y - padTol ||
          txtBox.x + txtBox.width > bgBox.x + bgBox.width + padTol ||
          txtBox.y + txtBox.height > bgBox.y + bgBox.height + padTol
        ) {
          violations.push({
            rule: 'visibility',
            elementId: `edge-label:${dataId}`,
            message: `Transition "${dataId}" label text "${labelText}" (${txtBox.width.toFixed(1)}x${txtBox.height.toFixed(1)}) overflows its .edge-label-bg pill (${bgBox.width.toFixed(1)}x${bgBox.height.toFixed(1)})`,
          });
        }

        // Verify multi-line `<tspan class="edge-label-line">` stacked card geometry:
        // every line must be visible, fit strictly inside `.edge-label-bg`, and have
        // strictly increasing vertical position with zero glyph-bbox overlap between lines.
        let prevLineBox: { x: number; y: number; width: number; height: number } | null = null;
        lineTspans.forEach((lineEl, lineIdx) => {
          const lineBox = checkVisibility(
            lineEl,
            `edge-label-line:${dataId}:${lineIdx}`,
            false,
          );
          if (
            lineBox.x < bgBox.x - padTol ||
            lineBox.y < bgBox.y - padTol ||
            lineBox.x + lineBox.width > bgBox.x + bgBox.width + padTol ||
            lineBox.y + lineBox.height > bgBox.y + bgBox.height + padTol
          ) {
            violations.push({
              rule: 'visibility',
              elementId: `edge-label-line:${dataId}:${lineIdx}`,
              message: `Transition "${dataId}" multi-line tspan[${lineIdx}] "${(lineEl.textContent || '').trim()}" (${lineBox.width.toFixed(1)}x${lineBox.height.toFixed(1)}) overflows its .edge-label-bg pill (${bgBox.width.toFixed(1)}x${bgBox.height.toFixed(1)})`,
            });
          }
          if (prevLineBox) {
            const verticalOverlap = prevLineBox.y + prevLineBox.height - lineBox.y;
            if (lineBox.y <= prevLineBox.y + 0.5 || verticalOverlap > 0.75) {
              violations.push({
                rule: 'visibility',
                elementId: `edge-label-line:${dataId}:${lineIdx}`,
                message: `Transition "${dataId}" multi-line tspan[${lineIdx}] (y=${lineBox.y.toFixed(1)}..${(lineBox.y + lineBox.height).toFixed(1)}) is not strictly below or overlaps previous line (y=${prevLineBox.y.toFixed(1)}..${(prevLineBox.y + prevLineBox.height).toFixed(1)})`,
              });
            }
          }
          prevLineBox = lineBox;
        });
      }

      rawEdges.push({
        dataId,
        sourceId,
        targetIds,
        dataEvent,
        dataOrder,
        dataGuard,
        dataActions,
        labelText,
      });
    }

    // Machine ID from root `<svg data-machine-id="...">` or inferred from top-level state ID
    let machineId = svgEl.getAttribute('data-machine-id') || '';
    if (!machineId && rawNodes.length > 0) {
      const topNode = rawNodes.find((n) => !n.parentId) || rawNodes[0];
      const dotIdx = topNode.id.indexOf('.');
      machineId = dotIdx > 0 ? topNode.id.slice(0, dotIdx) : topNode.id;
    }

    return {
      missingSvg: false as const,
      machineId,
      viewBox,
      rawNodes,
      initialMapEntries: Array.from(initialMap.entries()),
      rawEdges,
      violations,
      maxEndpointDistancePx,
      minSelfLoopSeparationPx,
    };
  }, svgSelector);

  if (rawResult.missingSvg) {
    return {
      ast: {
        machineId: '',
        rootInitialTargetId: null,
        nodes: {},
        transitions: [],
      },
      violations: rawResult.violations,
      metrics: {
        stateCount: 0,
        transitionCount: 0,
        maxEndpointDistancePx: 0,
        minSelfLoopSeparationPx: null,
        viewBox: { x: 0, y: 0, width: 0, height: 0 },
      },
    };
  }

  const violations: Gate1Violation[] = [...rawResult.violations];
  const initialMap = new Map<string, string>(rawResult.initialMapEntries);

  // Reconstruct StateNodeASTs from visible text and cross-check against `data-*` attributes!
  const nodes: Record<string, StateNodeAST> = {};

  for (const rn of rawResult.rawNodes) {
    const type = rn.type as StateNodeType;
    let reconstructedKey = rn.visibleTitleText;

    let reconstructedHistoryKind: 'shallow' | 'deep' | null =
      rn.historyKind as 'shallow' | 'deep' | null;

    if (type === 'history') {
      let parsedHistKind: 'shallow' | 'deep' | null = null;
      let parsedKey = '';
      if (rn.visibleTitleText === 'H') {
        parsedHistKind = 'shallow';
        parsedKey = 'history';
      } else if (rn.visibleTitleText === 'H*') {
        parsedHistKind = 'deep';
        parsedKey = 'history';
      } else {
        const hm = rn.visibleTitleText.match(/^(H\*?)\s*[:·]\s*(.+)$/);
        if (hm) {
          parsedHistKind = hm[1] === 'H*' ? 'deep' : 'shallow';
          parsedKey = hm[2].trim();
        }
      }

      if (
        !parsedHistKind ||
        parsedHistKind !== rn.historyKind ||
        parsedKey !== rn.dataKey
      ) {
        violations.push({
          rule: 'text-truthfulness',
          elementId: rn.id,
          message: `History state "${rn.id}" visible title "${rn.visibleTitleText}" contradicts data-history-kind="${rn.historyKind ?? ''}" / data-state-key="${rn.dataKey}"`,
        });
      }
      reconstructedKey = parsedKey || rn.dataKey;
      reconstructedHistoryKind = parsedHistKind ?? reconstructedHistoryKind;
    } else {
      if (rn.visibleTitleText !== rn.dataKey) {
        violations.push({
          rule: 'text-truthfulness',
          elementId: rn.id,
          message: `State "${rn.id}" visible <text class="state-title"> "${rn.visibleTitleText}" contradicts data-state-key="${rn.dataKey}"`,
        });
      }
    }

    const indicatorInitTarget = initialMap.get(rn.id) ?? null;
    if (type === 'parallel' && (rn.dataInitialTarget !== null || indicatorInitTarget !== null)) {
      violations.push({
        rule: 'text-truthfulness',
        elementId: rn.id,
        message: `Parallel state "${rn.id}" must not have an initial target or .initial-indicator (got data-initial-target="${rn.dataInitialTarget ?? ''}", indicator="${indicatorInitTarget ?? ''}")`,
      });
    }
    if ((rn.dataInitialTarget ?? null) !== indicatorInitTarget) {
      violations.push({
        rule: 'text-truthfulness',
        elementId: rn.id,
        message: `State "${rn.id}" data-initial-target="${rn.dataInitialTarget ?? ''}" contradicts rendered .initial-indicator target="${indicatorInitTarget ?? ''}"`,
      });
    }

    const entryActions: string[] = rn.entryRows.map((row) => {
      const m = row.text.match(/^entry\s*\/\s*(.+)$/);
      const parsed = m ? m[1].trim() : row.text;
      if (!m || parsed !== row.dataAction) {
        violations.push({
          rule: 'text-truthfulness',
          elementId: rn.id,
          message: `State "${rn.id}" entry row text "${row.text}" contradicts expected "entry / ${row.dataAction}"`,
        });
      }
      return parsed;
    });

    const exitActions: string[] = rn.exitRows.map((row) => {
      const m = row.text.match(/^exit\s*\/\s*(.+)$/);
      const parsed = m ? m[1].trim() : row.text;
      if (!m || parsed !== row.dataAction) {
        violations.push({
          rule: 'text-truthfulness',
          elementId: rn.id,
          message: `State "${rn.id}" exit row text "${row.text}" contradicts expected "exit / ${row.dataAction}"`,
        });
      }
      return parsed;
    });

    const invocations: InvocationAST[] = rn.invokeRows.map((row) => {
      const m = row.text.match(/^invoke\s*\/\s*(.+)$/);
      const body = m ? m[1].trim() : row.text;
      let parsedSrc = body;
      let parsedId: string | null = null;
      const colonIdx = body.indexOf(': ');
      if (colonIdx > 0) {
        parsedId = body.slice(0, colonIdx).trim();
        parsedSrc = body.slice(colonIdx + 2).trim();
      }
      if (
        !m ||
        parsedSrc !== row.dataSrc ||
        (parsedId ?? null) !== (row.dataId ?? null)
      ) {
        violations.push({
          rule: 'text-truthfulness',
          elementId: rn.id,
          message: `State "${rn.id}" invoke row text "${row.text}" contradicts data-invoke-id="${row.dataId ?? ''}" / data-invoke-src="${row.dataSrc}"`,
        });
      }
      return { id: parsedId, src: parsedSrc };
    });

    const internalEventCounts = new Map<string, number>();
    for (const row of rn.internalRows) {
      const parsed = parseTransitionLabelText(row.text);
      internalEventCounts.set(
        parsed.eventType,
        (internalEventCounts.get(parsed.eventType) ?? 0) + 1,
      );
    }

    const internalTransitions: InternalTransitionRowAST[] = rn.internalRows.map(
      (row) => {
        const parsed = parseTransitionLabelText(row.text);
        const totalForEv = internalEventCounts.get(parsed.eventType) ?? 1;
        const reconstructedOrder =
          totalForEv > 1 ? (parsed.explicitOrder ?? -1) : (parsed.explicitOrder ?? 0);

        if (totalForEv > 1 && parsed.explicitOrder === null) {
          violations.push({
            rule: 'text-truthfulness',
            elementId: rn.id,
            message: `State "${rn.id}" has ${totalForEv} internal transitions for event "${parsed.eventType}" but row "${row.text}" is missing explicit [#N] priority prefix`,
          });
        }

        if (
          parsed.eventType !== row.dataEvent ||
          reconstructedOrder !== row.dataOrder ||
          (parsed.guard ?? null) !== (row.dataGuard ?? null) ||
          JSON.stringify(parsed.actions) !== JSON.stringify(row.dataActions)
        ) {
          violations.push({
            rule: 'text-truthfulness',
            elementId: rn.id,
            message: `State "${rn.id}" internal transition text "${row.text}" contradicts data-internal-* (${row.dataEvent}, order=${row.dataOrder}, guard=${row.dataGuard}, actions=${row.dataActions.join(',')})`,
          });
        }
        return {
          eventType: parsed.eventType,
          order: reconstructedOrder >= 0 ? reconstructedOrder : row.dataOrder,
          guard: parsed.guard,
          actions: parsed.actions,
        };
      },
    );

    const tags: string[] = rn.tagRows.map((row) => {
      const m = row.text.match(/^#(.+)$/);
      const parsed = m ? m[1].trim() : row.text;
      if (!m || parsed !== row.dataTag) {
        violations.push({
          rule: 'text-truthfulness',
          elementId: rn.id,
          message: `State "${rn.id}" tag text "${row.text}" contradicts expected "#${row.dataTag}"`,
        });
      }
      return parsed;
    });

    nodes[rn.id] = {
      id: rn.id,
      key: reconstructedKey,
      type,
      historyKind: reconstructedHistoryKind,
      parentId: rn.parentId,
      initialTargetId: indicatorInitTarget,
      entryActions,
      exitActions,
      invocations,
      internalTransitions,
      tags,
    };
  }

  const externalGroupCounts = new Map<string, number>();
  for (const re of rawResult.rawEdges) {
    const parsed = parseTransitionLabelText(re.labelText);
    const key = `${re.sourceId}:::${parsed.eventType}`;
    externalGroupCounts.set(key, (externalGroupCounts.get(key) ?? 0) + 1);
  }

  const transitions: TransitionAST[] = rawResult.rawEdges.map((re) => {
    const parsed = parseTransitionLabelText(re.labelText);
    const groupKey = `${re.sourceId}:::${parsed.eventType}`;
    const totalForGroup = externalGroupCounts.get(groupKey) ?? 1;
    const reconstructedOrder =
      totalForGroup > 1 ? (parsed.explicitOrder ?? -1) : (parsed.explicitOrder ?? 0);

    if (totalForGroup > 1 && parsed.explicitOrder === null) {
      violations.push({
        rule: 'text-truthfulness',
        elementId: re.dataId,
        message: `Source "${re.sourceId}" has ${totalForGroup} branches for event "${parsed.eventType}" but transition "${re.dataId}" label "${re.labelText}" is missing explicit [#N] priority prefix`,
      });
    }

    if (
      parsed.eventType !== re.dataEvent ||
      reconstructedOrder !== re.dataOrder ||
      (parsed.guard ?? null) !== (re.dataGuard ?? null) ||
      JSON.stringify(parsed.actions) !== JSON.stringify(re.dataActions)
    ) {
      violations.push({
        rule: 'text-truthfulness',
        elementId: re.dataId,
        message: `Transition "${re.dataId}" visible label "${re.labelText}" contradicts data-edge-* (event="${re.dataEvent}", order=${re.dataOrder}, guard="${re.dataGuard ?? ''}", actions="${re.dataActions.join(',')}")`,
      });
    }

    const finalOrder = reconstructedOrder >= 0 ? reconstructedOrder : re.dataOrder;
    const expectedId = `${re.sourceId}__${parsed.eventType}__${finalOrder}`;
    if (re.dataId !== expectedId) {
      violations.push({
        rule: 'text-truthfulness',
        elementId: re.dataId,
        message: `Transition data-edge-id="${re.dataId}" does not match canonical "${expectedId}"`,
      });
    }

    return {
      id: expectedId,
      sourceId: re.sourceId,
      targetIds: re.targetIds,
      eventType: parsed.eventType,
      order: finalOrder,
      guard: parsed.guard,
      actions: parsed.actions,
    };
  });

  transitions.sort(
    (a, b) =>
      a.sourceId.localeCompare(b.sourceId) ||
      a.eventType.localeCompare(b.eventType) ||
      a.order - b.order,
  );

  const rootInitialTargetId = initialMap.get('__root__') ?? null;

  return {
    ast: {
      machineId: rawResult.machineId,
      rootInitialTargetId,
      nodes,
      transitions,
    },
    violations,
    metrics: {
      stateCount: Object.keys(nodes).length,
      transitionCount: transitions.length,
      maxEndpointDistancePx: rawResult.maxEndpointDistancePx,
      minSelfLoopSeparationPx: rawResult.minSelfLoopSeparationPx,
      viewBox: rawResult.viewBox,
    },
  };
}

/**
 * Gate 1 public entrypoint required by RULES_OF_ENGAGEMENT.md:
 * Reconstructs the `StatechartAST` from the rendered SVG in Playwright and enforces
 * all anti-lying geometric cross-checks (throwing if any check fails).
 */
export async function extractFromSvg(
  page: Page,
  svgSelector = 'svg',
): Promise<StatechartAST> {
  const result = await inspectGate1(page, svgSelector);
  if (result.violations.length > 0) {
    const formatted = result.violations
      .map((v, idx) => `  ${idx + 1}. [${v.rule}] (${v.elementId}) ${v.message}`)
      .join('\n');
    throw new Error(
      `Gate 1 Anti-Lying Geometry / Truthfulness Violations (${result.violations.length}):\n${formatted}`,
    );
  }
  return result.ast;
}
