import { describe, expect, it } from 'vitest'
import {
  KUN_PROMPT_OPTIMIZATION_DEFAULTS_VERSION,
  defaultKunRuntimeSettings,
  getKunRuntimeSettings,
  mergeKunRuntimeSettings,
  type AppSettingsV1
} from './app-settings'

function storedWith(promptOptimization: Record<string, unknown>): AppSettingsV1 {
  return { agents: { kun: { promptOptimization } } } as unknown as AppSettingsV1
}

const legacyRecord = { enabled: false, providerId: '', model: '', prompt: '', timeoutMs: 60_000 }

describe('prompt optimization defaults', () => {
  it('shows the composer button by default', () => {
    expect(defaultKunRuntimeSettings().promptOptimization).toMatchObject({
      enabled: true, defaultsVersion: KUN_PROMPT_OPTIMIZATION_DEFAULTS_VERSION
    })
  })

  it('turns the button on once for a record stored with the old default', () => {
    expect(getKunRuntimeSettings(storedWith(legacyRecord)).promptOptimization).toMatchObject({
      enabled: true, timeoutMs: 60_000, defaultsVersion: KUN_PROMPT_OPTIMIZATION_DEFAULTS_VERSION
    })
  })

  it('keeps an explicit off after the migration', () => {
    const stored = storedWith({ ...legacyRecord, defaultsVersion: KUN_PROMPT_OPTIMIZATION_DEFAULTS_VERSION })
    expect(getKunRuntimeSettings(stored).promptOptimization.enabled).toBe(false)
  })

  it('applies partial patches without re-running the migration', () => {
    const current = defaultKunRuntimeSettings()
    const off = mergeKunRuntimeSettings(current, { promptOptimization: { enabled: false } })
    expect(off.promptOptimization.enabled).toBe(false)
    const retimed = mergeKunRuntimeSettings(off, { promptOptimization: { timeoutMs: 30_000, prompt: 'x' } })
    expect(retimed.promptOptimization).toMatchObject({ enabled: false, timeoutMs: 30_000 })
  })
})
