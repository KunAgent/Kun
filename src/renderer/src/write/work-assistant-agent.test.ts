import { describe, expect, it } from 'vitest'
import type { ChatState } from '../store/chat-store-types'
import { workAssistantHarnessId, workAssistantThreadRoute, workAssistantUsesExternalAgent } from './work-assistant-agent'

function state(overrides: Partial<ChatState> = {}): ChatState {
  return {
    route: 'write', activeThreadId: null, threads: [], workspaceRoot: '/space',
    composerModel: 'deepseek-chat', composerProviderId: 'deepseek',
    composerModelGroups: [{ providerId: 'deepseek', label: 'DeepSeek', modelIds: ['deepseek-chat'] }],
    composerHarnessId: '', composerCredentialMode: '', clawChannels: [], activeClawChannelId: '',
    ...overrides
  } as ChatState
}

describe('Work assistant Agent', () => {
  it('is Kun unless the composer or the session picks another Agent', () => {
    expect(workAssistantHarnessId(state())).toBe('kun')
    expect(workAssistantUsesExternalAgent(state())).toBe(false)
    expect(workAssistantHarnessId(state({ composerHarnessId: 'codex' }))).toBe('codex')
    const pinned = state({ activeThreadId: 'thr_1', threads: [{ id: 'thr_1', harnessId: 'claude-code' } as never] })
    expect(workAssistantHarnessId(pinned)).toBe('claude-code')
    expect(workAssistantUsesExternalAgent(pinned)).toBe(true)
    // The composer's explicit pick wins over the session pin, as in Code.
    expect(workAssistantHarnessId({ ...pinned, composerHarnessId: 'kun' })).toBe('kun')
  })

  it('starts a new session with the composer choice: Kun model, or the external Agent route', () => {
    expect(workAssistantThreadRoute(state())).toEqual({ model: 'deepseek-chat', providerId: 'deepseek' })
    expect(workAssistantThreadRoute(state({ composerHarnessId: 'kun' })))
      .toEqual({ harnessId: 'kun', model: 'deepseek-chat', providerId: 'deepseek' })
    expect(workAssistantThreadRoute(state({ composerHarnessId: 'codex', composerCredentialMode: 'native-login',
      composerModel: 'gpt-5.5-codex', composerProviderId: '' }))).toEqual({
      harnessId: 'codex', credentialMode: 'native-login', model: 'gpt-5.5-codex', providerId: 'default'
    })
  })
})
