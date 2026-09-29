import type {
  AttachmentReference,
  ChatBlock,
  NormalizedThread,
  RequestContextSnapshot,
  DelegatedRuntimeState, HarnessRuntimeState,
  RuntimeConnectionStatus,
  ReviewTarget,
  ThreadGoal,
  ThreadGoalStatus,
  ThreadTodoList,
  ThreadTodoStatus,
  ThreadUsageSnapshot,
  KnowledgeBaseIndexStatus,
  KnowledgeBaseMount,
  UserInputAnswer
} from '../agent/types'
import type { KunRuntimeStatusPayload } from '@shared/kun-gui-api'
import type {
  AppLocale,
  ApprovalPolicy,
  ApprovalReviewer,
  ClawImAgentProfileV1,
  ClawImChannelV1,
  ClawImPlatformCredentialV1,
  ClawImProvider,
  ClawImSettingsV1,
  ClawModel,
  CodeAgentPresetV1,
  ModelReasoningEffort,
  SandboxMode
} from '@shared/app-settings'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import type {
  ExtensionComposerContextEvent,
  PendingComposerContextEvent
} from '@shared/extension-ipc'
import type { DesignTaskProfile } from '../agent/design-task-profile'
import type { ThreadRecoveryOptions } from './thread-recovery-coordinator'
import type { CodeWorkspaceFolderSetsRegistry } from '../lib/code-workspace-folder-sets'
import type { RemovedCodeWorkspacesRegistry } from '../lib/removed-code-workspaces'

import type { SettingsRouteSection } from './settings-route-sections'
export type { SettingsRouteSection }
import type {
  ClearDesignHistoryOptions,
  ClearDesignHistoryResult,
  CreateDesignThreadOptions,
  ExternalPlanBuildRequest,
  GuiDesignArtifactMessageContext,
  GuiPlanMessageContext,
  InitialSetupMode,
  QueuedUserMessage,
  SendMessageOverrides,
  WriteAssistantMessageContext
} from './chat-store-message-types'
export type {
  ClearDesignHistoryOptions,
  ClearDesignHistoryResult,
  CreateDesignThreadOptions,
  ExternalPlanBuildRequest,
  GuiDesignArtifactMessageContext,
  GuiPlanMessageContext,
  InitialSetupMode,
  QueuedUserMessage,
  SendMessageOverrides,
  WriteAssistantMessageContext
}
export type AppRoute = 'chat' | 'write' | 'rooms' | 'design' | 'settings' | 'plugins' | 'extensions' | 'claw' | 'board' | 'schedule' | 'workflow' | 'ade'
export type ThreadCompletionOutcome = 'completed' | 'failed'
export type CompletionAttentionRegistry = Record<string, ThreadCompletionOutcome | boolean>
export type ScheduledThreadActivity = {
  state: 'scheduled' | 'running'
  taskCount: number
  nextRunAt: string
  queued: boolean
}
export type PluginHostRoute = 'chat' | 'claw'

/**
 * A side conversation ("by-the-way") running alongside the active
 * thread. It owns its own timeline, composer, busy state, and SSE
 * subscription so it can stream in parallel with the main thread.
 *
 * The slice is namespaced under `sideConversations[threadId]` and
 * MUST NOT mutate any main-thread state (`activeThreadId`, `blocks`,
 * `busy`, etc.) — isolation is structural.
 */
export type SideConversation = {
  threadId: string
  parentThreadId: string
  /** Retargeted immutable profile owned by this independently cloned branch. */
  designProfile?: DesignTaskProfile
  designWorkspaceRoot?: string
  title: string
  createdAt: string
  /** Timestamp the snapshot was taken from the parent. */
  inheritedAt: string
  blocks: ChatBlock[]
  liveReasoning: string
  liveAssistant: string
  /** Stable runtime identity for the current compatibility live overlays. */
  liveReasoningItemId?: string
  liveReasoningTurnId?: string
  liveReasoningCreatedAt?: string
  liveAssistantItemId?: string
  liveAssistantTurnId?: string
  liveAssistantCreatedAt?: string
  lastSeq: number
  input: string
  model: string
  /** Provider paired with `model`; kept local to this side conversation. */
  providerId: string
  reasoningEffort: string
  /** User preference; effective only when this branch selects an eligible Codex model. */
  fastMode: boolean
  attachments: AttachmentReference[]
  busy: boolean
  turnId: string | null
  userItemId: string | null
  error: string | null
}

