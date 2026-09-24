import type {
  ModelFailureCategory,
  ModelFailureMetadata,
  ModelFailureReason
} from '../../contracts/model-route-pool.js'

export type { ModelFailureReason } from '../../contracts/model-route-pool.js'

/**
 * Unified failure classification shared by every model client.
 *
 * HTTP status codes alone cannot distinguish "rate limited, retry soon" from
 * "account out of credit, retrying is pointless", so classification also reads
 * the provider error body (English and Chinese signal phrases) and rate-limit
 * reset headers. The result drives three decisions: whether the same target
 * may be retried, whether a configured failover target may take over, and how
 * long a route-pool circuit stays open.
 */

export type ModelFailureClassification = {
  reason: ModelFailureReason
  /** Suggested wait before the same target may work again. */
  retryAfterMs?: number
  /** Provider-declared quota reset instant (ISO 8601), when known. */
  resetAt?: string
}

export type FailureHeaderSource =
  | Headers
  | Record<string, string | string[] | undefined>
  | Iterable<readonly [string, string]>
  | undefined

/** Body keywords are trusted only for actual error responses, never content. */
const CREDIT_SIGNAL =
  /insufficient[_\s-]?quota|insufficient[_\s-]?(?:balance|credit|funds?)|balance[_\s-]?(?:is[_\s-]?)?(?:not[_\s-]?enough|insufficient)|billing|hard[_\s-]?limit|arrears?|payment[_\s-]?required|recharge|余额不足|欠费|充值|账户.{0,8}(?:不足|停用|冻结)/iu
const QUOTA_SIGNAL =
  /\bquota\b|usage[_\s-]?limit|limit[_\s-]?reached|exceed(?:ed|s)?[_\s-]?.{0,24}(?:plan|limit|quota|allowance)|额度|用量|套餐|上限/iu
const RATE_SIGNAL =
  /rate[_\s-]?limit|too[_\s-]?many[_\s-]?requests|throttl|requests?[_\s-]?per[_\s-]?(?:min|sec|hour|day)|限流|频率/iu
const OVERLOADED_SIGNAL =
  /overload|server[_\s-]?busy|at[_\s-]?capacity|capacity[_\s-]?reached|engine[_\s-]?(?:unavailable|overloaded)|服务(?:器)?(?:繁忙|过载)/iu

/** Reasons that never benefit from retrying the same credential/target. */
const FAILOVER_REASONS: ReadonlySet<ModelFailureReason> = new Set([
  'credit',
  'quota',
  'rate',
  'overloaded'
])

const MAX_RESET_DELAY_MS = 3_600_000

export function classifyModelFailure(input: {
  status?: number
  providerCode?: string
  body?: string
  headers?: FailureHeaderSource
  now?: number
}): ModelFailureClassification {
  const now = input.now ?? Date.now()
  const signal = `${input.providerCode ?? ''}\n${(input.body ?? '').slice(0, 4_000)}`
    .toLowerCase()
  const { retryAfterMs, resetAt } = resetInfoFromHeaders(input.headers, now)
  const status = input.status
  let reason: ModelFailureReason
  if (status === 402 || CREDIT_SIGNAL.test(signal)) reason = 'credit'
  else if (QUOTA_SIGNAL.test(signal)) reason = 'quota'
  else if (status === 429 || RATE_SIGNAL.test(signal)) reason = 'rate'
  else if (status === 529 || OVERLOADED_SIGNAL.test(signal)) reason = 'overloaded'
  else if (status === 401 || status === 403) reason = 'auth'
  else if (status === 404) reason = 'model'
  else if (status === 400 || status === 413 || status === 422) reason = 'request'
  else reason = 'other'
  return {
    reason,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    ...(resetAt ? { resetAt } : {})
  }
}

export function reasonAllowsFailover(reason: ModelFailureReason): boolean {
  return FAILOVER_REASONS.has(reason)
}

/**
 * Full route-pool metadata for one failure. `reason` is additive: `category`
 * keeps the pre-existing mapping so older consumers keep working.
 */
export function modelFailureMetadata(input: {
  status?: number
  providerCode?: string
  body?: string
  headers?: FailureHeaderSource
  responseReceived?: boolean
  now?: number
}): ModelFailureMetadata {
  const classification = classifyModelFailure(input)
  return {
    category: categoryForReason(classification.reason, input.status),
    reason: classification.reason,
    responseReceived: input.responseReceived ?? input.status !== undefined,
    ...(input.status !== undefined ? { httpStatus: input.status } : {}),
    ...(input.providerCode ? { providerCode: input.providerCode.slice(0, 128) } : {}),
    ...(classification.retryAfterMs !== undefined
      ? { retryAfterMs: classification.retryAfterMs }
      : {}),
    ...(classification.resetAt ? { resetAt: classification.resetAt } : {}),
    failoverAllowed: failoverAllowedFor(classification.reason, input.status)
  }
}

