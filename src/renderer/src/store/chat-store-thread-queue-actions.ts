import { queueMutationPending, withQueueMutation } from './queue-mutation-fence'
import { awaitQueueAdmission, queueAdmissionPending } from './queue-admission-fence'
import type { ChatBlock, ReviewTarget } from '../agent/types'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import {
  showWorkspaceMissingDialog,
  workspaceDirectoryExists,
  workspaceMissingError
} from '../lib/workspace-availability'
import i18n from '../i18n'
import { applyTheme, applyUiFontScale } from '../lib/apply-theme'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import { describeRuntimeError, formatRuntimeError, getRuntimeErrorCode } from '../lib/format-runtime-error'
import {
  deriveThreadTitleFromPrompt,
  getDefaultThreadTitle,
  shouldAutoTitleThread
} from '../lib/thread-title'
import { filterThreadsForSidebar } from '../lib/thread-sidebar-visibility'
import {
  enrichThreadsWithForkInfo,
  forgetThreadFork,
  hydrateThreadForkRegistry,
  markThreadFork,
  readThreadForkRegistry,
  saveThreadForkRegistry
} from '../lib/thread-fork-registry'
import {
  markThreadWorktree,
  saveThreadWorktreeRegistry
} from '../lib/thread-worktree-registry'
import { workspaceLabelFromPath } from '../lib/workspace-label'
import {
  isInternalTemporaryWorkspace,
  normalizeWorkspaceRoot,
  workspaceRootScopeKey
} from '../lib/workspace-path'
import {
  buildClawRuntimePrompt,
  buildCodeRuntimePrompt,
  getActiveAgentApiKey,
  getKunRuntimeSettings
} from '@shared/app-settings'
import type {
  ChatState,
  ChatStoreGet,
  ChatStoreSet,
  QueuedUserMessage,
  WriteAssistantMessageContext
} from './chat-store-types'
import {
  queuedMessageGuidancePayload,
  queuedMessageMatchesRunningTurn
} from './queued-message-guidance'
import { currentTurnStartGeneration } from './turn-start-fence'
import {
  isPendingQueuedMessage,
  queuedMessagesForThread,
  reconcileQueuedMessages,
  saveQueuedMessagesForThread
} from './queued-message-persistence'
import { restoreQueuedMessageFromQueue } from './queued-message-edit'
import {
  accountIdForComposerSelection,
  activeClawChannel,
  compactCodeWorkspaceRoots,
  composerReasoningEffortForSelection,
  forgetCodeWorkspaceRoot,
  hydrateBlockModelLabels,
  isClawThread,
  optimisticUserModelLabel,
  readCodeWorkspaceRoots,
  composerModeForThread,
  readThreadComposerMode,
  rememberCodeWorkspaceRoots,
  rememberThreadComposerSelection,
  rememberTurnModel
} from './chat-store-helpers'
import {
  clearedThreadSelection,
  collectAssistantTextForTurn,
  findLatestUserBlockId,
  findReusableEmptyThreadId,
  reconcileOptimisticUserBlock,
  settlePendingRuntimeWorkAfterInterrupt,
  threadHasPendingRuntimeWork,
  threadSnapshotLooksRunning,
  threadBelongsToWorkspace
} from './chat-store-runtime-helpers'
import {
  WRITE_ASSISTANT_THREAD_TITLE,
  activeWriteThreadForWorkspace,
  forgetWriteThread,
  hydrateWriteThreadRegistry,
  isWriteThreadId,
  markWriteThread,
  pruneWriteThreadRegistry,
  readWriteThreadRegistry,
  saveWriteThreadRegistry,
  writeFileKey,
  writeThreadBelongsToWorkspace,
  writeWorkspaceForThreadId
} from '../write/write-thread-registry'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { useGraphStore } from '../graph/graph-store'
import {
  clearBusyWatchdog,
  resetBusyRecoveryAttempts,
  scheduleStartupRuntimeProbe,
  stopTurnCompletionPoll
} from './chat-store-schedulers'
import {
  armBusyWatchdog,
  buildFollowupMessageFromUserInput,
  buildThreadEventSink,
  clearWatchedCompletionNotification,
  finalizeTurnTiming,
  flushLiveBlocks,
  forkedMessageCount,
  forkedTurnCount,
  isCodeSidebarThread,
  isCodeThread,
  latestThread,
  looksLikeActiveTurnError,
  readActiveWriteWorkspace,
  readWriteWorkspaceRoots,
  rememberPendingClawFeishuMirror,
  runtimeErrorDetail,
  runtimeStreamRecoveringMessage,
  shouldOpenSettingsForError,
  syncTurnCompletionPoll,
  turnCompleteNotificationSource,
  watchTurnCompletionNotification
} from './chat-store-runtime'
import {
  getThreadSnapshot,
  invalidateThreadSnapshot,
  snapshotThreadProjection
} from './thread-snapshot-cache'
import {
  composerSelectionForThread,
  ensureRuntimeProviderForSend,
  fallbackComposerProviderIdForSend,
  subscribeThreadEventsWithRecovery
} from './chat-store-thread-action-helpers'
import { GitCheckpointAvailabilityCache } from '../lib/git-checkpoint-availability'
import { readDesignThreadRegistry } from '../design/design-thread-registry'
import { readSddThreadRegistry } from '../sdd/sdd-thread-registry'
import type { ComposerContextAttachment } from '@kun/extension-api'
import { mergeChatBlocks } from '../agent/kun-mapper'
import {
  activeChatWorkspaceRoot,
  activeWriteMessageContextMatches,
  createWorkspaceCheckpointRequestId,
  hasRuntimeUserBlockForGuidance,
  localConversationErrorBlock,
  pendingComposerContexts,
  pendingQueuedMessage,
  hasRuntimeTurnAdmissionWaiter,
  settleRuntimeTurnAdmission,
  prependOlderHistoryBlocks,
  startingQueuedSubmission,
  threadActionSharedState,
  turnAdmissionOutcomeMayBeUnknown,
  upsertQueuedSubmission,
  withoutConsumedComposerContexts,
  type StoreActionContext,
  type ThreadActionRuntime
} from './chat-store-thread-actions-support'

