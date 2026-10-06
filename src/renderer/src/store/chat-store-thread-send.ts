import { createPaperTurnContext } from '@shared/paper/paper-turn-context'
import { codeDefaultRouteError } from './chat-store-code-default-route'
import { designSubmissionMatchesCodeThread, kunWorkflowSendBlocked } from './chat-store-kun-capability-guard'
import type { ChatBlock, NormalizedThread, ReviewTarget } from '../agent/types'
import { getProvider } from '../agent/registry'
import { adeWorkerNoticeSendExtras } from '../agent/ade-notices'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { prepareAssistantMarkdownRenderer } from '../lib/assistant-markdown-loader'
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
import { writeConversationResourcePath } from '../paper/paper-mode-actions'
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
import { threadWorkspaceBlocksSend } from './task-workspace-store'
import { syncThreadAdditionalWorkspaces } from './chat-store-workspace-folder-sync'
import { currentTurnStartGeneration } from './turn-start-fence'
import {
  isPendingQueuedMessage,
  queuedMessagesForThread,
  reconcileQueuedMessages,
  saveQueuedMessagesForThread
} from './queued-message-persistence'
import {
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
  readWriteWorkspaceRoots,
  rememberPendingClawFeishuMirror,
  runtimeErrorDetail,
  runtimeStreamRecoveringMessage,
  shouldOpenSettingsForError,
  syncTurnCompletionPoll,
  turnCompleteNotificationSource,
  watchTurnCompletionNotification
} from './chat-store-runtime'
import { resolveSendWorkspaceRoot } from './chat-store-runtime-notifications'
import {
  getThreadSnapshot,
  invalidateThreadSnapshot,
  snapshotThreadProjection
} from './thread-snapshot-cache'
import {
  composerSelectionForThread,
  ensureRuntimeProviderForSend,
  subscribeThreadEventsWithRecovery
} from './chat-store-thread-action-helpers'
import { GitCheckpointAvailabilityCache } from '../lib/git-checkpoint-availability'
import { readSddThreadRegistry } from '../sdd/sdd-thread-registry'
import type { ComposerContextAttachment } from '@kun/extension-api'
import {
  mergeTurnComposerContexts,
  routeComposerContexts
} from './chat-store-composer-context-routing'
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
import {
  adeDraftStillCurrent,
  captureAdeDraftSendSnapshot,
  captureCodeDraftComposer,
  captureCodeProjectRouteSnapshot
} from './chat-store-ade-send-snapshot'
import { composerSelectionNeedsProvider, resolveDirectSendComposerSelection } from './chat-store-send-composer-selection'
import { submitToRuntimeQueue } from './chat-store-thread-send-enqueue'
import { runtimePromptForSurface } from './chat-store-send-prompt'
import { startWorkspaceCheckpointSnapshot } from './chat-store-thread-send-checkpoint'

export const routeComposerContextsForTests = routeComposerContexts

