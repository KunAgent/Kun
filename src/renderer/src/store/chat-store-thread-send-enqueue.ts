import { beginQueueAdmission } from './queue-admission-fence'
import { confirmQueueAdmission } from './queue-admission-recovery'
import type { AgentProvider } from '../agent/types'
import type { AttachmentReference } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet, QueuedUserMessage, SendMessageOverrides } from './chat-store-types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { describeRuntimeError, getRuntimeErrorCode } from '../lib/format-runtime-error'
import { runtimePromptForSurface } from './chat-store-send-prompt'
import { startWorkspaceCheckpointSnapshot } from './chat-store-thread-send-checkpoint'
import { rememberPendingClawFeishuMirror } from './chat-store-runtime-notifications'
import {
  activeClawChannel,
  rememberTurnModel,
  toWriteTurnContext
} from './chat-store-helpers'
import {
  ensureRuntimeProviderForSend
} from './chat-store-thread-action-helpers'
import {
  pendingQueuedMessage,
  turnAdmissionOutcomeMayBeUnknown,
  withoutConsumedComposerContexts
} from './chat-store-thread-actions-support'
import { queuedMessagesForThread, saveQueuedMessagesForThread } from './queued-message-persistence'
import { invalidateThreadSnapshot } from './thread-snapshot-cache'
import type { ComposerContextAttachment } from '@kun/extension-api'

export type RuntimeQueueSendInput = {
  provider: AgentProvider
  activeThreadId: string
  trimmedText: string
  clientRequestId: string
  mode?: string
  orchestration: QueuedUserMessage['orchestration']
  requestedAgentSurface: 'code' | 'write' | 'design' | undefined
  writeContext: SendMessageOverrides['writeContext']
  composerModel: string
  composerProviderId: string
  composerAccountId: string | undefined
  userModelChip: string | undefined
  displayText: string | undefined
  reasoningEffort: string | undefined
  serviceTier: 'priority' | undefined
  subagentResume: QueuedUserMessage['subagentResume']
  messageSource: QueuedUserMessage['messageSource']
  persona: SendMessageOverrides['persona']
  designProfile: SendMessageOverrides['designProfile']
  designDocumentTarget: SendMessageOverrides['designDocumentTarget']
  designImagePlacementTarget: SendMessageOverrides['designImagePlacementTarget']
  attachmentIds: readonly string[] | undefined
  attachments: readonly AttachmentReference[] | undefined
  fileReferences: SendMessageOverrides['fileReferences']
  composerContexts: ComposerContextAttachment[]
  queued: QueuedUserMessage | undefined
  overrides: SendMessageOverrides | undefined
  set: ChatStoreSet
  get: ChatStoreGet
  persistActiveQueuedMessages: () => void
}

/**
 * Submit a busy-thread follow-up straight into the durable runtime queue
 * (enqueueIfBusy). Returns true when the runtime admitted the turn, false on
 * a deterministic rejection, and null when the attempt outcome is unknown
 * and the caller should keep its local fallback queue entry.
 */
