import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProvider } from '../agent/types'
import { defaultClawSettings } from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type { TaskWorkspaceRecord } from '@shared/task-workspace'
import type { ChatState, ChatStoreSet, QueuedUserMessage } from './chat-store-types'
import { bindReadyTaskWorkspace } from './chat-store-runtime-helpers'
import { createThreadQueueActions } from './chat-store-thread-queue-actions'
import { queuedMessagesForThread, saveQueuedMessagesForThread } from './queued-message-persistence'
import { receiveTaskWorkspaceThreadEvent, useTaskWorkspaceStore } from './task-workspace-store'
import { threadActionSharedState } from './chat-store-thread-actions-support'
import { recoverTaskWorkspaceQueuedMessages, startTaskWorkspaceQueueRecovery } from './task-workspace-queue-recovery'

const mocks = vi.hoisted(() => ({
  provider: {} as AgentProvider,
  syncTurnCompletionPoll: vi.fn(), watchTurnCompletionNotification: vi.fn(),
  turnCompleteNotificationSource: vi.fn(() => undefined)
}))
vi.mock('../agent/registry', () => ({ getProvider: () => mocks.provider }))
vi.mock('./chat-store-runtime', () => mocks)
vi.mock('./review-store', () => ({ ensureThreadBinding: vi.fn() }))
vi.mock('./chat-store-thread-action-helpers', async (original) => ({
  ...await original<typeof import('./chat-store-thread-action-helpers')>(),
  ensureRuntimeProviderForSend: vi.fn(async () => undefined)
}))

const record = {
  workspaceId: 'ws_build', ownerThreadId: 'build', sourceRoot: '/repo',
  path: '/task/worktree', state: 'ready', createdAt: '2026-10-30T00:00:00Z'
} as TaskWorkspaceRecord
const submission: QueuedUserMessage = {
  id: 'q-build', text: 'Implement the plan', displayText: 'Build Feature',
  mode: 'agent', planBuild: true, harnessId: 'codex', credentialMode: 'native-login',
  expectedThreadId: 'build', clientRequestId: 'request-build', deliveryState: 'pending'
}
const ready = { threadId: 'build', workspaceId: record.workspaceId, state: 'ready' as const,
  workspace: { path: record.path, sourceRoot: record.sourceRoot } }

function harness() {
  const calls: string[] = []
  const provider = {
    bindThreadTaskWorkspace: vi.fn(async () => { calls.push('bind') }),
    listTaskWorkspaces: vi.fn(async () => ({ records: [record] })),
    sendUserMessage: vi.fn(async () => {
      calls.push('send')
      return { threadId: 'build', turnId: 'turn-build', status: 'running' }
    }),
    getThreadState: vi.fn(async () => ({ status: 'idle' })),
    getThreadDetail: vi.fn(async () => ({ blocks: [], latestTurnId: 'turn-build' }))
  }
  mocks.provider = provider as unknown as AgentProvider
  let state = {
    activeThreadId: 'other', route: 'settings', runtimeConnection: 'ready',
    busy: true, error: 'other error', blocks: [{ id: 'other-live', kind: 'assistant', text: 'Other task' }],
    queuedMessages: [{ id: 'q-other', text: 'other input' }], clawChannels: [],
    threads: [], adeThreads: [{ id: 'build', workspace: '/repo' }], watchTurnCompletion: {},
    sendMessage: vi.fn(async () => true), recoverActiveTurn: vi.fn(async () => true)
  } as unknown as ChatState
  const get = () => state
  const set: ChatStoreSet = (partial) => { state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) } }
  const actions = createThreadQueueActions({ set, get, sseAbortRef: { current: null } },
    { persistActiveQueuedMessages: vi.fn(), fenceThreadMutation: vi.fn(() => 1), threadSelectionGeneration: 0 })
  set({ drainQueuedMessages: actions.drainQueuedMessages })
  saveQueuedMessagesForThread('build', [submission])
  return { provider, calls, get, set,
    recover: () => recoverTaskWorkspaceQueuedMessages({ provider: mocks.provider, get, set }) }
}