function categoryForReason(reason: ModelFailureReason, status?: number): ModelFailureCategory {
  switch (reason) {
    case 'credit':
    case 'quota':
      return 'quota'
    case 'rate':
      return 'rate_limit'
    case 'overloaded':
      return 'unavailable'
    case 'auth':
      return 'authentication'
    case 'model':
      return 'model_not_found'
    case 'request':
      return 'request'
    case 'other':
      if (status === 408) return 'timeout'
      if (status !== undefined && status >= 500) return 'unavailable'
      return 'unknown'
  }
}

function failoverAllowedFor(reason: ModelFailureReason, status?: number): boolean {
  if (FAILOVER_REASONS.has(reason)) return true
  if (status === undefined) return false
  return (
    status === 401 || status === 402 || status === 403 || status === 404 ||
    status === 408 || status === 425 || status === 429 || status >= 500
  )
}

/**
 * Same-target retry budget for a classified failure. Credit/quota failures
 * cannot succeed on retry; rate/overload failures retry at most once when the
 * caller has declared failover alternatives (waiting on the same target only
 * delays the switch the user asked for).
 */
export function httpRetryBudget(input: {
  reason: ModelFailureReason
  retryAfterMs?: number
  policy: { maxAttempts: number }
  alternatives?: number
}): { maxAttempts: number; fixedDelayMs?: number; delayCapMs?: number } {
  const policyMax = Math.max(0, input.policy.maxAttempts)
  const hasAlternatives = (input.alternatives ?? 0) > 0
  switch (input.reason) {
    case 'credit':
    case 'quota':
      return { maxAttempts: 0 }
    case 'rate':
      if (input.retryAfterMs !== undefined && input.retryAfterMs <= 20_000) {
        return { maxAttempts: Math.min(1, policyMax), fixedDelayMs: input.retryAfterMs }
      }
      return hasAlternatives ? { maxAttempts: 0 } : { maxAttempts: policyMax }
    case 'overloaded':
    case 'other':
      return hasAlternatives
        ? { maxAttempts: Math.min(1, policyMax), delayCapMs: 3_000 }
        : { maxAttempts: policyMax }
    default:
      return { maxAttempts: policyMax }
  }
}

/**
 * Route-pool circuit cooldown for a classified failure. Deterministic account
 * failures (credit/quota/auth) open the circuit on the first failure; transient
 * ones keep the existing consecutive-failure threshold.
 */
export function circuitCooldownMs(input: {
  reason?: ModelFailureReason
  resetAt?: string
  retryAfterMs?: number
  consecutiveFailures: number
  policy: {
    failureThreshold: number
    cooldownMs: number
    creditCooldownMs?: number
    quotaCooldownMs?: number
    authCooldownMs?: number
    maxCooldownMs?: number
  }
  now?: number
}): { open: boolean; durationMs: number } {
  const now = input.now ?? Date.now()
  const reason = input.reason ?? 'other'
  const deterministic =
    reason === 'credit' || reason === 'quota' || reason === 'rate' || reason === 'auth'
  const open = deterministic || input.consecutiveFailures >= input.policy.failureThreshold
  if (!open) return { open: false, durationMs: 0 }
  const resetDelayMs = input.resetAt !== undefined
    ? Math.max(0, Math.min(MAX_RESET_DELAY_MS, Date.parse(input.resetAt) - now))
    : undefined
  let durationMs: number
  switch (reason) {
    case 'credit':
      durationMs = input.policy.creditCooldownMs ?? 1_800_000
      break
    case 'quota':
      durationMs = resetDelayMs ?? input.policy.quotaCooldownMs ?? 900_000
      break
    case 'rate':
      durationMs = input.retryAfterMs ?? resetDelayMs ?? input.policy.cooldownMs
      break
    case 'auth':
      durationMs = input.policy.authCooldownMs ?? 1_800_000
      break
    default: {
      const maxCooldownMs = input.policy.maxCooldownMs ?? 600_000
      const exponent = Math.max(0, input.consecutiveFailures - input.policy.failureThreshold)
      durationMs = Math.min(maxCooldownMs, input.policy.cooldownMs * 2 ** exponent)
    }
  }
  durationMs = Math.max(durationMs, input.retryAfterMs ?? 0)
  return { open: true, durationMs: Math.min(MAX_RESET_DELAY_MS, durationMs) }
}

