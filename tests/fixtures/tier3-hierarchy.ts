import * as fs from 'node:fs';
import * as path from 'node:path';
import { createMachine } from 'xstate';
import type { ConformanceFixture } from '../../src/verifier/gallery.js';

function loadCorpusMachineJson(slug: string): Record<string, unknown> {
  const jsonPath = path.resolve(
    process.cwd(),
    'tests/reference-corpus/machines',
    `${slug}.json`,
  );
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;
}

const coffeeNestedJson = loadCorpusMachineJson('coffee-nested');
const harelClusteredJson = loadCorpusMachineJson('harel-clustered');
const harelUnclusteringJson = loadCorpusMachineJson('harel-unclustering');
const harelConditionalJson = loadCorpusMachineJson('harel-conditional');
const harelBeepTestJson = loadCorpusMachineJson('harel-beep-test');
const harelSelectionJson = loadCorpusMachineJson('harel-selection');
const harelTimeoutJson = loadCorpusMachineJson('harel-timeout');
const harelDigitJson = loadCorpusMachineJson('harel-digit');

// 1. Simple 1-level compound state with child initial indicator and external parent-border transition
const simpleCompoundCancelConfig = {
  id: 'fileUpload',
  initial: 'idle',
  states: {
    idle: {
      on: {
        SELECT_FILE: { target: 'uploading' },
      },
    },
    uploading: {
      initial: 'preparing',
      on: {
        CANCEL: {
          target: 'idle',
          actions: ['abortUpload'],
        },
      },
      states: {
        preparing: {
          on: {
            HASH_READY: { target: 'transferring' },
          },
        },
        transferring: {
          on: {
            CHUNKS_SENT: { target: 'verifying' },
          },
        },
        verifying: {
          on: {
            CHECKSUM_OK: { target: '#fileUpload.completed' },
          },
        },
      },
    },
    completed: {
      type: 'final' as const,
    },
  },
};

// 2. Direct deep entry transitions from an outside state into specific non-initial children
const deepEntryNonInitialConfig = {
  id: 'checkoutWizard',
  initial: 'cartSummary',
  states: {
    cartSummary: {
      on: {
        START_CHECKOUT: { target: 'steps' },
        EDIT_BILLING: {
          guard: 'hasSavedShipping',
          target: 'steps.billing',
        },
        FAST_TRACK_REVIEW: {
          guard: 'hasOneClickProfile',
          target: 'steps.review',
        },
      },
    },
    steps: {
      initial: 'shipping',
      on: {
        BACK_TO_CART: { target: 'cartSummary' },
      },
      states: {
        shipping: {
          on: {
            NEXT: { target: 'billing' },
          },
        },
        billing: {
          on: {
            NEXT: { target: 'review' },
          },
        },
        review: {
          on: {
            PLACE_ORDER: { target: '#checkoutWizard.confirmed' },
          },
        },
      },
    },
    confirmed: {
      type: 'final' as const,
    },
  },
};

// 3. Cross-boundary child-to-outside transition AND cross-compound child-to-child transitions
const crossCompoundConfig = {
  id: 'authSessionBridge',
  initial: 'authentication',
  states: {
    authentication: {
      initial: 'enteringCredentials',
      states: {
        enteringCredentials: {
          on: {
            CREDENTIALS_OK: { target: 'verifyingMfa' },
          },
        },
        verifyingMfa: {
          on: {
            MFA_PASSED: {
              target: '#authSessionBridge.workspace.dashboard',
              actions: ['issueSessionToken'],
            },
            MFA_LOCKOUT: {
              target: '#authSessionBridge.lockedOut',
              actions: ['recordSecurityAlert'],
            },
          },
        },
      },
    },
    workspace: {
      initial: 'dashboard',
      on: {
        SIGN_OUT: { target: 'authentication' },
      },
      states: {
        dashboard: {
          on: {
            SENSITIVE_ACTION: { target: 'elevatingPrivilege' },
          },
        },
        elevatingPrivilege: {
          on: {
            REVERIFY_MFA: {
              target: '#authSessionBridge.authentication.verifyingMfa',
            },
            ELEVATED_OK: { target: 'dashboard' },
          },
        },
      },
    },
    lockedOut: {
      type: 'final' as const,
    },
  },
};

