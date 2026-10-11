import { approvalChoiceKey, type ApprovalChoice } from '../contracts/approval-choice.js'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const KUN_APPROVAL_CONSENT_HEADER = 'x-kun-approval-consent'
const APPROVAL_CONSENT_VERSION = 'v1'
const MAX_APPROVAL_CONSENT_LIFETIME_MS = 60_000
const MAX_USED_CONSENTS = 1_024

export function createApprovalConsentToken(input: {
  runtimeToken: string
  approvalId: string
  decision: 'allow' | 'deny'
  choice?: ApprovalChoice
  expiresAt: number
  nonce?: string
}): string {
  const nonce = input.nonce ?? randomBytes(24).toString('base64url')
  const signature = createHmac('sha256', input.runtimeToken)
    .update(approvalConsentPayload(input.approvalId, input.decision, input.expiresAt, nonce, input.choice))
    .digest('base64url')
  return [APPROVAL_CONSENT_VERSION, input.expiresAt, nonce, signature].join('.')
}

export class ApprovalConsentVerifier {
  private readonly used = new Map<string, number>()

  constructor(
    private readonly runtimeToken: string,
    private readonly now: () => number = Date.now
  ) {}

  verifyAndConsume(input: {
    token: string | null
    approvalId: string
    decision: 'allow' | 'deny'
    choice?: ApprovalChoice
  }): boolean {
    const parsed = parseToken(input.token)
    if (!parsed || !this.runtimeToken) return false
    const now = this.now()
    this.prune(now)
    if (parsed.expiresAt <= now || parsed.expiresAt > now + MAX_APPROVAL_CONSENT_LIFETIME_MS) return false
    const expected = createHmac('sha256', this.runtimeToken)
      .update(approvalConsentPayload(input.approvalId, input.decision, parsed.expiresAt, parsed.nonce, input.choice))
      .digest()
    let actual: Buffer
    try {
      actual = Buffer.from(parsed.signature, 'base64url')
    } catch {
      return false
    }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false
    const digest = createHash('sha256').update(input.token!).digest('hex')
    if (this.used.has(digest)) return false
    // Never evict an unexpired entry to make room: doing so would make an old
    // token replayable during a high-rate approval burst. Fail closed until an
    // entry expires instead.
    if (this.used.size >= MAX_USED_CONSENTS) return false
    this.used.set(digest, parsed.expiresAt)
    return true
  }

  private prune(now: number): void {
    for (const [digest, expiresAt] of this.used) {
      if (expiresAt <= now) this.used.delete(digest)
    }
  }
}

function parseToken(value: string | null): {
  expiresAt: number
  nonce: string
  signature: string
} | undefined {
  if (!value || value.length > 512) return undefined
  const [version, expiresRaw, nonce, signature, extra] = value.split('.')
  const expiresAt = Number(expiresRaw)
  if (
    version !== APPROVAL_CONSENT_VERSION ||
    extra !== undefined ||
    !Number.isSafeInteger(expiresAt) ||
    !nonce || !/^[A-Za-z0-9_-]{32}$/.test(nonce) ||
    !signature || !/^[A-Za-z0-9_-]{43}$/.test(signature)
  ) return undefined
  return { expiresAt, nonce, signature }
}

function approvalConsentPayload(
  approvalId: string,
  decision: 'allow' | 'deny',
  expiresAt: number,
  nonce: string,
  choice?: ApprovalChoice
): string {
  return `${APPROVAL_CONSENT_VERSION}\n${approvalId}\n${decision}\n${expiresAt}\n${nonce}${choice ? `\n${approvalChoiceKey(choice)}` : ''}`
}
