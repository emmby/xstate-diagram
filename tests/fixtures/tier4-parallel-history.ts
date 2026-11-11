import * as fs from 'node:fs';
import * as path from 'node:path';
import { assign, createMachine } from 'xstate';
import type { ConformanceFixture } from '../../src/verifier/gallery.js';

function loadCorpusMachineJson(slug: string): Record<string, unknown> {
  const jsonPath = path.resolve(
    process.cwd(),
    'tests/reference-corpus/machines',
    `${slug}.json`,
  );
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;
}

// All 18 Tier 4 statelyai/docs ground-truth reference machines (completing 31/31 of the corpus)
const coffeeDonutParallelJson = loadCorpusMachineJson('coffee-donut-parallel');
const harelParallelJson = loadCorpusMachineJson('harel-parallel');
const harelParallelEntryJson = loadCorpusMachineJson('harel-parallel-entry');
const harelHistoryShallowJson = loadCorpusMachineJson('harel-history-shallow');
const harelHistoryDeepJson = loadCorpusMachineJson('harel-history-deep');
const harelHistorySelectiveJson = loadCorpusMachineJson('harel-history-selective');
const harelActivitiesJson = loadCorpusMachineJson('harel-activities');
const harelAvionicsJson = loadCorpusMachineJson('harel-avionics');
const harelBroadcastCycleJson = loadCorpusMachineJson('harel-broadcast-cycle');
const harelConflictJson = loadCorpusMachineJson('harel-conflict');
const harelDisplaysJson = loadCorpusMachineJson('harel-displays');
const harelOverlapJson = loadCorpusMachineJson('harel-overlap');
const harelOverlapInactiveJson = loadCorpusMachineJson('harel-overlap-inactive');
const harelSemanticsJson = loadCorpusMachineJson('harel-semantics');
const harelStopwatchJson = loadCorpusMachineJson('harel-stopwatch');
const harelTelephonesJson = loadCorpusMachineJson('harel-telephones');
const harelUpdatesJson = loadCorpusMachineJson('harel-updates');
const harelWatchJson = loadCorpusMachineJson('harel-watch');

// 1. Basic 2-region parallel state (upload + validation orthogonal dashed regions)
const basicTwoRegionParallelConfig = {
  id: 'assetIngest',
  initial: 'idle',
  states: {
    idle: {
      on: {
        DROP_ASSET: { target: 'processing' },
      },
    },
    processing: {
      type: 'parallel' as const,
      on: {
        CANCEL_INGEST: {
          target: 'idle',
          actions: ['cleanupTempFiles'],
        },
      },
      states: {
        upload: {
          initial: 'chunking',
          states: {
            chunking: {
              on: {
                CHUNKS_READY: { target: 'streaming' },
              },
            },
            streaming: {
              on: {
                STREAM_ACK: { target: 'uploaded' },
              },
            },
            uploaded: {},
          },
        },
        validation: {
          initial: 'scanningVirus',
          states: {
            scanningVirus: {
              on: {
                SCAN_CLEAN: { target: 'checkingSchema' },
              },
            },
            checkingSchema: {
              on: {
                SCHEMA_VALID: { target: 'validated' },
              },
            },
            validated: {},
          },
        },
      },
    },
  },
};

// 2. 3-region parallel state with parent onDone completion when all 3 regions reach final
const threeRegionParallelOnDoneConfig = {
  id: 'releaseGate',
  initial: 'verifyingRelease',
  states: {
    verifyingRelease: {
      type: 'parallel' as const,
      onDone: {
        target: 'readyToPublish',
        actions: ['stampReleaseManifest'],
      },
      on: {
        GATE_FAILED: {
          target: 'blocked',
        },
      },
      states: {
        unitSuite: {
          initial: 'runningUnit',
          states: {
            runningUnit: {
              on: {
                UNIT_GREEN: { target: 'unitPassed' },
              },
            },
            unitPassed: {
              type: 'final' as const,
            },
          },
        },
        securityAudit: {
          initial: 'scanningDeps',
          states: {
            scanningDeps: {
              on: {
                CVE_ZERO: { target: 'auditPassed' },
              },
            },
            auditPassed: {
              type: 'final' as const,
            },
          },
        },
        licenseCheck: {
          initial: 'checkingSpdx',
          states: {
            checkingSpdx: {
              on: {
                SPDX_APPROVED: { target: 'licensePassed' },
              },
            },
            licensePassed: {
              type: 'final' as const,
            },
          },
        },
      },
    },
    readyToPublish: {
      tags: ['verified'],
      type: 'final' as const,
    },
    blocked: {
      type: 'final' as const,
    },
  },
};

