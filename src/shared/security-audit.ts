export const SECURITY_AUDIT_KINDS = [
  'permission-approved',
  'permission-denied',
  'external-path-access',
  'network-access-approved',
  'credential-revealed',
  'extension-installed',
  'extension-permission-changed',
  'diagnostic-exported',
  'config-migrated'
] as const
export type SecurityAuditKind = typeof SECURITY_AUDIT_KINDS[number]

export const SECURITY_AUDIT_RISKS = ['low', 'medium', 'high', 'critical'] as const
export type SecurityAuditRisk = typeof SECURITY_AUDIT_RISKS[number]

export type SecurityAuditRecord = {
  eventId: string
  kind: SecurityAuditKind
  risk: SecurityAuditRisk
  occurredAt: string
  summary: string
  threadId?: string
  turnId?: string
  metadata: Record<string, string | number | boolean>
}

export type SecurityAuditValidationError =
  | 'not-an-object'
  | 'unknown-field'
  | 'invalid-id'
  | 'invalid-kind'
  | 'invalid-risk'
  | 'invalid-time'
  | 'invalid-summary'
  | 'invalid-scope-id'
  | 'invalid-metadata'

export type SecurityAuditValidation =
  | { ok: true; value: SecurityAuditRecord }
  | { ok: false; error: SecurityAuditValidationError }

const MAX_ID_LENGTH = 256
const MAX_SUMMARY_LENGTH = 500
const MAX_METADATA_ENTRIES = 32
const MAX_METADATA_VALUE_LENGTH = 500

export function normalizeSecurityAuditRecord(input: unknown): SecurityAuditValidation {
  if (!isRecord(input)) return { ok: false, error: 'not-an-object' }
  if (!hasOnlyKeys(input, ['eventId', 'kind', 'risk', 'occurredAt', 'summary', 'threadId', 'turnId', 'metadata'])) {
    return { ok: false, error: 'unknown-field' }
  }
  if (!isBoundedText(input.eventId, MAX_ID_LENGTH)) return { ok: false, error: 'invalid-id' }
  if (!SECURITY_AUDIT_KINDS.includes(input.kind as SecurityAuditKind)) return { ok: false, error: 'invalid-kind' }
  if (!SECURITY_AUDIT_RISKS.includes(input.risk as SecurityAuditRisk)) return { ok: false, error: 'invalid-risk' }
  if (typeof input.occurredAt !== 'string' || !Number.isFinite(Date.parse(input.occurredAt))) return { ok: false, error: 'invalid-time' }
  if (!isBoundedText(input.summary, MAX_SUMMARY_LENGTH)) return { ok: false, error: 'invalid-summary' }
  if (input.threadId !== undefined && !isBoundedText(input.threadId, MAX_ID_LENGTH)) return { ok: false, error: 'invalid-scope-id' }
  if (input.turnId !== undefined && !isBoundedText(input.turnId, MAX_ID_LENGTH)) return { ok: false, error: 'invalid-scope-id' }
  const metadata = normalizeMetadata(input.metadata)
  if (!metadata.ok) return metadata
  return {
    ok: true,
    value: {
      eventId: input.eventId,
      kind: input.kind as SecurityAuditKind,
      risk: input.risk as SecurityAuditRisk,
      occurredAt: new Date(input.occurredAt).toISOString(),
      summary: redactAuditText(input.summary),
      ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
      ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
      metadata: metadata.value
    }
  }
}

function normalizeMetadata(input: unknown):
  | { ok: true; value: Record<string, string | number | boolean> }
  | { ok: false; error: SecurityAuditValidationError } {
  if (input === undefined) return { ok: true, value: {} }
  if (!isRecord(input)) return { ok: false, error: 'invalid-metadata' }
  const entries = Object.entries(input)
  if (entries.length > MAX_METADATA_ENTRIES) return { ok: false, error: 'invalid-metadata' }
  const result: Record<string, string | number | boolean> = {}
  for (const [key, value] of entries) {
    if (!isBoundedText(key, 100) || /(?:api[_-]?key|token|secret|password|authorization|cookie)/i.test(key)) {
      return { ok: false, error: 'invalid-metadata' }
    }
    if (typeof value === 'string') {
      if (!isBoundedText(value, MAX_METADATA_VALUE_LENGTH)) return { ok: false, error: 'invalid-metadata' }
      result[key] = redactAuditText(value)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      if (typeof value === 'number' && !Number.isFinite(value)) return { ok: false, error: 'invalid-metadata' }
      result[key] = value
    } else {
      return { ok: false, error: 'invalid-metadata' }
    }
  }
  return { ok: true, value: result }
}

export function redactAuditText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/(api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, (_match, key: string) => `${key}=[REDACTED]`)
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && !hasControlCharacter(value)
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}