export async function sendThreadMessage(
  context: StoreActionContext,
  runtime: ThreadActionRuntime,
  text: Parameters<ChatState['sendMessage']>[0],
  mode: Parameters<ChatState['sendMessage']>[1],
  overrides: Parameters<ChatState['sendMessage']>[2]
): Promise<boolean> {
  const { set, get } = context
  const routeError = codeDefaultRouteError(get())
  if (routeError) {
    set({ error: routeError })
    return false
  }
  const adeDraft = captureAdeDraftSendSnapshot(get())
  const codeDraftComposer = captureCodeDraftComposer(get())
  const codeProjectRoute = captureCodeProjectRouteSnapshot(get())
  const composerCollaborationEnabled = !get().activeThreadId && get().route === 'chat' &&
    get().composerCollaborationEnabled === true
  const composerCollaborationExplicit = !get().activeThreadId && get().route === 'chat' &&
    Boolean(get().composerProjectCollaborationExplicitWorkspaceRoot) &&
    normalizeWorkspaceRoot(get().composerProjectCollaborationExplicitWorkspaceRoot) === normalizeWorkspaceRoot(get().workspaceRoot)
  if (get().route === 'ade' && !get().activeThreadId && !adeDraft) return false
    const trimmedText = text.trim()
    if (!trimmedText) return false
    const activeSyncThreadId = get().activeThreadId
    if (activeSyncThreadId) {
      await syncThreadAdditionalWorkspaces({ set, get, threadId: activeSyncThreadId })
    }
    // The first streaming token usually lands before the lazy Streamdown
    // chunk finishes loading on a cold start. Warm it as soon as the user
    // commits a turn so the fallback plain-text frame is as short as possible.
    void prepareAssistantMarkdownRenderer().catch(() => undefined)
    let queued = overrides?.queued
    let paperContext = queued?.paperContext ?? overrides?.paperContext
    if (paperContext) {
      try {
        paperContext = createPaperTurnContext(paperContext)
        overrides = { ...overrides, paperContext }
        if (queued) queued = { ...queued, paperContext }
      } catch (error) {
        set({ error: error instanceof Error ? error.message : 'Invalid paper context' }); return false
      }
    }
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
    const persona = paperContext ? '' : resolveTurnPersona(
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
    const scopedWriteThread = !writeContext && requestedAgentSurface === 'write' && expectedThreadId
      ? get().threads.find((thread) => thread.id === expectedThreadId && thread.agentSurface === 'write') ?? null : null
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
      const activeThread = state.threads.find((thread) => thread.id === state.activeThreadId) ?? null
      let workspaceRoot = adeDraft?.workspaceRoot ?? await resolveSendWorkspaceRoot(state, activeThread, writeContext, scopedWriteThread)
      if (!activeWriteContextIsValid()) return false
      if (!workspaceRoot && !adeDraft) {
        workspaceRoot = normalizeWorkspaceRoot((await rendererRuntimeClient.getSettings()).workspaceRoot)
        if (!activeWriteContextIsValid()) return false
      }
      if (workspaceRoot && !(await workspaceDirectoryExists(workspaceRoot))) {
        if (adeDraft && !adeDraftStillCurrent(get(), adeDraft)) return false
        set({ error: workspaceMissingError() })
        if (!adeDraft) await showWorkspaceMissingDialog(workspaceRoot)
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
        : scopedWriteThread && get().activeThreadId === scopedWriteThread.id
          ? scopedWriteThread.id
          : await get().ensureWriteThreadForWorkspace(
              writeContext?.workspaceRoot,
              writeContext ? writeConversationResourcePath(
                writeContext.workspaceRoot, writeContext.activeFilePath) : undefined
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
    const selectedRoute = resolveDirectSendComposerSelection({
      state: get(), queued, overrides, adeDraft, codeDraftComposer,
      adeEligible: get().route === 'chat' || get().route === 'ade'
    })
    const orchestration = queued ? queued.orchestration ?? 'direct' : overrides?.orchestration ??
      (mode === 'agent' && get().route === 'chat' && get().graphEnabled ? get().composerOrchestration : 'direct')
    if (kunWorkflowSendBlocked({ state: get(), selection: selectedRoute, mode, orchestration, overrides })) {
      set({ error: i18n.t('common:kunAgentRequiredForWorkflow', {
        defaultValue: 'Design, Graph and plan workflows require Kun Agent. Select Kun to continue.'
      }) })
      return false
    }
    if (composerSelectionNeedsProvider(selectedRoute)) {
      set({ error: i18n.t('common:adeProviderSelectionRequired') })
      return false
    }
    const admissionPromise = !queued && shouldWaitForRuntimeAdmission
      ? waitForRuntimeTurnAdmission(clientRequestId)
      : null
    // ADE manager sends fold pending worker notices into the turn (09 §6.2).
    const adeExtras = await adeWorkerNoticeSendExtras(get(), queued?.ackNoticeIds, i18n.language)
    const ackNoticeIds = adeExtras.ackNoticeIds
    const hasPendingActiveTurn = threadHasPendingRuntimeWork(get().blocks)
    // Task-worktree prep queues locally (12 §7.3): the runtime cannot admit
    // a turn until the thread is bound to the ready workspace path.
    const workspacePreparing = threadWorkspaceBlocksSend(get().activeThreadId)
    if (get().busy || hasPendingActiveTurn || workspacePreparing || (queued && !shouldWaitForRuntimeAdmission)) {
      const state = get()
      const activeThreadId = state.activeThreadId
      const threadSnap = activeThreadId
        ? state.threads.find((thread) => thread.id === activeThreadId)
        : undefined
      const { composerModel, composerProviderId, composerAccountId, composerHarnessId, composerCredentialMode, composerGatewayBinding } = selectedRoute
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
      const composerContexts = mergeTurnComposerContexts(
        routeComposerContexts(
          state.route,
          queued?.composerContexts ?? overrides?.composerContexts ?? [],
          queued ? [] : pendingComposerContexts(state)
        ),
        adeExtras.contexts
      )
      // Runtime-owned queue: submit the follow-up directly with
      // enqueueIfBusy so it executes even when this conversation is never
      // opened again. Write sends now carry a durable `writeContext` reference
      // so they can join the runtime queue too.
      if (activeThreadId && !shouldWaitForRuntimeAdmission && !workspacePreparing) {
        const submitted = await submitToRuntimeQueue({
          provider: p,
          activeThreadId,
          trimmedText,
          clientRequestId,
          mode,
          orchestration,
          requestedAgentSurface,
          writeContext,
          composerModel,
          composerProviderId,
          composerAccountId,
          composerHarnessId,
          composerCredentialMode,
          composerGatewayBinding,
          userModelChip,
          displayText,
          reasoningEffort,
          serviceTier,
          subagentResume,
          messageSource,
          persona,
          designProfile,
          designDocumentTarget,
          designImagePlacementTarget,
          attachmentIds,
          attachments,
          fileReferences,
          composerContexts,
          ackNoticeIds,
          queued,
          overrides,
          set,
          get,
          persistActiveQueuedMessages: runtime.persistActiveQueuedMessages
        })
        if (submitted !== null) return submitted
      }
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
          ...(composerHarnessId ? { harnessId: composerHarnessId } : {}),
          ...(composerCredentialMode ? { credentialMode: composerCredentialMode } : {}),
          ...(composerGatewayBinding ? { gatewayBinding: structuredClone(composerGatewayBinding) } : {}),
          ...(userModelChip ? { modelLabel: userModelChip } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
          ...(serviceTier ? { serviceTier } : {}),
          ...(subagentResume ? { subagentResume } : {}),
          ...(messageSource ? { messageSource } : {}),
          ...(expectedThreadId ? { expectedThreadId } : {}),
          ...((queued?.guiPlan ?? overrides?.guiPlan) ? { guiPlan: queued?.guiPlan ?? overrides?.guiPlan } : {}),
          ...((queued?.guiDesignCanvas ?? overrides?.guiDesignCanvas) ? { guiDesignCanvas: true } : {}),
          ...((queued?.guiExcalidrawCanvas ?? overrides?.guiExcalidrawCanvas) ? { guiExcalidrawCanvas: true } : {}),
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
          ...(paperContext ? { paperContext: createPaperTurnContext(paperContext) } : {}),
          ...(attachmentIds?.length ? { attachmentIds } : {}),
          ...(attachments?.length ? { attachments } : {}),
          ...(fileReferences?.length ? { fileReferences } : {}),
          ...(composerContexts.length ? { composerContexts } : {}),
          ...(ackNoticeIds?.length ? { ackNoticeIds } : {})
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
    const composerContexts = mergeTurnComposerContexts(
      routeComposerContexts(
        get().route,
        queued?.composerContexts ?? overrides?.composerContexts ?? [],
        queued ? [] : pendingComposerContexts(get())
      ),
      adeExtras.contexts
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
    const { composerModel, composerProviderId, composerAccountId, composerHarnessId, composerCredentialMode, composerGatewayBinding } = selectedRoute
    const reasoningEffort = queued?.reasoningEffort ?? overrides?.reasoningEffort?.trim()
    const serviceTier =
      (queued?.serviceTier ?? overrides?.serviceTier) === 'priority'
        ? 'priority' as const
        : undefined
    const subagentResume = queued?.subagentResume ?? overrides?.subagentResume
    const guiDesignCanvas = (queued?.guiDesignCanvas ?? overrides?.guiDesignCanvas) === true
    const guiExcalidrawCanvas = (queued?.guiExcalidrawCanvas ?? overrides?.guiExcalidrawCanvas) === true
    const guiDesignMode = (queued?.guiDesignMode ?? overrides?.guiDesignMode) === true
    const userModelChip =
      queued?.modelLabel ?? overrides?.modelLabel ?? optimisticUserModelLabel(composerModel, threadSnap?.model)
    // Freeze the composer execution settings at enqueue time so a queued
    // message keeps the approval/sandbox policy selected when it was submitted,
    // not whatever is global by the time the queue drains.
    const composerExecutionSettings = adeDraft ? adeDraft.composer.composerExecutionSettings : get().composerExecutionSettings
    const snapshotApprovalPolicy =
      queued?.approvalPolicy ?? overrides?.approvalPolicy ?? composerExecutionSettings?.approvalPolicy
    const snapshotSandboxMode =
      queued?.sandboxMode ?? overrides?.sandboxMode ?? composerExecutionSettings?.sandboxMode
    const snapshotApprovalReviewer =
      queued?.approvalReviewer ?? overrides?.approvalReviewer ?? composerExecutionSettings?.approvalReviewer
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
      ...(composerHarnessId ? { harnessId: composerHarnessId } : {}),
      ...(composerCredentialMode ? { credentialMode: composerCredentialMode } : {}),
          ...(composerGatewayBinding ? { gatewayBinding: structuredClone(composerGatewayBinding) } : {}),
      ...(userModelChip ? { modelLabel: userModelChip } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(serviceTier ? { serviceTier } : {}),
      ...(subagentResume ? { subagentResume } : {}),
      ...(messageSource ? { messageSource } : {}),
      ...(expectedThreadId ? { expectedThreadId } : {}),
      ...((queued?.guiPlan ?? overrides?.guiPlan) ? { guiPlan: queued?.guiPlan ?? overrides?.guiPlan } : {}),
      ...(guiDesignCanvas ? { guiDesignCanvas: true } : {}),
      ...(guiExcalidrawCanvas ? { guiExcalidrawCanvas: true } : {}),
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
          ...(paperContext ? { paperContext: createPaperTurnContext(paperContext) } : {}),
      ...(snapshotApprovalPolicy ? { approvalPolicy: snapshotApprovalPolicy } : {}),
      ...(snapshotSandboxMode ? { sandboxMode: snapshotSandboxMode } : {}),
      ...(snapshotApprovalReviewer ? { approvalReviewer: snapshotApprovalReviewer } : {}),
      ...(attachmentIds.length ? { attachmentIds } : {}),
      ...(attachments.length ? { attachments } : {}),
      ...(fileReferences.length ? { fileReferences } : {}),
      ...(composerContexts.length ? { composerContexts } : {}),
      ...(ackNoticeIds?.length ? { ackNoticeIds } : {})
    })
    const sent = await performPreparedThreadSend({
      context,
      runtime,
      provider: p,
      adeDraft,
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
      ackNoticeIds,
      activeThreadId,
      displayText,
      userDisplayText,
      generatedTitle,
      composerCollaborationEnabled,
      composerCollaborationExplicit,
      codeProjectRoute,
      shouldAutoRenameForRoute,
      shouldRenameThreadAfterSend,
      composerModel,
      composerProviderId,
      composerAccountId,
      composerHarnessId,
      composerCredentialMode,
      composerGatewayBinding,
      reasoningEffort,
      serviceTier,
      guiDesignCanvas,
      guiExcalidrawCanvas,
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
