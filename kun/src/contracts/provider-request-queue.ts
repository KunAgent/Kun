export const PROVIDER_QUEUE_PRIORITIES = ['interactive', 'scheduled', 'background'] as const
export type ProviderQueuePriority = typeof PROVIDER_QUEUE_PRIORITIES[number]

export type ProviderQueueKey = {
  providerId: string
  accountId?: string
}

export type ProviderQueuePolicy = {
  maxConcurrent: number
  maxQueued: number
}

export type ProviderQueueCapacity = {
  active: number
  queued: number
}

export type ProviderQueueAdmission =
  | { status: 'run'; reason: 'concurrency-available' }
  | { status: 'queue'; reason: 'concurrency-full' }
  | { status: 'reject'; reason: 'queue-full' | 'invalid' }

export type ProviderQueueValidationError =
  | 'not-an-object'
  | 'unknown-field'
  | 'invalid-provider-id'
  | 'invalid-account-id'
  | 'invalid-priority'
  | 'invalid-concurrency'
  | 'invalid-queue-size'
  | 'invalid-capacity'

const MAX_ID_LENGTH = 256
const MAX_CONCURRENT = 128
const MAX_QUEUED = 10_000

export function normalizeProviderQueueKey(input: unknown):
  | { ok: true; value: ProviderQueueKey }
  | { ok: false; error: ProviderQueueValidationError } {
  if (!isRecord(input)) return { ok: false, error: 'not-an-object' }
  if (!hasOnlyKeys(input, ['providerId', 'accountId'])) return { ok: false, error: 'unknown-field' }
  if (!isBoundedId(input.providerId)) return { ok: false, error: 'invalid-provider-id' }
  if (input.accountId !== undefined && !isBoundedId(input.accountId)) return { ok: false, error: 'invalid-account-id' }
  return { ok: true, value: { providerId: input.providerId, ...(input.accountId === undefined ? {} : { accountId: input.accountId }) } }
}

export function normalizeProviderQueuePolicy(input: unknown):
  | { ok: true; value: ProviderQueuePolicy }
  | { ok: false; error: ProviderQueueValidationError } {
  if (!isRecord(input)) return { ok: false, error: 'not-an-object' }
  if (!hasOnlyKeys(input, ['maxConcurrent', 'maxQueued'])) return { ok: false, error: 'unknown-field' }
  const maxConcurrent = input.maxConcurrent
  const maxQueued = input.maxQueued
  if (!isBoundedInteger(maxConcurrent, 1, MAX_CONCURRENT)) {
    return { ok: false, error: 'invalid-concurrency' }
  }
  if (!isBoundedInteger(maxQueued, 0, MAX_QUEUED)) {
    return { ok: false, error: 'invalid-queue-size' }
  }
  return { ok: true, value: { maxConcurrent, maxQueued } }
}

export function decideProviderQueueAdmission(
  policy: unknown,
  capacity: unknown,
  priority: unknown
): ProviderQueueAdmission {
  if (!isValidPolicy(policy) || !isValidCapacity(capacity) ||
      !PROVIDER_QUEUE_PRIORITIES.includes(priority as ProviderQueuePriority)) {
    return { status: 'reject', reason: 'invalid' }
  }
  if (capacity.active < policy.maxConcurrent) return { status: 'run', reason: 'concurrency-available' }
  if (capacity.queued < policy.maxQueued) return { status: 'queue', reason: 'concurrency-full' }
  return { status: 'reject', reason: 'queue-full' }
}

function isValidPolicy(value: unknown): value is ProviderQueuePolicy {
  return isRecord(value) && isBoundedInteger(value.maxConcurrent, 1, MAX_CONCURRENT) &&
    isBoundedInteger(value.maxQueued, 0, MAX_QUEUED)
}

function isValidCapacity(value: unknown): value is ProviderQueueCapacity {
  return isRecord(value) && isBoundedInteger(value.active, 0, Number.MAX_SAFE_INTEGER) &&
    isBoundedInteger(value.queued, 0, Number.MAX_SAFE_INTEGER)
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function isBoundedId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH && !hasControlCharacter(value)
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}
