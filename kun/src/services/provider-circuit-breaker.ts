export type ProviderCircuitState = 'closed' | 'open' | 'half-open'
export type ProviderFailureKind = 'rate-limit' | 'server' | 'network' | 'timeout' | 'authentication' | 'client'

export type ProviderCircuitSnapshot = {
  state: ProviderCircuitState
  consecutiveFailures: number
  openedAt: number | null
  probeInFlight: boolean
}

export type ProviderCircuitPolicy = {
  failureThreshold: number
  openDurationMs: number
}

export type ProviderRequestDecision = {
  allowed: boolean
  probe: boolean
  reason: 'closed' | 'open' | 'half-open-probe' | 'half-open-busy' | 'invalid-time'
  snapshot: ProviderCircuitSnapshot
}

const DEFAULT_POLICY: ProviderCircuitPolicy = { failureThreshold: 3, openDurationMs: 30_000 }
const FAILURE_KINDS: readonly ProviderFailureKind[] = [
  'rate-limit',
  'server',
  'network',
  'timeout',
  'authentication',
  'client'
]

export function initialProviderCircuit(): ProviderCircuitSnapshot {
  return { state: 'closed', consecutiveFailures: 0, openedAt: null, probeInFlight: false }
}

export function decideProviderRequest(
  snapshot: ProviderCircuitSnapshot,
  now: number,
  policy: ProviderCircuitPolicy = DEFAULT_POLICY
): ProviderRequestDecision {
  const normalized = normalizeSnapshot(snapshot)
  const limits = normalizePolicy(policy)
  if (!isValidTimestamp(now)) {
    return {
      allowed: false,
      probe: false,
      reason: 'invalid-time',
      snapshot: normalized
    }
  }
  if (normalized.state === 'open') {
    if (now - (normalized.openedAt ?? now) < limits.openDurationMs) {
      return { allowed: false, probe: false, reason: 'open', snapshot: normalized }
    }
    // Claim the single half-open probe in the returned snapshot. Callers can
    // persist this decision before starting I/O, so concurrent admissions do
    // not all observe an available probe after the open window expires.
    const next = { ...normalized, state: 'half-open' as const, probeInFlight: true }
    return { allowed: true, probe: true, reason: 'half-open-probe', snapshot: next }
  }
  if (normalized.state === 'half-open') {
    if (normalized.probeInFlight) return { allowed: false, probe: false, reason: 'half-open-busy', snapshot: normalized }
    return { allowed: true, probe: true, reason: 'half-open-probe', snapshot: { ...normalized, probeInFlight: true } }
  }
  return { allowed: true, probe: false, reason: 'closed', snapshot: normalized }
}

export function recordProviderSuccess(snapshot: ProviderCircuitSnapshot): ProviderCircuitSnapshot {
  return { state: 'closed', consecutiveFailures: 0, openedAt: null, probeInFlight: false }
}

export function recordProviderFailure(
  snapshot: ProviderCircuitSnapshot,
  kind: ProviderFailureKind,
  now: number,
  policy: ProviderCircuitPolicy = DEFAULT_POLICY
): ProviderCircuitSnapshot {
  const current = normalizeSnapshot(snapshot)
  const limits = normalizePolicy(policy)
  if (!FAILURE_KINDS.includes(kind) || !isValidTimestamp(now)) {
    return { ...current, probeInFlight: false }
  }
  if (kind === 'authentication' || kind === 'client') return { ...current, probeInFlight: false }
  const failures = current.consecutiveFailures + 1
  if (current.state === 'half-open' || failures >= limits.failureThreshold) {
    return { state: 'open', consecutiveFailures: failures, openedAt: now, probeInFlight: false }
  }
  return { ...current, consecutiveFailures: failures, probeInFlight: false }
}

function normalizeSnapshot(snapshot: ProviderCircuitSnapshot): ProviderCircuitSnapshot {
  if (!snapshot || !hasExactKeys(snapshot, ['state', 'consecutiveFailures', 'openedAt', 'probeInFlight']) ||
      !['closed', 'open', 'half-open'].includes(snapshot.state) ||
      !Number.isSafeInteger(snapshot.consecutiveFailures) || snapshot.consecutiveFailures < 0 ||
      (snapshot.openedAt !== null && !isValidTimestamp(snapshot.openedAt)) ||
      typeof snapshot.probeInFlight !== 'boolean') {
    return initialProviderCircuit()
  }
  return {
    state: snapshot.state,
    consecutiveFailures: snapshot.consecutiveFailures,
    openedAt: snapshot.openedAt,
    probeInFlight: snapshot.state === 'half-open' && snapshot.probeInFlight
  }
}

function normalizePolicy(policy: ProviderCircuitPolicy): ProviderCircuitPolicy {
  if (!policy || !hasExactKeys(policy, ['failureThreshold', 'openDurationMs']) ||
      !Number.isSafeInteger(policy.failureThreshold) || policy.failureThreshold < 1 ||
      !Number.isSafeInteger(policy.openDurationMs) || policy.openDurationMs < 1) return DEFAULT_POLICY
  return { failureThreshold: policy.failureThreshold, openDurationMs: policy.openDurationMs }
}

function isValidTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
}