// 4. Multi-level deep hierarchy (3 levels of nested compound containers + leaf states)
const threeLevelDeepHierarchyConfig = {
  id: 'compilerPipeline',
  initial: 'queued',
  states: {
    queued: {
      on: {
        DEQUEUE: { target: 'executing' },
      },
    },
    executing: {
      initial: 'frontend',
      on: {
        ABORT_BUILD: { target: 'failed' },
      },
      states: {
        frontend: {
          initial: 'analysis',
          states: {
            analysis: {
              initial: 'lexing',
              states: {
                lexing: {
                  on: {
                    TOKENS_READY: { target: 'typechecking' },
                  },
                },
                typechecking: {
                  on: {
                    TYPES_VALID: {
                      target: '#compilerPipeline.executing.emitting',
                    },
                  },
                },
              },
            },
          },
        },
        emitting: {
          on: {
            BINARY_WRITTEN: { target: '#compilerPipeline.succeeded' },
          },
        },
      },
    },
    succeeded: {
      type: 'final' as const,
    },
    failed: {
      type: 'final' as const,
    },
  },
};

// 5. Compound state completion (onDone on parent triggered when child reaches final state)
const compoundOnDoneConfig = {
  id: 'kycVerification',
  initial: 'documentCheck',
  states: {
    documentCheck: {
      initial: 'capturingId',
      onDone: {
        target: 'identityAssurance',
        actions: ['markDocsVerified'],
      },
      on: {
        DOC_REJECTED: { target: 'manualEscalation' },
      },
      states: {
        capturingId: {
          on: {
            IMAGE_CAPTURED: { target: 'ocrExtracting' },
          },
        },
        ocrExtracting: {
          on: {
            OCR_MATCHED: { target: 'docApproved' },
          },
        },
        docApproved: {
          type: 'final' as const,
        },
      },
    },
    identityAssurance: {
      initial: 'livenessPrompt',
      onDone: {
        target: 'onboardingComplete',
      },
      states: {
        livenessPrompt: {
          on: {
            LIVENESS_CONFIRMED: { target: 'assurancePassed' },
          },
        },
        assurancePassed: {
          type: 'final' as const,
        },
      },
    },
    manualEscalation: {
      type: 'final' as const,
    },
    onboardingComplete: {
      type: 'final' as const,
    },
  },
};

// 6. Compound state with parent header compartments (entry, exit, internal, #tags) ABOVE children
const compoundWithParentCompartmentsConfig = {
  id: 'databaseTransaction',
  initial: 'activeTx',
  states: {
    activeTx: {
      tags: ['transactional', 'isolated'],
      entry: ['beginTransaction', 'acquireSavepoint'],
      exit: ['releaseLocks'],
      initial: 'executingQueries',
      on: {
        HEARTBEAT: {
          actions: ['extendLease'],
        },
        ROLLBACK_TX: {
          target: 'rolledBack',
          actions: ['revertChanges'],
        },
      },
      states: {
        executingQueries: {
          entry: ['prepareStatements'],
          on: {
            QUERIES_OK: { target: 'flushingWal' },
          },
        },
        flushingWal: {
          tags: ['io'],
          on: {
            WAL_SYNCED: { target: 'txDone' },
          },
        },
        txDone: {
          type: 'final' as const,
        },
      },
      onDone: {
        target: 'committed',
      },
    },
    committed: {
      tags: ['durable'],
      type: 'final' as const,
    },
    rolledBack: {
      type: 'final' as const,
    },
  },
};

// 7. Explicit external self-transition on a compound parent vs internal transition on parent
const compoundSelfLoopVsInternalConfig = {
  id: 'workerSupervisor',
  initial: 'runningCluster',
  states: {
    runningCluster: {
      tags: ['supervised'],
      entry: ['spawnWorkers'],
      exit: ['drainWorkers'],
      initial: 'warmingUp',
      on: {
        RELOAD_ENV: {
          actions: ['broadcastEnvUpdate'],
        },
        HARD_RESTART: {
          guard: 'isQuorumLost',
          target: 'runningCluster',
          actions: ['incrementRestartCount'],
        },
        SHUTDOWN: {
          target: 'stopped',
        },
      },
      states: {
        warmingUp: {
          on: {
            READY: { target: 'servingTraffic' },
          },
        },
        servingTraffic: {
          on: {
            DEGRADED: { target: 'warmingUp' },
          },
        },
      },
    },
    stopped: {
      type: 'final' as const,
    },
  },
};

