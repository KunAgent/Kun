import type { ChatBlock, NormalizedThread, ReviewTarget } from '../agent/types'
import type { DesignDocumentTarget, DesignTaskProfileInput } from '../agent/design-task-profile'
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
import { queuedMessageGuidancePayload } from './queued-message-guidance'
import { currentTurnStartGeneration } from './turn-start-fence'
import {
  isPendingQueuedMessage,
  queuedMessagesForThread,
  reconcileQueuedMessages,
  saveQueuedMessagesForThread
} from './queued-message-persistence'
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
import { isDesignThreadId } from '../design/design-thread-registry'
import { readSddThreadRegistry } from '../sdd/sdd-thread-registry'
import { isWorkspaceOfficeViewPositionAttachment } from '../lib/workspace-office-view-context'
import { isWriteTurnReferenceAttachment } from '../write/write-turn-reference-context'
import {
  MAX_COMPOSER_CONTEXT_ATTACHMENTS,
  type ComposerContextAttachment
} from '@kun/extension-api'
import { mergeChatBlocks } from '../agent/kun-mapper'
import {
  activeChatWorkspaceRoot,
  activeWriteMessageContextMatches,
  createClientTurnRequestId,
  createWorkspaceCheckpointRequestId,
  hasRuntimeUserBlockForGuidance,
  localConversationErrorBlock,
  pendingComposerContexts,
  pendingQueuedMessage,
  prependOlderHistoryBlocks,
  startingQueuedSubmission,
  threadActionSharedState,
  turnAdmissionOutcomeMayBeUnknown,
  upsertQueuedSubmission,
  waitForRuntimeTurnAdmission,
  settleRuntimeTurnAdmission,
  withoutConsumedComposerContexts,
  type StoreActionContext,
  type ThreadActionRuntime
} from './chat-store-thread-actions-support'
import { performPreparedThreadSend } from './chat-store-thread-send-direct'

function mergeTurnComposerContexts(
  primary: readonly ComposerContextAttachment[],
  pending: readonly ComposerContextAttachment[]
): ComposerContextAttachment[] {
  const merged: ComposerContextAttachment[] = []
  const seen = new Set<string>()
  for (const context of [...primary, ...pending]) {
    if (seen.has(context.attachmentId)) continue
    seen.add(context.attachmentId)
    merged.push(context)
    if (merged.length === MAX_COMPOSER_CONTEXT_ATTACHMENTS) break
  }
  return merged
}

function routeComposerContexts(
  route: ChatState['route'],
  primary: readonly ComposerContextAttachment[],
  pending: readonly ComposerContextAttachment[]
): ComposerContextAttachment[] {
  if (route === 'chat') return mergeTurnComposerContexts(primary, pending)
  if (route === 'write') {
    const currentView = primary.find(isWorkspaceOfficeViewPositionAttachment)
    const references = primary.filter(isWriteTurnReferenceAttachment)
    const pptContexts = primary.filter((context) =>
      'source' in context.provenance &&
      context.provenance.source === 'dev-preview' &&
      (context.reference.kind === 'ppt-review' || context.reference.kind === 'ppt-direction'))
    return mergeTurnComposerContexts(
      [...references, ...(currentView ? [currentView] : []), ...pptContexts],
      []
    )
  }
  return []
}

export const routeComposerContextsForTests = routeComposerContexts

function sameDesignDocumentTarget(
  left: DesignDocumentTarget | undefined,
  right: DesignDocumentTarget | undefined
): boolean {
  return Boolean(
    left && right &&
    left.documentId === right.documentId &&
    left.boardArtifactId === right.boardArtifactId
  )
}

function designSubmissionMatchesCodeThread(
  thread: NormalizedThread | null,
  profile: DesignTaskProfileInput | undefined,
  target: DesignDocumentTarget | undefined
): boolean {
  if (
    !thread ||
    thread.agentSurface === 'write' ||
    thread.agentSurface === 'design' ||
    isDesignThreadId(thread.id, readDesignThreadRegistry()) ||
    !profile ||
    !sameDesignDocumentTarget(profile.documentTarget, target)
  ) return false
  const locked = thread.designProfile
  if (!locked) return true
  return sameDesignDocumentTarget(locked.documentTarget, target) &&
    locked.outputMedium === profile.outputMedium &&
    locked.target === profile.target &&
    locked.preset === profile.preset &&
    locked.presetSource === profile.presetSource &&
    JSON.stringify(locked.styleSnapshot ?? null) === JSON.stringify(profile.styleSnapshot ?? null) &&
    JSON.stringify(locked.context) === JSON.stringify(profile.context)
}

