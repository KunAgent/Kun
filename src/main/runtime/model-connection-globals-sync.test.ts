import { describe, expect, it } from 'vitest'
import { normalizeAppSettings, type AppSettingsV1 } from '../../shared/app-settings'
import { desiredModelConnectionGlobals, modelConnectionGlobalsDiffer } from './model-connection-globals-sync'

function settingsWithGateway(enabled: boolean) {
  const base = normalizeAppSettings({} as AppSettingsV1)
  return normalizeAppSettings({ ...base, provider: { ...base.provider, localGateway: { ...base.provider.localGateway, enabled } } })
}

describe('model-connection globals sync', () => {
  it('detects a gateway toggle the registry has not seen', () => {
    const before = desiredModelConnectionGlobals(settingsWithGateway(false))
    const snapshot = { revision: 3, ...before }
    expect(modelConnectionGlobalsDiffer(snapshot, before)).toBe(false)
    expect(modelConnectionGlobalsDiffer(snapshot, desiredModelConnectionGlobals(settingsWithGateway(true)))).toBe(true)
  })

  it('ignores key order differences in registry snapshots', () => {
    const desired = desiredModelConnectionGlobals(settingsWithGateway(true))
    const reordered = {
      revision: 1,
      localModelGateway: { exposeProviderModels: desired.localModelGateway.exposeProviderModels, enabled: true },
      failover: desired.failover,
      routePools: desired.routePools,
      proxy: desired.proxy
    }
    expect(modelConnectionGlobalsDiffer(reordered, desired)).toBe(false)
  })
})
