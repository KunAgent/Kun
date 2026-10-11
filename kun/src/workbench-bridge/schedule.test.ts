import { describe, expect, it } from 'vitest'
import { firstScheduleAt, nextRecurringAt } from './schedule.js'

describe('workbench schedules', () => {
  it('rejects single runs outside the permitted window', () => {
    const now = Date.UTC(2026, 8, 29, 0)
    expect(() => firstScheduleAt({ kind: 'once', runAt: new Date(now + 30_000).toISOString(), timeZone: 'UTC' }, now))
      .toThrow('1 minute')
    expect(firstScheduleAt({ kind: 'once', runAt: new Date(now + 120_000).toISOString(), timeZone: 'UTC' }, now))
      .toBe(new Date(now + 120_000).toISOString())
  })

  it('skips weekends and observes the selected time zone', () => {
    const schedule = { kind: 'recurring' as const, every: 'weekday' as const, time: '09:00', timeZone: 'Asia/Shanghai' }
    expect(nextRecurringAt(schedule, Date.parse('2026-09-25T02:00:00Z'))).toBe('2026-09-28T01:00:00.000Z')
  })

  it('skips a nonexistent DST wall time and chooses the first repeated hour', () => {
    const gap = { kind: 'recurring' as const, every: 'day' as const, time: '02:30', timeZone: 'America/New_York' }
    expect(nextRecurringAt(gap, Date.parse('2026-03-08T05:00:00Z'))).toBe('2026-03-09T06:30:00.000Z')
    const repeated = { ...gap, time: '01:30' }
    expect(nextRecurringAt(repeated, Date.parse('2026-11-01T04:00:00Z'))).toBe('2026-11-01T05:30:00.000Z')
    expect(nextRecurringAt(repeated, Date.parse('2026-11-01T05:31:00Z'))).toBe('2026-11-02T06:30:00.000Z')
  })
})
