import { describe, expect, it } from 'vitest'
import { shouldSuppressRuntimeErrorBanner } from './runtime-banner-visibility'

describe('shouldSuppressRuntimeErrorBanner', () => {
  it('suppresses the main error banner while Kun is auto-restarting or recovering', () => {
    expect(shouldSuppressRuntimeErrorBanner({
      state: 'degraded',
      source: 'watchdog',
      at: '2026-06-18T14:59:59.000Z'
    })).toBe(true)
    expect(shouldSuppressRuntimeErrorBanner({
      state: 'restarting',
      source: 'settings-apply',
      at: '2026-06-18T15:00:00.000Z'
    })).toBe(true)
    expect(shouldSuppressRuntimeErrorBanner({
      state: 'crashed',
      source: 'supervisor',
      at: '2026-06-18T15:00:01.000Z'
    })).toBe(true)
  })

  it('keeps terminal runtime failures visible as errors', () => {
    expect(shouldSuppressRuntimeErrorBanner({
      state: 'failed',
      source: 'supervisor',
      message: 'Kun keeps crashing.',
      at: '2026-06-18T15:01:00.000Z'
    })).toBe(false)
    expect(shouldSuppressRuntimeErrorBanner({
      state: 'stopped',
      source: 'supervisor',
      message: 'Auto-start disabled.',
      at: '2026-06-18T15:01:01.000Z'
    })).toBe(false)
  })
})