export function createThreadQueueActions(
  context: StoreActionContext,
  runtime: ThreadActionRuntime
): Pick<ChatState, 'drainQueuedMessages' | 'removeQueuedMessage' | 'restoreQueuedMessage' | 'reorderQueuedMessage' | 'guideQueuedMessage' | 'resumeQueuedTurns'> {
  const { set, get, sseAbortRef } = context
  const cancelRuntimeQueuedTurn = async (message: QueuedUserMessage | undefined): Promise<void> => {
    // in_flight and runtime-owned paused rows both own a durable server-side
    // queued turn; failed rows may still carry one before settlement.
    if (
      !message?.deliveryTurnId ||
      (
        message.deliveryState !== 'in_flight' &&
        message.deliveryState !== 'paused' &&
        message.deliveryState !== 'failed'
      )
    ) return
    const threadId = get().activeThreadId
    const provider = getProvider()
    if (!threadId || typeof provider.cancelQueuedTurn !== 'function') return
    try {
      await provider.cancelQueuedTurn(threadId, message.deliveryTurnId)
    } catch (error) {
      // The turn may have started already; that is fine, the message
      // simply delivered before the cancel landed.
      if (!/not found|no longer queued|not queued/i.test(formatRuntimeError(error))) {
        set({ error: describeRuntimeError(error).message })
      }
    }
  }
  return {
  drainQueuedMessages: async () => {
    const threadId = get().activeThreadId?.trim()
    if (!threadId || threadActionSharedState.drainingQueuedMessageThreadIds.has(threadId)) return
    threadActionSharedState.drainingQueuedMessageThreadIds.add(threadId)
    try {
      while (true) {
        let state = get()
        if (state.activeThreadId !== threadId || queueMutationPending(threadId)) return
        const uncertain = state.queuedMessages.find((row) => row.steeringRequest)
        if (uncertain) {
          if (threadActionSharedState.guidingQueuedMessageIds.has(uncertain.id)) return
          await get().guideQueuedMessage(uncertain.id)
          if (get().queuedMessages.some((row) => row.id === uncertain.id)) return
          continue
        }
        const queuedMessages = reconcileQueuedMessages(state.queuedMessages, {
          busy: state.busy,
          turnId: state.currentTurnId,
          blocks: state.blocks
        })
        const queueChanged =
          queuedMessages.length !== state.queuedMessages.length ||
          queuedMessages.some((message, index) => message !== state.queuedMessages[index])
        if (queueChanged) {
          set({ queuedMessages })
          runtime.persistActiveQueuedMessages()
          state = get()
        }
        const next = queuedMessages.find(isPendingQueuedMessage)
        if (!next || state.busy || threadActionSharedState.guidingQueuedMessageIds.has(next.id)) return
        if (
          next.waitForRuntimeAdmission &&
          !hasRuntimeTurnAdmissionWaiter(next.clientRequestId)
        ) {
          set({ queuedMessages: queuedMessages.filter((message) => message.id !== next.id) })
          runtime.persistActiveQueuedMessages()
          continue
        }
        const started = await get().sendMessage(next.text, next.mode, { queued: next })
        // The user may have removed/restored this row while the send was in
        // flight; the submission path upserts by id and re-adds it. Cancel the
        // just-admitted server turn and drop the resurrected row instead of
        // executing a message the user already deleted.
        if (threadActionSharedState.removedQueuedMessageIds.has(next.id)) {
          threadActionSharedState.removedQueuedMessageIds.delete(next.id)
          const resurrected = get().queuedMessages.find((message) => message.id === next.id)
          if (resurrected) {
            await cancelRuntimeQueuedTurn(resurrected)
            set((current) => ({
              queuedMessages: current.queuedMessages.filter((message) => message.id !== next.id)
            }))
            runtime.persistActiveQueuedMessages()
          }
          continue
        }
        if (!started) {
          if (next.waitForRuntimeAdmission) {
            set((current) => ({
              queuedMessages: current.queuedMessages.filter((message) => message.id !== next.id)
            }))
            runtime.persistActiveQueuedMessages()
          }
          settleRuntimeTurnAdmission(next.clientRequestId, false)
          return
        }
      }
    } finally {
      threadActionSharedState.drainingQueuedMessageThreadIds.delete(threadId)
    }
  },

  removeQueuedMessage: async (id) => withQueueMutation(get().activeThreadId, undefined, async () => {
    if (threadActionSharedState.guidingQueuedMessageIds.has(id)) return
    let removed = get().queuedMessages.find((message) => message.id === id)
    const threadId = get().activeThreadId
    if (removed?.deliveryState === 'starting' && queueAdmissionPending(id)) {
      await awaitQueueAdmission(removed)
      if (get().activeThreadId !== threadId) return
      removed = get().queuedMessages.find((row) => row.id === id)
    }
    if (removed?.steeringRequest || removed?.deliveryState === 'starting') return
    if (removed?.deliveryTurnId) {
      const provider = getProvider()
      if (!threadId || !provider.cancelQueuedTurn) return
      try {
        await provider.cancelQueuedTurn(threadId, removed.deliveryTurnId)
      } catch (error) {
        if (get().activeThreadId === threadId) set({ error: describeRuntimeError(error).message })
        return
      }
      if (get().activeThreadId !== threadId) {
        saveQueuedMessagesForThread(threadId, queuedMessagesForThread(threadId).filter((row) => row.id !== id))
        invalidateThreadSnapshot(threadId)
        return
      }
    }
    // Tombstone before the local removal so a concurrent drain loop sees it.
    threadActionSharedState.removedQueuedMessageIds.add(id)
    set((s) => ({
      queuedMessages: s.queuedMessages.filter((message) => message.id !== id)
    }))
    runtime.persistActiveQueuedMessages()
    if (removed?.waitForRuntimeAdmission) {
      settleRuntimeTurnAdmission(removed.clientRequestId, false)
    }
  }),

  restoreQueuedMessage: async (id) => withQueueMutation(get().activeThreadId, null, async () => {
    if (threadActionSharedState.guidingQueuedMessageIds.has(id)) return null
    const threadId = get().activeThreadId
    const pending = get().queuedMessages.find((row) => row.id === id)
    if (pending?.deliveryState === 'starting' && queueAdmissionPending(id)) {
      await awaitQueueAdmission(pending)
      if (get().activeThreadId !== threadId) return null
    }
    const restored = restoreQueuedMessageFromQueue(get().queuedMessages, id)
    if (!restored.restored || restored.restored.steeringRequest || restored.restored.deliveryState === 'starting') return null
    const provider = getProvider()
    if (restored.restored.deliveryTurnId) {
      if (!threadId || !provider.cancelQueuedTurn) return null
      try {
        await provider.cancelQueuedTurn(threadId, restored.restored.deliveryTurnId)
      } catch (error) {
        if (get().activeThreadId === threadId) set({ error: describeRuntimeError(error).message })
        return null
      }
      if (get().activeThreadId !== threadId) {
        saveQueuedMessagesForThread(threadId, queuedMessagesForThread(threadId).filter((row) => row.id !== id))
        invalidateThreadSnapshot(threadId)
        return null
      }
    }
    // Tombstone before the local removal so a concurrent drain loop sees it.
    threadActionSharedState.removedQueuedMessageIds.add(id)
    set((current) => ({ queuedMessages: current.queuedMessages.filter((row) => row.id !== id) }))
    runtime.persistActiveQueuedMessages()
    return restored.restored
  }),

  reorderQueuedMessage: async (id, targetId, position) => withQueueMutation(get().activeThreadId, undefined, async () => {
    const moving = get().queuedMessages.find((message) => message.id === id)
    const anchor = get().queuedMessages.find((message) => message.id === targetId)
    const anchorTurnId = anchor?.deliveryTurnId
    const threadId = get().activeThreadId
    if (moving?.deliveryTurnId || anchorTurnId) {
      const provider = getProvider()
      if (!threadId || !moving?.deliveryTurnId || !anchorTurnId || !provider.moveQueuedTurn) return
      try {
        await provider.moveQueuedTurn(threadId, moving.deliveryTurnId, {
          [position === 'before' ? 'beforeTurnId' : 'afterTurnId']: anchorTurnId
        })
      } catch (error) {
        if (get().activeThreadId === threadId) set({ error: describeRuntimeError(error).message })
        return
      }
      if (get().activeThreadId !== threadId) { invalidateThreadSnapshot(threadId); return }
    }
    set((state) => {
      if (id === targetId) return {}
      const sourceIndex = state.queuedMessages.findIndex((message) => message.id === id)
      const targetIndex = state.queuedMessages.findIndex((message) => message.id === targetId)
      if (sourceIndex < 0 || targetIndex < 0) return {}

      const queuedMessages = [...state.queuedMessages]
      const [message] = queuedMessages.splice(sourceIndex, 1)
      if (!message) return {}
      const remainingTargetIndex = queuedMessages.findIndex((candidate) => candidate.id === targetId)
      const insertionIndex = remainingTargetIndex + (position === 'after' ? 1 : 0)
      queuedMessages.splice(insertionIndex, 0, message)
      if (queuedMessages.every((candidate, index) => candidate === state.queuedMessages[index])) {
        return {}
      }
      return { queuedMessages }
    })
    runtime.persistActiveQueuedMessages()
  }),

  resumeQueuedTurns: async () => {
    const state = get()
    const threadId = state.activeThreadId
    if (!threadId || state.busy) return false
    const provider = getProvider()
    if (typeof provider.resumeQueuedTurns !== 'function') return false
    const result = await provider.resumeQueuedTurns(threadId)
    if (!result.started) return false
    if (get().activeThreadId !== threadId) { invalidateThreadSnapshot(threadId); return true }
    // The interrupt paused locally parked entries; the runtime queue kept
    // them queued, so resume them locally too. Paused entries that never
    // reached the runtime stay local and keep their paused state.
    set((current) => ({
      queuedMessages: current.queuedMessages.map((message) =>
        message.deliveryState === 'paused' && message.clientRequestId
          ? { ...message, deliveryState: 'in_flight' as const }
          : message
      )
    }))
    runtime.persistActiveQueuedMessages()
    await get().recoverActiveTurn()
    return true
  },

  guideQueuedMessage: async (id) => {
    if (queueMutationPending(get().activeThreadId) || threadActionSharedState.guidingQueuedMessageIds.has(id)) return false
    const state = get()
    const message = state.queuedMessages.find((candidate) => candidate.id === id)
    if (!message || message.deliveryState === 'starting') return false
    if (message.deliveryState === 'paused' || message.deliveryState === 'failed') {
      if (message.waitForRuntimeAdmission) {
        set({ error: i18n.t('common:queuedMessageRetryUnavailable') })
        return false
      }
      if (state.busy) return false
      // Runtime-parked entries (admitted, then paused by an interrupt) resume
      // the server-side queue instead of re-submitting a new turn.
      if (message.deliveryState === 'paused' && message.clientRequestId) {
        return get().resumeQueuedTurns()
      }
      set((current) => ({
        queuedMessages: current.queuedMessages.map((candidate) => candidate.id === id
          ? {
              ...candidate,
              deliveryState: 'pending' as const,
              errorCode: undefined,
              errorMessage: undefined
            }
          : candidate)
      }))
      runtime.persistActiveQueuedMessages()
      await get().drainQueuedMessages()
      return true
    }
    const guidance = queuedMessageGuidancePayload(message)
    if (!guidance) {
      set({ error: i18n.t('common:guideQueuedMessageTextOnly') })
      return false
    }
    if (!state.activeThreadId || (!message.steeringRequest && (!state.busy || !state.currentTurnId))) {
      set({ error: i18n.t('common:guideQueuedMessageNoActiveTurn') })
      if (!state.busy) void get().drainQueuedMessages()
      return false
    }
    const runningUser = state.blocks.find((block) => block.kind === 'user' && (
      block.id === state.currentTurnUserId || block.turnId === state.currentTurnId
    ))
    const runningRouting = runningUser?.kind === 'user' && runningUser.meta
      ? runningUser.meta
      : (() => {
          // The running turn's durable meta is unavailable (e.g. a legacy or
          // test fixture state). The queued message's own frozen per-turn
          // snapshot is the only routing identity left for the same thread.
          const surface: 'write' | 'design' | 'code' =
            message.agentSurface === 'write' || message.agentSurface === 'design'
              ? message.agentSurface
              : message.guiDesignCanvas || message.guiDesignMode
                ? 'design'
                : 'code'
          return {
            agentSurface: surface,
            designProfile: message.designProfile,
            designDocumentTarget: message.designDocumentTarget
          }
        })()
    if (!message.steeringRequest && !queuedMessageMatchesRunningTurn(
      message,
      runningRouting
    )) {
      set({ error: i18n.t('common:guideQueuedMessageUnsupported') })
      return false
    }
    const guidanceThreadId = state.activeThreadId
    const guidanceTurnId = message.steeringRequest?.turnId ?? state.currentTurnId!
    const guidingGraphTurn = state.currentTurnOrchestration === 'graph'
    const delegated = state.lastDelegatedRuntimeState
    if (
      !guidingGraphTurn &&
      delegated?.threadId === guidanceThreadId &&
      delegated.turnId === guidanceTurnId &&
      delegated.capabilities.liveSteering === false
    ) {
      set({ error: i18n.t('common:guideQueuedMessageUnsupported') })
      return false
    }
    if (guidingGraphTurn && message.deliveryTurnId) {
      set({ error: i18n.t('common:guideQueuedMessageUnsupported') })
      return false
    }
    const provider = getProvider()
    const requiresNativeSteering = !guidingGraphTurn || Boolean(guidance.attachmentIds?.length)
    if (requiresNativeSteering && typeof provider.steerUserMessage !== 'function') {
      set({ error: i18n.t('common:guideQueuedMessageUnsupported') })
      return false
    }

    threadActionSharedState.guidingQueuedMessageIds.add(id)
    const requestStartedAt = Date.now()
    try {
      const graphSteered = guidingGraphTurn && !guidance.attachmentIds?.length
        ? await useGraphStore.getState().steerSourceTurn(
            guidanceThreadId,
            guidanceTurnId,
            guidance.text
          )
        : false
      if (!graphSteered) {
        if (typeof provider.steerUserMessage !== 'function') {
          set({ error: i18n.t('common:guideQueuedMessageUnsupported') })
          return false
        }
        const steeringRequest = message.steeringRequest ?? { operationId: `guide-${message.id}`, turnId: guidanceTurnId }
        set((current) => ({ queuedMessages: current.queuedMessages.map((row) => row.id === id ? { ...row, steeringRequest } : row) }))
        runtime.persistActiveQueuedMessages()
        const steerOptions = {
          operationId: steeringRequest.operationId,
          ...(message.deliveryTurnId ? { sourceTurnId: message.deliveryTurnId } : {}),
          ...(guidance.displayText ? { displayText: guidance.displayText } : {}),
          ...(guidance.attachmentIds?.length ? { attachmentIds: guidance.attachmentIds } : {})
        }
        await provider.steerUserMessage(
          guidanceThreadId,
          guidanceTurnId,
          guidance.text,
          Object.keys(steerOptions).length > 0 ? steerOptions : undefined
        )
      }
      const requestCompletedAt = Date.now()
      if (get().activeThreadId !== guidanceThreadId) {
        const durableQueuedMessages = queuedMessagesForThread(guidanceThreadId)
        saveQueuedMessagesForThread(
          guidanceThreadId,
          (durableQueuedMessages.length > 0
            ? durableQueuedMessages
            : state.queuedMessages
          ).filter((candidate) => candidate.id !== id)
        )
        // The parked snapshot still carries the guided message; without this
        // invalidation a later cache hit could resurrect it (selection actions
        // now read the durable queue on restore, but the stale snapshot must
        // not be reused at all).
        invalidateThreadSnapshot(guidanceThreadId)
        return true
      }
      set((current) => {
        const stillQueued = current.queuedMessages.some((candidate) => candidate.id === id)
        if (!stillQueued) return { error: null }
        const runtimeMessageAlreadyVisible = hasRuntimeUserBlockForGuidance(
          current.blocks,
          guidance,
          guidanceTurnId,
          requestStartedAt,
          requestCompletedAt
        )
        const displayText = guidance.displayText ?? guidance.text
        const optimisticMeta = {
          ...(guidance.displayText && guidance.displayText !== guidance.text
            ? { displayText: guidance.displayText }
            : {}),
          ...(guidance.attachmentIds?.length ? { attachmentIds: guidance.attachmentIds } : {}),
          ...(message.attachments?.length ? { attachments: message.attachments } : {})
        }
        return {
          queuedMessages: current.queuedMessages.filter((candidate) => candidate.id !== id),
          blocks: runtimeMessageAlreadyVisible
            ? current.blocks
            : [
                ...current.blocks,
                {
                  kind: 'user' as const,
                  id: message.id,
                  turnId: guidanceTurnId,
                  createdAt: new Date(requestCompletedAt).toISOString(),
                  text: displayText,
                  ...(message.modelLabel ? { modelLabel: message.modelLabel } : {}),
                  ...(Object.keys(optimisticMeta).length > 0 ? { meta: optimisticMeta } : {})
                }
              ],
          error: null
        }
      })
      runtime.persistActiveQueuedMessages()
      return true
    } catch (error) {
      if (get().activeThreadId !== guidanceThreadId) return false
      const messageText = formatRuntimeError(error)
      if (!turnAdmissionOutcomeMayBeUnknown(error) || /^(steering_|turn is not active|turn is no longer accepting steering)/.test(messageText)) {
        set((current) => ({ queuedMessages: current.queuedMessages.map((row) => row.id === id ? { ...row, steeringRequest: undefined } : row) }))
        runtime.persistActiveQueuedMessages()
      }
      if (/steering_target_(inactive|closed|missing)|steering_source_not_queued|turn is not active|turn is no longer accepting steering/.test(messageText)) {
        threadActionSharedState.guidingQueuedMessageIds.delete(id)
        await get().recoverActiveTurn({ forceTimeline: true })
        return false
      }
      set({
        error: i18n.t('common:guideQueuedMessageFailed', { message: messageText })
      })
      return false
    } finally {
      threadActionSharedState.guidingQueuedMessageIds.delete(id)
      if (get().activeThreadId === guidanceThreadId && !get().busy &&
        !get().queuedMessages.some((row) => row.steeringRequest)) void get().drainQueuedMessages?.()
    }
  },
  }
}