export async function sendThreadMessage(
  context: StoreActionContext,
  runtime: ThreadActionRuntime,
  text: Parameters<ChatState['sendMessage']>[0],
  mode: Parameters<ChatState['sendMessage']>[1],
  overrides: Parameters<ChatState['sendMessage']>[2]
): Promise<boolean> {
  const { set, get } = context
    const trimmedText = text.trim()
    if (!trimmedText) return false
    const queued = overrides?.queued
    const clientRequestId = queued?.clientRequestId?.trim() ||
      overrides?.clientRequestId?.trim() ||
      createClientTurnRequestId()
    const shouldWaitForRuntimeAdmission =
      (queued?.waitForRuntimeAdmission ?? overrides?.waitForRuntimeAdmission) === true
    const expectedThreadId = (queued?.expectedThreadId ?? overrides?.expectedThreadId ?? '').trim()
    const requestedAgentSurface = queued?.agentSurface ?? overrides?.agentSurface
    const designProfile = requestedAgentSurface === 'code'
      ? undefined
      : queued?.designProfile ?? overrides?.designProfile
    const designDocumentTarget = requestedAgentSurface === 'code'
      ? undefined
      : queued?.designDocumentTarget ?? overrides?.designDocumentTarget
    const designImagePlacementTarget = queued?.designImagePlacementTarget ?? overrides?.designImagePlacementTarget
    const messageSource = queued?.messageSource ?? overrides?.messageSource
    const persona = resolveTurnPersona(
      get().composerPersonaEnabled,
      queued?.persona,
      overrides?.persona,
      requestedAgentSurface === 'write' || Boolean(queued?.writeContext ?? overrides?.writeContext)
    )
    const expectedThreadStillActive = (): boolean => Boolean(
      !expectedThreadId ||
      (
        get().activeThreadId === expectedThreadId &&
        (
          requestedAgentSurface !== 'design' ||
          (
            get().route === 'chat' &&
            designSubmissionMatchesCodeThread(
              get().threads.find((thread) => thread.id === expectedThreadId) ?? null,
              designProfile,
              designDocumentTarget
            )
          )
        )
      )
    )
    let writeContext = queued?.writeContext ?? overrides?.writeContext
    const requireActiveWriteContext = Boolean(writeContext && !queued)
    const activeWriteContextIsValid = (): boolean => Boolean(
      !writeContext ||
      !requireActiveWriteContext ||
      (get().route === 'write' && activeWriteMessageContextMatches(writeContext))
    )
    if (!activeWriteContextIsValid()) return false
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return false
    }
    if (!expectedThreadStillActive()) {
      set({
        error: i18n.t('common:designThreadChangedBeforeSend')
      })
      return false
    }
    if (get().route !== 'claw') {
      const state = get()
      const activeThread = state.activeThreadId
        ? state.threads.find((thread) => thread.id === state.activeThreadId) ?? null
        : null
      let workspaceRoot = writeContext
        ? normalizeWorkspaceRoot(writeContext.workspaceRoot)
        : state.route === 'write'
          ? await readActiveWriteWorkspace(state.workspaceRoot)
          : normalizeWorkspaceRoot(activeThread?.workspace)
      if (!activeWriteContextIsValid()) return false
      if (!workspaceRoot) {
        workspaceRoot = normalizeWorkspaceRoot((await rendererRuntimeClient.getSettings()).workspaceRoot)
        if (!activeWriteContextIsValid()) return false
      }
      if (workspaceRoot && !(await workspaceDirectoryExists(workspaceRoot))) {
        set({ error: workspaceMissingError() })
        await showWorkspaceMissingDialog(workspaceRoot)
        return false
      }
      if (!activeWriteContextIsValid()) return false
    }
    const p = getProvider()
    if (writeContext || get().route === 'write') {
      const boardThreadId = writeContext?.whiteboardId
        ? writeContext.threadId?.trim() || null
        : null
      const boardThread = boardThreadId
        ? get().threads.find((thread) => thread.id === boardThreadId) ?? null
        : null
      const boardWorkspace = normalizeWorkspaceRoot(writeContext?.workspaceRoot)
      const writeThreadId = boardThreadId
        ? boardThread && normalizeWorkspaceRoot(boardThread.workspace) === boardWorkspace
          ? boardThreadId
          : null
        : await get().ensureWriteThreadForWorkspace(
            writeContext?.workspaceRoot,
            writeContext ? writeContext.activeFilePath ?? '' : undefined
          )
      if (!writeThreadId) return false
      if (writeContext?.threadId && writeThreadId !== writeContext.threadId) return false
      // ensureWriteThreadForWorkspace may await selectThread. If the user
      // selects another conversation before it resolves, never fall through to
      // the provider with that newer activeThreadId.
      if (get().activeThreadId !== writeThreadId) return false
      if (writeContext && !writeContext.threadId) {
        writeContext = { ...writeContext, threadId: writeThreadId }
      }
      if (!activeWriteContextIsValid()) return false
    }
    const admissionPromise = !queued && shouldWaitForRuntimeAdmission
      ? waitForRuntimeTurnAdmission(clientRequestId)
      : null
    const hasPendingActiveTurn = threadHasPendingRuntimeWork(get().blocks)
    if (get().busy || hasPendingActiveTurn) {
      const state = get()
      const activeThreadId = state.activeThreadId
      const threadSnap = activeThreadId
        ? state.threads.find((thread) => thread.id === activeThreadId)
        : undefined
      const clawModel = activeClawChannel(state)?.model
      const overrideModel = queued?.model ?? overrides?.model?.trim()
      const composerModel =
        overrideModel ?? (state.route === 'claw' && clawModel ? clawModel : state.composerModel.trim())
      const composerProviderId =
        queued?.providerId?.trim() || overrides?.providerId?.trim() || fallbackComposerProviderIdForSend(state)
      const composerAccountId =
        queued?.accountId?.trim() ||
        overrides?.accountId?.trim() ||
        accountIdForComposerSelection(
          state.composerModelGroups,
          composerProviderId,
          composerModel
        )
      const userModelChip =
        queued?.modelLabel ?? overrides?.modelLabel ?? optimisticUserModelLabel(composerModel, threadSnap?.model)
      const displayText = queued?.displayText ?? overrides?.displayText?.trim()
      const reasoningEffort = queued?.reasoningEffort ?? overrides?.reasoningEffort?.trim()
      const serviceTier = (queued?.serviceTier ?? overrides?.serviceTier) === 'priority'
        ? 'priority' as const
        : undefined
      const subagentResume = queued?.subagentResume ?? overrides?.subagentResume
      const attachmentIds = queued?.attachmentIds ?? overrides?.attachmentIds?.filter((id) => id.trim().length > 0)
      const attachments = queued?.attachments ?? overrides?.attachments?.filter((attachment) => attachment.id.trim().length > 0)
      const fileReferences = queued?.fileReferences ?? overrides?.fileReferences?.filter((reference) =>
        reference.path.trim().length > 0 &&
        reference.relativePath.trim().length > 0 &&
        reference.name.trim().length > 0
      )
      const composerContexts = routeComposerContexts(
        state.route,
        queued?.composerContexts ?? overrides?.composerContexts ?? [],
        queued ? [] : pendingComposerContexts(state)
      )
      const orchestration = queued?.orchestration ?? overrides?.orchestration ??
        (mode === 'agent' && state.route === 'chat' && state.graphEnabled
          ? state.composerOrchestration
          : 'direct')
      set((s) => ({
        queuedMessages: upsertQueuedSubmission(s.queuedMessages, {
          ...queued,
          id: queued?.id ?? `q-${clientRequestId}`,
          text: trimmedText,
          clientRequestId,
          ...(shouldWaitForRuntimeAdmission ? { waitForRuntimeAdmission: true } : {}),
          deliveryState: 'pending' as const,
          ...(displayText ? { displayText } : {}),
          ...(mode ? { mode } : {}),
          orchestration,
          ...(composerModel ? { model: composerModel } : {}),
          ...(composerProviderId ? { providerId: composerProviderId } : {}),
          ...(composerAccountId ? { accountId: composerAccountId } : {}),
          ...(userModelChip ? { modelLabel: userModelChip } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
          ...(serviceTier ? { serviceTier } : {}),
          ...(subagentResume ? { subagentResume } : {}),
          ...(messageSource ? { messageSource } : {}),
          ...(expectedThreadId ? { expectedThreadId } : {}),
          ...((queued?.guiPlan ?? overrides?.guiPlan) ? { guiPlan: queued?.guiPlan ?? overrides?.guiPlan } : {}),
          ...((queued?.guiDesignCanvas ?? overrides?.guiDesignCanvas) ? { guiDesignCanvas: true } : {}),
          ...((queued?.guiDesignMode ?? overrides?.guiDesignMode) ? { guiDesignMode: true } : {}),
          ...(persona ? { persona } : {}),
          ...(requestedAgentSurface ? { agentSurface: requestedAgentSurface } : {}),
          ...(designProfile ? { designProfile } : {}),
          ...(designDocumentTarget ? { designDocumentTarget } : {}),
          ...(designImagePlacementTarget ? { designImagePlacementTarget } : {}),
          ...((queued?.guiDesignArtifact ?? overrides?.guiDesignArtifact)
            ? { guiDesignArtifact: queued?.guiDesignArtifact ?? overrides?.guiDesignArtifact }
            : {}),
          ...(writeContext ? { writeContext } : {}),
          ...(attachmentIds?.length ? { attachmentIds } : {}),
          ...(attachments?.length ? { attachments } : {}),
          ...(fileReferences?.length ? { fileReferences } : {}),
          ...(composerContexts.length ? { composerContexts } : {})
        }),
        extensionComposerContexts: withoutConsumedComposerContexts(s, composerContexts),
        error: null
      }))
      runtime.persistActiveQueuedMessages()
      // UI/runtime can briefly drift (busy=false while runtime still has an active turn).
      // Kick recovery so queued input drains as soon as the in-flight turn settles.
      if (!get().busy && hasPendingActiveTurn) {
        void get().recoverActiveTurn()
      }
      return admissionPromise ?? true
    }
    const now = Date.now()
    const userBlockId = queued?.id ?? `u-${now}`
    const attachmentIds =
      queued?.attachmentIds ??
      overrides?.attachmentIds?.filter((id) => id.trim().length > 0) ??
      []
    const attachments =
      queued?.attachments ??
      overrides?.attachments?.filter((attachment) => attachment.id.trim().length > 0) ??
      []
    const fileReferences =
      queued?.fileReferences ??
      overrides?.fileReferences?.filter((reference) =>
        reference.path.trim().length > 0 &&
        reference.relativePath.trim().length > 0 &&
        reference.name.trim().length > 0
      ) ??
      []
    const composerContexts = routeComposerContexts(
      get().route,
      queued?.composerContexts ?? overrides?.composerContexts ?? [],
      queued ? [] : pendingComposerContexts(get())
    )
    let activeThreadId = get().activeThreadId
    if (!expectedThreadStillActive()) {
      set({
        error: i18n.t('common:designThreadChangedBeforeSend')
      })
      return false
    }
    const displayText = queued?.displayText ?? overrides?.displayText?.trim() ?? trimmedText
    const userDisplayText = displayText !== trimmedText ? displayText : undefined
    const generatedTitle = deriveThreadTitleFromPrompt(displayText)
    const shouldAutoRenameForRoute = get().route === 'chat'
    const activeThread = activeThreadId
      ? get().threads.find((thread) => thread.id === activeThreadId) ?? null
      : null
    let shouldRenameThreadAfterSend =
      shouldAutoRenameForRoute &&
      !!activeThreadId &&
      get().blocks.every((block) => block.kind !== 'user') &&
      shouldAutoTitleThread(activeThread)
    const threadSnap = get().threads.find((thread) => thread.id === activeThreadId)
    const clawModel = activeClawChannel(get())?.model
    const overrideModel = overrides?.model?.trim()
    const composerModel =
      queued?.model ?? overrideModel ?? (get().route === 'claw' && clawModel ? clawModel : get().composerModel.trim())
    const composerProviderId =
      queued?.providerId ?? overrides?.providerId?.trim() ?? fallbackComposerProviderIdForSend(get())
    const composerAccountId =
      queued?.accountId ??
      overrides?.accountId?.trim() ??
      accountIdForComposerSelection(get().composerModelGroups, composerProviderId, composerModel)
    const reasoningEffort = queued?.reasoningEffort ?? overrides?.reasoningEffort?.trim()
    const serviceTier =
      (queued?.serviceTier ?? overrides?.serviceTier) === 'priority'
        ? 'priority' as const
        : undefined
    const subagentResume = queued?.subagentResume ?? overrides?.subagentResume
    const guiDesignCanvas = (queued?.guiDesignCanvas ?? overrides?.guiDesignCanvas) === true
    const guiDesignMode = (queued?.guiDesignMode ?? overrides?.guiDesignMode) === true
    const orchestration = queued?.orchestration ??
      overrides?.orchestration ??
      (mode === 'agent' && get().route === 'chat' && get().graphEnabled
        ? get().composerOrchestration
        : 'direct')
    const userModelChip =
      queued?.modelLabel ?? overrides?.modelLabel ?? optimisticUserModelLabel(composerModel, threadSnap?.model)
    const submittedMessageForQueue = pendingQueuedMessage({
      ...queued,
      id: queued?.id ?? `q-${clientRequestId}`,
      text: trimmedText,
      clientRequestId,
      ...(shouldWaitForRuntimeAdmission ? { waitForRuntimeAdmission: true } : {}),
      ...(displayText ? { displayText } : {}),
      ...(mode ? { mode } : {}),
      orchestration,
      ...(composerModel ? { model: composerModel } : {}),
      ...(composerProviderId ? { providerId: composerProviderId } : {}),
      ...(composerAccountId ? { accountId: composerAccountId } : {}),
      ...(userModelChip ? { modelLabel: userModelChip } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(serviceTier ? { serviceTier } : {}),
      ...(subagentResume ? { subagentResume } : {}),
      ...(messageSource ? { messageSource } : {}),
      ...(expectedThreadId ? { expectedThreadId } : {}),
      ...((queued?.guiPlan ?? overrides?.guiPlan) ? { guiPlan: queued?.guiPlan ?? overrides?.guiPlan } : {}),
      ...(guiDesignCanvas ? { guiDesignCanvas: true } : {}),
      ...(guiDesignMode ? { guiDesignMode: true } : {}),
      ...(persona ? { persona } : {}),
      ...(requestedAgentSurface ? { agentSurface: requestedAgentSurface } : {}),
      ...(designProfile ? { designProfile } : {}),
      ...(designDocumentTarget ? { designDocumentTarget } : {}),
      ...(designImagePlacementTarget ? { designImagePlacementTarget } : {}),
      ...((queued?.guiDesignArtifact ?? overrides?.guiDesignArtifact)
        ? { guiDesignArtifact: queued?.guiDesignArtifact ?? overrides?.guiDesignArtifact }
        : {}),
      ...(writeContext ? { writeContext } : {}),
      ...(attachmentIds.length ? { attachmentIds } : {}),
      ...(attachments.length ? { attachments } : {}),
      ...(fileReferences.length ? { fileReferences } : {}),
      ...(composerContexts.length ? { composerContexts } : {})
    })
    const sent = await performPreparedThreadSend({
      context,
      runtime,
      provider: p,
      trimmedText,
      mode,
      overrides,
      queued,
      clientRequestId,
      expectedThreadId,
      requestedAgentSurface,
      designProfile,
      designDocumentTarget,
      designImagePlacementTarget,
      messageSource,
      expectedThreadStillActive,
      writeContext,
      now,
      userBlockId,
      attachmentIds,
      attachments,
      fileReferences,
      composerContexts,
      activeThreadId,
      displayText,
      userDisplayText,
      generatedTitle,
      shouldAutoRenameForRoute,
      shouldRenameThreadAfterSend,
      composerModel,
      composerProviderId,
      composerAccountId,
      reasoningEffort,
      serviceTier,
      guiDesignCanvas,
      guiDesignMode,
      persona,
      orchestration,
      userModelChip,
      submittedMessageForQueue
    })
    if (!queued && admissionPromise) {
      if (!sent) settleRuntimeTurnAdmission(clientRequestId, false)
      return admissionPromise
    }
    return sent
}

export function resolveTurnPersona(
  enabled: boolean,
  queuedPersona: string | undefined,
  overridePersona: string | undefined,
  workTurn = false
): string {
  return enabled || workTurn
    ? ((queuedPersona ?? overridePersona)?.trim() ?? '').slice(0, 2_000)
    : ''
}
