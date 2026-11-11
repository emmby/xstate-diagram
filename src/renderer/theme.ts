export interface ThemeTokens {
  fonts: {
    sans: string;
    mono: string;
  };
  fontSizes: {
    stateTitle: number;
    compartment: number;
    edgeLabel: number;
    tag: number;
    history: number;
  };
  colors: {
    canvasBg: string;
    atomicFill: string;
    atomicStroke: string;
    compoundFills: string[];
    compoundHeaderBg: string;
    compoundStroke: string;
    parallelFill: string;
    parallelStroke: string;
    finalFill: string;
    finalStroke: string;
    historyFill: string;
    historyStroke: string;
    historyText: string;
    textPrimary: string;
    textSecondary: string;
    edgeStroke: string;
    edgeLabelBg: string;
    edgeLabelStroke: string;
    edgeLabelText: string;
    initialFill: string;
    initialStroke: string;
    tagBg: string;
    tagStroke: string;
    tagText: string;
    dividerStroke: string;
  };
  radii: {
    atomic: number;
    compound: number;
    parallel: number;
    finalOuter: number;
    finalInner: number;
    history: number;
    edgeLabel: number;
    edgeCorner: number;
    initialDot: number;
    tag: number;
  };
  strokes: {
    atomic: number;
    compound: number;
    parallel: number;
    finalOuter: number;
    finalInner: number;
    history: number;
    edge: number;
    edgeLabel: number;
    initialEdge: number;
  };
  spacing: {
    canvasPadding: number;
    nodeMinWidth: number;
    nodeMinHeight: number;
    nodePaddingX: number;
    nodePaddingY: number;
    headerHeight: number;
    compartmentLineHeight: number;
    compartmentPaddingY: number;
    edgeLabelPaddingX: number;
    edgeLabelPaddingY: number;
    finalInset: number;
    textSafetyBuffer: number;
  };
  markers: {
    arrowWidth: number;
    arrowHeight: number;
  };
}

export const DEFAULT_THEME: ThemeTokens = {
  fonts: {
    sans: 'Arial, Helvetica, "Liberation Sans", "Nimbus Sans L", sans-serif',
    mono: 'Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace',
  },
  fontSizes: {
    stateTitle: 13,
    compartment: 11.5,
    edgeLabel: 12,
    tag: 10,
    history: 12,
  },
  colors: {
    canvasBg: '#F8FAFC',
    atomicFill: '#FFFFFF',
    atomicStroke: '#334155',
    compoundFills: ['#F1F5F9', '#F8FAFC', '#EFF6FF'],
    compoundHeaderBg: '#E2E8F0',
    compoundStroke: '#475569',
    parallelFill: '#FAFAFA',
    parallelStroke: '#64748B',
    finalFill: '#FFFFFF',
    finalStroke: '#0F172A',
    historyFill: '#FEF3C7',
    historyStroke: '#D97706',
    historyText: '#92400E',
    textPrimary: '#0F172A',
    textSecondary: '#334155',
    edgeStroke: '#475569',
    edgeLabelBg: '#FFFFFF',
    edgeLabelStroke: '#CBD5E1',
    edgeLabelText: '#0F172A',
    initialFill: '#0F172A',
    initialStroke: '#0F172A',
    tagBg: '#EFF6FF',
    tagStroke: '#BFDBFE',
    tagText: '#1D4ED8',
    dividerStroke: '#CBD5E1',
  },
  radii: {
    atomic: 8,
    compound: 10,
    parallel: 8,
    finalOuter: 8,
    finalInner: 5,
    history: 14,
    edgeLabel: 4,
    edgeCorner: 6,
    initialDot: 5.5,
    tag: 4,
  },
  strokes: {
    atomic: 1.5,
    compound: 1.5,
    parallel: 1.5,
    finalOuter: 2,
    finalInner: 1.5,
    history: 1.5,
    edge: 1.75,
    edgeLabel: 1,
    initialEdge: 1.75,
  },
  spacing: {
    canvasPadding: 28,
    nodeMinWidth: 86,
    nodeMinHeight: 42,
    nodePaddingX: 16,
    nodePaddingY: 10,
    headerHeight: 32,
    compartmentLineHeight: 19,
    compartmentPaddingY: 7,
    edgeLabelPaddingX: 7,
    edgeLabelPaddingY: 4,
    finalInset: 4,
    textSafetyBuffer: 8,
  },
  markers: {
    arrowWidth: 8,
    arrowHeight: 6,
  },
};