// 8. Root-level machine entry/exit/internal/on handlers (root itself rendered as outer compound container)
const rootLevelHandlersConfig = {
  id: 'daemonController',
  tags: ['daemon'],
  entry: ['registerSignalHandlers'],
  exit: ['flushTelemetry'],
  initial: 'serving',
  on: {
    LOG_METRICS: {
      actions: ['emitMetricsSnapshot'],
    },
    SIGTERM: {
      target: '.draining',
      actions: ['markTerminating'],
    },
  },
  states: {
    serving: {
      initial: 'accepting',
      states: {
        accepting: {
          on: {
            THROTTLE: { target: 'rateLimited' },
          },
        },
        rateLimited: {
          after: {
            5000: { target: 'accepting' },
          },
        },
      },
    },
    draining: {
      on: {
        CONNECTIONS_CLOSED: { target: 'halted' },
      },
    },
    halted: {
      type: 'final' as const,
    },
  },
};

// 9. Sibling compound states with priority-guarded & bidirectional cross-hierarchy transitions
const siblingCompoundsBidirectionalConfig = {
  id: 'documentStudio',
  initial: 'authoring',
  states: {
    authoring: {
      initial: 'clean',
      states: {
        clean: {
          on: {
            EDIT_CONTENT: { target: 'dirty' },
          },
        },
        dirty: {
          on: {
            SAVE: {
              target: 'clean',
              actions: ['persistDraft'],
            },
            OPEN_PREVIEW: [
              {
                guard: 'hasSyntaxErrors',
                target: '#documentStudio.previewing.diagnosticsPane',
              },
              {
                target: '#documentStudio.previewing.liveRender',
              },
            ],
          },
        },
      },
    },
    previewing: {
      initial: 'liveRender',
      on: {
        RETURN_TO_EDITOR: {
          target: 'authoring.clean',
        },
      },
      states: {
        liveRender: {
          on: {
            INSPECT_WARNINGS: { target: 'diagnosticsPane' },
          },
        },
        diagnosticsPane: {
          on: {
            JUMP_TO_FIX: {
              target: '#documentStudio.authoring.dirty',
              actions: ['highlightErrorLine'],
            },
          },
        },
      },
    },
  },
};

// 10. Kitchen-sink Tier 3 hierarchical statechart
const kitchenSinkTier3Config = {
  id: 'cloudDeployment',
  initial: 'stagingPhase',
  states: {
    stagingPhase: {
      tags: ['preprod'],
      entry: ['provisionEphemeralEnv'],
      exit: ['archiveStagingLogs'],
      initial: 'buildingImage',
      after: {
        600000: {
          target: 'aborted',
          actions: ['notifyStagingTimeout'],
        },
      },
      onDone: {
        target: 'productionRollout',
        actions: ['promoteArtifact'],
      },
      states: {
        buildingImage: {
          on: {
            IMAGE_BUILT: { target: 'smokeTesting' },
          },
        },
        smokeTesting: {
          initial: 'apiChecks',
          onDone: {
            target: 'stagingVerified',
          },
          states: {
            apiChecks: {
              on: {
                API_GREEN: { target: 'e2eChecks' },
                API_RED: { target: '#cloudDeployment.aborted' },
              },
            },
            e2eChecks: {
              on: {
                E2E_GREEN: { target: 'checksComplete' },
              },
            },
            checksComplete: {
              type: 'final' as const,
            },
          },
        },
        stagingVerified: {
          type: 'final' as const,
        },
      },
    },
    productionRollout: {
      tags: ['prod', 'critical'],
      entry: ['enableCanaryRouting'],
      initial: 'canary10Pct',
      on: {
        EMERGENCY_STOP: {
          target: 'rolledBack',
          actions: ['restorePreviousRelease'],
        },
      },
      onDone: {
        target: 'released',
      },
      states: {
        canary10Pct: {
          on: {
            METRICS_HEALTHY: [
              {
                guard: 'isFullAuto',
                target: 'fullTraffic',
              },
              {
                target: 'awaitingApproval',
              },
            ],
          },
        },
        awaitingApproval: {
          after: {
            APPROVAL_WINDOW: {
              target: '#cloudDeployment.rolledBack',
            },
          },
          on: {
            APPROVE_PROD: { target: 'fullTraffic' },
          },
        },
        fullTraffic: {
          type: 'final' as const,
        },
      },
    },
    released: {
      tags: ['live'],
      type: 'final' as const,
    },
    rolledBack: {
      type: 'final' as const,
    },
    aborted: {
      type: 'final' as const,
    },
  },
};

