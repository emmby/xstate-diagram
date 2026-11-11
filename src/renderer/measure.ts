import { DEFAULT_THEME } from './theme.js';

/**
 * Normalized per-character advance widths (at 1000 units per em) for
 * Arial / Helvetica / Liberation Sans (Regular & Bold conservative upper bound).
 * Using slightly generous metrics guarantees text never overflows containers in Chromium.
 */
const ARIAL_CHAR_WIDTHS_1000: Record<string, number> = {
  ' ': 278,
  '!': 333,
  '"': 474,
  '#': 556,
  '$': 556,
  '%': 889,
  '&': 722,
  "'": 238,
  '(': 333,
  ')': 333,
  '*': 389,
  '+': 584,
  ',': 278,
  '-': 333,
  '.': 278,
  '/': 278,
  '0': 556,
  '1': 556,
  '2': 556,
  '3': 556,
  '4': 556,
  '5': 556,
  '6': 556,
  '7': 556,
  '8': 556,
  '9': 556,
  ':': 333,
  ';': 333,
  '<': 584,
  '=': 584,
  '>': 584,
  '?': 611,
  '@': 975,
  A: 722,
  B: 722,
  C: 722,
  D: 722,
  E: 667,
  F: 611,
  G: 778,
  H: 722,
  I: 278,
  J: 556,
  K: 722,
  L: 611,
  M: 833,
  N: 722,
  O: 778,
  P: 667,
  Q: 778,
  R: 722,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 944,
  X: 667,
  Y: 667,
  Z: 611,
  '[': 333,
  '\\': 278,
  ']': 333,
  '^': 584,
  _: 556,
  '`': 333,
  a: 556,
  b: 611,
  c: 556,
  d: 611,
  e: 556,
  f: 333,
  g: 611,
  h: 611,
  i: 278,
  j: 278,
  k: 556,
  l: 278,
  m: 889,
  n: 611,
  o: 611,
  p: 611,
  q: 611,
  r: 389,
  s: 556,
  t: 333,
  u: 611,
  v: 556,
  w: 778,
  x: 556,
  y: 556,
  z: 500,
  '{': 389,
  '|': 280,
  '}': 389,
  '~': 584,
};

const DEFAULT_ARIAL_CHAR_WIDTH = 620;
const MONO_CHAR_RATIO = 0.61;

export interface MeasureTextOptions {
  fontFamily?: 'sans' | 'mono';
  fontSize?: number;
  bold?: boolean;
  includeSafetyBuffer?: boolean;
}

/**
 * Pure-JS text width measurement using the metrically-compatible Arial/Helvetica
 * lookup table or fixed 0.60 * fontSize monospace width, plus +8px safety buffer.
 */
export function measureTextWidth(
  text: string,
  options: MeasureTextOptions = {},
): number {
  const {
    fontFamily = 'sans',
    fontSize = DEFAULT_THEME.fontSizes.stateTitle,
    bold = false,
    includeSafetyBuffer = true,
  } = options;

  if (!text || text.length === 0) {
    return includeSafetyBuffer ? DEFAULT_THEME.spacing.textSafetyBuffer : 0;
  }

  let rawWidth = 0;
  if (fontFamily === 'mono') {
    rawWidth = text.length * fontSize * MONO_CHAR_RATIO;
  } else {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const units = ARIAL_CHAR_WIDTHS_1000[ch] ?? DEFAULT_ARIAL_CHAR_WIDTH;
      rawWidth += (units / 1000) * fontSize;
    }
  }

  if (bold) {
    rawWidth *= 1.05;
  }

  const safety = includeSafetyBuffer ? DEFAULT_THEME.spacing.textSafetyBuffer : 0;
  return Math.ceil(rawWidth + safety);
}

/**
 * Formats a transition label according to ARCHITECTURE.md Section 3.3:
 * - Single branch (`totalForEvent <= 1`): `<eventType> [guard] / action1, action2`
 * - Multi-branch (`totalForEvent > 1`): `[#${order + 1}] <eventType> [guard] / action1, action2`
 */
export function formatTransitionLabel(
  eventType: string,
  guard: string | null,
  actions: string[],
  order = 0,
  totalForEvent = 1,
): string {
  const prefix = totalForEvent > 1 ? `[#${order + 1}] ` : '';
  let label = `${prefix}${eventType}`;
  if (guard) {
    label += ` [${guard}]`;
  }
  if (actions && actions.length > 0) {
    label += ` / ${actions.join(', ')}`;
  }
  return label;
}

export interface EdgeLabelLineSegment {
  text: string;
  fontFamily: 'sans' | 'mono';
  fontSize: number;
  bold: boolean;
  tone: 'prefix' | 'event' | 'secondary';
}

export interface EdgeLabelLine {
  segments: EdgeLabelLineSegment[];
  rawText: string;
  width: number;
}

export interface MeasuredEdgeLabelPill {
  width: number;
  height: number;
  lineHeight: number;
  text: string;
  priorityPrefix: string;
  eventType: string;
  suffix: string;
  lines: EdgeLabelLine[];
}

