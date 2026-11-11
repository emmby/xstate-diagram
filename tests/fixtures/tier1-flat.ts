import { createMachine } from 'xstate';
import type { ConformanceFixture } from '../../src/verifier/gallery.js';

const toggleConfig = {
  id: 'toggle',
  initial: 'idle',
  states: {
    idle: {
      on: {
        TOGGLE: { target: 'active' },
      },
    },
    active: {
      on: {
        TOGGLE: { target: 'idle' },
      },
    },
  },
} as const;

const linearPipelineConfig = {
  id: 'pipeline',
  initial: 'idle',
  states: {
    idle: {
      on: {
        START: { target: 'loading' },
      },
    },
    loading: {
      on: {
        VALIDATE: { target: 'verifying' },
      },
    },
    verifying: {
      on: {
        FINISH: { target: 'success' },
      },
    },
    success: {
      type: 'final' as const,
    },
  },
};

const fetchRetryConfig = {
  id: 'fetchMachine',
  initial: 'idle',
  states: {
    idle: {
      on: {
        FETCH: { target: 'loading' },
      },
    },
    loading: {
      on: {
        RESOLVE: { target: 'success' },
        REJECT: { target: 'error' },
      },
    },
    error: {
      on: {
        RETRY: { target: 'loading' },
        CANCEL: { target: 'idle' },
      },
    },
    success: {
      type: 'final' as const,
    },
  },
};

const trafficLightConfig = {
  id: 'trafficLight',
  initial: 'green',
  states: {
    green: {
      on: {
        NEXT: { target: 'yellow' },
        POWER_LOSS: { target: 'flashingRed' },
      },
    },
    yellow: {
      on: {
        NEXT: { target: 'red' },
        POWER_LOSS: { target: 'flashingRed' },
      },
    },
    red: {
      on: {
        NEXT: { target: 'green' },
        POWER_LOSS: { target: 'flashingRed' },
      },
    },
    flashingRed: {
      on: {
        RESTORE: { target: 'red' },
      },
    },
  },
};

const bidirectionalPairConfig = {
  id: 'doorLock',
  initial: 'locked',
  states: {
    locked: {
      on: {
        UNLOCK_WITH_KEY: { target: 'unlocked' },
      },
    },
    unlocked: {
      on: {
        LOCK_BOLT: { target: 'locked' },
      },
    },
  },
};

const parallelMultiEdgesConfig = {
  id: 'documentSubmission',
  initial: 'draft',
  states: {
    draft: {
      on: {
        SUBMIT_STANDARD: { target: 'inReview' },
        SUBMIT_EXPEDITED: { target: 'inReview' },
        FORCE_ESCALATE: { target: 'inReview' },
      },
    },
    inReview: {
      on: {
        APPROVE: { target: 'published' },
      },
    },
    published: {
      type: 'final' as const,
    },
  },
};

const explicitSelfLoopConfig = {
  id: 'liveSession',
  initial: 'disconnected',
  states: {
    disconnected: {
      on: {
        CONNECT: { target: 'active' },
      },
    },
    active: {
      on: {
        REFRESH: { target: 'active' },
        DISCONNECT: { target: 'disconnected' },
      },
    },
  },
};

const combinedSelfAndBidirectionalConfig = {
  id: 'editorMode',
  initial: 'editing',
  states: {
    editing: {
      on: {
        AUTOSAVE: { target: 'editing' },
        OPEN_PREVIEW: { target: 'previewing' },
        PUBLISH: { target: 'published' },
      },
    },
    previewing: {
      on: {
        REFRESH_PREVIEW: { target: 'previewing' },
        BACK_TO_EDIT: { target: 'editing' },
      },
    },
    published: {
      type: 'final' as const,
    },
  },
};

const diamondDagConfig = {
  id: 'diamondDag',
  initial: 'start',
  states: {
    start: {
      on: {
        ROUTE_FAST: { target: 'leftPath' },
        ROUTE_THOROUGH: { target: 'rightPath' },
      },
    },
    leftPath: {
      on: {
        COMPLETE_LEFT: { target: 'done' },
      },
    },
    rightPath: {
      on: {
        COMPLETE_RIGHT: { target: 'done' },
      },
    },
    done: {
      type: 'final' as const,
    },
  },
};

