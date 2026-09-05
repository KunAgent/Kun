import type { AgentProvider } from '../agent/types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { describeRuntimeError, getRuntimeErrorCode } from '../lib/format-runtime-error'
import type { ChatState, ChatStoreGet, ChatStoreSet, QueuedUserMessage } from './chat-store-types'
import {
  rememberTurnModel,
  toWriteTurnContext
} from './chat-store-helpers'
import { rememberPendingClawFeishuMirror } from './chat-store-runtime-notifications'
import { ensureRuntimeProviderForSend } from './chat-store-thread-action-helpers'
import { startWorkspaceCheckpointSnapshot } from './chat-store-thread-send-checkpoint'
import { runtimePromptForSurface } from './chat-store-send-prompt'
import {
  isPendingQueuedMessage,
  queuedMessagesForThread,
  reconcileQueuedMessages,
  saveQueuedMessagesForThread
} from './queued-message-persistence'
import {
  createClientTurnRequestId,
  failQueuedSubmission,
  hasRuntimeTurnAdmissionWaiter,
  pendingQueuedMessage,
  resetUnknownOutcomeAttempts,
  scheduleUnknownOutcomeRetry,
  settleRuntimeTurnAdmission,
  threadActionSharedState,
  turnAdmissionOutcomeMayBeUnknown
} from './chat-store-thread-actions-support'

export type BackgroundQueueDelivery =
  | { status: 'accepted'; turnId: string }
  | { status: 'busy' | 'failed' | 'none' }

type BackgroundQueueInput = {
  threadId: string
  completedTurnId?: string
  provider: AgentProvider
  set: ChatStoreSet
  get: ChatStoreGet
  onTurnStarted?: (turnId: string) => void
}

function channelForThread(state: ChatState, threadId: string) {
  return state.clawChannels.find((channel) =>
    channel.threadId.trim() === threadId ||
    channel.conversations.some((conversation) => conversation.localThreadId.trim() === threadId)
  ) ?? null
}

function settleCompletedDelivery(
  messages: readonly QueuedUserMessage[],
  completedTurnId: string | undefined,
  detail?: Awaited<ReturnType<AgentProvider['getThreadDetail']>>
): QueuedUserMessage[] {
  const turnId = completedTurnId?.trim()
  if (turnId) {
    return messages.filter((message) =>
      message.deliveryState !== 'in_flight' || message.deliveryTurnId !== turnId
    )
  }
  if (!detail) return [...messages]
  return reconcileQueuedMessages(messages, {
    busy: false,
    turnId: detail.latestTurnId,
    blocks: detail.blocks
  })
}

function replaceQueuedMessage(
  threadId: string,
  id: string,
  update: (message: QueuedUserMessage) => QueuedUserMessage
): QueuedUserMessage[] {
  const latest = queuedMessagesForThread(threadId)
  const messages = latest.map((message) => message.id === id ? update(message) : message)
  saveQueuedMessagesForThread(threadId, messages)
  return messages
}

function syncActiveQueue(
  set: ChatStoreSet,
  threadId: string,
  id: string,
  update: (message: QueuedUserMessage) => QueuedUserMessage
): void {
  set((state) => state.activeThreadId === threadId
    ? { queuedMessages: state.queuedMessages.map((message) => message.id === id ? update(message) : message) }
    : {})
}

