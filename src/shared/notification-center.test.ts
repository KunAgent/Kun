import { describe, expect, it } from 'vitest'
import { isNotificationExpired, parseNotificationCenterRecord } from './notification-center'

const valid = {
  id: 'notice-1',
  kind: 'background-task',
  severity: 'success',
  title: 'Task complete',
  body: 'The background task finished.',
  occurredAt: '2026-07-14T00:00:00.000Z',
  dedupeKey: 'task:123',
  threadId: 'thread-1',
  expiresAt: '2026-07-15T00:00:00.000Z',
  action: { id: 'open-thread', label: 'Open thread', command: 'thread.open' }
}

describe('parseNotificationCenterRecord', () => {
  it('parses and normalizes a bounded notification record', () => {
    const result = parseNotificationCenterRecord(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.occurredAt).toBe('2026-07-14T00:00:00.000Z')
      expect(result.data.action?.command).toBe('thread.open')
    }
  })

  it('rejects unknown kinds and severities', () => {
    expect(parseNotificationCenterRecord({ ...valid, kind: 'unknown' }).success).toBe(false)
    expect(parseNotificationCenterRecord({ ...valid, severity: 'critical' }).success).toBe(false)
  })

  it('rejects invalid lifecycle timestamps', () => {
    expect(parseNotificationCenterRecord({ ...valid, expiresAt: valid.occurredAt }).success).toBe(false)
    expect(parseNotificationCenterRecord({ ...valid, readAt: '2026-07-13T00:00:00.000Z' }).success).toBe(false)
    expect(parseNotificationCenterRecord({ ...valid, occurredAt: '2026-07-14' }).success).toBe(false)
  })

  it('bounds text and rejects control characters while allowing body newlines', () => {
    expect(parseNotificationCenterRecord({ ...valid, title: ' x' }).success).toBe(false)
    expect(parseNotificationCenterRecord({ ...valid, body: 'line 1\nline 2' }).success).toBe(true)
    expect(parseNotificationCenterRecord({ ...valid, body: `bad\u0000` }).success).toBe(false)
    expect(parseNotificationCenterRecord({ ...valid, body: 'x'.repeat(2_001) }).success).toBe(false)
  })

  it('rejects malformed actions and unsafe command text', () => {
    expect(parseNotificationCenterRecord({ ...valid, action: [] }).success).toBe(false)
    expect(parseNotificationCenterRecord({ ...valid, action: { id: 'open', label: 'Open\n' } }).success).toBe(false)
    expect(parseNotificationCenterRecord({ ...valid, action: { id: 'open', label: 'Open', command: 'javascript:alert(1)' } }).success).toBe(false)
    expect(parseNotificationCenterRecord({ ...valid, action: { id: 'open', label: 'Open', command: 'thread.open' } }).success).toBe(true)
  })
})

describe('isNotificationExpired', () => {
  it('handles expiring and non-expiring notifications fail-closed', () => {
    const parsed = parseNotificationCenterRecord(valid)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(isNotificationExpired(parsed.data, Date.parse('2026-07-14T12:00:00.000Z'))).toBe(false)
      expect(isNotificationExpired(parsed.data, Date.parse('2026-07-15T00:00:00.000Z'))).toBe(true)
      expect(isNotificationExpired({ ...parsed.data, expiresAt: undefined }, Date.now())).toBe(false)
      expect(isNotificationExpired(parsed.data, Number.NaN)).toBe(false)
    }
  })
})
