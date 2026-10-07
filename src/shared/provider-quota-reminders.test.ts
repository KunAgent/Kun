import { describe, expect, it } from 'vitest'
import { nextQuotaReminderAt, quotaReminderText, quotaResetReminders, shortQuotaWindow } from './provider-quota-reminders'

describe('quota reset reminders', () => {
  const now = Date.parse('2026-10-06T10:00:00Z')
  it('flags windows renewing soon with much left, and nothing else', () => {
    expect(quotaResetReminders([
      { id: 'week', label: 'Weekly', unit: 'percent', usedPercent: 30, resetsAt: '2026-10-06T13:00:00Z' },
      { id: 'five-hour', label: '5h', unit: 'percent', usedPercent: 90, resetsAt: '2026-10-06T11:00:00Z' },
      { id: 'month', label: 'Monthly', unit: 'percent', usedPercent: 10, resetsAt: '2026-10-20T00:00:00Z' },
      { id: 'balance', label: 'Balance', unit: 'USD', remaining: 5 }
    ], now)).toEqual([{ metricId: 'week', label: 'Weekly', unusedPercent: 70, hoursLeft: 3 }])
  })
  it('never reminds about windows that renew within a day, however much is left', () => {
    const soon = '2026-10-06T12:00:00Z'
    expect(quotaResetReminders([
      { id: 'five-hour', label: '5-hour usage', unit: 'percent', usedPercent: 0, resetsAt: soon, windowSeconds: 18_000 },
      { id: 'primary', label: '5h usage', unit: 'percent', usedPercent: 0, resetsAt: soon, windowSeconds: 18_000 },
      { id: 'rate-limit-0', label: '5-hour rate limit', unit: 'requests', usedPercent: 0, resetsAt: soon },
      { id: 'interval-0', label: 'MiniMax-M2 interval quota', unit: 'requests', usedPercent: 0, resetsAt: soon },
      { id: 'secondary', label: 'Weekly usage window', unit: 'percent', usedPercent: 0, resetsAt: soon, windowSeconds: 604_800 }
    ], now).map((reminder) => reminder.metricId)).toEqual(['secondary'])
    expect(shortQuotaWindow({ id: 'seven-day', label: '7-day usage' })).toBe(false)
    expect(shortQuotaWindow({ id: 'monthly', label: 'Monthly requests' })).toBe(false)
  })
  it('knows when a long window next enters the reminder period', () => {
    expect(nextQuotaReminderAt([
      { id: 'five-hour', label: '5-hour usage', unit: 'percent', usedPercent: 5, resetsAt: '2026-10-06T12:00:00Z', windowSeconds: 18_000 },
      { id: 'week', label: 'Weekly', unit: 'percent', usedPercent: 5, resetsAt: '2026-10-08T10:00:00Z' },
      { id: 'month', label: 'Monthly', unit: 'percent', usedPercent: 5, resetsAt: '2026-10-07T10:00:00Z' }
    ], now)).toBe(Date.parse('2026-10-07T04:00:00Z'))
    expect(nextQuotaReminderAt([{ id: 'balance', label: 'Balance', unit: 'USD', remaining: 1 }], now)).toBeUndefined()
  })
  it('writes the notification in the app language', () => {
    const reminder = { metricId: 'week', label: 'Weekly', unusedPercent: 70, hoursLeft: 3 }
    expect(quotaReminderText('zh', 'Claude', reminder)).toEqual({ title: 'Claude：额度即将重置', body: 'Weekly 还有 70% 未用，约 3 小时后重置。' })
    expect(quotaReminderText(undefined, 'Claude', reminder).body).toBe('70% of Weekly is unused and renews in about 3h.')
  })
})
