import { describe, expect, it } from 'vitest'
import type { ChatState } from './chat-store-types'
import { captureAdeDraftSendSnapshot } from './chat-store-ade-send-snapshot'
import { resolveDirectSendComposerSelection } from './chat-store-send-composer-selection'

function draftState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    route: 'ade', activeThreadId: null, adeDraftOpen: true, adeDraftRevision: 1, workspaceRoot: '/repo',
    composerIsolation: 'local', composerModel: 'deepseek-chat',
    composerProviderId: 'deepseek', composerModelGroups: [{
      providerId: 'deepseek', label: 'DeepSeek', modelIds: ['deepseek-chat'], accountId: 'account-1'
    }],
    composerHarnessId: '', composerCredentialMode: '', composerExecutionSettings: null,
    clawChannels: [], activeClawChannelId: '',
    ...overrides
  } as ChatState
}

describe('ADE first-send composer selection', () => {
  it('keeps the Kun manager selection submitted before async store changes', () => {
    const original = draftState()
    const adeDraft = captureAdeDraftSendSnapshot(original)
    const later = draftState({
      composerHarnessId: 'claude-code', composerCredentialMode: 'native-login',
      composerModel: 'opus', composerProviderId: ''
    })
    const selection = resolveDirectSendComposerSelection({
      state: later, queued: undefined, overrides: undefined, adeEligible: true, adeDraft
    })
    expect(selection).toEqual({
      composerModel: 'deepseek-chat', composerProviderId: 'deepseek',
      composerAccountId: 'account-1', composerHarnessId: '', composerCredentialMode: ''
    })
  })

  it('keeps a one-on-one harness, credential, provider, and model together', () => {
    const original = draftState({
      composerHarnessId: 'claude-code', composerCredentialMode: 'provider',
      composerModel: 'claude-sonnet', composerProviderId: 'anthropic',
      composerModelGroups: [{
        providerId: 'anthropic', label: 'Anthropic', modelIds: ['claude-sonnet'], accountId: 'account-2'
      }]
    })
    const adeDraft = captureAdeDraftSendSnapshot(original)
    const selection = resolveDirectSendComposerSelection({
      state: draftState(), queued: undefined, overrides: undefined, adeEligible: true, adeDraft
    })
    expect(selection).toEqual({
      composerModel: 'claude-sonnet', composerProviderId: 'anthropic',
      composerAccountId: 'account-2', composerHarnessId: 'claude-code', composerCredentialMode: 'provider'
    })
  })
})
