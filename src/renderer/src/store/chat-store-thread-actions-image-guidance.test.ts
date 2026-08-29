import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { graphRuntimeClient } from '../graph/graph-runtime-client'
import { useGraphStore } from '../graph/graph-store'
import type { GraphRun } from '../graph/graph-types'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

import { createThreadActions } from './chat-store-thread-actions'

function thread(): NormalizedThread {
  return {
    id: 'thread_image_guidance',
    title: 'Image guidance',
    updatedAt: '2026-08-12T00:00:00.000Z',
    model: 'image-model',
    mode: 'agent',
    workspace: '/workspace',
    status: 'running'
  }
}

function harness(): {
  actions: ReturnType<typeof createThreadActions>
  state: ChatState
} {
  let state = {
    activeThreadId: 'thread_image_guidance',
    blocks: [],
    busy: true,
    clawChannels: [],
    codeWorkspaceRoots: [],
    composerModel: 'image-model',
    composerMode: 'agent',
    composerOrchestration: 'direct',
    composerProviderId: '',
    currentTurnId: 'turn_active',
    currentTurnOrchestration: 'direct',
    currentTurnUserId: 'user_original',
    error: null,
    extensionComposerContexts: [],
    lastSeq: 0,
    loadComposerModels: vi.fn(async () => undefined),
    queuedMessages: [],
    recoverActiveTurn: vi.fn(async () => true),
    refreshThreads: vi.fn(async () => undefined),
    route: 'chat',
    runtimeConnection: 'ready',
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    turnStartedAtByUserId: {},
    threads: [thread()]
  } as unknown as ChatState
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const actions = createThreadActions({ set, get, sseAbortRef: { current: null } })
  state.sendMessage = actions.sendMessage
  return { actions, state }
}

const queuedImage = {
  id: 'q-image',
  text: 'Use this image as the reference.',
  attachmentIds: ['att_0123456789abcdef01234567'],
  attachments: [{
    id: 'att_0123456789abcdef01234567',
    kind: 'image' as const,
    name: 'reference.png'
  }]
}

describe('chat store image guidance', () => {
  beforeEach(() => {
    registryMock.getProvider.mockReset()
    useGraphStore.setState({
      threadId: null,
      runs: [],
      selectedRunId: null,
      selectedNodeId: null,
      error: null
    })
  })

  it('forwards image ids, projects the image metadata, and retains failures intact', async () => {
    const steerUserMessage = vi.fn(async () => undefined)
    registryMock.getProvider.mockReturnValue({ steerUserMessage })
    const { actions, state } = harness()
    state.queuedMessages = [queuedImage]

    await expect(actions.guideQueuedMessage(queuedImage.id)).resolves.toBe(true)

    expect(steerUserMessage).toHaveBeenCalledWith(
      'thread_image_guidance',
      'turn_active',
      queuedImage.text,
      { attachmentIds: queuedImage.attachmentIds }
    )
    expect(state.queuedMessages).toEqual([])
    expect(state.blocks).toContainEqual(expect.objectContaining({
      kind: 'user',
      id: queuedImage.id,
      meta: {
        attachmentIds: queuedImage.attachmentIds,
        attachments: queuedImage.attachments
      }
    }))

    const failedImage = { ...queuedImage, id: 'q-image-failed' }
    state.queuedMessages = [failedImage]
    steerUserMessage.mockRejectedValueOnce(new Error('runtime offline'))
    await expect(actions.guideQueuedMessage(failedImage.id)).resolves.toBe(false)
    expect(state.queuedMessages).toEqual([failedImage])
  })

  it('guides a GUI plan image only into an active Plan turn', async () => {
    const steerUserMessage = vi.fn(async () => undefined)
    registryMock.getProvider.mockReturnValue({ steerUserMessage })
    const { actions, state } = harness()
    const guiPlan = {
      operation: 'refine' as const,
      workspaceRoot: '/workspace',
      relativePath: '.kunsdd/plan/mascot.md',
      planId: '/workspace:.kunsdd/plan/mascot.md'
    }
    const planImage = {
      ...queuedImage,
      id: 'q-plan-image',
      mode: 'plan',
      guiPlan
    }
    state.blocks = [{
      kind: 'user', id: 'user_original', turnId: 'turn_active', text: 'Draft the plan',
      meta: { agentSurface: 'code', mode: 'plan' }
    }]
    state.queuedMessages = [planImage]

    await expect(actions.guideQueuedMessage(planImage.id)).resolves.toBe(true)
    expect(steerUserMessage).toHaveBeenCalledWith(
      'thread_image_guidance',
      'turn_active',
      planImage.text,
      { attachmentIds: planImage.attachmentIds }
    )
    expect(state.queuedMessages).toEqual([])

    const blocked = { ...planImage, id: 'q-plan-image-agent-turn' }
    state.blocks = [{
      kind: 'user', id: 'user_original', turnId: 'turn_active', text: 'Implement now',
      meta: { agentSurface: 'code', mode: 'agent' }
    }]
    state.queuedMessages = [blocked]
    steerUserMessage.mockClear()

    await expect(actions.guideQueuedMessage(blocked.id)).resolves.toBe(false)
    expect(steerUserMessage).not.toHaveBeenCalled()
    expect(state.queuedMessages).toEqual([blocked])
  })

  it('bypasses the text-only Graph shortcut for image guidance', async () => {
    const steerUserMessage = vi.fn(async () => undefined)
    registryMock.getProvider.mockReturnValue({ steerUserMessage })
    const { actions, state } = harness()
    state.currentTurnOrchestration = 'graph'
    state.queuedMessages = [queuedImage]
    const run = {
      id: 'run_image_guidance',
      threadId: 'thread_image_guidance',
      sourceTurnId: 'turn_active',
      status: 'running',
      lastEventSeq: 1
    } as GraphRun
    useGraphStore.setState({
      threadId: 'thread_image_guidance',
      runs: [run],
      selectedRunId: run.id
    })
    const graphSteer = vi.spyOn(graphRuntimeClient, 'steer')

    await expect(actions.guideQueuedMessage(queuedImage.id)).resolves.toBe(true)

    expect(graphSteer).not.toHaveBeenCalled()
    expect(steerUserMessage).toHaveBeenCalledWith(
      'thread_image_guidance',
      'turn_active',
      queuedImage.text,
      { attachmentIds: queuedImage.attachmentIds }
    )
  })
})
