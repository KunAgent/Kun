import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdmissionHarness, admissionTestThread } from './chat-store-admission-test-support'
import { queuedMessagesForThread, saveQueuedMessagesForThread } from './queued-message-persistence'
import type { QueuedUserMessage } from './chat-store-types'

const mocks = vi.hoisted(() => ({
  provider: { sendUserMessage: vi.fn(), getThreadDetail: vi.fn() },
  workspaceDirectoryExists: vi.fn(async () => true),
  adeWorkerNoticeSendExtras: vi.fn(async () => ({ ackNoticeIds: [], contexts: [] }))
}))
vi.mock('../agent/registry', () => ({ getProvider: () => mocks.provider }))
vi.mock('../agent/ade-notices', () => ({ adeWorkerNoticeSendExtras: mocks.adeWorkerNoticeSendExtras }))
vi.mock('../lib/workspace-availability', () => ({
  workspaceDirectoryExists: mocks.workspaceDirectoryExists, workspaceMissingError: () => 'missing workspace'
}))

const queued: QueuedUserMessage = {
  id: 'q-build', text: 'Implement the plan', mode: 'agent', planBuild: true,
  expectedThreadId: 'build', clientRequestId: 'request-build', deliveryState: 'pending',
  harnessId: 'codex', credentialMode: 'native-login'
}

describe('queued plan admission navigation fences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const data = new Map<string, string>()
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value)
    } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each(['workspace', 'worker-notices'] as const)('keeps the plan on its owner when selection changes during %s preparation', async (phase) => {
    const { actions, state } = createAdmissionHarness()
    Object.assign(state, {
      activeThreadId: 'build', busy: false, error: null,
      composerHarnessId: 'codex', composerCredentialMode: 'native-login',
      threads: [{ ...admissionTestThread('build'), taskWorkspaceId: 'ws_build' },
        { ...admissionTestThread('other'), taskWorkspaceId: 'ws_other' }],
      queuedMessages: [queued]
    })
    saveQueuedMessagesForThread('build', [queued])
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    let started!: () => void
    const entered = new Promise<void>((resolve) => { started = resolve })
    if (phase === 'workspace') {
      mocks.workspaceDirectoryExists.mockImplementationOnce(async () => { started(); await pending; return true })
    } else {
      mocks.adeWorkerNoticeSendExtras.mockImplementationOnce(async () => { started(); await pending; return { ackNoticeIds: [], contexts: [] } })
    }
    const sending = actions.sendMessage(queued.text, 'agent', { queued })
    await entered
    state.activeThreadId = 'other'
    state.error = 'other error'
    state.queuedMessages = [{ id: 'q-other', text: 'Other input' }]
    finish()
    expect(await sending).toBe(false)
    expect(mocks.provider.sendUserMessage).not.toHaveBeenCalled()
    expect(state.queuedMessages).toEqual([{ id: 'q-other', text: 'Other input' }])
    expect(state.error).toBe('other error')
    expect(queuedMessagesForThread('build')).toEqual([queued])
  })
})
