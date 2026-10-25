import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultKunRuntimeSettings, type AppSettingsV1 } from '@shared/app-settings'
import { KunRuntimeProvider } from './kun-runtime'
import { rendererRuntimeClient } from './runtime-client'

vi.mock('../lib/harness-native-agent', () => ({ harnessAgentRequestField: () => ({ harnessAgentId: 'main-only-agent' }) }))
vi.mock('../lib/harness-session-settings', () => ({ harnessSettingsRequestField: () => ({ harnessSettings: { mode: 'main-only' } }) }))
afterEach(() => vi.restoreAllMocks())

describe('branch runtime routing', () => {
  it('does not attach main-composer native overrides to branch turns', async () => {
    vi.spyOn(rendererRuntimeClient, 'getSettings').mockResolvedValue({ agents: { kun: defaultKunRuntimeSettings() } } as AppSettingsV1)
    const request = vi.spyOn(rendererRuntimeClient, 'runtimeRequest').mockResolvedValue({ ok: true, status: 202,
      body: JSON.stringify({ threadId: 'branch', turnId: 'turn' }) })
    const provider = new KunRuntimeProvider()
    await provider.sendUserMessage('branch', 'review', { harnessId: 'codex', inheritHarnessPreferences: false,
      model: 'native', credentialMode: 'native-login', approvalPolicy: 'always', sandboxMode: 'read-only', approvalReviewer: 'user' })
    const body = JSON.parse(request.mock.calls[0][2]!)
    expect(body).toMatchObject({ harnessId: 'codex', model: 'native', credentialMode: 'native-login', approvalPolicy: 'always', sandboxMode: 'read-only' })
    expect(body).not.toHaveProperty('harnessAgentId')
    expect(body).not.toHaveProperty('harnessSettings')
    expect(body).not.toHaveProperty('inheritHarnessPreferences')
    await provider.sendUserMessage('main', 'continue', { harnessId: 'codex' })
    expect(JSON.parse(request.mock.calls[1][2]!)).toMatchObject({ harnessAgentId: 'main-only-agent', harnessSettings: { mode: 'main-only' } })
  })
})
