import { describe, expect, it } from 'vitest'
import { ApprovalConsentVerifier } from '../../kun/src/server/approval-consent.js'
import { createApprovalConsentToken } from './approval-consent'

describe('protected Kun approval consent', () => {
  it('binds the exact provider option and cannot upgrade once to always', () => {
    const token = createApprovalConsentToken({ runtimeToken: 'secret', approvalId: 'approval',
      decision: 'allow', choice: { optionId: 'once' }, expiresAt: 40_000 })
    const verifier = new ApprovalConsentVerifier('secret', () => 10_000)
    expect(verifier.verifyAndConsume({ token, approvalId: 'approval', decision: 'allow' })).toBe(false)
    expect(verifier.verifyAndConsume({ token, approvalId: 'approval', decision: 'allow', choice: { optionId: 'always' } })).toBe(false)
    expect(verifier.verifyAndConsume({ token, approvalId: 'approval', decision: 'allow', choice: { optionId: 'once' } })).toBe(true)
  })
  it('is action-bound, short-lived, and one-shot across Main and Kun', () => {
    const now = 10_000
    const token = createApprovalConsentToken({
      runtimeToken: 'runtime-secret',
      approvalId: 'approval-1',
      decision: 'allow',
      expiresAt: now + 30_000
    })
    const verifier = new ApprovalConsentVerifier('runtime-secret', () => now)
    expect(verifier.verifyAndConsume({
      token,
      approvalId: 'approval-1',
      decision: 'deny'
    })).toBe(false)
    expect(verifier.verifyAndConsume({
      token,
      approvalId: 'approval-2',
      decision: 'allow'
    })).toBe(false)
    expect(verifier.verifyAndConsume({
      token,
      approvalId: 'approval-1',
      decision: 'allow'
    })).toBe(true)
    expect(verifier.verifyAndConsume({
      token,
      approvalId: 'approval-1',
      decision: 'allow'
    })).toBe(false)
  })

  it('rejects expired or excessively long-lived tokens', () => {
    const now = 50_000
    const verifier = new ApprovalConsentVerifier('runtime-secret', () => now)
    for (const expiresAt of [now, now + 60_001]) {
      const token = createApprovalConsentToken({
        runtimeToken: 'runtime-secret',
        approvalId: 'approval-1',
        decision: 'allow',
        expiresAt
      })
      expect(verifier.verifyAndConsume({
        token,
        approvalId: 'approval-1',
        decision: 'allow'
      })).toBe(false)
    }
  })
})
