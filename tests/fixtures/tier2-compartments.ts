import * as fs from 'node:fs';
import * as path from 'node:path';
import { and, assign, createMachine, not, or, raise } from 'xstate';
import type { ConformanceFixture } from '../../src/verifier/gallery.js';

function loadCorpusMachineJson(slug: string): Record<string, unknown> {
  const jsonPath = path.resolve(
    process.cwd(),
    'tests/reference-corpus/machines',
    `${slug}.json`,
  );
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;
}

const coffeeOrderJson = loadCorpusMachineJson('coffee-order');
const harelFlatJson = loadCorpusMachineJson('harel-flat');
const harelSimultaneousJson = loadCorpusMachineJson('harel-simultaneous');
const harelOverlapSharedJson = loadCorpusMachineJson('harel-overlap-shared');
const harelProductJson = loadCorpusMachineJson('harel-product');

// 1. Guarded transitions (named string guards + XState v5 combinators and/or/not)
const guardedAccessSource = {
  id: 'accessControl',
  initial: 'anonymous',
  states: {
    anonymous: {
      on: {
        LOGIN: {
          guard: 'hasValidCredentials',
          target: 'authenticated',
        },
        SSO_CALLBACK: {
          guard: 'and(isSsoTokenValid, not(isAccountLocked))',
          target: 'authenticated',
        },
      },
    },
    authenticated: {
      on: {
        OPEN_ADMIN: {
          guard: 'or(isAdmin, isSuperUser)',
          target: 'adminConsole',
        },
        LOGOUT: {
          target: 'anonymous',
        },
      },
    },
    adminConsole: {
      on: {
        EXIT_ADMIN: {
          target: 'authenticated',
        },
      },
    },
  },
};

const guardedAccessMachine = createMachine({
  id: 'accessControl',
  initial: 'anonymous',
  states: {
    anonymous: {
      on: {
        LOGIN: {
          guard: 'hasValidCredentials',
          target: 'authenticated',
        },
        SSO_CALLBACK: {
          guard: and(['isSsoTokenValid', not('isAccountLocked')]),
          target: 'authenticated',
        },
      },
    },
    authenticated: {
      on: {
        OPEN_ADMIN: {
          guard: or(['isAdmin', 'isSuperUser']),
          target: 'adminConsole',
        },
        LOGOUT: {
          target: 'anonymous',
        },
      },
    },
    adminConsole: {
      on: {
        EXIT_ADMIN: {
          target: 'authenticated',
        },
      },
    },
  },
});

// 2. Multi-branch guarded priority arrays on the same event (SUBMIT order 0..3 -> [#1]..[#4])
const priorityBranchesConfig = {
  id: 'loanUnderwriting',
  initial: 'pendingReview',
  states: {
    pendingReview: {
      on: {
        SUBMIT: [
          {
            guard: 'isAutoApproved',
            target: 'approved',
          },
          {
            guard: 'needsManualAudit',
            target: 'manualReview',
          },
          {
            guard: 'hasFraudSignal',
            target: 'rejected',
          },
          {
            target: 'manualReview',
          },
        ],
      },
    },
    manualReview: {
      on: {
        APPROVE: { target: 'approved' },
        DECLINE: { target: 'rejected' },
      },
    },
    approved: {
      type: 'final' as const,
    },
    rejected: {
      type: 'final' as const,
    },
  },
};

// 3. Transition actions (multiple string actions + XState v5 assign/raise builtins)
const transitionActionsSource = {
  id: 'cartCheckout',
  initial: 'browsing',
  states: {
    browsing: {
      on: {
        ADD_ITEM: {
          target: 'cartReady',
          actions: ['assign(itemCount, subtotal)', 'trackAnalytics'],
        },
      },
    },
    cartReady: {
      on: {
        CHECKOUT: {
          target: 'receipt',
          actions: ['reserveInventory', 'chargePayment', 'raise(SEND_RECEIPT)'],
        },
        CLEAR_CART: {
          target: 'browsing',
          actions: ['assign(itemCount, subtotal)'],
        },
      },
    },
    receipt: {
      type: 'final' as const,
    },
  },
};

