import { describe, expect, it } from 'vitest'
import { applyKunRuntimePatch, defaultKunRuntimeSettings, mergeKunRuntimeSettings, normalizeAppSettings, type AppSettingsV1 } from './app-settings'
import { KunConfigSchema } from '../../kun/src/config/kun-config'
import { buildManagedRuntimeHotApplyBody } from '../main/runtime/kun-runtime-config-service'
import { settingsPatchSchema } from '../main/ipc/app-ipc-schemas/settings'
import { runtimeSettingsApplyMode } from '../main/runtime-settings-apply-mode'

describe('Memory relation annotations opt-in', () => {
  it('survives the Electron settings IPC boundary and triggers hot apply', () => {
    const before = normalizeAppSettings({} as AppSettingsV1)
    const parsed = settingsPatchSchema.parse({ agents: { kun: { memoryRelationContextEnabled: true } } })
    expect(parsed.agents?.kun?.memoryRelationContextEnabled).toBe(true)
    const after = applyKunRuntimePatch(before, {
      memoryRelationContextEnabled: parsed.agents?.kun?.memoryRelationContextEnabled
    })
    expect(runtimeSettingsApplyMode(before, after)).toBe('hot')
    expect(buildManagedRuntimeHotApplyBody(after, KunConfigSchema.parse({})).capabilities?.memory?.relationContextEnabled).toBe(true)
    expect(settingsPatchSchema.safeParse({ agents: { kun: { memoryRelationContextEnabled: 'true' } } }).success).toBe(false)
  })
  it('normalizes missing or non-boolean settings to off and preserves explicit choices', () => {
    const defaults = defaultKunRuntimeSettings()
    expect(defaults.memoryRelationContextEnabled).toBe(false)
    expect(mergeKunRuntimeSettings({ ...defaults, memoryRelationContextEnabled: undefined } as unknown as typeof defaults, undefined)
      .memoryRelationContextEnabled).toBe(false)
    expect(mergeKunRuntimeSettings(defaults, { memoryRelationContextEnabled: true }).memoryRelationContextEnabled).toBe(true)
    expect(mergeKunRuntimeSettings({ ...defaults, memoryRelationContextEnabled: true }, { memoryRelationContextEnabled: false })
      .memoryRelationContextEnabled).toBe(false)
  })

  it.each([false, true])('hot applies the explicit opt-in %s without overriding master Memory', (enabled) => {
    const settings = normalizeAppSettings({
      agents: { kun: { ...defaultKunRuntimeSettings(), memoryEnabled: false, memoryRelationContextEnabled: enabled } }
    } as AppSettingsV1)
    const config = KunConfigSchema.parse({})
    expect(buildManagedRuntimeHotApplyBody(settings, config).capabilities?.memory)
      .toMatchObject({ enabled: false, relationContextEnabled: enabled })
  })
})
