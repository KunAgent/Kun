import { describe, expect, it } from 'vitest'
import { formatInTimeZone, isValidTimeZone, relativeScheduleLabel, zonedDateTimeToIso } from './zoned-date-time'

describe('zoned date time', () => {
  it('converts wall clock values without using the system zone', () => {
    expect(zonedDateTimeToIso('2030-01-02', '09:30', 'Asia/Shanghai', 0)).toEqual({
      ok: true,
      iso: '2030-01-02T01:30:00.000Z'
    })
    expect(zonedDateTimeToIso('2030-01-02', '09:30', 'UTC', 0)).toEqual({
      ok: true,
      iso: '2030-01-02T09:30:00.000Z'
    })
  })

  it('rejects invalid, missing, repeated, and past local times', () => {
    expect(isValidTimeZone('Not/AZone')).toBe(false)
    expect(zonedDateTimeToIso('2030-03-10', '02:30', 'America/New_York', 0)).toMatchObject({
      ok: false,
      code: 'nonexistent-time'
    })
    expect(zonedDateTimeToIso('2030-11-03', '01:30', 'America/New_York', 0)).toMatchObject({
      ok: false,
      code: 'ambiguous-time'
    })
    expect(zonedDateTimeToIso('2020-01-01', '00:00', 'UTC')).toMatchObject({
      ok: false,
      code: 'past-time'
    })
  })

  it('formats with the explicit zone', () => {
    expect(formatInTimeZone('2030-01-02T01:30:00.000Z', 'Asia/Shanghai', 'en-CA')).toContain('9:30')
  })

  it('formats relative schedule labels in the requested locale', () => {
    const now = Date.UTC(2030, 0, 2, 1)
    expect(relativeScheduleLabel('2030-01-02T01:01:00.000Z', now)).toBe('in 1 minute')
    expect(relativeScheduleLabel('2030-01-02T01:01:00.000Z', now, 'en')).toBe('in 1 minute')
    expect(relativeScheduleLabel('2030-01-02T04:00:00.000Z', now, 'en')).toBe('in 3 hours')
    expect(relativeScheduleLabel('2030-01-02T01:01:00.000Z', now, 'zh')).toBe('1分钟后')
    expect(relativeScheduleLabel('2030-01-02T04:00:00.000Z', now, 'zh')).toBe('3小时后')
  })
})