function wrapPhraseAtSpaces(phrase: string, maxChars: number): string[] {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [phrase.trim()];
  if (words[0] === '/' && words.length >= 2) {
    words.splice(0, 2, `/ ${words[1]}`);
  }
  const out: string[] = [];
  let cur = words[0];
  for (let i = 1; i < words.length; i++) {
    if (cur.length + 1 + words[i].length <= maxChars) {
      cur += ` ${words[i]}`;
    } else {
      out.push(cur);
      cur = words[i];
    }
  }
  out.push(cur);
  return out;
}

/**
 * Measures the bounding box (width, height) and stacked line layout of a transition
 * label pill (`.edge-label-bg`), keeping short single-clause labels on 1 line and
 * stacking multi-clause / multi-action labels into compact multi-line cards.
 */
export function measureEdgeLabelPill(
  eventType: string,
  guard: string | null,
  actions: string[],
  order = 0,
  totalForEvent = 1,
): MeasuredEdgeLabelPill {
  const priorityPrefix = totalForEvent > 1 ? `[#${order + 1}] ` : '';
  const text = formatTransitionLabel(
    eventType,
    guard,
    actions,
    order,
    totalForEvent,
  );
  const fontSize = DEFAULT_THEME.fontSizes.edgeLabel;
  const lineHeight = 17;

  let suffix = '';
  if (guard) {
    suffix += ` [${guard}]`;
  }
  if (actions && actions.length > 0) {
    suffix += ` / ${actions.join(', ')}`;
  }

  const hasGuard = Boolean(guard && guard.trim().length > 0);
  const hasActions = Boolean(actions && actions.length > 0);
  const rawSegmentRows: EdgeLabelLineSegment[][] = [];

  if (!hasGuard && !hasActions) {
    if (
      (priorityPrefix + eventType).length > 24 &&
      eventType.includes(' ')
    ) {
      const evParts = wrapPhraseAtSpaces(eventType, 24);
      evParts.forEach((part, idx) => {
        const segs: EdgeLabelLineSegment[] = [];
        if (idx === 0 && priorityPrefix.length > 0) {
          segs.push({
            text: priorityPrefix,
            fontFamily: 'mono',
            fontSize: fontSize - 1,
            bold: true,
            tone: 'prefix',
          });
        }
        segs.push({
          text: part,
          fontFamily: 'sans',
          fontSize,
          bold: true,
          tone: 'event',
        });
        rawSegmentRows.push(segs);
      });
    } else {
      const segs: EdgeLabelLineSegment[] = [];
      if (priorityPrefix.length > 0) {
        segs.push({
          text: priorityPrefix,
          fontFamily: 'mono',
          fontSize: fontSize - 1,
          bold: true,
          tone: 'prefix',
        });
      }
      segs.push({
        text: eventType,
        fontFamily: 'sans',
        fontSize,
        bold: true,
        tone: 'event',
      });
      rawSegmentRows.push(segs);
    }
  } else {
    // Line 1: [#N] <eventType>
    if (eventType.length > 28 && eventType.includes(' ')) {
      const evParts = wrapPhraseAtSpaces(eventType, 26);
      evParts.forEach((part, idx) => {
        const segs: EdgeLabelLineSegment[] = [];
        if (idx === 0 && priorityPrefix.length > 0) {
          segs.push({
            text: priorityPrefix,
            fontFamily: 'mono',
            fontSize: fontSize - 1,
            bold: true,
            tone: 'prefix',
          });
        }
        segs.push({
          text: part,
          fontFamily: 'sans',
          fontSize,
          bold: true,
          tone: 'event',
        });
        rawSegmentRows.push(segs);
      });
    } else {
      const headerSegs: EdgeLabelLineSegment[] = [];
      if (priorityPrefix.length > 0) {
        headerSegs.push({
          text: priorityPrefix,
          fontFamily: 'mono',
          fontSize: fontSize - 1,
          bold: true,
          tone: 'prefix',
        });
      }
      headerSegs.push({
        text: eventType,
        fontFamily: 'sans',
        fontSize,
        bold: true,
        tone: 'event',
      });
      rawSegmentRows.push(headerSegs);
    }

    // Guard line(s): [<guard>]
    if (hasGuard && guard) {
      const guardBracketed = `[${guard}]`;
      const guardLines =
        guardBracketed.length > 32 && guardBracketed.includes(' ')
          ? wrapPhraseAtSpaces(guardBracketed, 28)
          : [guardBracketed];
      for (const gl of guardLines) {
        rawSegmentRows.push([
          {
            text: gl,
            fontFamily: 'mono',
            fontSize: fontSize - 0.5,
            bold: false,
            tone: 'secondary',
          },
        ]);
      }
    }

    // Action line(s): wrap at top-level commas targeting <= 28 chars per line
    if (hasActions) {
      const commaTokens = actions.map((act, idx) =>
        idx < actions.length - 1 ? `${act},` : act,
      );
      const packedActionLines: string[] = [];
      let curAct = `/ ${commaTokens[0]}`;
      for (let i = 1; i < commaTokens.length; i++) {
        if (curAct.length + 1 + commaTokens[i].length <= 28) {
          curAct += ` ${commaTokens[i]}`;
        } else {
          packedActionLines.push(curAct);
          curAct = commaTokens[i];
        }
      }
      packedActionLines.push(curAct);

      for (const pLine of packedActionLines) {
        const subLines =
          pLine.length > 32 && pLine.includes(' ')
            ? wrapPhraseAtSpaces(pLine, 28)
            : [pLine];
        for (const sl of subLines) {
          rawSegmentRows.push([
            {
              text: sl,
              fontFamily: 'mono',
              fontSize: fontSize - 0.5,
              bold: false,
              tone: 'secondary',
            },
          ]);
        }
      }
    }
  }

  const lines: EdgeLabelLine[] = rawSegmentRows.map((segs, rowIdx) => {
    const isNonFinal = rowIdx < rawSegmentRows.length - 1;
    let w = 0;
    for (const s of segs) {
      w += measureTextWidth(s.text, {
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        bold: s.bold,
        includeSafetyBuffer: false,
      });
    }
    if (isNonFinal && segs.length > 0) {
      const last = segs[segs.length - 1];
      w += measureTextWidth(' ', {
        fontFamily: last.fontFamily,
        fontSize: last.fontSize,
        bold: last.bold,
        includeSafetyBuffer: false,
      });
    }
    w += DEFAULT_THEME.spacing.textSafetyBuffer;
    return {
      segments: segs,
      rawText: segs.map((s) => s.text).join(''),
      width: Math.ceil(w),
    };
  });

  if (lines.length <= 1) {
    const lineW = lines[0]?.width ?? DEFAULT_THEME.spacing.textSafetyBuffer;
    const width = Math.ceil(lineW + DEFAULT_THEME.spacing.edgeLabelPaddingX * 2);
    const height = Math.ceil(
      fontSize + DEFAULT_THEME.spacing.edgeLabelPaddingY * 2 + 4,
    );
    return {
      width,
      height,
      lineHeight,
      text,
      priorityPrefix,
      eventType,
      suffix,
      lines,
    };
  }

  const padX = 8;
  const padY = 6;
  const maxLineW = Math.max(...lines.map((l) => l.width));
  const width = Math.ceil(maxLineW + padX * 2);
  const height = Math.ceil(lines.length * lineHeight - 3 + padY * 2);

  return {
    width,
    height,
    lineHeight,
    text,
    priorityPrefix,
    eventType,
    suffix,
    lines,
  };
}