function queuedSendOptions(message: QueuedUserMessage, input: {
  displayText: string
  checkpointRequestId?: string
  claw: boolean
}) {
  return {
    clientRequestId: message.clientRequestId,
    mode: message.mode,
    orchestration: message.orchestration,
    agentSurface: message.agentSurface ?? (
      message.writeContext ? 'write' as const : message.guiDesignMode ? 'design' as const : 'code' as const
    ),
    ...(message.model ? { model: message.model } : {}),
    ...(!input.claw && message.providerId ? { providerId: message.providerId } : {}),
    ...(!input.claw && message.accountId ? { accountId: message.accountId } : {}),
    ...(message.reasoningEffort ? { reasoningEffort: message.reasoningEffort } : {}),
    ...(!input.claw && message.serviceTier ? { serviceTier: message.serviceTier } : {}),
    ...(message.subagentResume ? { subagentResume: message.subagentResume } : {}),
    ...(message.messageSource ? { messageSource: message.messageSource } : {}),
    displayText: input.displayText,
    ...(message.guiPlan ? { guiPlan: message.guiPlan } : {}),
    ...(message.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
    ...(message.guiDesignMode ? { guiDesignMode: true } : {}),
    ...(message.persona ? { persona: message.persona } : {}),
    ...(message.approvalPolicy ? { approvalPolicy: message.approvalPolicy } : {}),
    ...(message.sandboxMode ? { sandboxMode: message.sandboxMode } : {}),
    ...(message.approvalReviewer ? { approvalReviewer: message.approvalReviewer } : {}),
    ...(message.designProfile ? { designProfile: message.designProfile } : {}),
    ...(message.designDocumentTarget ? { designDocumentTarget: message.designDocumentTarget } : {}),
    ...(message.writeContext ? { writeContext: toWriteTurnContext(message.writeContext) } : {}),
    ...(message.designImagePlacementTarget
      ? { designImagePlacementTarget: message.designImagePlacementTarget }
      : {}),
    ...(message.guiDesignArtifact ? { guiDesignArtifact: message.guiDesignArtifact } : {}),
    ...(message.attachmentIds?.length ? { attachmentIds: message.attachmentIds } : {}),
    ...(input.checkpointRequestId ? { workspaceCheckpointRequestId: input.checkpointRequestId } : {}),
    ...(message.fileReferences?.length ? { fileReferences: message.fileReferences } : {}),
    ...(message.composerContexts?.length ? { composerContexts: message.composerContexts } : {})
  }
}

function scheduleRetry(input: BackgroundQueueInput, message: QueuedUserMessage): boolean {
  const retryKey = message.clientRequestId ?? message.id
  const retry = scheduleUnknownOutcomeRetry(retryKey)
  if (!retry.retryable) return false
  const pending = replaceQueuedMessage(input.threadId, message.id, pendingQueuedMessage)
  syncActiveQueue(input.set, input.threadId, message.id, pendingQueuedMessage)
  globalThis.setTimeout(() => { void drainBackgroundQueuedMessage(input) }, retry.delayMs)
  return pending.some((candidate) => candidate.id === message.id)
}

export async function drainBackgroundQueuedMessage(
  input: BackgroundQueueInput
): Promise<BackgroundQueueDelivery> {
  const { threadId, provider, set, get } = input
  if (threadActionSharedState.drainingQueuedMessageThreadIds.has(threadId)) return { status: 'none' }
  threadActionSharedState.drainingQueuedMessageThreadIds.add(threadId)
  try {
    let messages = queuedMessagesForThread(threadId)
    if (!input.completedTurnId && messages.some((message) => message.deliveryState === 'in_flight')) {
      const detail = await provider.getThreadDetail(threadId)
      messages = settleCompletedDelivery(queuedMessagesForThread(threadId), undefined, detail)
    } else {
      messages = settleCompletedDelivery(messages, input.completedTurnId)
    }
    let next = messages.find(isPendingQueuedMessage)
    while (next?.waitForRuntimeAdmission && !hasRuntimeTurnAdmissionWaiter(next.clientRequestId)) {
      messages = messages.filter((message) => message.id !== next?.id)
      settleRuntimeTurnAdmission(next.clientRequestId, false)
      next = messages.find(isPendingQueuedMessage)
    }
    saveQueuedMessagesForThread(threadId, messages)
    if (!next) return { status: 'none' }

    const clientRequestId = next.clientRequestId?.trim() || createClientTurnRequestId()
    next = { ...next, clientRequestId }
    replaceQueuedMessage(threadId, next.id, (message) => ({
      ...message,
      clientRequestId,
      deliveryState: 'starting'
    }))
    syncActiveQueue(set, threadId, next.id, (message) => ({
      ...message,
      clientRequestId,
      deliveryState: 'starting'
    }))

    try {
      const state = get()
      const channel = channelForThread(state, threadId)
      await ensureRuntimeProviderForSend({ providerId: channel ? undefined : next.providerId, model: next.model })
      const settings = await rendererRuntimeClient.getSettings()
      const runtimeText = next.backgroundRuntimeText ?? runtimePromptForSurface({
        channel,
        requestedAgentSurface: next.agentSurface,
        writeContext: next.writeContext,
        settings,
        prompt: next.text
      })
      const checkpointRequestId = next.backgroundCheckpointRequestId ?? startWorkspaceCheckpointSnapshot({
        settings,
        threads: state.threads,
        activeThreadId: threadId,
        fallbackWorkspaceRoot: settings.workspaceRoot
      })
      next = {
        ...next,
        backgroundRuntimeText: runtimeText,
        ...(checkpointRequestId ? { backgroundCheckpointRequestId: checkpointRequestId } : {})
      }
      replaceQueuedMessage(threadId, next.id, (message) => ({ ...message, ...next }))
      syncActiveQueue(set, threadId, next.id, (message) => ({ ...message, ...next }))

      const accepted = await provider.sendUserMessage(
        threadId,
        runtimeText,
        queuedSendOptions(next, {
          displayText: next.displayText ?? next.text,
          checkpointRequestId,
          claw: Boolean(channel)
        })
      )
      resetUnknownOutcomeAttempts(clientRequestId)
      settleRuntimeTurnAdmission(clientRequestId, true)
      const acceptedUpdate = (message: QueuedUserMessage): QueuedUserMessage => ({
        ...message,
        deliveryState: 'in_flight',
        deliveryTurnId: accepted.turnId,
        deliveryUserMessageItemId: accepted.userMessageItemId ?? message.id
      })
      replaceQueuedMessage(threadId, next.id, acceptedUpdate)
      syncActiveQueue(set, threadId, next.id, acceptedUpdate)
      if (accepted.userMessageItemId && next.modelLabel) {
        rememberTurnModel(threadId, accepted.userMessageItemId, next.modelLabel)
      }
      if (channel && typeof window.kunGui?.mirrorClawChannelMessage === 'function') {
        const mirrored = await window.kunGui.mirrorClawChannelMessage(threadId, next.text, 'user')
          .catch(() => ({ ok: false as const }))
        if (mirrored.ok) {
          rememberPendingClawFeishuMirror(accepted.turnId, {
            threadId,
            userBlockId: accepted.userMessageItemId ?? next.id,
            userText: next.text
          })
        }
      }
      set((current) => ({
        threads: current.threads.map((thread) => thread.id === threadId
          ? {
              ...thread,
              status: thread.archived ? thread.status : 'running',
              latestTurnId: accepted.turnId,
              latestTurnStatus: 'running'
            }
          : thread)
      }))
      input.onTurnStarted?.(accepted.turnId)
      return { status: 'accepted', turnId: accepted.turnId }
    } catch (error) {
      const code = getRuntimeErrorCode(error)
      if (code === 'thread_busy' || code === 'turn_in_progress') {
        replaceQueuedMessage(threadId, next.id, pendingQueuedMessage)
        syncActiveQueue(set, threadId, next.id, pendingQueuedMessage)
        const runtimeState = await provider.getThreadState(threadId).catch(() => null)
        if (runtimeState?.latestTurnId) {
          input.onTurnStarted?.(runtimeState.latestTurnId)
        } else {
          scheduleRetry(input, next)
        }
        return { status: 'busy' }
      }
      if (turnAdmissionOutcomeMayBeUnknown(error) && scheduleRetry(input, next)) {
        return { status: 'none' }
      }
      const view = describeRuntimeError(error)
      const failedUpdate = (message: QueuedUserMessage): QueuedUserMessage =>
        failQueuedSubmission([message], message.id, view)[0]!
      replaceQueuedMessage(threadId, next.id, failedUpdate)
      syncActiveQueue(set, threadId, next.id, failedUpdate)
      settleRuntimeTurnAdmission(clientRequestId, false)
      return { status: 'failed' }
    }
  } finally {
    threadActionSharedState.drainingQueuedMessageThreadIds.delete(threadId)
  }
}