function resetInfoFromHeaders(
  headers: FailureHeaderSource,
  now: number
): { retryAfterMs?: number; resetAt?: string } {
  const get = headerGetter(headers)
  if (!get) return {}
  const retryAfterMs = retryAfterHeaderMs(get('retry-after'), now)
  let earliestReset: number | undefined
  forEachHeader(headers, (name, value) => {
    if (!/(?:rate.?limit|ratelimit).{0,24}reset/i.test(name)) return
    const resetMs = resetHeaderValueMs(value, now)
    if (resetMs === undefined) return
    const at = now + resetMs
    if (earliestReset === undefined || at < earliestReset) earliestReset = at
  })
  const retryDelay = earliestReset !== undefined ? earliestReset - now : retryAfterMs
  return {
    ...(retryDelay !== undefined ? { retryAfterMs: retryDelay } : {}),
    ...(earliestReset !== undefined
      ? { resetAt: new Date(earliestReset).toISOString() }
      : {})
  }
}

/** Retry-After / x-ratelimit-reset-*/ /anthropic-ratelimit-*-reset values. */
export function retryAfterHeaderMs(value: string | null | undefined, now = Date.now()): number | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  const numeric = Number(trimmed)
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.min(MAX_RESET_DELAY_MS, Math.round(numeric * 1_000))
  }
  const dateMs = Date.parse(trimmed)
  if (Number.isFinite(dateMs)) {
    return Math.min(MAX_RESET_DELAY_MS, Math.max(0, dateMs - now))
  }
  return undefined
}

/**
 * Reset header values arrive as unix seconds, RFC 3339 timestamps, or relative
 * durations (`20ms`, `1s`, `6m30s`, `1h`). Numbers near epoch magnitude are
 * treated as absolute instants; small numbers stay relative seconds.
 */
function resetHeaderValueMs(value: string, now: number): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const duration = parseDurationMs(trimmed)
  if (duration !== undefined) return Math.min(MAX_RESET_DELAY_MS, duration)
  const numeric = Number(trimmed)
  if (Number.isFinite(numeric) && numeric > 0) {
    if (numeric >= 1e12) return clampReset(numeric - now)
    if (numeric >= 1e9) return clampReset(numeric * 1_000 - now)
    return clampReset(numeric * 1_000)
  }
  const dateMs = Date.parse(trimmed)
  if (Number.isFinite(dateMs)) return clampReset(dateMs - now)
  return undefined
}

function parseDurationMs(value: string): number | undefined {
  if (!/^\d+(?:\.\d+)?(?:ms|s|m|h)(?:\d+(?:\.\d+)?(?:ms|s|m|h))*$/i.test(value)) {
    return undefined
  }
  let total = 0
  for (const match of value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/gi)) {
    const amount = Number(match[1])
    const unit = match[2].toLowerCase()
    total += amount * (unit === 'ms' ? 1 : unit === 's' ? 1_000 : unit === 'm' ? 60_000 : 3_600_000)
  }
  return total
}

function clampReset(ms: number): number | undefined {
  if (!Number.isFinite(ms) || ms < 0) return undefined
  return Math.min(MAX_RESET_DELAY_MS, Math.round(ms))
}

function headerGetter(headers: FailureHeaderSource): ((name: string) => string | null) | undefined {
  if (!headers) return undefined
  if (typeof (headers as Headers).get === 'function') {
    const h = headers as Headers
    return (name) => h.get(name)
  }
  if (Symbol.iterator in (headers as object)) {
    const map = new Map<string, string>()
    for (const [key, value] of headers as Iterable<readonly [string, string]>) {
      map.set(key.toLowerCase(), value)
    }
    return (name) => map.get(name.toLowerCase()) ?? null
  }
  const record = headers as Record<string, string | string[] | undefined>
  return (name) => {
    const found = Object.entries(record).find(([key]) => key.toLowerCase() === name)
    const value = found?.[1]
    return Array.isArray(value) ? value[0] ?? null : value ?? null
  }
}

function forEachHeader(
  headers: FailureHeaderSource,
  visit: (name: string, value: string) => void
): void {
  if (!headers) return
  if (typeof (headers as Headers).forEach === 'function') {
    ;(headers as Headers).forEach((value, name) => visit(name, value))
    return
  }
  if (Symbol.iterator in (headers as object)) {
    for (const [key, value] of headers as Iterable<readonly [string, string]>) visit(key, value)
    return
  }
  for (const [key, value] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (value === undefined) continue
    visit(key, Array.isArray(value) ? value.join(', ') : value)
  }
}
