export type InboundMessageIdentity = {
  channel: string
  accountId: string
  conversationId: string
  platformMessageId: string
}

export type InboundMessageIdentityInput = Partial<InboundMessageIdentity> & {
  channel?: unknown
  accountId?: unknown
  conversationId?: unknown
  platformMessageId?: unknown
}

const MAX_IDENTITY_PART_LENGTH = 256

/**
 * Normalize the provider-owned identity used for inbound webhook idempotency.
 * All four parts are required: a platform message id is not globally unique
 * across channels or bot accounts.
 */
export function normalizeInboundMessageIdentity(input: unknown): InboundMessageIdentity | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const value = input as InboundMessageIdentityInput
  const channel = normalizePart(value.channel, true)
  const accountId = normalizePart(value.accountId)
  const conversationId = normalizePart(value.conversationId)
  const platformMessageId = normalizePart(value.platformMessageId)
  if (!channel || !accountId || !conversationId || !platformMessageId) return null
  return { channel, accountId, conversationId, platformMessageId }
}

/**
 * JSON encoding keeps the dedupe key unambiguous even when an id contains
 * punctuation that would collide with a delimiter-based key.
 */
export function inboundMessageDedupeKey(identity: InboundMessageIdentity): string {
  const normalized = normalizeInboundMessageIdentity(identity)
  if (!normalized) throw new Error('invalid inbound message identity')
  return `im:${JSON.stringify([
    normalized.channel,
    normalized.accountId,
    normalized.conversationId,
    normalized.platformMessageId
  ])}`
}

function normalizePart(value: unknown, lowerCase = false): string | null {
  if (typeof value !== 'string') return null
  if ([...value].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)) return null
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > MAX_IDENTITY_PART_LENGTH) return null
  return lowerCase ? normalized.toLowerCase() : normalized
}