export async function submitToRuntimeQueue(input: RuntimeQueueSendInput): Promise<boolean | null> {
  const {
    provider: p, activeThreadId, trimmedText, clientRequestId, mode, orchestration,
    requestedAgentSurface, writeContext, composerModel, composerProviderId,
    composerAccountId, userModelChip, displayText, reasoningEffort, serviceTier,
    subagentResume, messageSource, persona, designProfile, designDocumentTarget,
    designImagePlacementTarget, attachmentIds, attachments, fileReferences, composerContexts,
    queued, overrides, set: setStore, get
  } = input
  const initialState = { ...get() }
  const set: ChatStoreSet = (partial) => {
    if (get().activeThreadId === activeThreadId) {
      setStore(partial)
      return
    }
    const parked = { ...initialState, queuedMessages: queuedMessagesForThread(activeThreadId) }
    const patch = typeof partial === 'function' ? partial(parked) : partial
    if (patch.queuedMessages) saveQueuedMessagesForThread(activeThreadId, patch.queuedMessages)
    invalidateThreadSnapshot(activeThreadId)
  }
  const queuedId = queued?.id ?? `q-${clientRequestId}`
  const finishAdmission = beginQueueAdmission(queuedId)
  try {
    const channel = initialState.route === 'claw' ? activeClawChannel(initialState) : null
    await ensureRuntimeProviderForSend({
      providerId: channel ? undefined : composerProviderId,
      model: composerModel
    })
    const settings = await rendererRuntimeClient.getSettings()
    const runtimeText = runtimePromptForSurface({
      channel,
      requestedAgentSurface,
      writeContext,
      settings,
      prompt: trimmedText
    })
    const checkpointRequestId = startWorkspaceCheckpointSnapshot({
      settings,
      threads: initialState.threads,
      activeThreadId,
      fallbackWorkspaceRoot: settings.workspaceRoot
    })
    const sendOptions = {
      clientRequestId,
      ...((queued?.approvalPolicy ?? overrides?.approvalPolicy) ? { approvalPolicy: queued?.approvalPolicy ?? overrides?.approvalPolicy } : {}),
      ...((queued?.sandboxMode ?? overrides?.sandboxMode) ? { sandboxMode: queued?.sandboxMode ?? overrides?.sandboxMode } : {}),
      ...((queued?.approvalReviewer ?? overrides?.approvalReviewer) ? { approvalReviewer: queued?.approvalReviewer ?? overrides?.approvalReviewer } : {}),
      ...(mode ? { mode } : {}),
      orchestration,
      agentSurface: requestedAgentSurface ??
        (writeContext || initialState.route === 'write'
          ? 'write' as const
          : queued?.guiDesignMode || initialState.route === 'design' ? 'design' as const : 'code' as const),
      ...(composerModel ? { model: composerModel } : {}),
      ...(!channel && composerProviderId ? { providerId: composerProviderId } : {}),
      ...(!channel && composerAccountId ? { accountId: composerAccountId } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(!channel && serviceTier ? { serviceTier } : {}),
      ...(subagentResume ? { subagentResume } : {}),
      ...(messageSource ? { messageSource } : {}),
      ...(displayText ? { displayText } : {}),
      ...((queued?.guiPlan ?? overrides?.guiPlan) ? { guiPlan: queued?.guiPlan ?? overrides?.guiPlan } : {}),
      ...(designProfile ? { designProfile } : {}),
      ...(designDocumentTarget ? { designDocumentTarget } : {}),
      ...(designImagePlacementTarget ? { designImagePlacementTarget } : {}),
      ...(writeContext ? { writeContext: toWriteTurnContext(writeContext) } : {}),
      ...(persona ? { persona } : {}),
      ...((queued?.guiDesignArtifact ?? overrides?.guiDesignArtifact)
        ? { guiDesignArtifact: queued?.guiDesignArtifact ?? overrides?.guiDesignArtifact }
        : {}),
      ...(attachmentIds?.length ? { attachmentIds: [...attachmentIds] } : {}),
      ...(checkpointRequestId ? { workspaceCheckpointRequestId: checkpointRequestId } : {}),
      ...(fileReferences?.length ? { fileReferences } : {}),
      ...(composerContexts.length ? { composerContexts } : {})
    }
    const queuedRow = pendingQueuedMessage({
      ...queued,
      ...(sendOptions.approvalPolicy ? { approvalPolicy: sendOptions.approvalPolicy } : {}),
      ...(sendOptions.sandboxMode ? { sandboxMode: sendOptions.sandboxMode } : {}),
      ...(sendOptions.approvalReviewer ? { approvalReviewer: sendOptions.approvalReviewer } : {}),
      id: queuedId,
      text: trimmedText,
      clientRequestId,
      ...(composerContexts.length ? { composerContexts } : {}),
      ...(fileReferences?.length ? { fileReferences } : {}),
      ...(attachmentIds?.length ? { attachmentIds: [...attachmentIds] } : {}),
      ...(attachments?.length ? { attachments: [...attachments] } : {}),
      ...(designProfile ? { designProfile } : {}),
      ...(designDocumentTarget ? { designDocumentTarget } : {}),
      ...(designImagePlacementTarget ? { designImagePlacementTarget } : {}),
      ...(writeContext ? { writeContext } : {}),
      ...((queued?.guiPlan ?? overrides?.guiPlan) ? { guiPlan: queued?.guiPlan ?? overrides?.guiPlan } : {}),
      ...(displayText ? { displayText } : {}),
      ...(mode ? { mode } : {}),
      orchestration,
      agentSurface: sendOptions.agentSurface,
      ...(composerProviderId ? { providerId: composerProviderId } : {}),
      ...(composerAccountId ? { accountId: composerAccountId } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(serviceTier ? { serviceTier } : {}),
      ...(subagentResume ? { subagentResume } : {}),
      ...(messageSource ? { messageSource } : {}),
      ...(persona ? { persona } : {}),
      ...(composerModel ? { model: composerModel } : {}),
      ...(userModelChip ? { modelLabel: userModelChip } : {})
    })
    // Persist a `starting` row before admission so a crash between the runtime
    // accepting the turn and the local state update cannot silently drop a
    // queued turn. The idempotent clientRequestId keeps any later retry safe.
    const startingRow = { ...queuedRow, deliveryState: 'starting' as const }
    set((s) => {
      const existingIndex = s.queuedMessages.findIndex((message) =>
        message.id === startingRow.id ||
        Boolean(startingRow.clientRequestId && message.clientRequestId === startingRow.clientRequestId)
      )
      const queuedMessages = existingIndex < 0
        ? [...s.queuedMessages, startingRow]
        : s.queuedMessages.map((message, index) => index === existingIndex
            ? { ...message, ...startingRow, id: message.id }
            : message)
      return {
        queuedMessages,
        extensionComposerContexts: withoutConsumedComposerContexts(s, composerContexts),
        error: null
      }
    })
    if (get().activeThreadId === activeThreadId) input.persistActiveQueuedMessages()

    const accepted = await confirmQueueAdmission({
      provider: p, threadId: activeThreadId, clientRequestId,
      send: () => p.sendUserMessage(activeThreadId, runtimeText, {
        ...sendOptions,
        enqueueIfBusy: true
      })
    })
    // Update the already-persisted starting row to in_flight with the
    // runtime-admitted turn identity.
    set((s) => {
      const existingIndex = s.queuedMessages.findIndex((message) =>
        message.id === queuedRow.id ||
        Boolean(queuedRow.clientRequestId && message.clientRequestId === queuedRow.clientRequestId)
      )
      const admittedRow = {
        ...queuedRow,
        deliveryState: 'in_flight' as const,
        deliveryTurnId: accepted.turnId,
        deliveryUserMessageItemId: accepted.userMessageItemId ?? queuedRow.id
      }
      const queuedMessages = accepted.retired || (accepted.status !== 'queued' &&
        (s.currentTurnId === accepted.turnId ||
        s.blocks.some((block) => block.kind === 'user' && block.id === accepted.userMessageItemId)))
        ? s.queuedMessages.filter((row) => row.id !== queuedRow.id)
        : existingIndex < 0
        ? [...s.queuedMessages, admittedRow]
        : s.queuedMessages.map((message, index) => index === existingIndex
            ? { ...message, ...admittedRow, id: message.id }
            : message)
      return {
        queuedMessages,
        extensionComposerContexts: withoutConsumedComposerContexts(s, composerContexts),
        error: null
      }
    })
    if (get().activeThreadId === activeThreadId) input.persistActiveQueuedMessages()
    if (accepted.userMessageItemId && userModelChip) {
      rememberTurnModel(activeThreadId, accepted.userMessageItemId, userModelChip)
    }
    if (channel && typeof window.kunGui?.mirrorClawChannelMessage === 'function') {
      const mirrored = await window.kunGui
        .mirrorClawChannelMessage(activeThreadId, trimmedText, 'user')
        .catch(() => ({ ok: false as const }))
      if (mirrored.ok) {
        rememberPendingClawFeishuMirror(accepted.turnId, {
          threadId: activeThreadId,
          userBlockId: accepted.userMessageItemId ?? queuedRow.id,
          userText: trimmedText
        })
      }
    }
    if (accepted.status !== 'queued' && get().activeThreadId === activeThreadId) {
      await get().recoverActiveTurn?.({ forceTimeline: true })
    }
    return true
  } catch (error) {
    const view = describeRuntimeError(error)
    // Do not fall back to a normal send or use another active turn as an
    // acknowledgement. Retain the exact request for an explicit retry.
    set((s) => ({
      queuedMessages: s.queuedMessages.map((row) => row.id === queuedId || row.clientRequestId === clientRequestId
        ? { ...row, deliveryState: 'failed' as const, errorCode: view.code, errorMessage: view.message } : row),
      error: view.message
    }))
    if (get().activeThreadId === activeThreadId) input.persistActiveQueuedMessages()
    return false
  } finally { finishAdmission() }
}
