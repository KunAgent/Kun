import { describe, expect, it } from 'vitest'
import { MAX_RETENTION_DAYS, normalizeDataRetentionPolicy, shouldRetainByAge } from './data-retention'

describe('data retention contract', () => {
  it('normalizes per-category days and supports null as keep forever', () => {
    expect(normalizeDataRetentionPolicy({ logs: 7, attachments: null })).toEqual({
      ok: true,
      value: { logs: 7, attachments: null }
    })
  })

  it('retains recent data and removes only data older than its category policy', () => {
    const day = 24 * 60 * 60 * 1_000
    const policy = { logs: 7, attachments: null }
    expect(shouldRetainByAge(policy, 'logs', 10 * day, 16 * day)).toBe(true)
    expect(shouldRetainByAge(policy, 'logs', 1 * day, 16 * day)).toBe(false)
    expect(shouldRetainByAge(policy, 'attachments', 0, 100 * day)).toBe(true)
  })

  it('keeps future or invalid timestamps rather than deleting conservatively', () => {
    expect(shouldRetainByAge({ logs: 1 }, 'logs', 2_000, 1_000)).toBe(true)
    expect(shouldRetainByAge({ logs: 1 }, 'logs', Number.NaN, 1_000)).toBe(true)
  })

  it.each([
    [{ unknown: 7 }, 'unknown-category'],
    [{ logs: 0 }, 'invalid-days'],
    [{ logs: MAX_RETENTION_DAYS + 1 }, 'invalid-days'],
    [{ logs: 1.5 }, 'invalid-days'],
    [{}, 'empty-policy']
  ])('rejects unsafe policies %#', (input, error) => {
    expect(normalizeDataRetentionPolicy(input)).toEqual({ ok: false, error })
  })

  it('rejects arrays and keeps unknown categories out of age checks', () => {
    expect(normalizeDataRetentionPolicy([])).toEqual({ ok: false, error: 'not-an-object' })
    expect(shouldRetainByAge({ logs: 1 }, 'diagnostics', 0, 100 * 24 * 60 * 60 * 1_000)).toBe(true)
    expect(shouldRetainByAge({ logs: -1 }, 'logs', 0, 100 * 24 * 60 * 60 * 1_000)).toBe(true)
    expect(shouldRetainByAge(null, 'logs', 0, 100 * 24 * 60 * 60 * 1_000)).toBe(true)
  })
})
