import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentProvider } from '../agent/types'
import type { ChatState, SideConversation } from './chat-store-types'
import { createSideActions, teardownAllSideSubscriptions } from './chat-store-side-actions'
import { defaultSideAgentConfig, mergeSideComposerConfig } from './side-composer-config'

function harness() {
  const state = {
    activeThreadId: 'main', runtimeConnection: 'ready', workspaceRoot: '/repo',
    threads: [{ id: 'main', model: 'm', title: 'Main', harnessId: 'kun' }],
    composerHarnessId: 'kun', composerCredentialMode: '', composerModel: 'm',
    composerProviderId: 'api', composerModelGroups: [], composerFastMode: false,
    composerExecutionSettings: { approvalPolicy: 'on-request', sandboxMode: 'workspace-write', approvalReviewer: 'user' },
    sideConversations: {}, sidePanel: { open: false, activeSideId: null }, unreadThreadIds: {}
  } as unknown as ChatState
  let id = 0
  const send = vi.fn(async (_threadId: string, _text: string, _options?: Parameters<AgentProvider['sendUserMessage']>[2]) => ({ threadId: 'side', turnId: 'turn' }))
  const fork = vi.fn(async () => ({ id: `side-${++id}`, title: 'Side' }))
  const provider = {
    forkThread: fork, sendUserMessage: send, subscribeThreadEvents: vi.fn(),
    getThreadDetail: vi.fn(async () => ({ blocks: [], latestSeq: 0 }))
  } as unknown as AgentProvider
  const actions = createSideActions({
    get: () => state, set: (update) => Object.assign(state, typeof update === 'function' ? update(state) : update),
    getProvider: () => provider, t: (key) => key,
    formatRuntimeError: (e) => String(e), shouldOpenSettingsForError: () => false
  })
  return { state, actions, send, fork }
}
afterEach(() => teardownAllSideSubscriptions())

describe('branch configuration isolation', () => {
  it('snapshots parent permissions without subscribing to later global changes', () => {
    const { state } = harness()
    state.threads[0].approvalPolicy = 'always'
    const snapshot = defaultSideAgentConfig(state, 'main')
    state.composerExecutionSettings!.approvalPolicy = 'never'
    expect(snapshot.approvalPolicy).toBe('always')
  })

  it('clears a gateway when switching credential paths on the same Agent', () => {
    const current = { harnessId: 'codex', credentialMode: 'kun-gateway',
      gatewayBinding: { main: { routeId: 'route', allowedConnectionIds: ['connection'] } },
      model: 'm', providerId: '', reasoningEffort: 'auto', fastMode: false } as SideConversation
    expect(mergeSideComposerConfig(current, { credentialMode: 'provider', gatewayBinding: undefined, providerId: 'api' }))
      .toMatchObject({ credentialMode: 'provider', gatewayBinding: undefined, providerId: 'api' })
    expect(current.gatewayBinding).toBeDefined()
  })

  it('passes the selected Agent and policy on the first turn, not just its label', async () => {
    const { state, actions, send } = harness()
    const config = { harnessId: 'codex', credentialMode: 'native-login' as const,
      model: 'native-model', providerId: '', approvalPolicy: 'always' as const,
      sandboxMode: 'read-only' as const, approvalReviewer: 'user' as const }
    const id = await actions.spawnSideConversation('review', config)
    const { providerId: _providerId, ...sentConfig } = config
    expect(send).toHaveBeenCalledWith(id, 'review', expect.objectContaining(sentConfig))
    expect(send.mock.calls[0]?.[2]).not.toHaveProperty('accountId')
    expect(state.composerHarnessId).toBe('kun')
  })

  it('keeps failed first-turn input and configuration on the created branch for retry', async () => {
    const { actions, send, fork, state } = harness()
    send.mockRejectedValueOnce(new Error('admission failed'))
    const id = (await actions.spawnSideConversation('retain me', { harnessId: 'kun', model: 'chosen' }))!
    expect(state.sideConversations[id]).toMatchObject({ input: 'retain me', model: 'chosen', submitting: false, busy: false })
    await actions.sendSideMessage(id, state.sideConversations[id].input)
    expect(fork).toHaveBeenCalledTimes(1)
  })

  it('blocks double sends and configuration edits while admission is pending', async () => {
    const { actions, send, state } = harness()
    const id = (await actions.spawnSideConversation())!
    let resolve!: (value: { threadId: string; turnId: string }) => void
    send.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const sending = actions.sendSideMessage(id, 'hello')
    actions.setSideComposerConfig(id, { harnessId: 'codex' })
    expect(await actions.sendSideMessage(id, 'duplicate')).toBe(false)
    expect(state.sideConversations[id].harnessId).toBe('kun')
    resolve({ threadId: id, turnId: 'turn' })
    await sending
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('changes only the named idle branch and protects running models and permissions', async () => {
    const { actions, state } = harness()
    const a = (await actions.spawnSideConversation())!
    const b = (await actions.spawnSideConversation())!
    actions.setSideComposerConfig(a, { harnessId: 'codex', credentialMode: 'provider', model: 'native', providerId: 'p' })
    expect(state.sideConversations[b].harnessId).toBe('kun')
    expect(state.composerHarnessId).toBe('kun')
    state.sideConversations[a].busy = true
    actions.setSideModel(a, 'wrong')
    actions.setSideComposerConfig(a, { approvalPolicy: 'never' })
    expect(state.sideConversations[a]).toMatchObject({ model: 'native', approvalPolicy: 'on-request' })
  })

  it('honors an explicit empty native model rather than falling back to the parent model', async () => {
    const { actions, state } = harness()
    const id = (await actions.spawnSideConversation(undefined, { harnessId: 'codex', model: '', providerId: '' }))!
    expect(state.sideConversations[id].model).toBe('')
  })
})
