import type { StatechartAST } from '../ast/types.js';
import type {
  Point,
  PositionedDiagram,
  PositionedEdge,
  PositionedInitialIndicator,
  PositionedNode,
} from './elk-graph.js';
import { layoutTagPills } from './measure.js';
import type { ThemeTokens } from './theme.js';

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fmt(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Converts an orthogonal polyline into an SVG path string with smooth
 * rounded corners (`Q`) at interior 90-degree bends while keeping exact
 * start and end coordinates and straight terminal segments for markers.
 */
export function buildRoundedOrthogonalPath(
  points: Point[],
  cornerRadius: number,
): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    return `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  }
  if (points.length === 2 || cornerRadius <= 0) {
    return points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${fmt(p.x)} ${fmt(p.y)}`)
      .join(' ');
  }

  const parts: string[] = [`M ${fmt(points[0].x)} ${fmt(points[0].y)}`];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const len1 = Math.hypot(v1x, v1y);

    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const len2 = Math.hypot(v2x, v2y);

    const r = Math.min(cornerRadius, len1 * 0.35, len2 * 0.35);
    if (r < 1) {
      parts.push(`L ${fmt(curr.x)} ${fmt(curr.y)}`);
      continue;
    }

    const pInX = curr.x - (v1x / len1) * r;
    const pInY = curr.y - (v1y / len1) * r;
    const pOutX = curr.x + (v2x / len2) * r;
    const pOutY = curr.y + (v2y / len2) * r;

    parts.push(`L ${fmt(pInX)} ${fmt(pInY)}`);
    parts.push(`Q ${fmt(curr.x)} ${fmt(curr.y)} ${fmt(pOutX)} ${fmt(pOutY)}`);
  }

  const last = points[points.length - 1];
  parts.push(`L ${fmt(last.x)} ${fmt(last.y)}`);
  return parts.join(' ');
}

function toRelativeStatePath(stateId: string, machineId: string): string {
  if (!stateId) return '';
  if (stateId === machineId) return '';
  const prefix = `${machineId}.`;
  return stateId.startsWith(prefix) ? stateId.slice(prefix.length) : stateId;
}

