/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatState } from '../store/chat-store-types'
import { createAdmissionHarness, admissionTestThread } from '../store/chat-store-admission-test-support'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { clearBusyWatchdog, stopTurnCompletionPoll } from '../store/chat-store-schedulers'
import { clearThreadSnapshotCache } from '../store/thread-snapshot-cache'
import { openPaperSpaceAssistant } from './paper-space-assistant'
import { patchPaperAssistant, usePaperAssistantStore } from './paper-space-assistant-state'
import { paperSpaceItemKey, usePaperSpaceStore } from './paper-space-store'

const mock = vi.hoisted(() => ({ state: null as ChatState | null, provider: vi.fn() }))
vi.mock('../agent/registry', () => ({ getProvider: mock.provider }))
vi.mock('../store/chat-store', () => ({ useChatStore: {
  getState: () => mock.state!,
  setState: (patch: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) =>
    Object.assign(mock.state!, typeof patch === 'function' ? patch(mock.state!) : patch)
} }))

const root = '/library'
const key = paperSpaceItemKey(root, 'papers/a')
const threadId = 'paper-thread'
const source = { workspaceRoot: root, unitDir: 'papers/a', prompt: 'Explain', images: [{ name: 'figure.png', dataBase64: 'PNG' }] }

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  rendererRuntimeClient.invalidateSettings()
  clearThreadSnapshotCache()
  usePaperAssistantStore.setState({ sessions: {} })
  usePaperSpaceStore.setState({ readerKey: key })
  vi.stubGlobal('window', { localStorage, kunGui: {
    getSettings: vi.fn(async () => ({ agents: { kun: { model: 'gpt-5', providerId: 'codex' } }, codePromptPrefix: '', chatWelcomeMessage: '' })),
    logError: vi.fn(async () => undefined),
    workspaceDirectoryExists: vi.fn(async () => true)
  } })
})

afterEach(() => {
  clearBusyWatchdog()
  stopTurnCompletionPoll()
  rendererRuntimeClient.invalidateSettings()
  vi.unstubAllGlobals()
})

describe('paper sends through the real chat send action', () => {
  it.each([false, true])('freezes high + fast before upload and preserves it with busy=%s', async (busy) => {
    const { state } = createAdmissionHarness()
    mock.state = state
    Object.assign(state, {
      activeThreadId: threadId, route: 'papers', busy, error: null,
      threads: [{ ...admissionTestThread(threadId), workspace: root, agentSurface: 'write', status: busy ? 'running' : 'idle' }],
      composerModel: 'gpt-5', composerProviderId: 'codex', composerFastMode: true, composerReasoningEffort: 'high',
      composerModelGroups: [{ providerId: 'codex', label: 'Codex', modelIds: ['gpt-5'],
        modelProfiles: { 'gpt-5': { serviceTiers: ['priority'] } } }],
      selectThread: vi.fn(async () => undefined)
    })
    patchPaperAssistant(key, { threadId, model: 'gpt-5', providerId: 'codex' })
    let finishUpload!: (value: { id: string }) => void
    const upload = new Promise<{ id: string }>((resolve) => { finishUpload = resolve })
    const sendUserMessage = vi.fn(async () => ({ threadId, turnId: 'turn-paper', userMessageItemId: 'user-paper',
      ...(busy ? { status: 'queued' } : {}) }))
    const createThread = vi.fn()
    mock.provider.mockReturnValue({
      createThread, sendUserMessage,
      getThreadSummary: vi.fn(async () => state.threads[0]),
      uploadAttachment: vi.fn(() => upload),
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const sending = openPaperSpaceAssistant(source)
    await vi.waitFor(() => expect(mock.provider().uploadAttachment).toHaveBeenCalledOnce())
    Object.assign(state, { composerReasoningEffort: 'low', composerFastMode: false,
      composerModel: 'other-model', composerProviderId: 'other-provider' })
    finishUpload({ id: 'paper-image' })
    const result = await sending
    expect(usePaperAssistantStore.getState().sessions[key]?.error).toBeNull()
    expect(result).toBe(threadId)
    expect(createThread).not.toHaveBeenCalled()
    expect(sendUserMessage).toHaveBeenCalledExactlyOnceWith(threadId, 'Explain', expect.objectContaining({
      model: 'gpt-5', providerId: 'codex', reasoningEffort: 'high', serviceTier: 'priority', attachmentIds: ['paper-image'],
      ...(busy ? { enqueueIfBusy: true } : {})
    }))
    if (busy) {
      expect(state.queuedMessages).toEqual([expect.objectContaining({
        model: 'gpt-5', providerId: 'codex', reasoningEffort: 'high', serviceTier: 'priority'
      })])
      Object.assign(state, { composerReasoningEffort: 'off', composerFastMode: true, composerModel: 'later' })
      expect(state.queuedMessages[0]).toMatchObject({ model: 'gpt-5', reasoningEffort: 'high', serviceTier: 'priority' })
    }
  })
})