const transitionActionsMachine = createMachine({
  id: 'cartCheckout',
  initial: 'browsing',
  states: {
    browsing: {
      on: {
        ADD_ITEM: {
          target: 'cartReady',
          actions: [assign({ itemCount: 1, subtotal: 25 }), 'trackAnalytics'],
        },
      },
    },
    cartReady: {
      on: {
        CHECKOUT: {
          target: 'receipt',
          actions: ['reserveInventory', 'chargePayment', raise({ type: 'SEND_RECEIPT' })],
        },
        CLEAR_CART: {
          target: 'browsing',
          actions: [assign({ itemCount: 0, subtotal: 0 })],
        },
      },
    },
    receipt: {
      type: 'final',
    },
  },
});

// 4. Combined EVENT [guard] / action1, action2 transitions
const combinedGuardActionsConfig = {
  id: 'paymentAuthorization',
  initial: 'awaitingCard',
  states: {
    awaitingCard: {
      on: {
        AUTHORIZE: [
          {
            guard: 'isLimitExceeded',
            target: 'declined',
            actions: ['flagRisk', 'notifyCompliance'],
          },
          {
            guard: 'hasSufficientFunds',
            target: 'captured',
            actions: ['captureHold', 'emitReceipt'],
          },
        ],
      },
    },
    captured: {
      type: 'final' as const,
    },
    declined: {
      on: {
        RETRY_CARD: {
          guard: 'canRetry',
          target: 'awaitingCard',
          actions: ['incrementAttempts', 'clearBanner'],
        },
      },
    },
  },
};

// 5. State entry and exit actions compartments
const entryExitCompartmentsConfig = {
  id: 'mediaRecorder',
  initial: 'standby',
  states: {
    standby: {
      entry: ['initAudioContext'],
      exit: ['clearPreview'],
      on: {
        RECORD: { target: 'recording' },
      },
    },
    recording: {
      entry: ['acquireMicStream', 'startTimer'],
      exit: ['stopTimer', 'flushBuffer'],
      on: {
        PAUSE: { target: 'paused' },
        STOP: { target: 'uploading' },
      },
    },
    paused: {
      entry: ['showPauseIndicator'],
      exit: ['hidePauseIndicator'],
      on: {
        RESUME: { target: 'recording' },
        STOP: { target: 'uploading' },
      },
    },
    uploading: {
      entry: ['uploadRecording'],
      on: {
        DONE: { target: 'complete' },
      },
    },
    complete: {
      type: 'final' as const,
    },
  },
};

// 6. Internal / targetless transitions (rendered inside state compartments, NOT external self-loops)
const internalTransitionsConfig = {
  id: 'formDraftEditor',
  initial: 'editing',
  states: {
    editing: {
      entry: ['focusFirstField'],
      on: {
        TYPE_CHAR: {
          actions: ['updateField', 'markDirty'],
        },
        VALIDATE: [
          {
            guard: 'isDirty',
            actions: ['runSchemaCheck', 'saveDraft'],
          },
          {
            actions: ['logNoOp'],
          },
        ],
        SUBMIT_FORM: {
          guard: 'isFormValid',
          target: 'submitted',
          actions: ['commitForm'],
        },
      },
    },
    submitted: {
      entry: ['showToast'],
      type: 'final' as const,
    },
  },
};

// 7. State tags (#loading, #authorized, plus multi-tag wrapping without bloated boxes)
const stateTagsConfig = {
  id: 'featureRollout',
  initial: 'fetchingFlags',
  states: {
    fetchingFlags: {
      tags: ['loading', 'network'],
      entry: ['requestFlags'],
      on: {
        LOADED: { target: 'canaryActive' },
        OFFLINE: { target: 'degradedFallback' },
      },
    },
    canaryActive: {
      tags: ['authorized', 'canary', 'instrumented', 'interactive'],
      entry: ['enableTelemetry'],
      on: {
        ROLLBACK: { target: 'degradedFallback' },
      },
    },
    degradedFallback: {
      tags: ['offline', 'cached'],
      on: {
        RETRY_FLAGS: { target: 'fetchingFlags' },
      },
    },
  },
};

