import { describe, expect, it } from 'vitest'
import {
  KUN_CONTEXT_COMPACTION_DEFAULTS_VERSION,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  mergeKunRuntimeSettings,
  migrateKunContextCompactionDefaults,
  normalizeAppSettings,
  type AppSettingsV1,
  type KunContextCompactionSettingsV1
} from './app-settings'

function settingsWithCompaction(
  contextCompaction: Partial<KunContextCompactionSettingsV1>
): AppSettingsV1 {
  const runtime = defaultKunRuntimeSettings()
  return {
    version: 1,
    provider: defaultModelProviderSettings(),
    agents: {
      kun: {
        ...runtime,
        contextCompaction: {
          ...runtime.contextCompaction,
          ...contextCompaction
        }
      }
    }
  } as AppSettingsV1
}

describe('Kun context compaction default migrations', () => {
  it.each([
    { soft: 16_000, hard: 24_000 },
    { soft: 96_000, hard: 108_800 }
  ])('upgrades the markerless legacy $soft/$hard defaults', ({ soft, hard }) => {
    const input = settingsWithCompaction({
      defaultSoftThreshold: soft,
      defaultHardThreshold: hard
    })
    delete input.agents.kun.contextCompaction.defaultsVersion
    const migrated = migrateKunContextCompactionDefaults(input.agents.kun.contextCompaction)
    expect(migrated).toMatchObject({
      defaultSoftThreshold: 192_000,
      defaultHardThreshold: 217_600
    })
    expect(mergeKunRuntimeSettings(defaultKunRuntimeSettings(), {
      contextCompaction: migrated
    }).contextCompaction).toMatchObject({
      defaultSoftThreshold: 192_000,
      defaultHardThreshold: 217_600
    })

    const normalized = normalizeAppSettings(input)

    expect(normalized.agents.kun.contextCompaction).toMatchObject({
      defaultsVersion: KUN_CONTEXT_COMPACTION_DEFAULTS_VERSION,
      defaultSoftThreshold: 192_000,
      defaultHardThreshold: 217_600
    })
  })

  it('preserves an intentional low threshold after the defaults migration is recorded', () => {
    const normalized = normalizeAppSettings(settingsWithCompaction({
      defaultsVersion: KUN_CONTEXT_COMPACTION_DEFAULTS_VERSION,
      defaultSoftThreshold: 16_000,
      defaultHardThreshold: 24_000
    }))

    expect(normalized.agents.kun.contextCompaction).toMatchObject({
      defaultsVersion: KUN_CONTEXT_COMPACTION_DEFAULTS_VERSION,
      defaultSoftThreshold: 16_000,
      defaultHardThreshold: 24_000
    })
  })
})

describe('Kun context compaction window mode toggle', () => {
  it('normalizes missing or non-boolean window mode to disabled', () => {
    const missing = normalizeAppSettings(settingsWithCompaction({}))
    expect(missing.agents.kun.contextCompaction.windowModeEnabled).toBe(false)

    const illegal = normalizeAppSettings(settingsWithCompaction({
      windowModeEnabled: 'yes' as unknown as boolean
    }))
    expect(illegal.agents.kun.contextCompaction.windowModeEnabled).toBe(false)
  })

  it('round-trips the toggle without touching summary parameters', () => {
    const enabled = normalizeAppSettings(settingsWithCompaction({ windowModeEnabled: true }))
    const compaction = enabled.agents.kun.contextCompaction
    expect(compaction.windowModeEnabled).toBe(true)
    expect(compaction.summaryMode).toBe('model')
    expect(compaction.summaryTimeoutMs).toBe(15_000)
    expect(compaction.summaryMaxTokens).toBe(2_048)
    expect(compaction.summaryInputMaxBytes).toBe(96 * 1024)
    expect(compaction.defaultSoftThreshold).toBe(192_000)
    expect(compaction.defaultHardThreshold).toBe(217_600)

    const merged = mergeKunRuntimeSettings(defaultKunRuntimeSettings(), {
      contextCompaction: { windowModeEnabled: true }
    })
    expect(merged.contextCompaction.windowModeEnabled).toBe(true)
    expect(merged.contextCompaction.summaryMaxTokens).toBe(2_048)

    const disabled = normalizeAppSettings(settingsWithCompaction({ windowModeEnabled: false }))
    expect(disabled.agents.kun.contextCompaction.windowModeEnabled).toBe(false)
  })
})