const hubAndSpokeConfig = {
  id: 'appRouter',
  initial: 'router',
  states: {
    router: {
      on: {
        GO_DASHBOARD: { target: 'dashboard' },
        GO_PROFILE: { target: 'profile' },
        GO_SETTINGS: { target: 'settings' },
        GO_ALERTS: { target: 'alerts' },
      },
    },
    dashboard: {
      on: {
        BACK: { target: 'router' },
      },
    },
    profile: {
      on: {
        BACK: { target: 'router' },
      },
    },
    settings: {
      on: {
        BACK: { target: 'router' },
      },
    },
    alerts: {
      on: {
        BACK: { target: 'router' },
      },
    },
  },
};

export const TIER1_FIXTURES: ConformanceFixture[] = [
  {
    id: '01-minimal-toggle',
    title: 'Minimal 2-State Toggle',
    description: 'Two atomic states (idle <-> active) instantiated via XState v5 createMachine().',
    configSource: toggleConfig as unknown as Record<string, unknown>,
    machineOrConfig: createMachine(toggleConfig),
  },
  {
    id: '02-linear-pipeline',
    title: 'Linear Pipeline with Initial & Final State',
    description: 'Sequential 4-stage pipeline from initial idle state terminating at a double-bordered final state.',
    configSource: linearPipelineConfig,
    machineOrConfig: linearPipelineConfig,
  },
  {
    id: '03-fetch-retry',
    title: 'Branching Fetch & Retry Machine',
    description: 'Async request lifecycle with loading, final success, error branch, retry loop, and cancel reset.',
    configSource: fetchRetryConfig,
    machineOrConfig: createMachine(fetchRetryConfig),
  },
  {
    id: '04-traffic-light',
    title: 'Cyclic Traffic Light with Fault Mode',
    description: '3-phase traffic cycle (green -> yellow -> red -> green) plus fault transitions to/from flashingRed.',
    configSource: trafficLightConfig,
    machineOrConfig: createMachine(trafficLightConfig),
  },
  {
    id: '05-bidirectional-pair',
    title: 'Bidirectional Distinct Events',
    description: 'Two states connected by opposing transitions with distinct event labels requiring separated channels.',
    configSource: bidirectionalPairConfig,
    machineOrConfig: bidirectionalPairConfig,
  },
  {
    id: '06-parallel-multi-edges',
    title: 'Parallel Same-Direction Multi-Edges',
    description: 'Three distinct events transitioning in the same direction between draft and inReview without highway merges.',
    configSource: parallelMultiEdgesConfig,
    machineOrConfig: createMachine(parallelMultiEdgesConfig),
  },
  {
    id: '07-explicit-self-loop',
    title: 'Explicit External Self-Transition',
    description: 'Active session state with an explicit external REFRESH self-loop and bidirectional session lifecycle.',
    configSource: explicitSelfLoopConfig,
    machineOrConfig: createMachine(explicitSelfLoopConfig),
  },
  {
    id: '08-combined-self-and-bidirectional',
    title: 'Combined Self-Loops & Bidirectional Pair',
    description: 'Stress test combining external self-loops on two nodes alongside bidirectional transitions and final exit.',
    configSource: combinedSelfAndBidirectionalConfig,
    machineOrConfig: createMachine(combinedSelfAndBidirectionalConfig),
  },
  {
    id: '09-diamond-dag',
    title: 'Diamond DAG Convergence',
    description: 'Forking from start into leftPath and rightPath and converging cleanly on final done state.',
    configSource: diamondDagConfig,
    machineOrConfig: diamondDagConfig,
  },
  {
    id: '10-hub-and-spoke',
    title: 'Hub-and-Spoke Central Router',
    description: 'Central router state with 8 bidirectional transitions to and from 4 atomic spoke states.',
    configSource: hubAndSpokeConfig,
    machineOrConfig: createMachine(hubAndSpokeConfig),
  },
];

export const fixtures = TIER1_FIXTURES;