export type TurnTimingMetrics = {
  avgTtftMs: number | null
  avgTokensPerSecond: number | null
}

export type SidePanelState = {
  open: boolean
  activeSideId: string | null
}

export type SideConversationDraftOptions = {
  model?: string
  providerId?: string
  reasoningEffort?: string
  fastMode?: boolean
  attachments?: AttachmentReference[]
}

export type ChatState = {
  route: AppRoute
  settingsReturnRoute: Exclude<AppRoute, 'settings'>
  pluginHostRoute: PluginHostRoute
  settingsSection: SettingsRouteSection
  initialSetupOpen: boolean
  initialSetupMode: InitialSetupMode
  workspaceRoot: string
  /** True while `workspaceRoot` is a renderer-local (`persist: false`) pick —
   *  host `settings.workspaceRoot` must not overwrite it. */
  workspaceRootLocal: boolean
  workspaceLabel: string
  /** 对话会话的工作目录根(默认 ~/Documents/Kun),供侧边栏对话区块和项目保护使用。 */
  conversationWorkspaceRoot: string
  runtimeConnection: RuntimeConnectionStatus
  runtimeStatus: KunRuntimeStatusPayload | null
  codeWorkspaceRoots: string[]
  /** Extra folders attached to a Code project; persisted in localStorage. */
  codeWorkspaceFolderSets: CodeWorkspaceFolderSetsRegistry
  /** Projects hidden from the Code sidebar/picker; persisted in localStorage. */
  removedCodeWorkspaces: RemovedCodeWorkspacesRegistry
  threads: NormalizedThread[]
  /**
   * Sidebar thread inventory lifecycle. Guards the "no conversations yet"
   * empty state: the sidebar must never render the empty state while the
   * first inventory request is still in flight or failed.
   */
  threadListStatus: 'idle' | 'loading' | 'ready' | 'refreshing' | 'error'
  threadListError: string | null
  /**
   * Per-workspace pagination state, keyed by normalized workspace identity.
   * Only a workspace-scoped Runtime response may populate this map.
   */
  threadListCursorByWorkspace: Record<string, import('./chat-store-thread-pagination').WorkspaceThreadPageMeta>
  knowledgeBaseStatuses: Record<string, KnowledgeBaseIndexStatus[]>
  threadSearch: string
  showArchivedThreads: boolean
  activeThreadId: string | null
  /** Thread selected immediately but whose durable snapshot is still loading. */
  threadLoadingId: string | null
  /** Active-thread durable refresh; unlike initial hydration, its projection stays interactive. */
  threadRefreshingId: string | null
  /** Opaque cursor for the next older durable timeline page. */
  threadHistoryCursor: string | null
  threadHasMoreHistory: boolean
  threadHistoryLoading: boolean
  /** 最近一次在 Code 工作台(chat 路由)选中的会话,供从设置/其他工作区/Connect Phone 返回时恢复。 */
  lastCodeThreadId: string | null
  /** 最近一次在 ADE 工作台选中的会话;与 Code 的记忆互相独立。 */
  lastAdeThreadId: string | null
  /**
   * ADE-mode thread inventory (`workspace_mode=ade`), loaded beside the
   * code-only `threads` inventory. ADE threads never appear in `threads`, so
   * every Code view keeps its previous behavior.
   */
  adeThreads: NormalizedThread[]
  /** Relationship of the active thread (e.g. `side` for a subagent's own session). */
  activeThreadRelation: 'primary' | 'fork' | 'side' | null
  /** Parent thread of the active thread, when it is a `side`/`fork` branch. */
  activeThreadParentId: string | null
  activeThreadGoal: ThreadGoal | null
  activeThreadTodos: ThreadTodoList | null
  blocks: ChatBlock[]
  liveReasoning: string
  liveAssistant: string
  /** Stable runtime identity for the current compatibility live overlays. */
  liveReasoningItemId?: string
  liveReasoningTurnId?: string
  liveReasoningCreatedAt?: string
  liveAssistantItemId?: string
  liveAssistantTurnId?: string
  liveAssistantCreatedAt?: string
  lastSeq: number
  /**
   * Highest delta `seq` (per-thread, monotonic) already folded into the live
   * buffers. Unlike the per-sink `appliedDeltaSeqFloor` closure — which only
   * dedups within ONE subscription — this lives in the store and is shared
   * across every sink. When a long, tool-heavy turn loses its SSE stream and
   * more than one sink is briefly live (recovery / re-subscribe), the per-sink
   * floors are independent and each re-appends the same replayed deltas; the
   * shared floor serializes them so a given seq folds into `liveAssistant` at
   * most once. Reset to the new subscription's `sinceSeq` in lockstep with
   * every `liveAssistant` reset (send / select / recover / live / clear) — and
   * because seqs are per-thread, the reset is what keeps a thread switch from
   * dropping the new thread's low seqs. A genuine new delta always has seq >
   * sinceSeq, so this never drops live text.
   */
  liveDeltaSeqFloor: number
  usageRefreshKey: number
  /** Latest main-agent request context snapshot, tagged with its owning thread. */
  lastContextSnapshot: RequestContextSnapshot | null
  /** Latest truthful optional-capability snapshot for the active delegated route. */
  lastDelegatedRuntimeState: DelegatedRuntimeState | null
  lastHarnessRuntimeState: HarnessRuntimeState | null
  /**
   * Latest cumulative usage snapshot, tagged with the thread it belongs to.
   * This is billing/cache telemetry and must not be used as context occupancy.
   */
  lastTurnUsage: { threadId: string; snapshot: ThreadUsageSnapshot } | null
  /**
   * Per-turn TTFT/TPS averages for the active thread, keyed by turnId. Bounded
   * to the turns currently visible in the timeline; cleared on thread switch.
   */
  turnTimingMetrics: Map<string, TurnTimingMetrics>
  busy: boolean
  /**
   * True right after a thread switch/recovery hydrated a snapshot that claims
   * a running turn, before that claim is re-confirmed by the runtime. The
   * timeline must render history as settled (no live-progress UI, no
   * typewriter replay) while input/disabling decisions still follow `busy`.
   */
  busyUnconfirmed: boolean
  error: string | null
  runtimeErrorDetail: string | null
  currentTurnId: string | null
  currentTurnOrchestration: 'direct' | 'graph' | null
  currentTurnUserId: string | null
  /**
   * Start time of the currently running turn (ms epoch), recovered from the
   * runtime's persisted turn record on hydration/reconciliation. Unlike the
   * live `turnStartedAtByUserId`, this survives a thread switch or renderer
   * restart so elapsed-time displays anchored to it do not reset mid-turn.
   */
  currentTurnStartedAtMs: number | null
  turnStartedAtByUserId: Record<string, number>
  turnDurationByUserId: Record<string, number>
  turnReasoningFirstAtByUserId: Record<string, number>
  turnReasoningLastAtByUserId: Record<string, number>
  inspectorSelectedId: string | null
  composerMode: 'plan' | 'agent' | 'auto'
  /** Composer execution settings mirrored from the runtime settings UI so sends can freeze them per message. */
  composerExecutionSettings: {
    approvalPolicy: ApprovalPolicy
    sandboxMode: SandboxMode
    approvalReviewer: ApprovalReviewer
  } | null
  composerOrchestration: 'direct' | 'graph'
  graphEnabled: boolean
  composerModel: string
  composerProviderId: string
  composerReasoningEffort: ModelReasoningEffort
  /**
   * ADE harness id for the next turn/thread. Empty = thread/runtime default.
   * Persisted per thread via `ThreadComposerSelection`; Code mode ignores it.
   */
  composerHarnessId: string
  /** Credential mode for the selected harness route (`native-login` or a provider id). */
  composerCredentialMode: string
  /**
   * ADE new-session isolation (12 §7.3): 'local' binds the picked workspace
   * directly; 'worktree' asks the host to prepare a fresh task workspace.
   */
  composerIsolation: 'local' | 'worktree'
  composerWorktreeStartFrom?: import('@shared/task-workspace').TaskWorkspaceStartFrom
  /** User preference; effective only for eligible ChatGPT subscription models. */
  composerFastMode: boolean
  composerPickList: string[]
  composerModelGroups: ModelProviderModelGroup[]
  /**
   * Optional subagent profile id selected as the persona for the next new
   * thread / next-turn override. Empty = use the runtime default.
   */
  composerAgentId: string
  /**
   * Selected Code-persona preset id. Empty = no persona. Resolved to text and
   * sent per turn, so switching it never rewrites earlier turns.
   */
  composerPersonaId: string
  /** Whether the experimental composer persona picker and turn override are active. */
  composerPersonaEnabled: boolean
  /** Mirror of `AppSettingsV1.codeAgentPresets` for composer-side resolution. */
  codeAgentPresets: CodeAgentPresetV1[]
  disabledSkillIds: string[]
  queuedMessages: QueuedUserMessage[]
  /** Source-neutral, host-fenced context awaiting one main-chat turn. Legacy field name is persisted for compatibility. */
  extensionComposerContexts: PendingComposerContextEvent[]
  watchTurnCompletion: Record<string, boolean>
  /** Threads whose live runtime is currently awaiting a user_input answer. */
  awaitingUserInputThreadIds: Record<string, true>
  /** Completion attention keyed by thread. Legacy boolean true reads as completed. */
  unreadThreadIds: CompletionAttentionRegistry
  /** Write assistant thread whose timeline is actually mounted in the visible right panel. */
  writeAssistantVisibleThreadId: string | null
  scheduledThreadActivities: Record<string, ScheduledThreadActivity>
  /**
   * Side conversations opened via `/btw`. The main thread selection
   * and subscription are never touched by these entries.
   */
  sideConversations: Record<string, SideConversation>
  sidePanel: SidePanelState
  clawChannels: ClawImChannelV1[]
  activeClawChannelId: string
  appendLocalClawTurn: (userText: string, replyText: string) => void
  setError: (message: string | null) => void
  setComposerMode: (mode: 'plan' | 'agent' | 'auto') => void
  setComposerExecutionSettings: (settings: {
    approvalPolicy: ApprovalPolicy
    sandboxMode: SandboxMode
    approvalReviewer: ApprovalReviewer
  } | null) => void
  setComposerOrchestration: (mode: 'direct' | 'graph') => void
  setComposerModel: (modelId: string, providerId?: string) => void
  /**
   * ADE-only: switch the harness (and optional credential mode) used by the
   * next turn or next new thread. Confirmed switches on a non-empty thread
   * apply to subsequent turns only — the runtime opens a fresh native
   * session with a deterministic handoff summary (docs/ade/08).
   */
  setComposerHarness: (harnessId: string, credentialMode?: string) => void
  /** ADE-only: pick the isolation used by the next new session (12 §7.3). */
  setComposerIsolation: (
    isolation: 'local' | 'worktree',
    startFrom?: import('@shared/task-workspace').TaskWorkspaceStartFrom
  ) => void
  /**
   * ADE-only: (re)request a task worktree for an existing thread — used by
   * the isolation picker's retry affordance after a failed preparation.
   */
  requestAdeThreadWorkspace: (
    threadId: string,
    startFrom?: import('@shared/task-workspace').TaskWorkspaceStartFrom
  ) => Promise<boolean>
  setComposerReasoningEffort: (effort: ModelReasoningEffort) => void
  setComposerFastMode: (enabled: boolean) => void
  setComposerAgentId: (agentId: string) => void
  setComposerPersonaId: (presetId: string) => void
  loadComposerModels: () => Promise<void>
  setRoute: (r: AppRoute) => void
  openWrite: (options?: { activationGuard?: () => boolean }) => Promise<void>
  openCode: (options?: { activationGuard?: () => boolean }) => Promise<void>
  /** Enter the ADE workspace mode, restoring the last-open ADE thread. */
  openAde: (options?: { activationGuard?: () => boolean }) => Promise<void>
  /** Reload the ADE-mode (`workspace_mode=ade`) thread inventory. */
  refreshAdeThreads: () => Promise<void>
  ensureWriteThreadForWorkspace: (workspaceRoot?: string, activeFilePath?: string) => Promise<string | null>
  createWriteThread: (
    workspaceRoot?: string,
    activeFilePath?: string,
    options?: { title?: string; titleAuto?: boolean }
  ) => Promise<string | null>
  ensureDesignThreadForWorkspace: (workspaceRoot?: string, docId?: string) => Promise<string | null>
  createDesignThread: (
    workspaceRoot?: string,
    docId?: string,
    options?: CreateDesignThreadOptions
  ) => Promise<string | null>
  clearDesignHistory: (
    workspaceRoot: string,
    docId: string,
    options?: ClearDesignHistoryOptions
  ) => Promise<ClearDesignHistoryResult>
  selectWriteThread: (
    threadId: string,
    workspaceRoot?: string,
    activeFilePath?: string
  ) => Promise<void>
  setWriteAssistantVisibleThreadId: (threadId: string | null) => void
  openSettings: (section?: SettingsRouteSection) => void
  /** 离开设置页:直接把 route 恢复为进入设置前的工作台路由,不经过会重新解析/切换会话的 open* 入口。 */
  closeSettings: () => void
  openPlugins: (host?: PluginHostRoute) => void
  openClaw: () => void
  openBoard: (workspaceRoot?: string) => void
  openSchedule: () => void
  openWorkflow: () => void
  openDesign: () => void
  clearActiveThreadSelection: () => void
  refreshClawChannels: () => Promise<void>
  addClawChannel: (
    provider: ClawImProvider,
    agentProfile?: Partial<ClawImAgentProfileV1>,
    platformCredential?: ClawImPlatformCredentialV1,
    options?: {
      channelId?: string
      model?: string
      workspaceRoot?: string
      enabled?: boolean
      im?: Partial<ClawImSettingsV1>
      preserveRoute?: boolean
    }
  ) => Promise<void>
  selectClawChannel: (channelId: string) => Promise<void>
  selectClawConversation: (channelId: string, threadId: string) => Promise<void>
  deleteClawChannel: (channelId: string) => Promise<void>
  resetClawChannelSession: (channelId: string) => Promise<void>
  setClawChannelModel: (channelId: string, model: string, providerId?: string) => Promise<void>
  openInitialSetup: (mode?: InitialSetupMode) => void
  closeInitialSetup: () => void
  boot: () => Promise<void>
  probeRuntime: (mode?: 'user' | 'background', options?: { restart?: boolean }) => Promise<void>
  chooseWorkspace: (options?: {
    createThreadAfter?: boolean
    selectThreadAfter?: boolean
    /**
     * `false` keeps the selection renderer-local (no `settings.workspaceRoot`
     * write). Remote/mobile clients use this so browsing a project on a phone
     * never moves the desktop host's current project.
     */
    persist?: boolean
  }) => Promise<string | null>
  selectWorkspaceRoot: (workspaceRoot: string, options?: {
    /** See `chooseWorkspace` — `false` skips the host settings write. */
    persist?: boolean
  }) => Promise<string | null>
  clearWorkspace: () => Promise<void>
  /**
   * Remove a sidebar project from the Code project list. Keeps threads,
   * snapshots and files on disk; re-adding the directory later restores it.
   * `relatedPaths` carries the sidebar-resolved worktree/main aliases so the
   * whole project identity is hidden at once.
   */
  removeWorkspace: (workspacePath: string, relatedPaths?: string[]) => Promise<void>
  /** Add a sibling directory to the current Code project without creating a new project. */
  addWorkspaceFolder: (workspacePath?: string) => Promise<boolean>
  /** Remove a previously attached extra directory from a Code project. */
  removeWorkspaceFolder: (workspacePath: string, extraRoot: string) => Promise<boolean>
  refreshThreads: () => Promise<void>
  /** Reconcile targeted push invalidations or run a legacy discovery scan. */
  syncSidebarActivity: (options?: {
    threadIds?: string[]
    deletedThreadIds?: string[]
    includeSchedule?: boolean
    scheduleStatus?: import('@shared/app-settings').ScheduleRuntimeStatus
  }) => Promise<boolean>
  /** Append the next older page of threads for a workspace ("show more"). */
  loadMoreThreads: (workspacePath: string) => Promise<void>
  setThreadKnowledgeBases: (threadId: string, mounts: KnowledgeBaseMount[]) => Promise<boolean>
  refreshThreadKnowledgeBases: (threadId?: string) => Promise<void>
  reindexThreadKnowledgeBase: (threadId: string, knowledgeBaseId: string) => Promise<boolean>
  setThreadSearch: (query: string) => void
  setShowArchivedThreads: (show: boolean) => void
  createThread: (options?: {
    workspaceRoot?: string
    forceNew?: boolean
    /** Durable ownership for renderer-created Code-workbench threads. */
    agentSurface?: 'code' | 'design'
    /** Owning workspace mode for the new thread; absent counts as 'code'. */
    workspaceMode?: 'ade'
    /** Prevent a completed async creation from overriding newer navigation. */
    activationGuard?: () => boolean
    /** When true, checkout the selected branch into an isolated worktree. */
    useWorktreePool?: boolean
    worktreeBranch?: string
    /**
     * ADE one-to-one threads (00 §5): pin the thread to this harness from
     * creation instead of inferring a route from the composer model.
     */
    harnessId?: string
    credentialMode?: 'native-login' | 'provider' | 'kun-gateway'
    /** Explicit provider/model pins for the new thread (p4 §3.6 defaults). */
    providerId?: string
    model?: string
    /**
     * Optional subagent profile id to bind the new thread to. When set
     * and the profile mode is 'primary' or 'all', the agent's
     * providerId / model / systemPrompt are snapshotted onto the thread.
     */
    agentId?: string
    /**
     * 创建一条不绑定项目文件夹的对话会话:在 conversationWorkspaceRoot 下
     * 自动创建一个时间戳子目录作为工作目录。
     */
    conversation?: boolean
  }) => Promise<string | null>
  createConversation: (options?: { activationGuard?: () => boolean }) => Promise<void>
  selectThread: (id: string, options?: {
    /** Ignore this selection when a newer renderer navigation intent wins. */
    selectionGuard?: () => boolean
  }) => Promise<void>
  loadEarlierThreadHistory: () => Promise<boolean>
  /**
   * 打开 SSE 订阅一条 thread(不预先拉 getThreadDetail)。
   * 用于:onClawChannelActivity 自动切到 bot thread,让流式 deltas 立即可见。
   * 与 selectThread 的区别:selectThread 先做 HTTP getThreadDetail 拉元数据,
   * subscribeThreadEventsLive 直接开 SSE (sinceSeq=0),跳过 HTTP 抢在 SSE 之前。
   */
  subscribeThreadEventsLive: (threadId: string) => Promise<void>
  recoverActiveTurn: (options?: ThreadRecoveryOptions) => Promise<boolean>
  sendMessage: (text: string, mode?: string, overrides?: SendMessageOverrides) => Promise<boolean>
  /**
   * Run a plan build on an external harness inside a host-managed task
   * worktree (07 §10): creates the ADE build thread, parks the
   * `planBuild`-marked turn until the worktree is ready, and flags the
   * Review panel when the turn settles.
   */
  dispatchExternalPlanBuild: (input: ExternalPlanBuildRequest) => Promise<boolean>
  reviewActiveThread: (target: ReviewTarget) => Promise<boolean>
  drainQueuedMessages: () => Promise<void>
  removeQueuedMessage: (id: string) => Promise<void> | void
  restoreQueuedMessage: (id: string, accept?: (message: QueuedUserMessage) => boolean | Promise<boolean>) => Promise<QueuedUserMessage | null>
  reorderQueuedMessage: (id: string, targetId: string, position: 'before' | 'after') => Promise<void> | void
  /** Resume a runtime queue paused by an interrupt. */
  resumeQueuedTurns: () => Promise<boolean>
  guideQueuedMessage: (id: string) => Promise<boolean>
  attachExtensionComposerContext: (event: ExtensionComposerContextEvent) => void
  removeExtensionComposerContext: (attachmentId: string) => void
  attachComposerContext: (event: PendingComposerContextEvent) => void
  removeComposerContext: (attachmentId: string) => void
  clearComposerContexts: (filter?: { source?: 'dev-preview'; threadId?: string }) => void
  rewindAndResend: (userBlockId: string, newText: string) => Promise<void>
  rollbackWorkspaceToCheckpoint: (checkpointId: string) => Promise<void>
  interrupt: (options?: { discard?: boolean }) => Promise<void>
  cancelToolCall: (threadId: string, turnId: string, callId: string) => Promise<boolean>
  renameActiveThread: (title: string) => Promise<void>
  renameThread: (threadId: string, title: string) => Promise<void>
  pinThread: (threadId: string, pinned: boolean) => Promise<void>
  archiveThread: (threadId: string, archived: boolean) => Promise<void>
  compactActiveThread: (reason?: string) => Promise<void>
  archiveActiveThreadToTurn: (turnId: string) => Promise<void>
  forkActiveThread: () => Promise<void>
  forkThreadFromTurn: (turnId: string) => Promise<void>
  setActiveThreadGoal: (objective: string) => Promise<boolean>
  setActiveThreadGoalStatus: (status: ThreadGoalStatus) => Promise<boolean>
  clearActiveThreadGoal: () => Promise<boolean>
  setActiveThreadTodoStatus: (todoId: string, status: ThreadTodoStatus) => Promise<boolean>
  clearActiveThreadTodos: () => Promise<boolean>
  syncPlanTodosFromMarkdown: (
    threadId: string,
    plan: { id: string; relativePath: string },
    markdown: string
  ) => Promise<boolean>
  /**
   * Spawn a side conversation from the active thread. Available even
   * while the active thread is running. Does not change `activeThreadId`.
   * If `seedText` is provided, immediately sends it as the first turn.
   */
  spawnSideConversation: (
    seedText?: string,
    options?: SideConversationDraftOptions
  ) => Promise<string | null>
  /**
   * Open the side chat surface without creating an underlying side
   * thread. The first draft send will create the side thread.
   */
  openSideConversationDraft: () => void
  sendSideMessage: (sideId: string, text: string) => Promise<boolean>
  interruptSide: (sideId: string) => Promise<void>
  resolveSideUserInput: (
    sideId: string,
    blockId: string,
    action: { kind: 'submit'; answers: UserInputAnswer[] } | { kind: 'cancel' }
  ) => Promise<void>
  setSideInput: (sideId: string, text: string) => void
  setSideModel: (sideId: string, model: string, providerId?: string) => void
  setSideReasoningEffort: (sideId: string, effort: string) => void
  setSideFastMode: (sideId: string, enabled: boolean) => void
  setSideAttachments: (sideId: string, attachments: AttachmentReference[]) => void
  selectSideConversation: (sideId: string) => void
  setSidePanelOpen: (open: boolean) => void
  closeSideConversation: (sideId: string) => Promise<void>
  discardSideConversation: (sideId: string) => Promise<void>
  promoteSideConversation: (sideId: string) => Promise<void>
  resumeSessionIntoThread: (
    sessionId: string,
    options?: { model?: string; mode?: string }
  ) => Promise<string | null>
  deleteThread: (threadId: string) => Promise<void>
  resolveApproval: (blockId: string, decision: 'allow' | 'deny') => Promise<void>
  resolveUserInput: (
    blockId: string,
    action: { kind: 'submit'; answers: UserInputAnswer[] } | { kind: 'cancel' }
  ) => Promise<void>
  selectInspectorItem: (id: string | null) => void
  applyI18nFromSettings: (locale: AppLocale) => Promise<void>
  reloadUiSettings: () => Promise<void>
}

export type ChatStoreSet = (
  partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)
) => void

export type ChatStoreGet = () => ChatState
