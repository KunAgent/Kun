import { describe, expect, it } from 'vitest'
import { settingsPatchSchema } from './app-ipc-schemas/settings'
import { applySettingsPatchToSnapshot, defaultSettings } from '../settings-store-foundation'
import { adeConfigForRuntime } from '../runtime/kun-runtime-model-config'
import { RuntimeConfigApplyRequest } from '../../../kun/src/contracts/runtime-config'
import { KunConfigSchema } from '../../../kun/src/config/kun-config'

const projectDefaults = {
  '/repo/source': {
    route: { harnessId: 'kun', model: 'deepseek-chat', providerId: 'deepseek', credentialMode: 'provider' },
    collaborationEnabled: true,
    managerModel: { providerId: 'deepseek', model: 'deepseek-chat' },
    limits: { softWorkers: 2, hardWorkers: 4 },
    budget: { softTokens: 1_000, hardTokens: 2_000 },
    isolation: 'worktree'
  }
}
const patch = (value: unknown) => ({ agents: { kun: { ade: { projectDefaults: value } } } })

describe('project defaults across settings and runtime configuration boundaries', () => {
  it('preserves allowed project overrides through ordinary IPC, normalization, hot apply and persisted Kun config', () => {
    const accepted = settingsPatchSchema.parse(patch(projectDefaults))
    const normalized = applySettingsPatchToSnapshot(defaultSettings(), {
      agents: { kun: { ade: { projectDefaults: accepted.agents?.kun?.ade?.projectDefaults } } }
    })
    expect(normalized.agents.kun.ade.projectDefaults).toEqual(projectDefaults)
    const ade = adeConfigForRuntime(normalized.agents.kun.ade)
    expect(RuntimeConfigApplyRequest.parse({ ade }).ade?.projectDefaults).toEqual(projectDefaults)
    expect(KunConfigSchema.parse(JSON.parse(JSON.stringify({ ade }))).ade?.projectDefaults).toEqual(projectDefaults)
  })

  it.each([
    { token: 'secret' },
    { binaryPath: '/private/agent' },
    { arbitrary: 'field' },
    { route: { harnessId: 'kun', model: 'model', providerId: 'provider', apiKey: 'secret' } },
    { route: { harnessId: 'kun', model: 'model', providerId: 'provider', baseUrl: 'https://example.test' } },
    { managerModel: { providerId: 'provider', model: 'model', secretEnv: [] } }
  ])('rejects unknown and secret fields at every strict boundary: %j', (value) => {
    const bad = { '/repo': value }
    expect(settingsPatchSchema.safeParse(patch(bad)).success).toBe(false)
    expect(RuntimeConfigApplyRequest.safeParse({ ade: { projectDefaults: bad } }).success).toBe(false)
    expect(KunConfigSchema.safeParse({ ade: { projectDefaults: bad } }).success).toBe(false)
  })

  it('bounds project map size and rejects incompatible credential pairs at the IPC boundary', () => {
    const tooMany = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`/repo/${index}`, {}]))
    expect(settingsPatchSchema.safeParse(patch(tooMany)).success).toBe(false)
    expect(RuntimeConfigApplyRequest.safeParse({ ade: { projectDefaults: tooMany } }).success).toBe(false)
    expect(settingsPatchSchema.safeParse(patch({ '/repo': {
      route: { harnessId: 'codex', model: 'gpt-5', credentialMode: 'native-login', providerId: 'secret-provider' }
    } })).success).toBe(false)
  })
})
