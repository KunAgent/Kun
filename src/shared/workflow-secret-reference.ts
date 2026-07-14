/**
 * A workflow may refer to a credential without persisting the credential
 * material itself. This contract is deliberately small so runtime resolution
 * can be added independently without changing the persisted workflow shape.
 */
export type WorkflowSecretReference = {
  credentialSourceId: string
  accountId?: string
  secretName?: string
}

const MAX_REFERENCE_PART_LENGTH = 256
const ALLOWED_KEYS = new Set(['credentialSourceId', 'accountId', 'secretName'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f)) return true
  }
  return false
}

function normalizePart(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (containsControlCharacter(value)) return undefined
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_REFERENCE_PART_LENGTH) return undefined
  return normalized
}

/**
 * Parses an untrusted value into a reference-only shape.
 *
 * Unknown keys are rejected intentionally: accepting a future `value` or
 * `token` field here would make it too easy to persist a secret accidentally.
 */
export function parseWorkflowSecretReference(value: unknown): WorkflowSecretReference | null {
  if (!isRecord(value)) return null
  if (Object.keys(value).some((key) => !ALLOWED_KEYS.has(key))) return null

  const credentialSourceId = normalizePart(value.credentialSourceId)
  if (!credentialSourceId) return null

  const accountId = value.accountId === undefined ? undefined : normalizePart(value.accountId)
  if (value.accountId !== undefined && !accountId) return null

  const secretName = value.secretName === undefined ? undefined : normalizePart(value.secretName)
  if (value.secretName !== undefined && !secretName) return null

  return {
    credentialSourceId,
    ...(accountId ? { accountId } : {}),
    ...(secretName ? { secretName } : {})
  }
}
