import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtimeClientMock = vi.hoisted(() => ({
  getSettings: vi.fn()
}))
const actionHelpersMock = vi.hoisted(() => ({
  ensureRuntimeProviderForSend: vi.fn()
}))
const sendPromptMock = vi.hoisted(() => ({
  runtimePromptForSurface: vi.fn()
}))
const checkpointMock = vi.hoisted(() => ({
  startWorkspaceCheckpointSnapshot: vi.fn()
}))
const helpersMock = vi.hoisted(() => ({
  activeClawChannel: vi.fn(),
  rememberTurnModel: vi.fn(),
  toWriteTurnContext: vi.fn()
}))
const notificationsMock = vi.hoisted(() => ({
  rememberPendingClawFeishuMirror: vi.fn()
}))

vi.mock('../agent/runtime-client', () => ({
  rendererRuntimeClient: { getSettings: runtimeClientMock.getSettings }
}))
vi.mock('./chat-store-thread-action-helpers', () => ({
  ensureRuntimeProviderForSend: actionHelpersMock.ensureRuntimeProviderForSend
}))
vi.mock('./chat-store-send-prompt', () => ({
  runtimePromptForSurface: sendPromptMock.runtimePromptForSurface
}))
vi.mock('./chat-store-thread-send-checkpoint', () => ({
  startWorkspaceCheckpointSnapshot: checkpointMock.startWorkspaceCheckpointSnapshot
}))
vi.mock('./chat-store-helpers', () => ({
  activeClawChannel: helpersMock.activeClawChannel,
  rememberTurnModel: helpersMock.rememberTurnModel,
  toWriteTurnContext: helpersMock.toWriteTurnContext
}))
vi.mock('./chat-store-runtime-notifications', () => ({
  rememberPendingClawFeishuMirror: notificationsMock.rememberPendingClawFeishuMirror
}))

import { submitToRuntimeQueue } from './chat-store-thread-send-enqueue'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import type { AttachmentReference } from '../agent/types'

function buildHarness(initial?: Partial<ChatState>): {
  state: ChatState
  set: ChatStoreSet
  get: ChatStoreGet
} {
  const state = {
    activeThreadId: 'thr_1',
    blocks: [],
    busy: true,
    queuedMessages: [],
    route: 'chat',
    composerModel: 'deepseek-v4-pro',
    extensionComposerContexts: [],
    ...initial
  } as unknown as ChatState
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  return { state, set, get }
}

const attachment: AttachmentReference = {
  id: 'att_1',
  kind: 'image',
  name: 'shot.png',
  mimeType: 'image/png',
  previewUrl: 'data:image/png;base64,AAAA'
}

beforeEach(() => {
  runtimeClientMock.getSettings.mockReset()
  runtimeClientMock.getSettings.mockResolvedValue({ workspaceRoot: '' })
  actionHelpersMock.ensureRuntimeProviderForSend.mockReset()
  actionHelpersMock.ensureRuntimeProviderForSend.mockImplementation(async () => undefined)
  sendPromptMock.runtimePromptForSurface.mockReset()
  sendPromptMock.runtimePromptForSurface.mockImplementation((input: { prompt: string }) => input.prompt)
  checkpointMock.startWorkspaceCheckpointSnapshot.mockReset()
  checkpointMock.startWorkspaceCheckpointSnapshot.mockReturnValue(undefined)
  helpersMock.activeClawChannel.mockReset()
  helpersMock.activeClawChannel.mockReturnValue(null)
  helpersMock.rememberTurnModel.mockReset()
  helpersMock.toWriteTurnContext.mockReset()
  helpersMock.toWriteTurnContext.mockImplementation((context: unknown) => context)
  notificationsMock.rememberPendingClawFeishuMirror.mockReset()
})

describe('submitToRuntimeQueue', () => {
  it('preserves the full attachment snapshot on an admitted busy-thread send', async () => {
    const sendUserMessage = vi.fn(async () => ({
      turnId: 'turn_new',
      userMessageItemId: 'user_new'
    }))
    const persistActiveQueuedMessages = vi.fn()
    const { state, set, get } = buildHarness()

    const result = await submitToRuntimeQueue({
      provider: { sendUserMessage } as never,
      activeThreadId: 'thr_1',
      trimmedText: 'look at this image',
      clientRequestId: 'turn_req_1',
      orchestration: 'direct',
      requestedAgentSurface: undefined,
      writeContext: undefined,
      composerModel: 'deepseek-v4-pro',
      composerProviderId: 'deepseek',
      composerAccountId: undefined,
      userModelChip: undefined,
      displayText: undefined,
      reasoningEffort: undefined,
      serviceTier: undefined,
      subagentResume: undefined,
      messageSource: undefined,
      persona: undefined,
      designProfile: undefined,
      designDocumentTarget: undefined,
      designImagePlacementTarget: undefined,
      attachmentIds: ['att_1'],
      attachments: [attachment],
      fileReferences: undefined,
      composerContexts: [],
      queued: undefined,
      overrides: undefined,
      set,
      get,
      persistActiveQueuedMessages
    })

    expect(result).toBe(true)
    expect(sendUserMessage).toHaveBeenCalledWith(
      'thr_1',
      'look at this image',
      expect.objectContaining({
        enqueueIfBusy: true,
        attachmentIds: ['att_1']
      })
    )
    expect(state.queuedMessages).toHaveLength(1)
    expect(state.queuedMessages[0]).toMatchObject({
      deliveryState: 'in_flight',
      deliveryTurnId: 'turn_new',
      deliveryUserMessageItemId: 'user_new',
      attachmentIds: ['att_1']
    })
    expect(state.queuedMessages[0].attachments).toEqual([attachment])
    expect(persistActiveQueuedMessages).toHaveBeenCalled()
  })

  it('keeps the runtime request scoped to attachment ids while persisting renderer attachments', async () => {
    let capturedOptions: Record<string, unknown> | undefined
    const sendUserMessage = vi.fn(async (
      _threadId: string,
      _text: string,
      options?: Record<string, unknown>
    ) => {
      capturedOptions = options
      return { turnId: 'turn_new' }
    })
    const persistActiveQueuedMessages = vi.fn()
    const { state, set, get } = buildHarness()

    await submitToRuntimeQueue({
      provider: { sendUserMessage } as never,
      activeThreadId: 'thr_1',
      trimmedText: 'use this doc',
      clientRequestId: 'turn_req_2',
      orchestration: 'direct',
      requestedAgentSurface: undefined,
      writeContext: undefined,
      composerModel: 'deepseek-v4-pro',
      composerProviderId: 'deepseek',
      composerAccountId: undefined,
      userModelChip: undefined,
      displayText: undefined,
      reasoningEffort: undefined,
      serviceTier: undefined,
      subagentResume: undefined,
      messageSource: undefined,
      persona: undefined,
      designProfile: undefined,
      designDocumentTarget: undefined,
      designImagePlacementTarget: undefined,
      attachmentIds: ['att_1'],
      attachments: [attachment],
      fileReferences: undefined,
      composerContexts: [],
      queued: undefined,
      overrides: undefined,
      set,
      get,
      persistActiveQueuedMessages
    })

    expect(capturedOptions?.attachmentIds).toEqual(['att_1'])
    expect(capturedOptions).not.toHaveProperty('attachments')
    expect(state.queuedMessages[0].attachments).toEqual([attachment])
    expect(persistActiveQueuedMessages).toHaveBeenCalled()
  })
})
