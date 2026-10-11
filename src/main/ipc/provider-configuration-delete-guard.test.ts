import { describe, expect, it, vi } from 'vitest'
import { normalizeAppSettings, defaultKunRuntimeSettings, defaultModelProviderSettings, defaultScheduleSettings, normalizeScheduledTask, type AppSettingsV1, type ModelProviderProfileV1 } from '../../shared/app-settings'
import { ProviderConfigurationDeleteGuard } from './provider-configuration-delete-guard'
const profile: ModelProviderProfileV1 = { id: 'one', name: 'One', apiKey: '', baseUrl: 'https://one.test', endpointFormat: 'chat_completions', useProxy: false, models: ['coding'], modelProfiles: {} }
function settings(providerId: string) {
  const input: Pick<AppSettingsV1, 'provider' | 'agents' | 'schedule'> = { provider: { ...defaultModelProviderSettings(), providers: [profile] },
    agents: { kun: { ...defaultKunRuntimeSettings(), providerId: '' } },
    schedule: { ...defaultScheduleSettings(), providerId, tasks: [normalizeScheduledTask({ id: 'task', title: 'Nightly', providerId }, 0, '2026-10-06T00:00:00.000Z')] } }
  return normalizeAppSettings(input as AppSettingsV1)
}
const preview = { path: '/v1/provider-config/transactions/preview', method: 'POST', body: JSON.stringify({ operations: [{ kind: 'remove-connection', connectionId: 'one' }] }) }
describe('provider configuration deletion authority in Main', () => {
  it('rejects deleting a provider used by scheduled tasks before forwarding to Runtime', async () => {
    const send = vi.fn()
    await expect(new ProviderConfigurationDeleteGuard().run(preview, async () => settings('one'), send)).rejects.toThrow('Nightly')
    expect(send).not.toHaveBeenCalled()
  })
  it('rechecks authoritative settings when a task is added after preview', async () => {
    const guard = new ProviderConfigurationDeleteGuard()
    const response = { ok: true, status: 200, body: JSON.stringify({ previewId: 'preview', expiresAt: new Date(Date.now() + 600_000).toISOString() }) }
    await guard.run(preview, async () => settings('other'), async () => response)
    const send = vi.fn()
    await expect(guard.run({ path: '/v1/provider-config/transactions/commit', method: 'POST', body: JSON.stringify({ previewId: 'preview' }) },
      async () => settings('one'), send)).rejects.toThrow('Nightly')
    expect(send).not.toHaveBeenCalled()
  })
  it('rejects commit cache misses and verifies ordinary previews in the same app session', async () => {
    const guard = new ProviderConfigurationDeleteGuard(), send = vi.fn()
    const commit = { path: '/v1/provider-config/transactions/commit', method: 'POST', body: JSON.stringify({ previewId: 'ordinary' }) }
    await expect(guard.run(commit, async () => settings('other'), send)).rejects.toThrow('review the changes again')
    expect(send).not.toHaveBeenCalled()
    await guard.run({ ...preview, body: JSON.stringify({ operations: [{ kind: 'put-group' }] }) }, async () => settings('other'),
      async () => ({ ok: true, status: 200, body: JSON.stringify({ previewId: 'ordinary', expiresAt: new Date(Date.now() + 600_000).toISOString() }) }))
    const response = { ok: true, status: 200, body: '{}' }
    await expect(guard.run(commit, async () => settings('other'), async () => response)).resolves.toEqual(response)
  })

})
