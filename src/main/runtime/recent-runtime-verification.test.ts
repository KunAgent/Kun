import { afterEach, describe, expect, it } from 'vitest'
import {
  ENSURE_RUNTIME_VERIFIED_WINDOW_MS,
  forgetRecentRuntimeVerification,
  recentRuntimeVerification,
  rememberRuntimeVerification
} from './recent-runtime-verification'
import type { AppSettingsV1 } from '../../shared/app-settings'

const settings = { version: 1 } as unknown as AppSettingsV1

afterEach(() => forgetRecentRuntimeVerification())

describe('recent runtime verification window', () => {
  it('reuses a verified runtime only for the same fingerprint, generation, and window', () => {
    rememberRuntimeVerification({ fingerprint: 'a', generation: 3, settings }, 1_000)
    expect(recentRuntimeVerification('a', 3, 1_000 + ENSURE_RUNTIME_VERIFIED_WINDOW_MS - 1)).toBe(settings)
    expect(recentRuntimeVerification('a', 3, 1_000 + ENSURE_RUNTIME_VERIFIED_WINDOW_MS)).toBeNull()
    expect(recentRuntimeVerification('b', 3, 1_001)).toBeNull()
    expect(recentRuntimeVerification('a', 4, 1_001)).toBeNull()
  })

  it('forgets the verification after a connection failure or exit', () => {
    rememberRuntimeVerification({ fingerprint: 'a', generation: 0, settings }, 1_000)
    forgetRecentRuntimeVerification()
    expect(recentRuntimeVerification('a', 0, 1_001)).toBeNull()
  })
})
