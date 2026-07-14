export const FAULT_INJECTION_KINDS = [
  'disk-full',
  'permission-denied',
  'child-process-crash',
  'runtime-sigterm',
  'renderer-crash',
  'sse-disconnect',
  'out-of-order-event',
  'http-timeout',
  'http-429',
  'invalid-json',
  'sqlite-busy',
  'credential-store-unavailable'
] as const
export type FaultInjectionKind = typeof FAULT_INJECTION_KINDS[number]

export type FaultInjectionSpec = {
  kind: FaultInjectionKind
  enabled: boolean
  once: boolean
  delayMs: number
}

export type FaultInjectionValidationError =
  | 'not-an-object'
  | 'unknown-field'
  | 'invalid-kind'
  | 'invalid-enabled'
  | 'invalid-once'
  | 'invalid-delay'

export type FaultInjectionValidation =
  | { ok: true; value: FaultInjectionSpec }
  | { ok: false; error: FaultInjectionValidationError }

const MAX_DELAY_MS = 60_000

export function normalizeFaultInjectionSpec(input: unknown): FaultInjectionValidation {
  if (!isRecord(input)) return { ok: false, error: 'not-an-object' }
  if (!hasOnlyKeys(input, ['kind', 'enabled', 'once', 'delayMs'])) {
    return { ok: false, error: 'unknown-field' }
  }
  if (!FAULT_INJECTION_KINDS.includes(input.kind as FaultInjectionKind)) {
    return { ok: false, error: 'invalid-kind' }
  }
  if (typeof input.enabled !== 'boolean') return { ok: false, error: 'invalid-enabled' }
  const once = input.once === undefined ? true : input.once
  if (typeof once !== 'boolean') return { ok: false, error: 'invalid-once' }
  const delayMs = input.delayMs === undefined ? 0 : input.delayMs
  if (typeof delayMs !== 'number' || !Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > MAX_DELAY_MS) {
    return { ok: false, error: 'invalid-delay' }
  }
  return { ok: true, value: { kind: input.kind as FaultInjectionKind, enabled: input.enabled, once, delayMs } }
}

export function shouldInjectFault(spec: unknown, activationCount: number): boolean {
  const normalized = normalizeFaultInjectionSpec(spec)
  if (!normalized.ok || !normalized.value.enabled ||
      !Number.isSafeInteger(activationCount) || activationCount < 0) return false
  return !normalized.value.once || activationCount === 0
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}
