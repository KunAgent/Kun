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
  getActiveAgentApiKey
} from '@shared/app-settings'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
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
import { restoredLiveProjection } from './chat-store-live-projection'
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
import { primaryAgentAvailableOnSurface } from '../lib/subagent-profile-surface'
import { isDesignThreadId, readDesignThreadRegistry } from '../design/design-thread-registry'
import { readSddThreadRegistry } from '../sdd/sdd-thread-registry'
import type { ComposerContextAttachment } from '@kun/extension-api'
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
  withoutConsumedComposerContexts,
  type StoreActionContext,
  type ThreadActionRuntime
} from './chat-store-thread-actions-support'

export function createThreadCreationActions(
  context: StoreActionContext,
  runtime: ThreadActionRuntime
): Pick<ChatState, 'createThread' | 'createConversation' | 'recoverActiveTurn'> {
  const { set, get, sseAbortRef } = context
  return {
  createThread: async (options = {}) => {
    const activationAllowed = (): boolean => options.activationGuard?.() !== false
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return null
    }
    try {
      const p = getProvider()
      const settings = await rendererRuntimeClient.getSettings()
      const runtime = getKunRuntimeSettings(settings)
      const activeThread = get().activeThreadId
        ? get().threads.find((thread) => thread.id === get().activeThreadId)
        : null
      const requestedAgentSurface = options.conversation ? 'code' : options.agentSurface ?? 'code'
      const pickedAgentId = options.agentId?.trim() || get().composerAgentId?.trim() || ''
      const personaProfile = pickedAgentId
        ? settings.agents?.kun?.subagents?.profiles?.find(
          (profile) => profile.id === pickedAgentId &&
            primaryAgentAvailableOnSurface(profile, requestedAgentSurface)
        )
        : undefined
      const initialModel = personaProfile?.model?.trim() || runtime.model.trim()
      const initialProviderId = personaProfile?.providerId?.trim() ||
        (personaProfile?.model?.trim() ? '' : runtime.providerId.trim())
      const initialSelectionSource = personaProfile ? 'user' as const : 'default' as const
      // 对话会话:不绑定项目文件夹,在 conversationWorkspaceRoot 下自动创建
      // 一个时间戳子目录作为工作目录(主进程负责实际建目录)。
      if (options.conversation) {
        if (!activationAllowed()) return null
        if (typeof window.kunGui === 'undefined' || typeof window.kunGui.createConversationWorkspace !== 'function') {
          set({ error: i18n.t('common:workspacePickerUnavailable') })
          return null
        }
        const created = await window.kunGui.createConversationWorkspace(
          settings.conversationWorkspaceRoot || undefined
        )
        if (!created.ok || !created.path) {
          set({ error: created.error || i18n.t('common:worktreeAcquireFailed') })
          return null
        }
        const t = await p.createThread({
          workspace: created.path,
          title: getDefaultThreadTitle(),
          mode: 'agent',
          agentSurface: 'code',
          ...(initialProviderId ? { providerId: initialProviderId } : {}),
          ...(initialModel ? { model: initialModel } : {}),
          ...(personaProfile ? {
            agentId: personaProfile.id,
            ...(personaProfile.systemPrompt ? { systemPrompt: personaProfile.systemPrompt } : {})
          } : {})
        })
        if (initialModel) {
          rememberThreadComposerSelection(
            t.id,
            initialModel,
            initialProviderId,
            initialSelectionSource
          )
        }
        const activate = activationAllowed()
        set((s) => ({
          ...(activate ? { activeThreadId: t.id } : {}),
          ...(pickedAgentId && !options.agentId ? { composerAgentId: '' } : {}),
          threads: s.threads.some((thread) => thread.id === t.id) ? s.threads : [t, ...s.threads]
        }))
        if (activate) {
          await get().selectThread(t.id)
          await get().refreshThreads()
        }
        return t.id
      }

      let workspaceRoot =
        normalizeWorkspaceRoot(options.workspaceRoot) ||
        (activeThread && !isInternalTemporaryWorkspace(activeThread.workspace)
          ? normalizeWorkspaceRoot(activeThread.workspace)
          : '') ||
        normalizeWorkspaceRoot(settings.workspaceRoot)
      if (!workspaceRoot) {
        await get().chooseWorkspace({ createThreadAfter: true })
        return null
      }
      if (!(await workspaceDirectoryExists(workspaceRoot))) {
        set({ error: workspaceMissingError() })
        await showWorkspaceMissingDialog(workspaceRoot)
        return null
      }
      if (!activationAllowed()) return null
      const codeWorkspaceRoots = rememberCodeWorkspaceRoots(get().codeWorkspaceRoots, [workspaceRoot])
      set({ codeWorkspaceRoots })
      // Worktree pool mode always needs a fresh thread bound to a fresh pool
      // slot, so never reuse an existing main-workspace thread in that case.
      const reusableThreadId = options.forceNew || options.useWorktreePool || personaProfile
        ? null
        : await findReusableEmptyThreadId(
            get(),
            p,
            workspaceRoot,
            (thread) =>
              isCodeThread(thread, get().clawChannels) &&
              !isDesignThreadId(thread.id, readDesignThreadRegistry()) &&
              (thread.agentSurface ?? 'code') === requestedAgentSurface
          )
      if (reusableThreadId) {
        if (!activationAllowed()) return null
        if (initialModel) {
          rememberThreadComposerSelection(
            reusableThreadId,
            initialModel,
            initialProviderId,
            'default'
          )
        }
        if (get().activeThreadId !== reusableThreadId) {
          await get().selectThread(reusableThreadId)
        } else {
          set({
            error: null,
            ...(initialModel
              ? {
                  composerModel: initialModel,
                  composerProviderId: initialProviderId,
                  composerReasoningEffort: composerReasoningEffortForSelection(
                    get().composerModelGroups,
                    initialModel,
                    initialProviderId
                  )
                }
              : {})
          })
        }
        return reusableThreadId
      }
      // Worktree mode: checkout the selected branch into an isolated worktree
      // and bind the new thread to that workspace.
      let acquiredWorktree: { projectPath: string; path: string; branch: string } | null = null
      if (options.useWorktreePool) {
        try {
          let branch = options.worktreeBranch?.trim() ?? ''
          if (!branch) {
            const branches = await window.kunGui.getGitBranches(workspaceRoot)
            if (branches.ok) branch = branches.currentBranch ?? ''
          }
          if (!branch) {
            throw new Error(i18n.t('common:worktreeBranchRequired'))
          }
          const wt = await window.kunGui.checkoutGitBranchWorktree(workspaceRoot, branch)
          if (!wt.ok) {
            throw new Error(wt.message)
          }
          acquiredWorktree = {
            projectPath: wt.sourceRepositoryRoot,
            path: wt.worktreePath,
            branch: wt.currentBranch ?? branch
          }
          workspaceRoot = wt.worktreePath
        } catch (err) {
          set({ error: err instanceof Error ? err.message : i18n.t('common:worktreeAcquireFailed') })
          return null
        }
      }
      // Primary-agent persona snapshot: bind this thread to the picked
      // subagent profile and freeze its providerId / model / systemPrompt
      // at create time so later agent edits don't drift the thread.
      const t = await p.createThread({
        workspace: workspaceRoot,
        title: getDefaultThreadTitle(),
        mode: 'agent',
        agentSurface: requestedAgentSurface,
        ...(initialProviderId ? { providerId: initialProviderId } : {}),
        ...(initialModel ? { model: initialModel } : {}),
        ...(personaProfile ? {
          agentId: personaProfile.id,
          ...(personaProfile.systemPrompt ? { systemPrompt: personaProfile.systemPrompt } : {})
        } : {})
      })
      if (initialModel) {
        rememberThreadComposerSelection(
          t.id,
          initialModel,
          initialProviderId,
          initialSelectionSource
        )
      }
      // Register + activate optimistically before refreshing. A freshly created
      // Kun thread may not be listed until the first message is written.
      // Setting it active first lets refreshThreads preserve it in the sidebar.
      const activate = activationAllowed()
      set((s) => ({
        ...(activate ? { activeThreadId: t.id } : {}),
        ...(pickedAgentId && !options.agentId ? { composerAgentId: '' } : {}),
        codeWorkspaceRoots: rememberCodeWorkspaceRoots(
          s.codeWorkspaceRoots,
          [acquiredWorktree?.projectPath ?? workspaceRoot]
        ),
        threads: s.threads.some((thread) => thread.id === t.id) ? s.threads : [t, ...s.threads]
      }))
      if (activate) await get().selectThread(t.id)
      if (acquiredWorktree) {
        saveThreadWorktreeRegistry(
          markThreadWorktree(t.id, {
            projectPath: acquiredWorktree.projectPath,
            worktreePath: acquiredWorktree.path,
            branch: acquiredWorktree.branch,
            createdAt: new Date().toISOString()
          })
        )
      }
      if (activate) await get().refreshThreads()
      return t.id
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      return null
    }
  },

  createConversation: async (options) => {
    await get().createThread({
      conversation: true,
      agentSurface: 'code',
      ...(options?.activationGuard ? { activationGuard: options.activationGuard } : {})
    })
  },

  recoverActiveTurn: async () => {
    const state = get()
    if (!state.activeThreadId) return false
    const { activeThreadId } = state
    // Recovery results are bound to the thread selected when the request
    // started. If the user switches to another thread or starts a newer turn
    // while the detail is in flight, never commit this stale projection.
    const recoveryGeneration = ++runtime.threadSelectionGeneration
    const recoveryStillCurrent = (): boolean =>
      recoveryGeneration === runtime.threadSelectionGeneration &&
      get().activeThreadId === activeThreadId
    const p = getProvider()
    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    clearBusyWatchdog()
    set({ error: runtimeStreamRecoveringMessage() })
    try {
      const {
        blocks: rawBlocks,
        latestSeq,
        threadStatus,
        latestTurnId,
        latestTurnStatus,
        latestTurnOrchestration,
        latestUserMessageId,
        turnDurationByUserId = {},
        goal,
        todos,
        historyCursor,
        hasMoreHistory = false,
        liveProjection
      } = await p.getThreadDetail(activeThreadId)
      if (!recoveryStillCurrent()) return state.busy
      const loaded = hydrateBlockModelLabels(activeThreadId, rawBlocks)
      const busy = threadSnapshotLooksRunning(loaded, threadStatus, latestTurnStatus)
      // The server has settled but a tool/approval/user_input block may still be
      // open (e.g. a delegate_task interrupted by a runtime restart). Settle it,
      // otherwise threadHasPendingRuntimeWork stays true and the queued message
      // we are recovering re-queues forever instead of draining (KunAgent/Kun#621).
      const blocks = busy ? loaded : settlePendingRuntimeWorkAfterInterrupt(loaded)
      const currentTurnUserId = busy
        ? state.currentTurnUserId ?? latestUserMessageId ?? findLatestUserBlockId(blocks)
        : null
      // The detail response is authoritative for the running turn; a stale local
      // currentTurnId from a previous recovery attempt must not win over it.
      const currentTurnId = busy ? latestTurnId ?? state.currentTurnId ?? null : null
      const durableQueuedMessages = queuedMessagesForThread(activeThreadId)
      const queuedMessages = reconcileQueuedMessages(
        state.queuedMessages.length > 0 ? state.queuedMessages : durableQueuedMessages,
        { busy, turnId: currentTurnId, blocks }
      )

      set((snapshot) => {
        const watchTurnCompletion = { ...(snapshot.watchTurnCompletion ?? {}) }
        if (!busy) {
          delete watchTurnCompletion[activeThreadId]
          clearWatchedCompletionNotification(activeThreadId)
          invalidateThreadSnapshot(activeThreadId)
        }
        return {
          activeThreadId,
          threadLoadingId: !busy && snapshot.threadLoadingId === activeThreadId
            ? null : snapshot.threadLoadingId,
          activeThreadGoal: goal ?? null,
          activeThreadTodos: todos ?? null,
          threadHistoryCursor: historyCursor ?? null,
          threadHasMoreHistory: hasMoreHistory,
          threadHistoryLoading: false,
          blocks,
          lastSeq: latestSeq,
          ...restoredLiveProjection(latestSeq, busy ? liveProjection : undefined),
          error: busy ? runtimeStreamRecoveringMessage() : null,
          busy,
          // Recovery re-read a persisted snapshot; its running claim stays
          // unconfirmed until the live stream proves the turn is alive.
          busyUnconfirmed: busy,
          currentTurnId,
          currentTurnOrchestration: busy ? latestTurnOrchestration ?? 'direct' : null,
          currentTurnUserId,
          turnDurationByUserId,
          queuedMessages,
          watchTurnCompletion,
          threads: snapshot.threads.map((thread) => thread.id === activeThreadId
            ? {
                ...thread,
                status: thread.archived ? thread.status : busy ? 'running' : 'idle',
                ...(latestTurnId ? { latestTurnId } : {}),
                ...(latestTurnStatus ? { latestTurnStatus } : {})
              }
            : thread)
        }
      })
      saveQueuedMessagesForThread(activeThreadId, queuedMessages)

      const ac = new AbortController()
      sseAbortRef.current = ac
      const sink = buildThreadEventSink(set, get, {
        threadId: activeThreadId,
        signal: ac.signal,
        sinceSeq: latestSeq,
        awaitReplaySynchronization: busy
      })
      subscribeThreadEventsWithRecovery(p, activeThreadId, latestSeq, sink, ac.signal, get)
      if (busy) {
        armBusyWatchdog(set, get)
      } else {
        resetBusyRecoveryAttempts()
        if (get().queuedMessages.length > 0) {
          void get().drainQueuedMessages()
        }
      }
      return busy
    } catch (e) {
      if (!recoveryStillCurrent()) return state.busy
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      if (state.busy) armBusyWatchdog(set, get)
      return state.busy
    }
  },
  }
}