/**
 * Measures a single `#tag` pill inside `.state-compartment[data-compartment="tags"]`.
 */
export function measureTagPill(
  tagText: string,
  fontSize = DEFAULT_THEME.fontSizes.tag,
): { width: number; height: number } {
  const tw =
    measureTextWidth(tagText, {
      fontFamily: 'sans',
      fontSize,
      bold: true,
      includeSafetyBuffer: false,
    }) + 14;
  return {
    width: Math.ceil(tw),
    height: Math.ceil(fontSize + 6),
  };
}

export interface LaidOutTagPill {
  index: number;
  text: string;
  relX: number;
  relY: number;
  width: number;
  height: number;
}

/**
 * Deterministically lays out `#tag` pills into wrapped rows within `maxInnerWidth`
 * so `.state-tag` pills never overflow `.state-box` or intersect each other.
 */
export function layoutTagPills(
  tagTexts: string[],
  maxInnerWidth: number,
  fontSize = DEFAULT_THEME.fontSizes.tag,
): { pills: LaidOutTagPill[]; totalWidth: number; totalHeight: number } {
  if (tagTexts.length === 0) {
    return { pills: [], totalWidth: 0, totalHeight: 0 };
  }
  const padTop = 6;
  const padBottom = 6;
  const gapX = 6;
  const gapY = 6;

  const pills: LaidOutTagPill[] = [];
  let curX = 0;
  let curY = padTop;
  let rowHeight = 0;
  let maxRowW = 0;

  for (let i = 0; i < tagTexts.length; i++) {
    const m = measureTagPill(tagTexts[i], fontSize);
    if (curX > 0 && curX + m.width > maxInnerWidth) {
      maxRowW = Math.max(maxRowW, curX - gapX);
      curX = 0;
      curY += rowHeight + gapY;
      rowHeight = 0;
    }
    pills.push({
      index: i,
      text: tagTexts[i],
      relX: curX,
      relY: curY,
      width: m.width,
      height: m.height,
    });
    curX += m.width + gapX;
    rowHeight = Math.max(rowHeight, m.height);
  }
  if (curX > 0) {
    maxRowW = Math.max(maxRowW, curX - gapX);
  }

  return {
    pills,
    totalWidth: Math.ceil(maxRowW),
    totalHeight: Math.ceil(curY + rowHeight + padBottom),
  };
}
