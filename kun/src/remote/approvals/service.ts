import { createHash, randomBytes } from 'node:crypto'
import { canonical } from '@kun/remote-protocol'
import {
  createApprovalConsentToken,
  KUN_APPROVAL_CONSENT_HEADER
} from '../../server/approval-consent.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { type LocalCall } from '../runtime/local-call.js'
import { allowedThread } from '../authorization/thread-access.js'
import type { RemoteScope } from '../contracts.js'
import type { ApprovalChoice } from '../../contracts/approval-choice.js'
type Challenge = {
  scope: string
  approvalId: string
  hash: string
  expiresAt: number
}
export class RemoteApprovals {
  private challenges = new Map<string, Challenge>()
  constructor(
    private runtime: ServerRuntime,
    private call: LocalCall
  ) {}
  private fingerprint(value: unknown) {
    return createHash('sha256')
      .update(canonical(JSON.parse(JSON.stringify(value))))
      .digest('hex')
  }
  async prepare(scope: RemoteScope, id: string) {
    const approval = this.runtime.approvalGate.get(id)
    if (!approval || approval.status !== 'pending')
      throw new Error('APPROVAL_EXPIRED')
    await allowedThread(this.runtime, approval.threadId)
    for (const [key, c] of this.challenges)
      if (c.expiresAt <= Date.now()) this.challenges.delete(key)
    if (this.challenges.size >= 256) throw new Error('BACKPRESSURE')
    const challenge = randomBytes(32).toString('hex'),
      expiresAt = Date.now() + 60000
    this.challenges.set(challenge, {
      scope:
        scope.accountId + ':' + scope.deviceId + ':' + scope.authorizationId,
      approvalId: id,
      hash: this.fingerprint(approval),
      expiresAt
    })
    return { challenge, expiresAt, approval }
  }
  async resolve(
    scope: RemoteScope,
    p: {
      approvalId: string
      challenge: string
      decision: 'allow' | 'deny'
      choice?: unknown
    }
  ) {
    const c = this.challenges.get(p.challenge),
      approval = this.runtime.approvalGate.get(p.approvalId)
    if (
      !c ||
      c.scope !==
        scope.accountId + ':' + scope.deviceId + ':' + scope.authorizationId ||
      c.approvalId !== p.approvalId ||
      c.expiresAt <= Date.now() ||
      !approval ||
      approval.status !== 'pending' ||
      c.hash !== this.fingerprint(approval)
    )
      throw new Error('APPROVAL_EXPIRED')
    this.challenges.delete(p.challenge)
    await allowedThread(this.runtime, approval.threadId)
    const choice = p.choice as ApprovalChoice | undefined
    const token = createApprovalConsentToken({
      runtimeToken: this.runtime.runtimeToken,
      approvalId: p.approvalId,
      decision: p.decision,
      choice,
      expiresAt: Math.min(c.expiresAt, Date.now() + 30000)
    })
    return this.call(
      '/v1/approvals/' + encodeURIComponent(p.approvalId),
      'POST',
      { decision: p.decision, ...(choice ? { choice } : {}) },
      { [KUN_APPROVAL_CONSENT_HEADER]: token }
    )
  }
}
