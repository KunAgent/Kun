import { describe, expect, it } from 'vitest'
import { parseQuotaReminderPayload, quotaRemindersDisabled } from './quota-reminder-payload'

describe('quota reminder payload', () => {
  it('trims, strips control characters, bounds length and namespaces the key', () => {
    expect(parseQuotaReminderPayload({ title: '  Z.ai: renews\u0007 soon ', body: 'x'.repeat(400), dedupeKey: 'zai:five-hour:2030-01-01T12:00:00Z' }))
      .toEqual({ title: 'Z.ai: renews soon', body: 'x'.repeat(240), dedupeKey: 'quota:zai:five-hour:2030-01-01T12:00:00Z' })
  })
  it('rejects missing text and unsafe keys', () => {
    expect(() => parseQuotaReminderPayload({ title: '', body: 'b', dedupeKey: 'k' })).toThrow()
    expect(() => parseQuotaReminderPayload({ title: 't', body: 'b', dedupeKey: 'a b' })).toThrow()
    expect(() => parseQuotaReminderPayload(null)).toThrow()
  })
  it('is on unless the user turned it off', () => {
    expect(quotaRemindersDisabled({ notifications: { turnComplete: true } })).toBe(false)
    expect(quotaRemindersDisabled({ notifications: { turnComplete: true, quotaReminders: false } })).toBe(true)
  })
})
