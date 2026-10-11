import { describe, expect, it, vi } from 'vitest'
import type { ProviderQuotaListResult } from '../../shared/provider-quota'
import { ProviderQuotaReminderService } from './provider-quota-reminder-service'

const now = Date.parse('2030-01-01T10:00:00Z')
const list = (metrics: unknown[], providerName = 'Z.ai'): ProviderQuotaListResult => ({ refreshedAt: 'x',
  entries: [{ providerId: 'zai coding', providerName, status: 'available', metrics }, { providerId: 'down', providerName: 'Down', status: 'error', metrics: [] }] } as never)

function harness(settings: { locale?: string; notifications: { turnComplete: boolean; quotaReminders?: boolean } } = { locale: 'en', notifications: { turnComplete: true } }) {
  const timers: Array<{ ms: number; run: () => void; cancelled: boolean }> = []
  const show = vi.fn(async () => ({ ok: true }))
  const fetchList = vi.fn(async () => list([]))
  const service = new ProviderQuotaReminderService({ list: fetchList, show, settings: async () => settings as never, now: () => now,
    setTimer: (run, ms) => { const timer = { ms, run, cancelled: false }; timers.push(timer); return { cancel: () => { timer.cancelled = true } } } })
  return { service, show, fetchList, timers, live: () => timers.filter((timer) => !timer.cancelled) }
}

describe('provider quota reminder service', () => {
  it('reminds once per long window from lists the app fetched anyway, in the app language', async () => {
    const h = harness({ locale: 'zh', notifications: { turnComplete: true } })
    const sent = await h.service.observe(list([
      { id: 'five-hour', label: '5-hour usage', unit: 'percent', usedPercent: 0, resetsAt: '2030-01-01T12:00:00Z', windowSeconds: 18_000 },
      { id: 'week', label: 'Weekly', unit: 'percent', usedPercent: 10, resetsAt: '2030-01-01T12:00:00Z', windowSeconds: 604_800 }]))
    expect(sent).toBe(1)
    expect(h.show).toHaveBeenCalledWith({ title: 'Z.ai：额度即将重置', body: 'Weekly 还有 90% 未用，约 2 小时后重置。', dedupeKey: 'zai_coding:week:2030-01-01T12:00:00Z' })
    expect(h.fetchList).not.toHaveBeenCalled()
  })
  it('asks the runtime itself only when a window is about to enter the reminder period', async () => {
    const h = harness()
    h.service.start()
    expect(h.live().map((timer) => timer.ms)).toEqual([5 * 60_000])
    await h.service.observe(list([{ id: 'month', label: 'Monthly', unit: 'percent', usedPercent: 10, resetsAt: '2030-01-03T10:00:00Z' }]))
    // Reset in 48h, reminder period 6h: the next own check is 42h away, capped at 12h.
    expect(h.live().map((timer) => timer.ms)).toEqual([12 * 3_600_000])
    await h.service.observe(list([{ id: 'month', label: 'Monthly', unit: 'percent', usedPercent: 10, resetsAt: '2030-01-01T17:00:00Z' }]))
    expect(h.live().map((timer) => timer.ms)).toEqual([60 * 60_000])
    h.live()[0]!.run()
    await vi.waitFor(() => expect(h.fetchList).toHaveBeenCalledTimes(1))
    h.service.stop()
    expect(h.live()).toEqual([])
  })
  it('stays quiet when the user turned reminders off, but keeps its schedule', async () => {
    const h = harness({ locale: 'en', notifications: { turnComplete: true, quotaReminders: false } })
    h.service.start()
    expect(await h.service.observe(list([{ id: 'week', label: 'Weekly', unit: 'percent', usedPercent: 0, resetsAt: '2030-01-01T12:00:00Z' }]))).toBe(0)
    expect(h.show).not.toHaveBeenCalled()
  })
})
