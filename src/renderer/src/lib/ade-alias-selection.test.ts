import { describe, expect, it } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { ChatState } from '../store/chat-store-types'
import { adeHarnessModelGroups, credentialGroupFromKey } from './ade-composer-harness'
import { captureCodeDraftComposer } from '../store/chat-store-ade-send-snapshot'
import { composerSelectionNeedsProvider, resolveDirectSendComposerSelection } from '../store/chat-store-send-composer-selection'
import { normalizeQueuedMessageRegistry } from '../store/queued-message-persistence'

const binding = { main: { routeId: 'coding', allowedConnectionIds: ['one'] } }
describe('typed Agent alias selection', () => {
  it('shows an approved alias without creating an HTTP provider identity', () => {
    const profile = { harnessId: 'codex', credentialMode: 'kun-gateway', gatewayBinding: binding }
    const row = { definition: { id: 'codex', credentialModes: ['kun-gateway'] }, enabled: true,
      status: { installed: 'yes' }, enabledProfiles: [profile], readyProfiles: [{ ...profile, expiresAt: new Date(Date.now() + 60000).toISOString() }]
    } as unknown as AdeHarnessRow
    const groups = adeHarnessModelGroups({ row, models: [], hasConfiguredProvider: false,
      aliasGroups: [{ routeId: 'coding', modelId: 'route/coding', label: 'Coding', connectionIds: ['one', 'two'] }],
      labels: { nativeLogin: 'Native', provider: 'Provider', kunGateway: 'Gateway' } })
    expect(groups).toHaveLength(1)
    const picked = credentialGroupFromKey(groups[0].providerId)
    expect(picked).toEqual({ mode: 'kun-gateway', gatewayBinding: binding })
    expect(picked?.providerId).toBeUndefined()
  })
  it('freezes the visible alias scope through drafts and queued sends and drops an unrelated account', () => {
    const state = { route: 'chat', activeThreadId: null, clawChannels: [], activeClawChannelId: null, composerModel: 'route/coding', composerProviderId: 'unrelated',
      composerModelGroups: [], composerHarnessId: 'codex', composerCredentialMode: 'kun-gateway',
      composerGatewayBinding: structuredClone(binding) } as unknown as ChatState
    const captured = captureCodeDraftComposer(state)!
    state.composerGatewayBinding!.main.allowedConnectionIds.push('later-account')
    const selected = resolveDirectSendComposerSelection({ state, queued: undefined, overrides: undefined,
      adeEligible: true, adeDraft: undefined, codeDraftComposer: captured })
    expect(selected).toMatchObject({ composerProviderId: '', composerAccountId: '', composerGatewayBinding: binding })
    expect(composerSelectionNeedsProvider(selected)).toBe(false)
    const persisted = normalizeQueuedMessageRegistry({ version: 1, threads: { thread: { updatedAt: new Date().toISOString(), messages: [{
      id: 'message', text: 'hello', model: selected.composerModel, harnessId: 'codex', credentialMode: 'kun-gateway', gatewayBinding: selected.composerGatewayBinding
    }] } } })
    expect(persisted.threads.thread.messages[0].gatewayBinding).toEqual(binding)
    const queued = resolveDirectSendComposerSelection({ state, queued: persisted.threads.thread.messages[0], overrides: undefined, adeEligible: true, adeDraft: undefined })
    expect(queued.composerGatewayBinding).toEqual(binding)
  })
})
