import { describe, expect, it } from 'vitest'
import { normalizeSecurityAuditRecord, redactAuditText } from './security-audit'

describe('security audit contract', () => {
  it('normalizes scoped records and redacts credential-like values', () => {
    expect(normalizeSecurityAuditRecord({
      eventId: 'evt-1',
      kind: 'permission-approved',
      risk: 'high',
      occurredAt: '2026-07-14T00:00:00Z',
      summary: 'token: abc123 approved',
      threadId: 'thread-1',
      metadata: { tool: 'shell', count: 1 }
    })).toEqual({
      ok: true,
      value: {
        eventId: 'evt-1',
        kind: 'permission-approved',
        risk: 'high',
        occurredAt: '2026-07-14T00:00:00.000Z',
        summary: 'token=[REDACTED] approved',
        threadId: 'thread-1',
        metadata: { tool: 'shell', count: 1 }
      }
    })
  })

  it('rejects raw credential fields and non-scalar metadata', () => {
    expect(normalizeSecurityAuditRecord({
      eventId: 'evt', kind: 'credential-revealed', risk: 'critical',
      occurredAt: '2026-07-14T00:00:00Z', summary: 'credential',
      metadata: { apiKey: 'should-not-be-stored' }
    })).toEqual({ ok: false, error: 'invalid-metadata' })
    expect(normalizeSecurityAuditRecord({
      eventId: 'evt', kind: 'credential-revealed', risk: 'critical',
      occurredAt: '2026-07-14T00:00:00Z', summary: 'credential', metadata: { data: {} }
    })).toEqual({ ok: false, error: 'invalid-metadata' })
  })

  it.each([
    [{ eventId: 'e', kind: 'unknown', risk: 'low', occurredAt: '2026-07-14', summary: 'x' }, 'invalid-kind'],
    [{ eventId: 'e', kind: 'permission-denied', risk: 'unknown', occurredAt: '2026-07-14', summary: 'x' }, 'invalid-risk'],
    [{ eventId: 'e', kind: 'permission-denied', risk: 'low', occurredAt: 'not-a-date', summary: 'x' }, 'invalid-time'],
    [{ eventId: 'e', kind: 'permission-denied', risk: 'low', occurredAt: '2026-07-14', summary: '' }, 'invalid-summary'],
    [{ eventId: 'e', kind: 'permission-denied', risk: 'low', occurredAt: '2026-07-14', summary: 'x', extra: true }, 'unknown-field']
  ])('rejects malformed records %#', (input, error) => {
    expect(normalizeSecurityAuditRecord(input)).toEqual({ ok: false, error })
  })

  it('redacts bearer, key-value, and sk-style secrets without changing normal text', () => {
    expect(redactAuditText('Bearer abc.def token=secret sk-123456789012')).toBe('Bearer [REDACTED] token=[REDACTED] [REDACTED]')
    expect(redactAuditText('permission approved')).toBe('permission approved')
  })
})