export const TIER3_FIXTURES: ConformanceFixture[] = [
  // Official statelyai/docs Ground-Truth Tier 3 Reference Corpus (all 8 machines)
  {
    id: 'ref-01-coffee-nested',
    title: 'Corpus: Stately Nested Coffee Machine (Tier 3 Reference)',
    description:
      'Official statelyai/docs coffee-nested machine with compound Preparing state (Grinding -> Brewing -> Steaming milk), parent CANCEL exit, and #coffee.Served exit.',
    configSource: coffeeNestedJson,
    machineOrConfig: createMachine(coffeeNestedJson as Parameters<typeof createMachine>[0]),
    referencePngRelPath: 'tests/reference-corpus/screenshots/coffee-nested.png',
    referenceSourceLabel: 'statelyai/docs — coffee-nested.png',
  },
  {
    id: 'ref-02-harel-clustered',
    title: 'Corpus: Harel Figure 2 Clustered Superstate (Tier 3 Reference)',
    description:
      'Official statelyai/docs harel-clustered machine clustering A and C inside compound state D with parent exit beta -> B and deep entries alpha -> D.A, delta -> D.C.',
    configSource: harelClusteredJson,
    machineOrConfig: createMachine(harelClusteredJson as Parameters<typeof createMachine>[0]),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-clustered.png',
    referenceSourceLabel: 'statelyai/docs — harel-clustered.png',
  },
  {
    id: 'ref-03-harel-unclustering',
    title: 'Corpus: Harel Figure 36 Unclustering Refinement (Tier 3 Reference)',
    description:
      'Official statelyai/docs harel-unclustering machine with Outside <-> Cluster superstate containing cyclic First <-> Second children.',
    configSource: harelUnclusteringJson,
    machineOrConfig: createMachine(
      harelUnclusteringJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-unclustering.png',
    referenceSourceLabel: 'statelyai/docs — harel-unclustering.png',
  },
  {
    id: 'ref-04-harel-conditional',
    title: 'Corpus: Harel Figure 33 Conditional Deep Entry (Tier 3 Reference)',
    description:
      'Official statelyai/docs harel-conditional machine with 3 priority-guarded alpha [P]/[Q]/[R] deep entry branches into Inside children and parent RESET exit.',
    configSource: harelConditionalJson,
    machineOrConfig: createMachine(
      harelConditionalJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-conditional.png',
    referenceSourceLabel: 'statelyai/docs — harel-conditional.png',
  },
  {
    id: 'ref-05-harel-beep-test',
    title: 'Corpus: Harel Figures 29 & 32 Beep Control Refinement (Tier 3 Reference)',
    description:
      'Official statelyai/docs harel-beep-test machine refining compound beep state (on <-> off) alongside 00, 10, 01 control states.',
    configSource: harelBeepTestJson,
    machineOrConfig: createMachine(harelBeepTestJson as Parameters<typeof createMachine>[0]),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-beep-test.png',
    referenceSourceLabel: 'statelyai/docs — harel-beep-test.png',
  },
  {
    id: 'ref-06-harel-selection',
    title: 'Corpus: Harel Figure 34 Selection & Parent-to-Child Re-Entry (Tier 3 Reference)',
    description:
      'Official statelyai/docs harel-selection machine featuring Browsing deep entries AND compound Updating parent-to-child SELECT_* transitions plus internal UPDATE actions.',
    configSource: harelSelectionJson,
    machineOrConfig: createMachine(harelSelectionJson as Parameters<typeof createMachine>[0]),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-selection.png',
    referenceSourceLabel: 'statelyai/docs — harel-selection.png',
  },
  {
    id: 'ref-07-harel-timeout',
    title: 'Corpus: Harel Figure 35 Compound Timeout Envelope (Tier 3 Reference)',
    description:
      'Official statelyai/docs harel-timeout machine with after(2000ms) timeout on compound Waiting parent and after(500ms) inside child Minimum not met.',
    configSource: harelTimeoutJson,
    machineOrConfig: createMachine(harelTimeoutJson as Parameters<typeof createMachine>[0]),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-timeout.png',
    referenceSourceLabel: 'statelyai/docs — harel-timeout.png',
  },
  {
    id: 'ref-08-harel-digit',
    title: 'Corpus: Harel Figures 38 & 39 Ten-State Minute Digit (Tier 3 Reference)',
    description:
      'Official statelyai/docs harel-digit 13-state 23-transition machine with 10-state cyclic counter inside One minute and 10 priority-guarded SYNC [digit 0..9] parent-to-child transitions.',
    configSource: harelDigitJson,
    machineOrConfig: createMachine(harelDigitJson as Parameters<typeof createMachine>[0]),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-digit.png',
    referenceSourceLabel: 'statelyai/docs — harel-digit.png',
  },

  // Tier 3 XState v5 Compound Conformance Suite
  {
    id: '01-simple-compound-cancel',
    title: '1-Level Compound State with Parent Cancel Exit',
    description:
      'Compound uploading container with 3 sequential child states, compound initial indicator, parent CANCEL exit, and child exit to final state.',
    configSource: simpleCompoundCancelConfig,
    machineOrConfig: createMachine(simpleCompoundCancelConfig),
  },
  {
    id: '02-deep-entry-non-initial',
    title: 'Direct Deep Entry into Non-Initial Child States',
    description:
      'Outside cartSummary branching either to compound steps default initial state or directly into steps.billing and steps.review.',
    configSource: deepEntryNonInitialConfig,
    machineOrConfig: createMachine(deepEntryNonInitialConfig),
  },
  {
    id: '03-cross-boundary-and-cross-compound',
    title: 'Cross-Boundary & Cross-Compound Child-to-Child Transitions',
    description:
      'Direct child-to-child transitions bridging sibling compound containers (authentication <-> workspace) plus child-to-outside lockout exit.',
    configSource: crossCompoundConfig,
    machineOrConfig: createMachine(crossCompoundConfig),
  },
  {
    id: '04-three-level-deep-hierarchy',
    title: '3-Level Nested Compound Hierarchy & Alternating Container Tints',
    description:
      'Three nested compound containers (executing -> frontend -> analysis -> lexing/typechecking) verifying recursive insets and depth tinting.',
    configSource: threeLevelDeepHierarchyConfig,
    machineOrConfig: createMachine(threeLevelDeepHierarchyConfig),
  },
  {
    id: '05-compound-ondone-completion',
    title: 'Compound State Completion (onDone via Final Child)',
    description:
      'Sequential compound stages advancing automatically via parent onDone transitions when nested subflows reach their final child state.',
    configSource: compoundOnDoneConfig,
    machineOrConfig: createMachine(compoundOnDoneConfig),
    referencePngRelPath: 'tests/reference-corpus/features/state-done-events.png',
    referenceSourceLabel: 'statelyai/docs Feature Reference — state-done-events.png',
  },
  {
    id: '06-compound-with-parent-compartments',
    title: 'Compound State with Parent Entry, Exit, Internal & Tag Compartments',
    description:
      'Compound activeTx container rendering its own #tags, entry, exit, and internal HEARTBEAT compartments cleanly separated above its child subgraph.',
    configSource: compoundWithParentCompartmentsConfig,
    machineOrConfig: createMachine(compoundWithParentCompartmentsConfig),
  },
  {
    id: '07-compound-external-self-loop-vs-internal',
    title: 'External Self-Transition vs Internal Row on Compound Parent',
    description:
      'Compound runningCluster state with both an internal RELOAD_ENV compartment row and an external HARD_RESTART self-loop routed outside the container.',
    configSource: compoundSelfLoopVsInternalConfig,
    machineOrConfig: createMachine(compoundSelfLoopVsInternalConfig),
  },
  {
    id: '08-root-level-handlers-machine',
    title: 'Root-Level Machine Compartments & Global Interrupt Handler',
    description:
      'Machine root node with entry, exit, #daemon tag, internal LOG_METRICS, and global SIGTERM -> .draining rendered as outermost compound container.',
    configSource: rootLevelHandlersConfig,
    machineOrConfig: createMachine(rootLevelHandlersConfig),
  },
  {
    id: '09-sibling-compounds-guarded-bidirectional',
    title: 'Sibling Compound Containers with Guarded Bidirectional Crossings',
    description:
      'Authoring and previewing superstates connected by priority-guarded [#1]/[#2] deep entries and return transitions across container walls.',
    configSource: siblingCompoundsBidirectionalConfig,
    machineOrConfig: createMachine(siblingCompoundsBidirectionalConfig),
  },
  {
    id: '10-tier3-kitchen-sink-workflow',
    title: 'Tier 3 Kitchen-Sink Multi-Stage Cloud Deployment Statechart',
    description:
      'Comprehensive hierarchical workflow combining 2- and 3-level compound nesting, parent compartments, onDone chains, compound after(...) timers, and priority guards.',
    configSource: kitchenSinkTier3Config,
    machineOrConfig: createMachine(kitchenSinkTier3Config),
  },
];

export const fixtures = TIER3_FIXTURES;
