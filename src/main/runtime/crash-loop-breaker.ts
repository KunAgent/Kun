/**
 * Pure crash-loop policy for the GUI-managed runtime.
 *
 * The process supervisor owns process lifecycle and exit classification. It
 * can feed the resulting expected/unexpected observations into this reducer
 * without coupling the policy to Electron, timers, or logging. That keeps the
 * policy reusable when the supervisor's exit contract evolves.
 */

export const DEFAULT_CRASH_LOOP_POLICY = {
  /** Keep only unexpected exits observed in the last five minutes. */
  windowMs: 5 * 60 * 1_000,
  /** Trip after three unexpected exits in the active window. */
  maxUnexpectedCrashes: 3,
  /** A runtime must stay ready for two minutes before clearing history. */
  stableRuntimeMs: 2 * 60 * 1_000
} as const

export type CrashLoopPolicy = {
  windowMs: number
  maxUnexpectedCrashes: number
  stableRuntimeMs: number
}

export type CrashExitClassification = 'expected' | 'unexpected'

/**
 * Exit observations are deliberately classified before reaching this module.
 * Runtime exit reasons and process metadata belong to the supervisor's
 * contract (for example #889); this policy only needs the safe disposition.
 */
export type CrashExitRecord = {
  at: number
  classification: CrashExitClassification
}

export type CrashLoopEvent =
  | { type: 'runtime-exit'; record: CrashExitRecord }
  | { type: 'runtime-ready'; at: number }
  | { type: 'runtime-stable'; at: number }

export type CrashLoopState = {
  /** Recent unexpected exits, retained for diagnostics and threshold checks. */
  unexpectedExits: readonly CrashExitRecord[]
  /** The most recent classified exit, including expected exits. */
  lastExit: CrashExitRecord | null
  /** Start of the current ready period, or null while the runtime is stopped. */
  stableSince: number | null
  /** True while the unexpected-exit threshold is reached in the active window. */
  tripped: boolean
}

export function createCrashLoopState(): CrashLoopState {
  return {
    unexpectedExits: [],
    lastExit: null,
    stableSince: null,
    tripped: false
  }
}

/**
 * Apply one observation without side effects.
 *
 * `runtime-ready` starts the stable-runtime timer. A caller should dispatch
 * `runtime-stable` from its health/readiness path; the reducer then clears
 * crash history only after `stableRuntimeMs` has elapsed. This avoids clearing
 * a crash loop merely because a process briefly bound its port.
 */
export function reduceCrashLoop(
  state: CrashLoopState,
  event: CrashLoopEvent,
  policy: CrashLoopPolicy = DEFAULT_CRASH_LOOP_POLICY
): CrashLoopState {
  const normalizedPolicy = normalizePolicy(policy)
  const at = event.type === 'runtime-exit' ? event.record.at : event.at
  const now = finiteTimestamp(at)
  let next = pruneState(state, now, normalizedPolicy)

  switch (event.type) {
    case 'runtime-exit': {
      const record = normalizeRecord(event.record, now)
      next = {
        ...next,
        lastExit: record,
        // An expected stop is not a stable runtime period. Keep existing
        // history so an expected settings restart cannot hide prior crashes.
        stableSince: null,
        unexpectedExits:
          record.classification === 'unexpected'
            ? [...next.unexpectedExits, record]
            : next.unexpectedExits
      }
      return withTripState(next, normalizedPolicy)
    }

    case 'runtime-ready':
      return {
        ...withTripState(next, normalizedPolicy),
        stableSince: now
      }

    case 'runtime-stable': {
      // Stable events before readiness (or with a backwards clock) must not
      // clear crash history.
      if (
        next.stableSince === null ||
        now < next.stableSince ||
        now - next.stableSince < normalizedPolicy.stableRuntimeMs
      ) {
        return withTripState(next, normalizedPolicy)
      }
      return createCrashLoopState()
    }
  }
}

function normalizeRecord(record: CrashExitRecord, fallbackAt: number): CrashExitRecord {
  return {
    at: finiteTimestamp(record.at, fallbackAt),
    classification: record.classification === 'unexpected' ? 'unexpected' : 'expected'
  }
}

function normalizePolicy(policy: CrashLoopPolicy): Required<CrashLoopPolicy> {
  return {
    windowMs: positiveFinite(policy.windowMs, DEFAULT_CRASH_LOOP_POLICY.windowMs),
    maxUnexpectedCrashes: positiveInteger(
      policy.maxUnexpectedCrashes,
      DEFAULT_CRASH_LOOP_POLICY.maxUnexpectedCrashes
    ),
    stableRuntimeMs: nonNegativeFinite(
      policy.stableRuntimeMs,
      DEFAULT_CRASH_LOOP_POLICY.stableRuntimeMs
    )
  }
}

function pruneState(
  state: CrashLoopState,
  now: number,
  policy: Required<CrashLoopPolicy>
): CrashLoopState {
  const unexpectedExits = state.unexpectedExits.filter((record) => {
    const age = now - record.at
    // Keep future-dated records when clocks move backwards. Dropping them
    // would silently erase crash history; the next monotonic observation will
    // prune them once they are genuinely outside the window.
    return age < policy.windowMs
  })
  return {
    unexpectedExits,
    lastExit: state.lastExit,
    stableSince: state.stableSince,
    tripped: state.tripped
  }
}

function withTripState(
  state: CrashLoopState,
  policy: Required<CrashLoopPolicy>
): CrashLoopState {
  return {
    ...state,
    tripped: state.unexpectedExits.length >= policy.maxUnexpectedCrashes
  }
}

function finiteTimestamp(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

function positiveFinite(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function nonNegativeFinite(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback
}