// 8. Eventless (always) transitions (multi-branch guarded transient decision node)
const eventlessAlwaysConfig = {
  id: 'creditTierRouter',
  initial: 'collectingScore',
  states: {
    collectingScore: {
      on: {
        SCORE_READY: {
          target: 'evaluatingTier',
          actions: ['storeScore'],
        },
      },
    },
    evaluatingTier: {
      always: [
        {
          guard: 'isPrimeScore',
          target: 'primeOffer',
          actions: ['applyPrimeRate'],
        },
        {
          guard: 'isStandardScore',
          target: 'standardOffer',
          actions: ['applyStandardRate'],
        },
        {
          target: 'manualUnderwrite',
          actions: ['queueSpecialist'],
        },
      ],
    },
    primeOffer: {
      type: 'final' as const,
    },
    standardOffer: {
      type: 'final' as const,
    },
    manualUnderwrite: {
      type: 'final' as const,
    },
  },
};

// 9. Delayed (after) transitions (numeric ms + named delay + internal targetless delay; no synthetic raise/cancel leaks)
const delayedAfterConfig = {
  id: 'sessionIdleMonitor',
  initial: 'active',
  states: {
    active: {
      entry: ['resetHeartbeat'],
      after: {
        IDLE_WARN_MS: {
          actions: ['showIdleToast'],
        },
        30000: {
          guard: 'isUnsavedClear',
          target: 'warningModal',
          actions: ['announceCountdown'],
        },
      },
      on: {
        USER_INPUT: {
          actions: ['recordActivity'],
        },
      },
    },
    warningModal: {
      tags: ['modal', 'warning'],
      after: {
        SESSION_TTL: {
          target: 'expired',
          actions: ['purgeTokens'],
        },
      },
      on: {
        STAY_SIGNED_IN: {
          target: 'active',
          actions: ['refreshSession'],
        },
      },
    },
    expired: {
      entry: ['redirectToLogin'],
      type: 'final' as const,
    },
  },
};

// 10. Multi-self-loop state with compartments (distinct non-overlapping self-loop channels)
const multiSelfLoopCompartmentConfig = {
  id: 'streamConnection',
  initial: 'connected',
  states: {
    connected: {
      tags: ['online', 'streaming'],
      entry: ['openSocket'],
      exit: ['closeSocket'],
      on: {
        PING: {
          actions: ['recordLatency'],
        },
        RECONNECT_SOFT: {
          guard: 'isStale',
          target: 'connected',
          actions: ['rotateCursor'],
        },
        FORCE_RESYNC: {
          target: 'connected',
          actions: ['resetOffset'],
        },
        FATAL_DROP: {
          target: 'terminated',
        },
      },
    },
    terminated: {
      type: 'final' as const,
    },
  },
};

// 11. Kitchen-sink flat Tier 2 statechart combining all Tier 2 semantics simultaneously
const kitchenSinkTier2Config = {
  id: 'orderFulfillment',
  initial: 'validating',
  states: {
    validating: {
      tags: ['intake', 'automated'],
      entry: ['normalizeAddress'],
      exit: ['logValidationExit'],
      always: [
        {
          guard: 'isInvalidAddress',
          target: 'onHold',
          actions: ['flagAddressIssue'],
        },
      ],
      on: {
        AMEND_NOTE: {
          actions: ['appendAuditNote'],
        },
        CONFIRM: [
          {
            guard: 'isExpressEligible',
            target: 'charging',
            actions: ['selectExpressCarrier', 'lockInventory'],
          },
          {
            target: 'charging',
            actions: ['selectStandardCarrier', 'lockInventory'],
          },
        ],
      },
    },
    charging: {
      tags: ['billing'],
      entry: ['beginChargeAttempt'],
      after: {
        15000: {
          target: 'onHold',
          actions: ['recordGatewayTimeout'],
        },
      },
      on: {
        CHARGE_OK: {
          target: 'shipped',
          actions: ['emitInvoice'],
        },
        RETRY_GATEWAY: {
          guard: 'hasRetriesLeft',
          target: 'charging',
          actions: ['incrementRetry'],
        },
      },
    },
    onHold: {
      tags: ['attention', 'manual'],
      entry: ['notifySupportDesk'],
      after: {
        HOLD_EXPIRY: {
          target: 'cancelled',
          actions: ['releaseInventory'],
        },
      },
      on: {
        RESOLVE_HOLD: {
          guard: 'isOverrideApproved',
          target: 'validating',
          actions: ['clearFlags'],
        },
      },
    },
    shipped: {
      tags: ['completed'],
      entry: ['sendTrackingEmail'],
      type: 'final' as const,
    },
    cancelled: {
      entry: ['issueVoidNotice'],
      type: 'final' as const,
    },
  },
};

