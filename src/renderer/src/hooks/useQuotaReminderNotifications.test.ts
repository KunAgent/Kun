import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { sendQuotaReminders } from './useQuotaReminderNotifications'

beforeEach(async () => { await i18n.changeLanguage('en') })

describe('quota reminder notifications', () => {
  it('sends one localized reminder per window about to renew with much unused, keyed by its reset time', async () => {
    const now = Date.parse('2030-01-01T10:00:00Z')
    const show = vi.fn(async () => ({ ok: true }))
    const sent = await sendQuotaReminders({ refreshedAt: 'x', entries: [
      { providerId: 'zai coding', providerName: 'Z.ai', status: 'available', metrics: [
        { id: 'five-hour', label: '5-hour window', unit: 'percent', usedPercent: 20, resetsAt: '2030-01-01T12:00:00Z' },
        { id: 'week', label: 'Weekly', unit: 'percent', usedPercent: 90, resetsAt: '2030-01-01T12:00:00Z' },
        { id: 'month', label: 'Monthly', unit: 'percent', usedPercent: 0, resetsAt: '2030-02-01T00:00:00Z' }] },
      { providerId: 'down', providerName: 'Down', status: 'error', metrics: [] }
    ] } as never, now, show)
    expect(sent).toBe(1)
    expect(show).toHaveBeenCalledWith({ title: 'Z.ai: allowance renews soon',
      body: '80% of 5-hour window is unused and renews in about 2h.', dedupeKey: 'zai_coding:five-hour:2030-01-01T12:00:00Z' })
  })
})