function renderStateNode(
  node: PositionedNode,
  fullAst: StatechartAST,
  theme: ThemeTokens,
  clipIndex: number,
): { defs: string; body: string } {
  const { ast, x, y, width, height, depth, headerHeight, compartmentLines } =
    node;

  const isParallelRegion = Boolean(
    ast.parentId && fullAst.nodes[ast.parentId]?.type === 'parallel',
  );
  const stateClasses = [
    'state-node',
    `state-node--${ast.type}`,
    ...(isParallelRegion ? ['state-node--region'] : []),
  ].join(' ');
  const statePath = toRelativeStatePath(ast.id, fullAst.machineId);
  const parentPath = toRelativeStatePath(ast.parentId ?? '', fullAst.machineId);

  const commonAttrs = [
    `class="${escapeXml(stateClasses)}"`,
    `data-state-id="${escapeXml(ast.id)}"`,
    `data-state-path="${escapeXml(statePath)}"`,
    `data-state-key="${escapeXml(ast.key)}"`,
    `data-state-type="${escapeXml(ast.type)}"`,
    `data-parent-id="${escapeXml(ast.parentId ?? '')}"`,
    `data-parent-path="${escapeXml(parentPath)}"`,
    `data-initial-target="${escapeXml(ast.initialTargetId ?? '')}"`,
    `data-history-kind="${escapeXml(ast.historyKind ?? '')}"`,
  ].join(' ');

  if (ast.type === 'history') {
    const cx = x + width / 2;
    const cy = y + height / 2;
    const symbol = ast.historyKind === 'deep' ? 'H*' : 'H';
    if (ast.key === 'history') {
      const r = Math.min(width, height) / 2;
      return {
        defs: '',
        body: [
          `    <g ${commonAttrs}>`,
          `      <circle class="state-box" cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="${theme.colors.historyFill}" stroke="${theme.colors.historyStroke}" stroke-width="${theme.strokes.history}" />`,
          `      <text class="state-title" x="${fmt(cx)}" y="${fmt(cy)}" text-anchor="middle" dominant-baseline="central" font-family="${escapeXml(theme.fonts.sans)}" font-size="${theme.fontSizes.history}" font-weight="700" fill="${theme.colors.historyText}">${escapeXml(symbol)}</text>`,
          `    </g>`,
        ].join('\n'),
      };
    }

    const rx = Math.min(theme.radii.history, height / 2);
    const labelText = `${symbol}: ${ast.key}`;
    return {
      defs: '',
      body: [
        `    <g ${commonAttrs}>`,
        `      <rect class="state-box" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(height)}" rx="${fmt(rx)}" fill="${theme.colors.historyFill}" stroke="${theme.colors.historyStroke}" stroke-width="${theme.strokes.history}" />`,
        `      <text class="state-title" x="${fmt(cx)}" y="${fmt(cy)}" text-anchor="middle" dominant-baseline="central" font-family="${escapeXml(theme.fonts.sans)}" font-size="${theme.fontSizes.history}" font-weight="700" fill="${theme.colors.historyText}">${escapeXml(labelText)}</text>`,
        `    </g>`,
      ].join('\n'),
    };
  }

  const isCompound = ast.type === 'compound';
  const isParallel = ast.type === 'parallel';
  const isFinal = ast.type === 'final';
  const hasCompartments = compartmentLines.length > 0;
  const showDividedHeader = isCompound || isParallel || hasCompartments;

  let fill = theme.colors.atomicFill;
  let stroke = theme.colors.atomicStroke;
  let strokeWidth = theme.strokes.atomic;
  let rx = theme.radii.atomic;
  let dashAttr = '';

  if (isParallelRegion) {
    fill = theme.colors.parallelFill;
    stroke = theme.colors.parallelStroke;
    strokeWidth = theme.strokes.parallel;
    rx = theme.radii.parallel;
    dashAttr = ' stroke-dasharray="6 4"';
  } else if (isCompound || isParallel) {
    fill =
      theme.colors.compoundFills[depth % theme.colors.compoundFills.length];
    stroke = theme.colors.compoundStroke;
    strokeWidth = theme.strokes.compound;
    rx = theme.radii.compound;
  } else if (isFinal) {
    fill = theme.colors.finalFill;
    stroke = theme.colors.finalStroke;
    strokeWidth = theme.strokes.finalOuter;
    rx = theme.radii.finalOuter;
  }

  let defs = '';
  const lines: string[] = [`    <g ${commonAttrs}>`];

  // Primary bounding shape
  lines.push(
    `      <rect class="state-box" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(height)}" rx="${fmt(rx)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr} />`,
  );

  // Final state inner double border
  if (isFinal) {
    const inset = theme.spacing.finalInset;
    lines.push(
      `      <rect class="state-final-inner" x="${fmt(x + inset)}" y="${fmt(y + inset)}" width="${fmt(width - inset * 2)}" height="${fmt(height - inset * 2)}" rx="${fmt(theme.radii.finalInner)}" fill="none" stroke="${theme.colors.finalStroke}" stroke-width="${theme.strokes.finalInner}" />`,
    );
  }

  // Compound/parallel header bar fill & optional parent compartment band clipped cleanly to rounded container
  if (isCompound || isParallel) {
    const clipId = `clip-header-${clipIndex}`;
    defs = `    <clipPath id="${clipId}"><rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(height)}" rx="${fmt(rx)}" /></clipPath>`;
    if (!isParallelRegion) {
      lines.push(
        `      <rect class="state-header-bg" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(headerHeight)}" fill="${theme.colors.compoundHeaderBg}" clip-path="url(#${clipId})" />`,
      );
    } else {
      lines.push(
        `      <rect class="state-header-bg" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(headerHeight)}" fill="#F1F5F9" fill-opacity="0.55" clip-path="url(#${clipId})" />`,
      );
    }
    if (hasCompartments && node.compartmentHeight > 0) {
      lines.push(
        `      <rect class="state-compartment-bg" x="${fmt(x)}" y="${fmt(y + headerHeight)}" width="${fmt(width)}" height="${fmt(node.compartmentHeight)}" fill="#FFFFFF" fill-opacity="0.72" clip-path="url(#${clipId})" />`,
      );
    }
  }

  const finalInset = isFinal ? theme.spacing.finalInset : 0;
  const divX1 = x + finalInset;
  const divX2 = x + width - finalInset;

  if (showDividedHeader) {
    const divY = y + headerHeight;
    const divStroke =
      isCompound || isParallel ? stroke : theme.colors.dividerStroke;
    lines.push(
      `      <line class="state-divider" x1="${fmt(divX1)}" y1="${fmt(divY)}" x2="${fmt(divX2)}" y2="${fmt(divY)}" stroke="${divStroke}" stroke-width="1"${isParallelRegion ? ' stroke-dasharray="6 4"' : ''} />`,
    );
  }

  // Title text (optically centered alongside the bullseye badge on final states)
  const titleX =
    showDividedHeader && (isCompound || isParallel)
      ? x + 14
      : isFinal
        ? x + (width - 14) / 2
        : x + width / 2;
  const titleY = showDividedHeader
    ? y + finalInset + (headerHeight - finalInset) / 2
    : y + height / 2;
  const titleAnchor =
    showDividedHeader && (isCompound || isParallel) ? 'start' : 'middle';

  lines.push(
    `      <text class="state-title" x="${fmt(titleX)}" y="${fmt(titleY)}" text-anchor="${titleAnchor}" dominant-baseline="central" font-family="${escapeXml(theme.fonts.sans)}" font-size="${theme.fontSizes.stateTitle}" font-weight="700" fill="${theme.colors.textPrimary}">${escapeXml(ast.key)}</text>`,
  );

  // Subtle parallel split-region badge in top-right of parallel container header
  if (isParallel) {
    const bx = x + width - 24;
    const by = titleY - 5;
    lines.push(
      `      <g class="state-parallel-badge" aria-hidden="true">`,
      `        <rect x="${fmt(bx)}" y="${fmt(by)}" width="12" height="10" rx="2" fill="none" stroke="${theme.colors.parallelStroke}" stroke-width="1.2" />`,
      `        <line x1="${fmt(bx + 6)}" y1="${fmt(by + 1)}" x2="${fmt(bx + 6)}" y2="${fmt(by + 9)}" stroke="${theme.colors.parallelStroke}" stroke-width="1.1" stroke-dasharray="2 1.5" />`,
      `      </g>`,
    );
  }

  // Subtle final-state bullseye badge in top-right or beside title if room
  if (isFinal) {
    const bx = x + width - 15;
    const by = titleY;
    lines.push(
      `      <circle class="state-final-badge-outer" cx="${fmt(bx)}" cy="${fmt(by)}" r="4.5" fill="none" stroke="${theme.colors.finalStroke}" stroke-width="1.2" />`,
      `      <circle class="state-final-badge-inner" cx="${fmt(bx)}" cy="${fmt(by)}" r="2" fill="${theme.colors.finalStroke}" />`,
    );
  }

  // Helper to format rich compartment row inner XML while keeping exact `.textContent === row.text`
  const formatCompartmentRowInner = (
    kind: string,
    rowText: string,
    attrs: Record<string, string>,
  ): string => {
    if (kind === 'entry' && rowText.startsWith('entry / ')) {
      const rest = rowText.slice('entry'.length);
      return `<tspan class="compartment-keyword" font-weight="700" fill="${theme.colors.textPrimary}">entry</tspan>${escapeXml(rest)}`;
    }
    if (kind === 'exit' && rowText.startsWith('exit / ')) {
      const rest = rowText.slice('exit'.length);
      return `<tspan class="compartment-keyword" font-weight="700" fill="${theme.colors.textPrimary}">exit</tspan>${escapeXml(rest)}`;
    }
    if (kind === 'invoke' && rowText.startsWith('invoke / ')) {
      const rest = rowText.slice('invoke'.length);
      return `<tspan class="compartment-keyword" font-weight="700" fill="${theme.colors.textPrimary}">invoke</tspan>${escapeXml(rest)}`;
    }
    if (kind === 'internal') {
      const ev = attrs['data-internal-event'] ?? '';
      const prefixMatch = rowText.match(/^(\[#\d+\]\s+)/);
      const pfx = prefixMatch ? prefixMatch[1] : '';
      const afterPfx = rowText.slice(pfx.length);
      if (ev && afterPfx.startsWith(ev)) {
        const rest = afterPfx.slice(ev.length);
        const pfxSpan = pfx
          ? `<tspan class="internal-priority" font-weight="700" fill="${theme.colors.edgeStroke}">${escapeXml(pfx)}</tspan>`
          : '';
        return `${pfxSpan}<tspan class="internal-event" font-weight="700" fill="${theme.colors.textPrimary}">${escapeXml(ev)}</tspan>${escapeXml(rest)}`;
      }
    }
    return escapeXml(rowText);
  };

  // Render compartments
  const leftPad = 12 + finalInset;
  let cursorY = y + headerHeight;
  for (let gIdx = 0; gIdx < compartmentLines.length; gIdx++) {
    const group = compartmentLines[gIdx];
    if (gIdx > 0) {
      lines.push(
        `      <line class="compartment-divider" x1="${fmt(divX1)}" y1="${fmt(cursorY)}" x2="${fmt(divX2)}" y2="${fmt(cursorY)}" stroke="${theme.colors.dividerStroke}" stroke-width="1" />`,
      );
    }

    lines.push(
      `      <g class="state-compartment" data-compartment="${group.kind}">`,
    );

    if (group.kind === 'tags') {
      const innerAvailW = Math.max(80, width - leftPad * 2);
      const laidOut = layoutTagPills(
        group.rows.map((r) => r.text),
        innerAvailW,
        theme.fontSizes.tag,
      );
      for (const pill of laidOut.pills) {
        const row = group.rows[pill.index];
        const tagValue = row.attrs['data-tag'] ?? '';
        const px = x + leftPad + pill.relX;
        const py = cursorY + pill.relY;
        lines.push(
          `        <g class="state-tag" data-tag="${escapeXml(tagValue)}">`,
          `          <rect x="${fmt(px)}" y="${fmt(py)}" width="${fmt(pill.width)}" height="${fmt(pill.height)}" rx="${theme.radii.tag}" fill="${theme.colors.tagBg}" stroke="${theme.colors.tagStroke}" stroke-width="1" />`,
          `          <text x="${fmt(px + pill.width / 2)}" y="${fmt(py + pill.height / 2)}" text-anchor="middle" dominant-baseline="central" font-family="${escapeXml(theme.fonts.sans)}" font-size="${theme.fontSizes.tag}" font-weight="600" fill="${theme.colors.tagText}">${escapeXml(pill.text)}</text>`,
          `        </g>`,
        );
      }
      cursorY += laidOut.totalHeight;
    } else {
      cursorY += theme.spacing.compartmentPaddingY;
      const rowClass =
        group.kind === 'internal'
          ? 'compartment-row internal-transition'
          : `compartment-row compartment-${group.kind}`;
      for (const row of group.rows) {
        const attrStr = Object.entries(row.attrs)
          .map(([k, v]) => `${k}="${escapeXml(v)}"`)
          .join(' ');
        const rowCenterY = cursorY + theme.spacing.compartmentLineHeight / 2;
        const innerXml = formatCompartmentRowInner(
          group.kind,
          row.text,
          row.attrs,
        );
        lines.push(
          `        <text class="${rowClass}" ${attrStr} x="${fmt(x + leftPad)}" y="${fmt(rowCenterY)}" text-anchor="start" dominant-baseline="central" font-family="${escapeXml(theme.fonts.mono)}" font-size="${theme.fontSizes.compartment}" fill="${theme.colors.textSecondary}">${innerXml}</text>`,
        );
        cursorY += theme.spacing.compartmentLineHeight;
      }
      cursorY += theme.spacing.compartmentPaddingY;
    }

    lines.push(`      </g>`);
  }

  if ((isCompound || isParallel) && hasCompartments) {
    lines.push(
      `      <line class="compartment-bottom-divider" x1="${fmt(divX1)}" y1="${fmt(cursorY)}" x2="${fmt(divX2)}" y2="${fmt(cursorY)}" stroke="${theme.colors.dividerStroke}" stroke-width="1" />`,
    );
  }

  lines.push(`    </g>`);
  return { defs, body: lines.join('\n') };
}

function renderInitialIndicator(
  ind: PositionedInitialIndicator,
  theme: ThemeTokens,
): string {
  const parentAttr = ind.parentId ?? '__root__';
  const d = buildRoundedOrthogonalPath(ind.points, theme.radii.edgeCorner);
  return [
    `    <g class="initial-indicator" data-parent-id="${escapeXml(parentAttr)}" data-target-id="${escapeXml(ind.targetId)}">`,
    `      <circle class="initial-dot" cx="${fmt(ind.cx)}" cy="${fmt(ind.cy)}" r="${fmt(ind.r)}" fill="${theme.colors.initialFill}" />`,
    `      <path class="initial-edge" d="${d}" fill="none" stroke="${theme.colors.initialStroke}" stroke-width="${theme.strokes.initialEdge}" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#arrow-initial)" />`,
    `    </g>`,
  ].join('\n');
}

function classifyEdgeModifiers(
  eventType: string,
  sourceId: string,
  targetIds: string[],
): string[] {
  const mods: string[] = [];
  if (eventType === 'always') {
    mods.push('transition-edge--eventless');
  } else if (eventType.startsWith('after(')) {
    mods.push('transition-edge--delayed');
  } else if (eventType === 'onDone' || eventType.startsWith('onDone(')) {
    mods.push('transition-edge--done');
  } else if (eventType.startsWith('onError(')) {
    mods.push('transition-edge--error');
  }
  if (targetIds.length === 1 && targetIds[0] === sourceId) {
    mods.push('transition-edge--self');
  }
  if (targetIds.length > 1) {
    mods.push('transition-edge--fork');
  }
  return mods;
}

function renderTransitionEdge(
  edge: PositionedEdge,
  fullAst: StatechartAST,
  theme: ThemeTokens,
): string {
  const { ast, branches, label } = edge;
  const edgeClasses = [
    'transition-edge',
    ...classifyEdgeModifiers(ast.eventType, ast.sourceId, ast.targetIds),
  ].join(' ');
  const sourcePath = toRelativeStatePath(ast.sourceId, fullAst.machineId);
  const targetPaths = ast.targetIds.map((tid) =>
    toRelativeStatePath(tid, fullAst.machineId),
  );

  const attrs = [
    `class="${escapeXml(edgeClasses)}"`,
    `data-edge-id="${escapeXml(ast.id)}"`,
    `data-edge-source="${escapeXml(ast.sourceId)}"`,
    `data-edge-source-path="${escapeXml(sourcePath)}"`,
    `data-edge-targets="${escapeXml(ast.targetIds.join(','))}"`,
    `data-edge-target-paths="${escapeXml(targetPaths.join(','))}"`,
    `data-edge-event="${escapeXml(ast.eventType)}"`,
    `data-edge-order="${ast.order}"`,
    `data-edge-guard="${escapeXml(ast.guard ?? '')}"`,
    `data-edge-actions="${escapeXml(ast.actions.join(','))}"`,
  ].join(' ');

  const lines: string[] = [`    <g ${attrs}>`];

  for (let bIdx = 0; bIdx < branches.length; bIdx++) {
    const pts = branches[bIdx];
    const tid = ast.targetIds[bIdx] ?? ast.sourceId;
    const tPath = toRelativeStatePath(tid, fullAst.machineId);
    const d = buildRoundedOrthogonalPath(pts, theme.radii.edgeCorner);
    lines.push(
      `      <path class="edge-path" data-edge-target="${escapeXml(tid)}" data-edge-target-path="${escapeXml(tPath)}" d="${d}" fill="none" stroke="${theme.colors.edgeStroke}" stroke-width="${theme.strokes.edge}" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#arrow-transition)" />`,
    );
  }

  // Emit crisp fork junction dot where multi-target branches diverge from their shared trunk
  if (
    branches.length > 1 &&
    branches.every(
      (br) =>
        br.length >= 2 &&
        Math.hypot(br[0].x - branches[0][0].x, br[0].y - branches[0][0].y) <= 1,
    )
  ) {
    const p0 = branches[0][0];
    const p1 = branches[0][1];
    const d0 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    let jPt = p1;
    if (d0 > 1e-3) {
      const ux = (p1.x - p0.x) / d0;
      const uy = (p1.y - p0.y) / d0;
      let minShared = d0;
      let allAligned = true;
      for (let b = 1; b < branches.length; b++) {
        const bp1 = branches[b][1];
        const db = Math.hypot(bp1.x - p0.x, bp1.y - p0.y);
        if (db <= 1e-3) {
          allAligned = false;
          break;
        }
        const dot = ((bp1.x - p0.x) / db) * ux + ((bp1.y - p0.y) / db) * uy;
        if (dot < 0.98) {
          allAligned = false;
          break;
        }
        minShared = Math.min(minShared, db);
      }
      jPt = allAligned
        ? { x: p0.x + ux * minShared, y: p0.y + uy * minShared }
        : p0;
    }
    lines.push(
      `      <circle class="fork-junction" cx="${fmt(jPt.x)}" cy="${fmt(jPt.y)}" r="3.5" fill="${theme.colors.edgeStroke}" />`,
    );
  }

  // Render label pill + single-line or multi-line stacked card whose `.textContent` equals `label.text`
  const cx = label.x + label.width / 2;
  const cy = label.y + label.height / 2;

  let textElementXml: string;
  if (label.lines && label.lines.length >= 2) {
    const xLeft = label.x + 8;
    const yBase0 = label.y + 17;
    const lineSpans = label.lines
      .map((line, lineIdx) => {
        const isNonFinal = lineIdx < label.lines.length - 1;
        const dy = lineIdx === 0 ? '0' : fmt(label.lineHeight);
        if (
          line.segments.length === 1 &&
          line.segments[0].tone === 'secondary'
        ) {
          const seg = line.segments[0];
          const content = `${seg.text}${isNonFinal ? ' ' : ''}`;
          return `<tspan class="edge-label-line edge-label-meta" x="${fmt(xLeft)}" dy="${dy}" font-family="${escapeXml(theme.fonts.mono)}" font-size="${fmt(seg.fontSize)}" font-weight="400" fill="${theme.colors.textSecondary}">${escapeXml(content)}</tspan>`;
        }
        if (line.segments.length === 1 && line.segments[0].tone === 'event') {
          const seg = line.segments[0];
          const content = `${seg.text}${isNonFinal ? ' ' : ''}`;
          return `<tspan class="edge-label-line edge-label-event" x="${fmt(xLeft)}" dy="${dy}">${escapeXml(content)}</tspan>`;
        }
        const innerSegs = line.segments
          .map((seg, sIdx) => {
            const addSpace = isNonFinal && sIdx === line.segments.length - 1;
            const content = `${seg.text}${addSpace ? ' ' : ''}`;
            if (seg.tone === 'prefix') {
              return `<tspan class="edge-label-prefix" font-family="${escapeXml(theme.fonts.mono)}" font-size="${fmt(seg.fontSize)}" font-weight="700" fill="${theme.colors.edgeStroke}">${escapeXml(content)}</tspan>`;
            }
            if (seg.tone === 'secondary') {
              return `<tspan class="edge-label-meta" font-family="${escapeXml(theme.fonts.mono)}" font-size="${fmt(seg.fontSize)}" font-weight="400" fill="${theme.colors.textSecondary}">${escapeXml(content)}</tspan>`;
            }
            return `<tspan class="edge-label-event" font-family="${escapeXml(theme.fonts.sans)}" font-weight="600" fill="${theme.colors.edgeLabelText}">${escapeXml(content)}</tspan>`;
          })
          .join('');
        return `<tspan class="edge-label-line" x="${fmt(xLeft)}" dy="${dy}">${innerSegs}</tspan>`;
      })
      .join('');
    textElementXml = `        <text class="edge-label-text" x="${fmt(xLeft)}" y="${fmt(yBase0)}" text-anchor="start" font-family="${escapeXml(theme.fonts.sans)}" font-size="${theme.fontSizes.edgeLabel}" font-weight="600" fill="${theme.colors.edgeLabelText}">${lineSpans}</text>`;
  } else {
    const hasRichParts =
      label.priorityPrefix.length > 0 || label.suffix.length > 0;
    let textInner: string;
    if (!hasRichParts) {
      textInner = escapeXml(ast.eventType);
    } else {
      const pfxSpan =
        label.priorityPrefix.length > 0
          ? `<tspan class="edge-label-prefix" font-family="${escapeXml(theme.fonts.mono)}" font-size="${fmt(theme.fontSizes.edgeLabel - 1)}" font-weight="700" fill="${theme.colors.edgeStroke}">${escapeXml(label.priorityPrefix)}</tspan>`
          : '';
      const evSpan = `<tspan class="edge-label-event" font-family="${escapeXml(theme.fonts.sans)}" font-weight="600" fill="${theme.colors.edgeLabelText}">${escapeXml(ast.eventType)}</tspan>`;
      const sfxSpan =
        label.suffix.length > 0
          ? `<tspan class="edge-label-meta" font-family="${escapeXml(theme.fonts.mono)}" font-size="${fmt(theme.fontSizes.edgeLabel - 0.5)}" font-weight="400" fill="${theme.colors.textSecondary}">${escapeXml(label.suffix)}</tspan>`
          : '';
      textInner = `${pfxSpan}${evSpan}${sfxSpan}`;
    }
    textElementXml = `        <text class="edge-label-text" x="${fmt(cx)}" y="${fmt(cy)}" text-anchor="middle" dominant-baseline="central" font-family="${escapeXml(theme.fonts.sans)}" font-size="${theme.fontSizes.edgeLabel}" font-weight="600" fill="${theme.colors.edgeLabelText}">${textInner}</text>`;
  }

  lines.push(
    `      <g class="edge-label">`,
    `        <rect class="edge-label-bg" x="${fmt(label.x)}" y="${fmt(label.y)}" width="${fmt(label.width)}" height="${fmt(label.height)}" rx="${theme.radii.edgeLabel}" fill="${theme.colors.edgeLabelBg}" fill-opacity="0.95" stroke="${theme.colors.edgeLabelStroke}" stroke-width="${theme.strokes.edgeLabel}" />`,
    textElementXml,
    `      </g>`,
  );

  lines.push(`    </g>`);
  return lines.join('\n');
}

function buildInteractiveStyleSheet(): string {
  return [
    `    <style class="xstate-diagram-styles">`,
    `      .xstate-diagram {`,
    `        --xsd-active-stroke: #0284C7;`,
    `        --xsd-active-fill: #F0F9FF;`,
    `        --xsd-active-header-bg: #BAE6FD;`,
    `        --xsd-active-title: #0369A1;`,
    `        --xsd-active-divider: #7DD3FC;`,
    `        --xsd-active-glow: rgba(2, 132, 199, 0.22);`,
    `        --xsd-enabled-stroke: #0284C7;`,
    `        --xsd-enabled-label-bg: #F0F9FF;`,
    `        --xsd-enabled-label-stroke: #38BDF8;`,
    `        --xsd-enabled-label-text: #0369A1;`,
    `        --xsd-enabled-label-meta: #0369A1;`,
    `        --xsd-hover-stroke: #0369A1;`,
    `        --xsd-hover-label-bg: #E0F2FE;`,
    `        --xsd-hover-label-stroke: #0284C7;`,
    `        --xsd-hover-label-text: #0C4A6E;`,
    `        --xsd-triggered-stroke: #059669;`,
    `        --xsd-triggered-label-bg: #ECFDF5;`,
    `        --xsd-triggered-label-stroke: #34D399;`,
    `        --xsd-triggered-label-text: #065F46;`,
    `        --xsd-disabled-opacity: 0.45;`,
    `        --xsd-transition-duration: 0ms;`,
    `      }`,
    `      .state-node > .state-box,`,
    `      .state-node > .state-header-bg,`,
    `      .state-node > .state-divider,`,
    `      .state-node > .state-title,`,
    `      .transition-edge > .edge-path,`,
    `      .transition-edge > .fork-junction,`,
    `      .transition-edge > .edge-label > .edge-label-bg,`,
    `      .transition-edge > .edge-label > .edge-label-text {`,
    `        transition: fill var(--xsd-transition-duration) ease, stroke var(--xsd-transition-duration) ease;`,
    `      }`,
    `      .state-node:is(.is-active, .active, [data-active="true"]) > .state-box {`,
    `        stroke: var(--xsd-active-stroke);`,
    `        stroke-width: 2.5px;`,
    `      }`,
    `      .state-node:is(.state-node--atomic, .state-node--final, .state-node--history):is(.is-active, .active, [data-active="true"]) > .state-box {`,
    `        fill: var(--xsd-active-fill);`,
    `        filter: drop-shadow(0 0 6px var(--xsd-active-glow));`,
    `      }`,
    `      .state-node:is(.state-node--compound, .state-node--parallel):is(.is-active, .active, [data-active="true"]) > .state-box {`,
    `        stroke-width: 2.25px;`,
    `      }`,
    `      .state-node:is(.state-node--compound, .state-node--parallel):is(.is-active, .active, [data-active="true"]) > .state-header-bg {`,
    `        fill: var(--xsd-active-header-bg);`,
    `        fill-opacity: 0.9;`,
    `      }`,
    `      .state-node:is(.is-active, .active, [data-active="true"]) > .state-title {`,
    `        fill: var(--xsd-active-title);`,
    `      }`,
    `      .state-node:is(.is-active, .active, [data-active="true"]) > .state-divider,`,
    `      .state-node:is(.is-active, .active, [data-active="true"]) > .compartment-divider,`,
    `      .state-node:is(.is-active, .active, [data-active="true"]) > .compartment-bottom-divider {`,
    `        stroke: var(--xsd-active-divider);`,
    `      }`,
    `      .state-node:is(.is-active, .active, [data-active="true"]) > .state-final-inner,`,
    `      .state-node:is(.is-active, .active, [data-active="true"]) > .state-final-badge-outer,`,
    `      .state-node:is(.is-active, .active, [data-active="true"]) > .state-parallel-badge rect,`,
    `      .state-node:is(.is-active, .active, [data-active="true"]) > .state-parallel-badge line {`,
    `        stroke: var(--xsd-active-stroke);`,
    `      }`,
    `      .state-node:is(.is-active, .active, [data-active="true"]) > .state-final-badge-inner {`,
    `        fill: var(--xsd-active-stroke);`,
    `      }`,
    `      .transition-edge:is(.is-enabled, .is-available, .is-active, .enabled, [data-enabled="true"], [data-active="true"]) {`,
    `        cursor: pointer;`,
    `      }`,
    `      .transition-edge:is(.is-enabled, .is-available, .is-active, .enabled, [data-enabled="true"], [data-active="true"]) > .edge-path {`,
    `        stroke: var(--xsd-enabled-stroke);`,
    `        stroke-width: 2.5px;`,
    `        marker-end: url(#arrow-transition-active);`,
    `      }`,
    `      .transition-edge:is(.is-enabled, .is-available, .is-active, .enabled, [data-enabled="true"], [data-active="true"]) > .fork-junction {`,
    `        fill: var(--xsd-enabled-stroke);`,
    `      }`,
    `      .transition-edge:is(.is-enabled, .is-available, .is-active, .enabled, [data-enabled="true"], [data-active="true"]) > .edge-label > .edge-label-bg {`,
    `        fill: var(--xsd-enabled-label-bg);`,
    `        fill-opacity: 1;`,
    `        stroke: var(--xsd-enabled-label-stroke);`,
    `        stroke-width: 1.5px;`,
    `      }`,
    `      .transition-edge:is(.is-enabled, .is-available, .is-active, .enabled, [data-enabled="true"], [data-active="true"]) > .edge-label .edge-label-text,`,
    `      .transition-edge:is(.is-enabled, .is-available, .is-active, .enabled, [data-enabled="true"], [data-active="true"]) > .edge-label .edge-label-event,`,
    `      .transition-edge:is(.is-enabled, .is-available, .is-active, .enabled, [data-enabled="true"], [data-active="true"]) > .edge-label .edge-label-prefix {`,
    `        fill: var(--xsd-enabled-label-text);`,
    `      }`,
    `      .transition-edge:is(.is-enabled, .is-available, .is-active, .enabled, [data-enabled="true"], [data-active="true"]) > .edge-label .edge-label-meta {`,
    `        fill: var(--xsd-enabled-label-meta);`,
    `      }`,
    `      .transition-edge:is(.is-clickable, .clickable, [data-clickable="true"]) {`,
    `        cursor: pointer;`,
    `      }`,
    `      .transition-edge:is(.is-enabled, .is-available, .is-active, .enabled, .is-clickable, .clickable, [data-enabled="true"], [data-active="true"], [data-clickable="true"]):hover > .edge-path {`,
    `        stroke: var(--xsd-hover-stroke);`,
    `        stroke-width: 3px;`,
    `        marker-end: url(#arrow-transition-hover);`,
    `      }`,
    `      .transition-edge:is(.is-enabled, .is-available, .is-active, .enabled, .is-clickable, .clickable, [data-enabled="true"], [data-active="true"], [data-clickable="true"]):hover > .fork-junction {`,
    `        fill: var(--xsd-hover-stroke);`,
    `      }`,
    `      .transition-edge:is(.is-enabled, .is-available, .is-active, .enabled, .is-clickable, .clickable, [data-enabled="true"], [data-active="true"], [data-clickable="true"]):hover > .edge-label > .edge-label-bg {`,
    `        fill: var(--xsd-hover-label-bg);`,
    `        fill-opacity: 1;`,
    `        stroke: var(--xsd-hover-label-stroke);`,
    `        stroke-width: 1.75px;`,
    `        filter: drop-shadow(0 1px 3px var(--xsd-active-glow));`,
    `      }`,
    `      .transition-edge:is(.is-enabled, .is-available, .is-active, .enabled, .is-clickable, .clickable, [data-enabled="true"], [data-active="true"], [data-clickable="true"]):hover > .edge-label .edge-label-text,`,
    `      .transition-edge:is(.is-enabled, .is-available, .is-active, .enabled, .is-clickable, .clickable, [data-enabled="true"], [data-active="true"], [data-clickable="true"]):hover > .edge-label .edge-label-event,`,
    `      .transition-edge:is(.is-enabled, .is-available, .is-active, .enabled, .is-clickable, .clickable, [data-enabled="true"], [data-active="true"], [data-clickable="true"]):hover > .edge-label .edge-label-prefix {`,
    `        fill: var(--xsd-hover-label-text);`,
    `      }`,
    `      .transition-edge:is(.is-triggered, .is-taken, [data-triggered="true"]) > .edge-path {`,
    `        stroke: var(--xsd-triggered-stroke);`,
    `        stroke-width: 2.75px;`,
    `        marker-end: url(#arrow-transition-triggered);`,
    `      }`,
    `      .transition-edge:is(.is-triggered, .is-taken, [data-triggered="true"]) > .fork-junction {`,
    `        fill: var(--xsd-triggered-stroke);`,
    `      }`,
    `      .transition-edge:is(.is-triggered, .is-taken, [data-triggered="true"]) > .edge-label > .edge-label-bg {`,
    `        fill: var(--xsd-triggered-label-bg);`,
    `        fill-opacity: 1;`,
    `        stroke: var(--xsd-triggered-label-stroke);`,
    `        stroke-width: 1.75px;`,
    `      }`,
    `      .transition-edge:is(.is-triggered, .is-taken, [data-triggered="true"]) > .edge-label .edge-label-text,`,
    `      .transition-edge:is(.is-triggered, .is-taken, [data-triggered="true"]) > .edge-label .edge-label-event,`,
    `      .transition-edge:is(.is-triggered, .is-taken, [data-triggered="true"]) > .edge-label .edge-label-prefix {`,
    `        fill: var(--xsd-triggered-label-text);`,
    `      }`,
    `      .internal-transition:is(.is-enabled, .is-available, .is-active, .enabled, .is-clickable, .clickable, [data-enabled="true"], [data-active="true"], [data-clickable="true"]) {`,
    `        cursor: pointer;`,
    `        fill: var(--xsd-enabled-label-text);`,
    `      }`,
    `      .internal-transition:is(.is-enabled, .is-available, .is-active, .enabled, .is-clickable, .clickable, [data-enabled="true"], [data-active="true"], [data-clickable="true"]) .internal-event,`,
    `      .internal-transition:is(.is-enabled, .is-available, .is-active, .enabled, .is-clickable, .clickable, [data-enabled="true"], [data-active="true"], [data-clickable="true"]) .internal-priority {`,
    `        fill: var(--xsd-enabled-label-text);`,
    `      }`,
    `      .internal-transition:is(.is-enabled, .is-available, .is-active, .enabled, .is-clickable, .clickable, [data-enabled="true"], [data-active="true"], [data-clickable="true"]):hover {`,
    `        fill: var(--xsd-hover-label-text);`,
    `        text-decoration: underline;`,
    `      }`,
    `      .state-node:is(.is-disabled, .is-inactive, [data-disabled="true"]),`,
    `      .transition-edge:is(.is-disabled, .is-inactive, [data-disabled="true"]),`,
    `      .internal-transition:is(.is-disabled, .is-inactive, [data-disabled="true"]) {`,
    `        opacity: var(--xsd-disabled-opacity);`,
    `      }`,
    `      .initial-indicator:is(.is-active, .active, [data-active="true"]) > .initial-dot {`,
    `        fill: var(--xsd-active-stroke);`,
    `      }`,
    `      .initial-indicator:is(.is-active, .active, [data-active="true"]) > .initial-edge {`,
    `        stroke: var(--xsd-active-stroke);`,
    `        marker-end: url(#arrow-transition-active);`,
    `      }`,
    `    </style>`,
  ].join('\n');
}

/**
 * Serializes a PositionedDiagram + StatechartAST into a standalone SVG string
 * conforming to Section 4 & Section 5 of ARCHITECTURE.md.
 */
export function renderDiagramToSvg(
  diagram: PositionedDiagram,
  ast: StatechartAST,
): string {
  const { width, height, theme, nodes, initialIndicators, edges } = diagram;

  const extraDefs: string[] = [];
  const stateSvgBlocks: string[] = [];

  nodes.forEach((n, idx) => {
    const rendered = renderStateNode(n, ast, theme, idx);
    if (rendered.defs) extraDefs.push(rendered.defs);
    stateSvgBlocks.push(rendered.body);
  });

  const initialBlocks = initialIndicators.map((ind) =>
    renderInitialIndicator(ind, theme),
  );
  const edgeBlocks = edges.map((e) => renderTransitionEdge(e, ast, theme));

  const mw = theme.markers.arrowWidth;
  const mh = theme.markers.arrowHeight;
  const maxCssDim = 7600;
  const cssScale = Math.min(1, maxCssDim / Math.max(width, height, 1));
  const attrWidth = Math.round(width * cssScale);
  const attrHeight = Math.round(height * cssScale);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" class="xstate-diagram" viewBox="0 0 ${width} ${height}" width="${attrWidth}" height="${attrHeight}" data-machine-id="${escapeXml(ast.machineId)}" data-root-initial="${escapeXml(ast.rootInitialTargetId ?? '')}">`,
    `  <defs>`,
    buildInteractiveStyleSheet(),
    `    <marker id="arrow-transition" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="${mw}" markerHeight="${mh}" markerUnits="userSpaceOnUse" orient="auto">`,
    `      <path d="M 0 0.5 L 9.5 4 L 0 7.5 L 1.8 4 Z" fill="${theme.colors.edgeStroke}" />`,
    `    </marker>`,
    `    <marker id="arrow-transition-active" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="${mw}" markerHeight="${mh}" markerUnits="userSpaceOnUse" orient="auto">`,
    `      <path d="M 0 0.5 L 9.5 4 L 0 7.5 L 1.8 4 Z" fill="#0284C7" />`,
    `    </marker>`,
    `    <marker id="arrow-transition-hover" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="${mw}" markerHeight="${mh}" markerUnits="userSpaceOnUse" orient="auto">`,
    `      <path d="M 0 0.5 L 9.5 4 L 0 7.5 L 1.8 4 Z" fill="#0369A1" />`,
    `    </marker>`,
    `    <marker id="arrow-transition-triggered" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="${mw}" markerHeight="${mh}" markerUnits="userSpaceOnUse" orient="auto">`,
    `      <path d="M 0 0.5 L 9.5 4 L 0 7.5 L 1.8 4 Z" fill="#059669" />`,
    `    </marker>`,
    `    <marker id="arrow-initial" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="${mw}" markerHeight="${mh}" markerUnits="userSpaceOnUse" orient="auto">`,
    `      <path d="M 0 0.5 L 9.5 4 L 0 7.5 L 1.8 4 Z" fill="${theme.colors.initialStroke}" />`,
    `    </marker>`,
    ...extraDefs,
    `  </defs>`,
    `  <rect class="canvas-bg" x="0" y="0" width="${width}" height="${height}" fill="${theme.colors.canvasBg}" />`,
    `  <g class="layer-states">`,
    ...stateSvgBlocks,
    `  </g>`,
    `  <g class="layer-initials">`,
    ...initialBlocks,
    `  </g>`,
    `  <g class="layer-edges">`,
    ...edgeBlocks,
    `  </g>`,
    `</svg>`,
  ].join('\n');
}