export const TIER2_FIXTURES: ConformanceFixture[] = [
  // Official statelyai/docs Ground-Truth Corpus (<= Tier 2)
  {
    id: 'ref-01-coffee-order',
    title: 'Corpus: Stately Coffee Order (Tier 1 Reference)',
    description:
      'Official statelyai/docs coffee-order machine (Ready -> Brewing -> Served [final] + CANCEL loop).',
    configSource: coffeeOrderJson,
    machineOrConfig: createMachine(coffeeOrderJson as Parameters<typeof createMachine>[0]),
    referencePngRelPath: 'tests/reference-corpus/screenshots/coffee-order.png',
    referenceSourceLabel: 'statelyai/docs — coffee-order.png',
  },
  {
    id: 'ref-02-harel-flat',
    title: 'Corpus: Harel Figure 6 Flat Guarded Machine (Tier 2 Reference)',
    description:
      'Official statelyai/docs harel-flat machine from Harel (1987) with guarded transition gamma [P].',
    configSource: harelFlatJson,
    machineOrConfig: createMachine(harelFlatJson as Parameters<typeof createMachine>[0]),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-flat.png',
    referenceSourceLabel: 'statelyai/docs — harel-flat.png',
  },
  {
    id: 'ref-03-harel-simultaneous',
    title: 'Corpus: Harel Simultaneous Priority Guards (Tier 2 Reference)',
    description:
      'Official statelyai/docs harel-simultaneous machine with multi-branch guarded INPUT [alpha and beta] vs [alpha without beta] and unreachable state D.',
    configSource: harelSimultaneousJson,
    machineOrConfig: createMachine(
      harelSimultaneousJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-simultaneous.png',
    referenceSourceLabel: 'statelyai/docs — harel-simultaneous.png',
  },
  {
    id: 'ref-04-harel-overlap-shared',
    title: 'Corpus: Harel Figure 41 Shared-Membership Flat Expansion (Tier 1 Reference)',
    description:
      'Official statelyai/docs harel-overlap-shared 5-state 10-transition flat statechart.',
    configSource: harelOverlapSharedJson,
    machineOrConfig: createMachine(
      harelOverlapSharedJson as Parameters<typeof createMachine>[0],
    ),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-overlap-shared.png',
    referenceSourceLabel: 'statelyai/docs — harel-overlap-shared.png',
  },
  {
    id: 'ref-05-harel-product',
    title: 'Corpus: Harel Figure 20 Six-State Product Machine (Tier 1 Reference)',
    description:
      'Official statelyai/docs harel-product 6-state 11-transition Cartesian product machine with comma-containing state keys (B,E..C,G).',
    configSource: harelProductJson,
    machineOrConfig: createMachine(harelProductJson as Parameters<typeof createMachine>[0]),
    referencePngRelPath: 'tests/reference-corpus/screenshots/harel-product.png',
    referenceSourceLabel: 'statelyai/docs — harel-product.png',
  },

  // Tier 2 XState v5 Conformance Suite
  {
    id: '01-guarded-transitions',
    title: 'Guarded Transitions & XState v5 Guard Combinators',
    description:
      'Named string guards and nested XState v5 higher-order guard combinators (and, or, not).',
    configSource: guardedAccessSource,
    machineOrConfig: guardedAccessMachine,
    referencePngRelPath: 'tests/reference-corpus/features/guards.png',
    referenceSourceLabel: 'statelyai/docs Feature Reference — guards.png',
  },
  {
    id: '02-priority-guarded-branches',
    title: 'Multi-Branch Guarded Priority Array ([#1]..[#4])',
    description:
      'Four ordered branches on SUBMIT (3 guarded + 1 unguarded fallback) preserving exact evaluation priority order.',
    configSource: priorityBranchesConfig,
    machineOrConfig: createMachine(priorityBranchesConfig),
  },
  {
    id: '03-transition-actions',
    title: 'Transition Actions & Builtin Assign / Raise Formatting',
    description:
      'External transitions executing multi-key assign(...) and raise(...) alongside named action strings.',
    configSource: transitionActionsSource,
    machineOrConfig: transitionActionsMachine,
  },
  {
    id: '04-combined-guard-and-actions',
    title: 'Combined EVENT [guard] / action1, action2 Transitions',
    description:
      'Full UML/Harel transition labels combining priority order, bracketed guards, and slash-prefixed action lists.',
    configSource: combinedGuardActionsConfig,
    machineOrConfig: createMachine(combinedGuardActionsConfig),
  },
  {
    id: '05-entry-exit-compartments',
    title: 'State Entry & Exit Action Compartments',
    description:
      'States with single and multiple entry / exit lifecycle action rows separated from the state header by a clean divider.',
    configSource: entryExitCompartmentsConfig,
    machineOrConfig: createMachine(entryExitCompartmentsConfig),
  },
  {
    id: '06-internal-targetless-transitions',
    title: 'Internal / Targetless Transitions Compartment',
    description:
      'Targetless transitions (including multi-branch priority VALIDATE [#1]/[#2]) rendered strictly inside state compartments without external arrows.',
    configSource: internalTransitionsConfig,
    machineOrConfig: createMachine(internalTransitionsConfig),
  },
  {
    id: '07-state-tags-pills',
    title: 'State Tags & Multi-Tag Row Wrapping',
    description:
      'Rounded #tag badges inside state compartments, including 4 tags on canaryActive testing compact pill wrapping.',
    configSource: stateTagsConfig,
    machineOrConfig: createMachine(stateTagsConfig),
  },
  {
    id: '08-eventless-always-router',
    title: 'Eventless (always) Transient Decision Node',
    description:
      'Transient evaluatingTier state with 3 ordered always branches ([#1] prime, [#2] standard, [#3] fallback).',
    configSource: eventlessAlwaysConfig,
    machineOrConfig: createMachine(eventlessAlwaysConfig),
  },
  {
    id: '09-delayed-after-transitions',
    title: 'Delayed (after) Transitions — Numeric ms & Named Delays',
    description:
      'Numeric after(30000ms), named after(SESSION_TTL), and internal after(IDLE_WARN_MS) without leaking synthetic raise/cancel actions.',
    configSource: delayedAfterConfig,
    machineOrConfig: createMachine(delayedAfterConfig),
    referencePngRelPath: 'tests/reference-corpus/features/delayed-transitions.png',
    referenceSourceLabel: 'statelyai/docs Feature Reference — delayed-transitions.png',
  },
  {
    id: '10-multi-self-loop-compartment',
    title: 'Multiple External Self-Transitions + Internal Compartment',
    description:
      'Simultaneous internal PING row inside the compartment plus two distinct external self-loop arrows (RECONNECT_SOFT and FORCE_RESYNC).',
    configSource: multiSelfLoopCompartmentConfig,
    machineOrConfig: createMachine(multiSelfLoopCompartmentConfig),
  },
  {
    id: '11-tier2-kitchen-sink',
    title: 'Tier 2 Kitchen-Sink Order Fulfillment Statechart',
    description:
      'End-to-end flat statechart exercising entry, exit, internalTransitions, tags, always, numeric & named after delays, priority guards, and external self-loops.',
    configSource: kitchenSinkTier2Config,
    machineOrConfig: createMachine(kitchenSinkTier2Config),
  },
];

export const fixtures = TIER2_FIXTURES;