describe('parked external plan execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const data = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: { getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value) },
      kunGui: { getSettings: vi.fn(async () => ({ workspaceRoot: '/repo',
        checkpointCleanup: { createEnabled: false }, claw: defaultClawSettings() })) }
    })
    rendererRuntimeClient.invalidateSettings()
    useTaskWorkspaceStore.setState({ prepByThread: {} })
    threadActionSharedState.drainingQueuedMessageThreadIds.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    rendererRuntimeClient.invalidateSettings()
    useTaskWorkspaceStore.setState({ prepByThread: {} })
    threadActionSharedState.drainingQueuedMessageThreadIds.clear()
  })

  it('binds and starts the target once after navigation, including duplicate ready events', async () => {
    const h = harness()
    const other = { blocks: h.get().blocks, queuedMessages: h.get().queuedMessages, error: h.get().error }
    await Promise.all([bindReadyTaskWorkspace(ready, h.set, h.get), bindReadyTaskWorkspace(ready, h.set, h.get)])
    expect(h.provider.bindThreadTaskWorkspace).toHaveBeenCalledTimes(1)
    expect(h.provider.sendUserMessage).toHaveBeenCalledTimes(1)
    expect(h.provider.sendUserMessage).toHaveBeenCalledWith('build', expect.any(String), expect.objectContaining({
      clientRequestId: 'request-build', planBuild: true, harnessId: 'codex', enqueueIfBusy: true
    }))
    expect(h.calls).toEqual(['bind', 'send'])
    expect(h.get()).toMatchObject({ ...other, activeThreadId: 'other', route: 'settings', busy: true,
      watchTurnCompletion: { build: true } })
    expect(mocks.watchTurnCompletionNotification).toHaveBeenCalledWith('build', expect.any(Number), undefined)
    expect(queuedMessagesForThread('build')[0]).toMatchObject({ deliveryState: 'in_flight', deliveryTurnId: 'turn-build' })
    // Replayed ready after execution must not PATCH a running thread again.
    await bindReadyTaskWorkspace(ready, h.set, h.get)
    expect(h.provider.bindThreadTaskWorkspace).toHaveBeenCalledTimes(1)
    expect(h.provider.sendUserMessage).toHaveBeenCalledTimes(1)
  })

  it('recovers after restart without a completion watch, prep state, or a loaded sidebar row', async () => {
    const h = harness()
    h.set({ adeThreads: [] })
    h.provider.bindThreadTaskWorkspace.mockImplementation(async () => {
      if (h.provider.sendUserMessage.mock.calls.length > 0) throw new Error('workspace cannot be changed while running')
      h.calls.push('bind')
    })
    await h.recover()
    await h.recover()
    receiveTaskWorkspaceThreadEvent(ready)
    await bindReadyTaskWorkspace(ready, h.set, h.get)
    expect(h.provider.bindThreadTaskWorkspace).toHaveBeenCalledTimes(1)
    expect(h.provider.listTaskWorkspaces).toHaveBeenCalledWith({ ownerThreadId: 'build' })
    expect(h.calls).toEqual(['bind', 'send'])
    expect(h.get().activeThreadId).toBe('other')
    expect(useTaskWorkspaceStore.getState().prepByThread.build).toMatchObject({ state: 'ready', bound: true })
  })

  it('waits for creating workspaces, then binds before admission with the same request ID', async () => {
    const h = harness()
    h.provider.listTaskWorkspaces.mockResolvedValueOnce({ records: [{ ...record, state: 'creating' }] })
    await h.recover()
    expect(h.calls).toEqual([])
    expect(queuedMessagesForThread('build')[0]?.clientRequestId).toBe('request-build')
    await h.recover()
    expect(h.calls).toEqual(['bind', 'send'])
  })

  it('does not rebind an already-bound thread and watches a queued first receipt', async () => {
    const h = harness()
    h.set({ adeThreads: [{ id: 'build', taskWorkspaceId: record.workspaceId, workspace: record.path }] as ChatState['adeThreads'] })
    h.provider.sendUserMessage.mockResolvedValueOnce({ threadId: 'build', turnId: 'turn-build', status: 'queued' })
    await h.recover()
    expect(h.provider.bindThreadTaskWorkspace).not.toHaveBeenCalled()
    expect(h.provider.sendUserMessage).toHaveBeenCalledTimes(1)
    expect(h.get().watchTurnCompletion.build).toBe(true)
  })

  it.each(['failed', 'missing', 'worker', 'foreign'] as const)('never sends in the source checkout for a %s workspace', async (kind) => {
    const h = harness()
    const records = kind === 'missing' ? [] : [{ ...record,
      ...(kind === 'failed' ? { state: 'failed' as const } : {}),
      ...(kind === 'worker' ? { unitId: 'worker-unit' } : {}),
      ...(kind === 'foreign' ? { ownerThreadId: 'someone-else' } : {}) }]
    h.provider.listTaskWorkspaces.mockResolvedValue({ records })
    await h.recover()
    await h.get().drainQueuedMessages('build')
    expect(h.calls).toEqual([])
    expect(queuedMessagesForThread('build')[0]?.deliveryState).toBe('pending')
  })

  it('keeps active plan input parked after restart until its workspace is bound', async () => {
    const h = harness()
    h.set({ activeThreadId: 'build', busy: false, queuedMessages: [submission] })
    await h.get().drainQueuedMessages('build')
    expect(h.get().sendMessage).not.toHaveBeenCalled()
    expect(h.provider.sendUserMessage).not.toHaveBeenCalled()
    vi.mocked(h.get().sendMessage).mockImplementationOnce(async () => {
      h.set({ busy: true, queuedMessages: [] })
      saveQueuedMessagesForThread('build', [])
      return true
    })
    await h.recover()
    expect(h.get().sendMessage).toHaveBeenCalledTimes(1)
    expect(h.provider.sendUserMessage).not.toHaveBeenCalled()
  })

  it('keeps the input for retry after a binding failure without clobbering the selected thread error', async () => {
    const h = harness()
    h.provider.bindThreadTaskWorkspace.mockRejectedValueOnce(new Error('bind offline'))
    await h.recover()
    expect(h.provider.sendUserMessage).not.toHaveBeenCalled()
    expect(h.get().error).toBe('other error')
    expect(queuedMessagesForThread('build')[0]?.deliveryState).toBe('pending')
    await h.recover()
    expect(h.provider.sendUserMessage).toHaveBeenCalledTimes(1)
  })

  it.each(['paused', 'failed'] as const)('does not automatically resume %s input', async (deliveryState) => {
    const h = harness()
    saveQueuedMessagesForThread('build', [{ ...submission, deliveryState }])
    await h.recover()
    expect(h.provider.listTaskWorkspaces).not.toHaveBeenCalled()
    expect(h.calls).toEqual([])
  })

  it('retries starting input with its persisted idempotency key', async () => {
    const h = harness()
    saveQueuedMessagesForThread('build', [{ ...submission, deliveryState: 'starting' }])
    await h.recover()
    expect(h.provider.sendUserMessage).toHaveBeenCalledWith('build', expect.any(String), expect.objectContaining({ clientRequestId: 'request-build' }))
    await h.recover()
    expect(h.provider.sendUserMessage).toHaveBeenCalledTimes(1)
  })

  it('recovers at application lifetime after reconnect without selecting the build conversation', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.set({ runtimeConnection: 'offline' })
    const stop = startTaskWorkspaceQueueRecovery(h.set, h.get)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(h.calls).toEqual([])
    h.set({ runtimeConnection: 'ready' })
    await vi.advanceTimersByTimeAsync(3_000)
    expect(h.calls).toEqual(['bind', 'send'])
    expect(h.get().activeThreadId).toBe('other')
    stop()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(h.provider.sendUserMessage).toHaveBeenCalledTimes(1)
  })

  it('does not consume a late lookup after application recovery has stopped', async () => {
    const h = harness()
    let current = true
    h.provider.listTaskWorkspaces.mockImplementationOnce(async () => {
      current = false
      return { records: [record] }
    })
    await recoverTaskWorkspaceQueuedMessages({ provider: mocks.provider, set: h.set, get: h.get, isCurrent: () => current })
    expect(h.calls).toEqual([])
  })
})