// 3. Nested parallel inside compound AND compound inside parallel regions
const nestedParallelAndCompoundConfig = {
  id: 'workstationSession',
  initial: 'locked',
  states: {
    locked: {
      on: {
        UNLOCK: { target: 'authenticated' },
      },
    },
    authenticated: {
      initial: 'bootstrapping',
      on: {
        LOCK_SCREEN: { target: 'locked' },
      },
      states: {
        bootstrapping: {
          on: {
            SESSION_READY: { target: 'activeWorkspace' },
          },
        },
        activeWorkspace: {
          type: 'parallel' as const,
          states: {
            editorPane: {
              initial: 'viewingCode',
              states: {
                viewingCode: {
                  on: {
                    START_REFACTOR: { target: 'refactoring' },
                  },
                },
                refactoring: {
                  initial: 'computingEdits',
                  states: {
                    computingEdits: {
                      on: {
                        PREVIEW_DIFF: { target: 'applyingPatch' },
                      },
                    },
                    applyingPatch: {
                      on: {
                        PATCH_APPLIED: {
                          target: '#workstationSession.authenticated.activeWorkspace.editorPane.viewingCode',
                        },
                      },
                    },
                  },
                },
              },
            },
            terminalPane: {
              initial: 'shellIdle',
              states: {
                shellIdle: {
                  on: {
                    EXEC_CMD: { target: 'runningProcess' },
                  },
                },
                runningProcess: {
                  on: {
                    EXIT_ZERO: { target: 'shellIdle' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

// 4. Shallow history (type: 'history', history: 'shallow' -> circular H) with default fallback & external re-entry
const shallowHistoryWithDefaultConfig = {
  id: 'wizardResume',
  initial: 'editingSteps',
  states: {
    editingSteps: {
      initial: 'accountInfo',
      on: {
        OPEN_HELP_DRAWER: { target: 'helpDrawer' },
      },
      states: {
        accountInfo: {
          on: {
            NEXT: { target: 'paymentMethod' },
          },
        },
        paymentMethod: {
          on: {
            NEXT: { target: 'confirmOrder' },
            BACK: { target: 'accountInfo' },
          },
        },
        confirmOrder: {
          on: {
            BACK: { target: 'paymentMethod' },
            SUBMIT_ORDER: { target: '#wizardResume.submitted' },
          },
        },
        history: {
          type: 'history' as const,
          history: 'shallow' as const,
          target: 'accountInfo',
        },
      },
    },
    helpDrawer: {
      entry: ['loadContextualFaq'],
      on: {
        CLOSE_HELP_DRAWER: {
          target: 'editingSteps.history',
        },
        RESET_WIZARD: {
          target: 'editingSteps.accountInfo',
        },
      },
    },
    submitted: {
      type: 'final' as const,
    },
  },
};

// 5. Deep history (type: 'history', history: 'deep' -> circular H*) inside a multi-level compound hierarchy
const deepHistoryMultiLevelConfig = {
  id: 'debuggerSession',
  initial: 'runningTarget',
  states: {
    runningTarget: {
      initial: 'executing',
      on: {
        CONNECTION_LOST: { target: 'reconnecting' },
      },
      states: {
        executing: {
          on: {
            HIT_BREAKPOINT: { target: 'inspectingFrame' },
          },
        },
        inspectingFrame: {
          initial: 'localsTab',
          states: {
            localsTab: {
              on: {
                VIEW_CALLSTACK: { target: 'callstackTab' },
              },
            },
            callstackTab: {
              on: {
                VIEW_LOCALS: { target: 'localsTab' },
                RESUME_EXEC: { target: '#debuggerSession.runningTarget.executing' },
              },
            },
          },
        },
        history: {
          type: 'history' as const,
          history: 'deep' as const,
          target: 'executing',
        },
      },
    },
    reconnecting: {
      after: {
        3000: {
          target: 'disconnected',
        },
      },
      on: {
        SOCKET_RESTORED: {
          target: 'runningTarget.history',
          actions: ['syncBreakpoints'],
        },
      },
    },
    disconnected: {
      type: 'final' as const,
    },
  },
};

// 6. Both H (shallowHist) and H* (deepHist) inside the same compound container
const dualShallowAndDeepHistoryConfig = {
  id: 'coursePlayer',
  initial: 'learningModule',
  states: {
    learningModule: {
      initial: 'chapterOne',
      on: {
        PAUSE_SESSION: { target: 'pausedMenu' },
      },
      states: {
        chapterOne: {
          initial: 'videoLecture',
          states: {
            videoLecture: {
              on: {
                START_QUIZ: { target: 'practiceQuiz' },
              },
            },
            practiceQuiz: {
              on: {
                PASS_QUIZ: { target: '#coursePlayer.learningModule.chapterTwo' },
              },
            },
          },
        },
        chapterTwo: {
          initial: 'labSetup',
          states: {
            labSetup: {
              on: {
                LAB_READY: { target: 'interactiveLab' },
              },
            },
            interactiveLab: {},
          },
        },
        shallowHist: {
          type: 'history' as const,
          history: 'shallow' as const,
          target: 'chapterOne',
        },
        deepHist: {
          type: 'history' as const,
          history: 'deep' as const,
          target: 'chapterOne',
        },
      },
    },
    pausedMenu: {
      on: {
        RESTART_CURRENT_CHAPTER: {
          target: 'learningModule.shallowHist',
        },
        RESUME_EXACT_SPOT: {
          target: 'learningModule.deepHist',
        },
      },
    },
  },
};

// 7. Multi-target simultaneous fork transition (target: ['#...', '#...'])
const multiTargetSimultaneousForkConfig = {
  id: 'conferenceCall',
  initial: 'lobby',
  states: {
    lobby: {
      on: {
        JOIN_DEFAULT: {
          target: 'inCall',
        },
        JOIN_PRESENTATION_MODE: {
          guard: 'isPresenter',
          target: [
            '#conferenceCall.inCall.microphone.unmuted',
            '#conferenceCall.inCall.screenShare.sharingWindow',
          ],
          actions: ['announcePresenter'],
        },
      },
    },
    inCall: {
      type: 'parallel' as const,
      on: {
        LEAVE_CALL: {
          target: 'lobby',
        },
      },
      states: {
        microphone: {
          initial: 'muted',
          states: {
            muted: {
              on: {
                TOGGLE_MIC: { target: 'unmuted' },
              },
            },
            unmuted: {
              on: {
                TOGGLE_MIC: { target: 'muted' },
              },
            },
          },
        },
        screenShare: {
          initial: 'notSharing',
          states: {
            notSharing: {
              on: {
                START_SHARE: { target: 'sharingWindow' },
              },
            },
            sharingWindow: {
              on: {
                STOP_SHARE: { target: 'notSharing' },
              },
            },
          },
        },
      },
    },
  },
};

// 8. Single invoke actor (id + src, onDone + onError transitions with actions)
const singleInvokeActorConfig = {
  id: 'userProfileLoader',
  initial: 'idle',
  context: {
    user: null as unknown,
  },
  states: {
    idle: {
      on: {
        LOAD_PROFILE: { target: 'fetchingProfile' },
      },
    },
    fetchingProfile: {
      tags: ['loading'],
      entry: ['clearStaleErrors'],
      invoke: {
        id: 'fetchUser',
        src: 'fetchUserActor',
        onDone: {
          target: 'ready',
          actions: [assign({ user: ({ event }) => event.output })],
        },
        onError: {
          target: 'errorBanner',
          actions: ['recordFetchError'],
        },
      },
    },
    ready: {
      on: {
        REFRESH: { target: 'fetchingProfile' },
      },
    },
    errorBanner: {
      on: {
        RETRY: { target: 'fetchingProfile' },
      },
    },
  },
};

// 9. Multiple invoke actors array on a single state (named id + src AND anonymous src-only actor)
const multipleInvokeActorsArrayConfig = {
  id: 'liveTradingDesk',
  initial: 'connecting',
  states: {
    connecting: {
      invoke: {
        src: 'authenticateBrokerActor',
        onDone: { target: 'streamingQuotes' },
        onError: { target: 'halted' },
      },
    },
    streamingQuotes: {
      tags: ['realtime'],
      invoke: [
        {
          id: 'marketFeed',
          src: 'quoteWebSocketActor',
          onError: {
            target: 'reconnectingFeed',
            actions: ['logFeedDrop'],
          },
        },
        {
          src: 'heartbeatPingActor',
          onDone: {
            actions: ['recordHeartbeatAck'],
          },
        },
      ],
      on: {
        CLOSE_DESK: { target: 'halted' },
      },
    },
    reconnectingFeed: {
      after: {
        1500: { target: 'streamingQuotes' },
      },
      on: {
        ABORT: { target: 'halted' },
      },
    },
    halted: {
      type: 'final' as const,
    },
  },
};

// 10. Full XState v5 Tier 4 kitchen-sink statechart
const tier4KitchenSinkConfig = {
  id: 'autonomousDroneMission',
  initial: 'preflight',
  states: {
    preflight: {
      tags: ['ground'],
      entry: ['calibrateImu'],
      invoke: {
        id: 'gpsLock',
        src: 'acquireGpsFixActor',
        onDone: [
          {
            guard: 'isBatterySafe',
            target: 'airborne',
            actions: ['armRotors'],
          },
          {
            target: 'missionAborted',
            actions: ['flagLowBattery'],
          },
        ],
        onError: {
          target: 'missionAborted',
          actions: ['logSensorFault'],
        },
      },
      on: {
        EMERGENCY_LAUNCH_SURVEY: {
          guard: 'hasManualOverride',
          target: [
            '#autonomousDroneMission.airborne.navigation.waypointCruise',
            '#autonomousDroneMission.airborne.payload.recording4k',
          ],
          actions: ['logOverrideLaunch'],
        },
      },
    },
    airborne: {
      type: 'parallel' as const,
      tags: ['inFlight'],
      exit: ['disarmPayload'],
      on: {
        SIGNAL_DROP: {
          target: 'failsafeHold',
        },
      },
      onDone: {
        target: 'landedSafely',
        actions: ['uploadFlightLog'],
      },
      states: {
        navigation: {
          initial: 'takeoffClimb',
          states: {
            takeoffClimb: {
              on: {
                ALTITUDE_REACHED: { target: 'waypointCruise' },
              },
            },
            waypointCruise: {
              invoke: {
                src: 'obstacleLidarActor',
              },
              on: {
                WAYPOINTS_DONE: { target: 'returningHome' },
              },
            },
            returningHome: {
              on: {
                TOUCHDOWN: { target: 'navComplete' },
              },
            },
            navComplete: {
              type: 'final' as const,
            },
            history: {
              type: 'history' as const,
              history: 'deep' as const,
              target: 'waypointCruise',
            },
          },
        },
        payload: {
          initial: 'gimbalStandby',
          states: {
            gimbalStandby: {
              on: {
                START_CAPTURE: { target: 'recording4k' },
              },
            },
            recording4k: {
              entry: ['openVideoStream'],
              exit: ['flushVideoBuffer'],
              on: {
                STORAGE_DONE: { target: 'payloadComplete' },
              },
            },
            payloadComplete: {
              type: 'final' as const,
            },
          },
        },
      },
    },
    failsafeHold: {
      tags: ['hovering'],
      after: {
        10000: {
          target: 'missionAborted',
          actions: ['initiateAutoLand'],
        },
      },
      on: {
        LINK_RESTORED: {
          target: 'airborne.navigation.history',
          actions: ['resumeTelemetry'],
        },
      },
    },
    landedSafely: {
      tags: ['complete'],
      type: 'final' as const,
    },
    missionAborted: {
      type: 'final' as const,
    },
  },
};

export const TIER4_FIXTURES: ConformanceFixture[] = [
  // Official statelyai/docs Ground-Truth Tier 4 Reference Corpus (all 18 remaining machines — completing 31/31!)
  {
    id: 'ref-01-coffee-donut-parallel',
    title: 'Corpus: Stately Parallel Coffee & Donut Order (Tier 4 Reference)',
    description:
      'Official statelyai/docs coffee-donut-parallel machine with orthogonal coffee and donut regions and parent onDone -> orderComplete.',
    configSource: coffeeDonutParallelJson,
    machineOrConfig: createMachine(
      coffeeDonutParallelJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath: 'tests/reference-corpus/screenshots/coffee-donut-parallel.png',
    referenceSourceLabel: 'statelyai/docs — coffee-donut-parallel.png',
  },
  {
    id: 'ref-02-harel-parallel',
    title: 'Corpus: Harel Orthogonal Parallel Regions (Tier 4 Reference)',
    description:
      'Official statelyai/docs harel-parallel machine with root-level orthogonal regions A (B <-> C) and D (E <-> F -> G).',
    configSource: harelParallelJson,
    machineOrConfig: createMachine(
      harelParallelJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-parallel.png',
    referenceSourceLabel: 'statelyai/docs — harel-parallel.png',
  },
  {
    id: 'ref-03-harel-parallel-entry',
    title: 'Corpus: Harel Parallel Entry, Multi-Target Fork & Shallow History (Tier 4 Reference)',
    description:
      'Official statelyai/docs harel-parallel-entry machine combining parallel regions, shallow history (#entry-D.history), and multi-target fork entries ([B, E] and [C, #entry-D.history]).',
    configSource: harelParallelEntryJson,
    machineOrConfig: createMachine(
      harelParallelEntryJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-parallel-entry.png',
    referenceSourceLabel: 'statelyai/docs — harel-parallel-entry.png',
  },
  {
    id: 'ref-04-harel-history-shallow',
    title: 'Corpus: Harel Shallow History (H) Superstate (Tier 4 Reference)',
    description:
      'Official statelyai/docs harel-history-shallow machine resuming top-level substate inside compound container via shallow history H.',
    configSource: harelHistoryShallowJson,
    machineOrConfig: createMachine(
      harelHistoryShallowJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-history-shallow.png',
    referenceSourceLabel: 'statelyai/docs — harel-history-shallow.png',
  },
  {
    id: 'ref-05-harel-history-deep',
    title: 'Corpus: Harel Deep History (H*) Superstate (Tier 4 Reference)',
    description:
      'Official statelyai/docs harel-history-deep machine resuming arbitrarily nested leaf state via deep history H*.',
    configSource: harelHistoryDeepJson,
    machineOrConfig: createMachine(
      harelHistoryDeepJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-history-deep.png',
    referenceSourceLabel: 'statelyai/docs — harel-history-deep.png',
  },
  {
    id: 'ref-06-harel-history-selective',
    title: 'Corpus: Harel Selective Shallow History Subclustering (Tier 4 Reference)',
    description:
      'Official statelyai/docs harel-history-selective machine combining selective subclustering with shallow history fallback.',
    configSource: harelHistorySelectiveJson,
    machineOrConfig: createMachine(
      harelHistorySelectiveJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-history-selective.png',
    referenceSourceLabel: 'statelyai/docs — harel-history-selective.png',
  },
  {
    id: 'ref-07-harel-activities',
    title: 'Corpus: Harel Parallel Activities Coordination (Tier 4 Reference)',
    description:
      'Official statelyai/docs harel-activities root-parallel statechart coordinating orthogonal control and activity regions.',
    configSource: harelActivitiesJson,
    machineOrConfig: createMachine(
      harelActivitiesJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-activities.png',
    referenceSourceLabel: 'statelyai/docs — harel-activities.png',
  },
  {
    id: 'ref-08-harel-avionics',
    title: 'Corpus: Harel Avionics Orthogonal Subsystems Decomposition (Tier 4 Reference)',
    description:
      'Official statelyai/docs harel-avionics zero-transition root-parallel decomposition with nested parallel & compound subsystems.',
    configSource: harelAvionicsJson,
    machineOrConfig: createMachine(
      harelAvionicsJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-avionics.png',
    referenceSourceLabel: 'statelyai/docs — harel-avionics.png',
  },
  {
    id: 'ref-09-harel-broadcast-cycle',
    title: 'Corpus: Harel Broadcast Chain Reaction Cycle (Tier 4 Reference)',
    description:
      'Official statelyai/docs harel-broadcast-cycle machine with 3 orthogonal regions communicating via raised broadcast events.',
    configSource: harelBroadcastCycleJson,
    machineOrConfig: createMachine(
      harelBroadcastCycleJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-broadcast-cycle.png',
    referenceSourceLabel: 'statelyai/docs — harel-broadcast-cycle.png',
  },
  {
    id: 'ref-10-harel-conflict',
    title: 'Corpus: Harel Orthogonal Conflict & Hierarchy (Tier 4 Reference)',
    description:
      'Official statelyai/docs harel-conflict 21-state machine illustrating transitions across nested compound and parallel boundaries.',
    configSource: harelConflictJson,
    machineOrConfig: createMachine(
      harelConflictJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-conflict.png',
    referenceSourceLabel: 'statelyai/docs — harel-conflict.png',
  },
  {
    id: 'ref-11-harel-displays',
    title: 'Corpus: Harel Citizen Watch Displays & History Modes (Tier 4 Reference)',
    description:
      'Official statelyai/docs harel-displays 21-state 27-transition watch display mode hierarchy with both shallow H and deep H* history.',
    configSource: harelDisplaysJson,
    machineOrConfig: createMachine(
      harelDisplaysJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-displays.png',
    referenceSourceLabel: 'statelyai/docs — harel-displays.png',
  },
  {
    id: 'ref-12-harel-overlap',
    title: 'Corpus: Harel Overlapping State Emulation via Parallel Regions & Multi-Target Fork (Tier 4 Reference)',
    description:
      'Official statelyai/docs harel-overlap machine with parallel Together regions and multi-target fork gamma -> [Together.A2.D2, Together.B.E].',
    configSource: harelOverlapJson,
    machineOrConfig: createMachine(
      harelOverlapJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-overlap.png',
    referenceSourceLabel: 'statelyai/docs — harel-overlap.png',
  },
  {
    id: 'ref-13-harel-overlap-inactive',
    title: 'Corpus: Harel Overlapping Regions with Inactive States (Tier 4 Reference)',
    description:
      'Official statelyai/docs harel-overlap-inactive root-parallel machine modeling overlapping state sets via explicit inactive states.',
    configSource: harelOverlapInactiveJson,
    machineOrConfig: createMachine(
      harelOverlapInactiveJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath:
      'tests/reference-corpus/screenshots/harel-overlap-inactive.png',
    referenceSourceLabel: 'statelyai/docs — harel-overlap-inactive.png',
  },
  {
    id: 'ref-14-harel-semantics',
    title: 'Corpus: Harel Step Semantics Orthogonal Example (Tier 4 Reference)',
    description:
      'Official statelyai/docs harel-semantics root-parallel 10-state machine demonstrating synchronous step semantics across orthogonal regions.',
    configSource: harelSemanticsJson,
    machineOrConfig: createMachine(
      harelSemanticsJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-semantics.png',
    referenceSourceLabel: 'statelyai/docs — harel-semantics.png',
  },
  {
    id: 'ref-15-harel-stopwatch',
    title: 'Corpus: Harel Stopwatch with Parallel Split Display & Deep History (Tier 4 Reference)',
    description:
      'Official statelyai/docs harel-stopwatch 12-state machine combining parallel run/display regions inside On with deep history H*.',
    configSource: harelStopwatchJson,
    machineOrConfig: createMachine(
      harelStopwatchJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-stopwatch.png',
    referenceSourceLabel: 'statelyai/docs — harel-stopwatch.png',
  },
  {
    id: 'ref-16-harel-telephones',
    title: 'Corpus: Harel Multi-Party Telephones Orthogonal Regions (Tier 4 Reference)',
    description:
      'Official statelyai/docs harel-telephones 11-state root-parallel statechart modeling concurrent caller/callee handset states.',
    configSource: harelTelephonesJson,
    machineOrConfig: createMachine(
      harelTelephonesJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-telephones.png',
    referenceSourceLabel: 'statelyai/docs — harel-telephones.png',
  },
  {
    id: 'ref-17-harel-updates',
    title: 'Corpus: Harel Watch Time/Date Updates & Shallow History Cycle (Tier 4 Reference)',
    description:
      'Official statelyai/docs harel-updates 20-state 23-transition watch update cycle with shallow history H resumption.',
    configSource: harelUpdatesJson,
    machineOrConfig: createMachine(
      harelUpdatesJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-updates.png',
    referenceSourceLabel: 'statelyai/docs — harel-updates.png',
  },
  {
    id: 'ref-18-harel-watch',
    title: 'Corpus: Full Harel Citizen Quartz Multi-Alarm Watch (77 States, 81 Transitions — Tier 4 Boss)',
    description:
      'Official statelyai/docs harel-watch full Citizen Quartz Multi-Alarm III statechart (77 states, 81 transitions, 3 parallel states, 5 history pseudostates).',
    configSource: harelWatchJson,
    machineOrConfig: createMachine(
      harelWatchJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-watch.png',
    referenceSourceLabel: 'statelyai/docs — harel-watch.png',
  },

  // Tier 4 XState v5 Parallel, History, Multi-Target Fork & Invoke Conformance Suite (10 machines)
  {
    id: '01-basic-two-region-parallel',
    title: '2-Region Orthogonal Parallel State (Upload + Validation)',
    description:
      'Parallel processing container with dashed upload and validation regions, zero initial dot on the parallel parent, and independent region initial dots.',
    configSource: basicTwoRegionParallelConfig,
    machineOrConfig: createMachine(basicTwoRegionParallelConfig),
  },
  {
    id: '02-three-region-parallel-ondone',
    title: '3-Region Parallel State with Parent onDone Completion',
    description:
      'Three orthogonal CI verification regions (unitSuite, securityAudit, licenseCheck) triggering parent onDone -> readyToPublish when all three reach final.',
    configSource: threeRegionParallelOnDoneConfig,
    machineOrConfig: createMachine(threeRegionParallelOnDoneConfig),
  },
  {
    id: '03-nested-parallel-and-compound',
    title: 'Nested Parallel Inside Compound & Compound Inside Parallel Regions',
    description:
      'Compound authenticated session containing parallel activeWorkspace whose editorPane region itself contains a nested compound refactoring workflow.',
    configSource: nestedParallelAndCompoundConfig,
    machineOrConfig: createMachine(nestedParallelAndCompoundConfig),
  },
  {
    id: '04-shallow-history-with-default',
    title: 'Shallow History (H) with Default Fallback & External Re-Entry',
    description:
      'Multi-step wizard resuming its active top-level step via circular H history node after closing a contextual help drawer, with default fallback to accountInfo.',
    configSource: shallowHistoryWithDefaultConfig,
    machineOrConfig: createMachine(shallowHistoryWithDefaultConfig),
  },
  {
    id: '05-deep-history-multi-level',
    title: 'Deep History (H*) Resuming Multi-Level Nested Substates',
    description:
      'Debugger session restoring the exact nested tab inside inspectingFrame via circular H* deep history upon socket reconnection.',
    configSource: deepHistoryMultiLevelConfig,
    machineOrConfig: createMachine(deepHistoryMultiLevelConfig),
  },
  {
    id: '06-dual-shallow-and-deep-history',
    title: 'Dual Shallow (H) & Deep (H*) History Nodes in One Compound Container',
    description:
      'Course player offering both RESTART_CURRENT_CHAPTER (-> H: shallowHist) and RESUME_EXACT_SPOT (-> H*: deepHist) inside the same learningModule superstate.',
    configSource: dualShallowAndDeepHistoryConfig,
    machineOrConfig: createMachine(dualShallowAndDeepHistoryConfig),
  },
  {
    id: '07-multi-target-simultaneous-fork',
    title: 'Multi-Target Simultaneous Fork Hyperedge Entering Parallel Regions',
    description:
      'Single JOIN_PRESENTATION_MODE [isPresenter] / announcePresenter transition simultaneously entering microphone.unmuted and screenShare.sharingWindow.',
    configSource: multiTargetSimultaneousForkConfig,
    machineOrConfig: createMachine(multiTargetSimultaneousForkConfig),
  },
  {
    id: '08-single-invoke-actor-lifecycle',
    title: 'Single Invoked Actor with Named ID, onDone & onError Transitions',
    description:
      'State invoking fetchUser: fetchUserActor rendered in the invoke compartment with normalized onDone(fetchUser) and onError(fetchUser) transitions.',
    configSource: singleInvokeActorConfig,
    machineOrConfig: createMachine(singleInvokeActorConfig),
  },
  {
    id: '09-multiple-invoke-actors-array',
    title: 'Multiple Concurrent Invoked Actors Array (Named + Anonymous)',
    description:
      'Live trading state invoking both named marketFeed: quoteWebSocketActor and anonymous heartbeatPingActor with internal targetless onDone handler.',
    configSource: multipleInvokeActorsArrayConfig,
    machineOrConfig: createMachine(multipleInvokeActorsArrayConfig),
  },
  {
    id: '10-tier4-kitchen-sink-statechart',
    title: 'Tier 4 Kitchen-Sink Autonomous Drone Mission Statechart',
    description:
      'Full XState v5 statechart combining parallel flight/payload regions, deep H* history, multi-target override fork, invoked actors with guarded onDone/onError, timers, actions, and #tags.',
    configSource: tier4KitchenSinkConfig,
    machineOrConfig: createMachine(tier4KitchenSinkConfig),
  },
];

export const fixtures = TIER4_FIXTURES;
