import { describe, expect, it } from 'vitest'
import { quotaResetReminders } from './provider-quota-reminders'

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
})
