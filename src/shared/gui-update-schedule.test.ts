import { describe, expect, it } from 'vitest'
import {
  failureBackoffMs,
  GUI_UPDATE_DAILY_CHECK_INTERVAL_MS,
  GUI_UPDATE_MIN_BACKGROUND_DELAY_MS,
  nextGuiUpdateCheckDelay,
  normalizeGuiUpdateScheduleState,
  scheduleStateAfterFailure,
  scheduleStateAfterSuccess
} from './gui-update-schedule'

describe('GUI update schedule', () => {
  const now = Date.UTC(2026, 4, 26, 12, 0, 0)

  it('checks immediately only when there is no prior schedule state', () => {
    expect(nextGuiUpdateCheckDelay(null, now)).toBe(0)
    expect(nextGuiUpdateCheckDelay({}, now)).toBe(0)
  })

  it('waits for the daily interval after a successful check', () => {
    const lastSuccessAt = now - 3_600_000
    expect(nextGuiUpdateCheckDelay({ lastSuccessAt }, now)).toBe(
      GUI_UPDATE_DAILY_CHECK_INTERVAL_MS - 3_600_000
    )
  })

  it('clamps overdue checks to a non-zero background delay', () => {
    expect(nextGuiUpdateCheckDelay({ lastSuccessAt: now - 48 * 3_600_000 }, now)).toBe(
      GUI_UPDATE_MIN_BACKGROUND_DELAY_MS
    )
  })

  it('migrates the legacy lastCheckedAt field to lastSuccessAt', () => {
    expect(normalizeGuiUpdateScheduleState({ lastCheckedAt: new Date(now).toISOString() })).toEqual({
      lastSuccessAt: now
    })
  })

  it('uses jittered, capped failure backoff and preserves the last success', () => {
    expect(failureBackoffMs(1, () => 0)).toBe(4 * 60 * 1000)
    expect(failureBackoffMs(2, () => 0.5)).toBe(15 * 60 * 1000)
    expect(failureBackoffMs(3, () => 1)).toBe(72 * 60 * 1000)
    expect(failureBackoffMs(10, () => 0.5)).toBe(6 * 60 * 60 * 1000)

    const failed = scheduleStateAfterFailure({ lastSuccessAt: now - 1 }, now, () => 0.5)
    expect(failed).toMatchObject({
      lastAttemptAt: now,
      lastSuccessAt: now - 1,
      consecutiveFailures: 1,
      nextRetryAt: now + 5 * 60 * 1000
    })
  })

  it('resets failures only after a successful check', () => {
    expect(scheduleStateAfterSuccess({ consecutiveFailures: 3, nextRetryAt: now }, now)).toEqual({
      consecutiveFailures: 0,
      lastAttemptAt: now,
      lastSuccessAt: now,
      nextRetryAt: null
    })
  })
})
