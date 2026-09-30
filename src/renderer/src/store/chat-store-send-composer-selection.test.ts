import { describe, expect, it } from 'vitest'
import type { ChatState } from './chat-store-types'
import { captureAdeDraftSendSnapshot } from './chat-store-ade-send-snapshot'
import { composerSelectionNeedsProvider, resolveDirectSendComposerSelection } from './chat-store-send-composer-selection'

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

  it('does not infer an HTTP provider or account for a native-login model with the same id', () => {
    const state = draftState({ composerHarnessId: 'codex', composerCredentialMode: 'native-login',
      composerModel: 'shared-model', composerProviderId: '', composerModelGroups: [
        { providerId: 'http-account', label: 'HTTP', modelIds: ['shared-model'], accountId: 'account-2' }
      ] })
    const selection = resolveDirectSendComposerSelection({
      state, queued: undefined, overrides: undefined, adeEligible: true, adeDraft: undefined
    })
    expect(selection).toMatchObject({ composerModel: 'shared-model', composerHarnessId: 'codex',
      composerCredentialMode: 'native-login', composerProviderId: '', composerAccountId: '' })
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
  it('requires an explicit source for a provider-backed external Agent instead of inferring HTTP by model', () => {
    const state = draftState({ composerHarnessId: 'cursor', composerCredentialMode: 'provider', composerProviderId: '' })
    const selection = resolveDirectSendComposerSelection({ state, queued: undefined, overrides: undefined, adeEligible: true, adeDraft: undefined })
    expect(selection.composerProviderId).toBe('')
    expect(composerSelectionNeedsProvider(selection)).toBe(true)
  })

  it('blocks a cleared explicit Kun choice instead of inheriting a previous native Agent model', () => {
    const state = draftState({ composerHarnessId: 'kun', composerCredentialMode: '', composerProviderId: '', composerModel: '' })
    const selection = resolveDirectSendComposerSelection({ state, queued: undefined, overrides: undefined, adeEligible: true, adeDraft: undefined })
    expect(composerSelectionNeedsProvider(selection)).toBe(true)
  })

  it('keeps an unpinned queued Code route independent of a later native Agent choice', () => {
    const state = draftState({ composerHarnessId: 'codex', composerCredentialMode: 'native-login', composerProviderId: '', composerModel: 'native' })
    const queued = { id: 'old-queue', text: 'queued', model: 'deepseek-chat', providerId: 'deepseek' }
    const selection = resolveDirectSendComposerSelection({ state, queued, overrides: undefined, adeEligible: true, adeDraft: undefined })
    expect(selection).toMatchObject({ composerModel: 'deepseek-chat', composerProviderId: 'deepseek', composerHarnessId: '', composerCredentialMode: '' })
  })

  it('lets a legacy Agent route with no credential mode use its host-defined default', () => {
    expect(composerSelectionNeedsProvider({ composerHarnessId: 'codex', composerCredentialMode: '',
      composerProviderId: '', composerModel: 'native-model', composerAccountId: '' })).toBe(false)
  })

  it('preserves omitted native defaults in an old queue instead of borrowing the new composer route', () => {
    const queued = { id: 'old-native', text: 'queued', harnessId: 'codex' }
    const selection = resolveDirectSendComposerSelection({ state: draftState(), queued,
      overrides: undefined, adeEligible: true, adeDraft: undefined })
    expect(selection).toEqual({ composerHarnessId: 'codex', composerCredentialMode: '', composerModel: '',
      composerProviderId: '', composerAccountId: '' })
  })

})
