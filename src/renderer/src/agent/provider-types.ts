import type {
  CoreAttachmentContentResponseJson,
  CoreAttachmentMetadataJson,
  CoreAttachmentTextFallbackJson,
  CoreMemoryDiagnosticsJson,
  CoreMemoryConfirmResultJson,
  CoreMemoryCorrectResultJson,
  CorePendingMemoryCandidateJson,
  CoreMemoryRecordJson,
  CoreMcpOAuthDiagnosticJson,
  CoreQueuedTurnsResponseJson,
  CoreResumeSessionMetadataJson,
  CoreRuntimeInfoJson,
  CoreRuntimeSkillJson,
  CoreRuntimeToolDiagnosticsJson
} from './kun-contract'
import type {
  ApprovalPolicy,
  ApprovalReviewer,
  ModelReasoningEffort,
  SandboxMode
} from '@shared/app-settings'
import type { ComposerContextAttachment } from '@kun/extension-api'
import type {
  DesignDocumentTarget,
  DesignImagePlacementTarget,
  DesignTaskProfile,
  DesignTaskProfileInput
} from './design-task-profile'

import type {
  ApprovalRequestPayload,
  ApprovalReviewEventPayload,
  ApprovalStatusPayload,
  AssistantItemSnapshotPayload,
  ChatBlock,
  CompactionEventPayload,
  DelegatedRuntimeState,
  HarnessRuntimeState,
  HandoffEventPayload,
  NormalizedThread,
  KnowledgeBaseMount,
  KnowledgeBaseIndexStatus,
  RequestContextSnapshot,
  ReviewEventPayload,
  ReviewTarget,
  RuntimeChildEventPayload,
  RuntimeErrorEventPayload,
  RuntimeStatusEventPayload,
  ThreadDeltaEvent,
  ThreadErrorOptions,
  ThreadGoal,
  ThreadGoalStatus,
  ThreadTodoList,
  ThreadTodoSource,
  ThreadTodoStatus,
  ThreadUsageSnapshot,
  ToolEventPayload,
  TurnTerminalEvent,
  UserFileReference,
  UserInputAnswer,
  UserInputRequestPayload,
  UserInputStatusPayload,
  UserMessageEventPayload
} from './types'
import type { WriteTurnContext } from './write-turn-context'
import type {
  ActivityPollResponse,
  ActivitySnapshotResponse
} from '@shared/activity-row'

export type ThreadListOptions = {
  limit?: number
  search?: string
  includeArchived?: boolean
  archivedOnly?: boolean
  includeSide?: boolean
  summary?: boolean
  cursor?: string
  workspace?: string
  /** Extra workspace roots matched alongside `workspace` (e.g. project worktrees). */
  workspaces?: string[]
  /** Filter by owning workspace mode; absent returns every mode. */
  workspaceMode?: 'code' | 'ade'
  /** Unified Code workbench listing of Code and legacy ADE roots. */
  workbenchScope?: 'code'
  lean?: boolean
}

/** Rebuildable thread-index lifecycle exposed by the runtime. */
export type ThreadIndexStatus = 'not_started' | 'running' | 'ready' | 'failed' | 'unavailable'
export type ThreadIndexStatusInfo = {
  status: ThreadIndexStatus
  indexed: number
  total: number
}

/** Paginated sidebar thread listing result. */
export type ThreadListPage = {
  threads: NormalizedThread[]
  /** True only when the runtime acknowledged workbench_scope=code. */
  workbenchScopeApplied?: boolean
  nextCursor?: string
  hasMore: boolean
  total?: number
  indexStatus?: ThreadIndexStatusInfo
}

export type ThreadRuntimeState = {
  activeTurn?: { id: string; status: string; orchestration: 'direct' | 'graph' } | null
  status: string
  updatedAt: string
  latestSeq: number
  replayFloorSeq?: number
  latestTurnId?: string
  latestTurnStatus?: string
  latestTurnOrchestration?: 'direct' | 'graph'
  /** Undefined means an older provider did not expose live input state. */
  pendingUserInputIds?: string[]
}

export type ThreadRuntimeStateBatchResult =
  | { id: string; ok: true; state: ThreadRuntimeState }
  | {
      id: string
      ok: false
      error: { code: 'not_found' | 'unavailable'; message: string }
    }

export type ThreadLiveTextProjection = {
  text: string
  itemId: string
  turnId: string
  createdAt?: string
}

export type ThreadLiveProjection = {
  reasoning?: ThreadLiveTextProjection
  assistant?: ThreadLiveTextProjection
}

export type ThreadDetail = {
  activeTurn?: { id: string; status: string; orchestration: 'direct' | 'graph' } | null
  blocks: ChatBlock[]
  latestSeq: number
  /** Cumulative unfinished text restored separately from settled timeline blocks. */
  liveProjection?: ThreadLiveProjection
  threadStatus?: string
  latestTurnId?: string
  latestTurnStatus?: string
  latestTurnOrchestration?: 'direct' | 'graph'
  latestUserMessageId?: string
  /** Persisted start time of the currently running turn (ms epoch), when known. */
  latestTurnStartedAtMs?: number
  turnDurationByUserId?: Record<string, number>
  usage?: ThreadUsageSnapshot
  relation?: 'primary' | 'fork' | 'side'
  parentThreadId?: string
  model?: string
  goal?: ThreadGoal | null
  todos?: ThreadTodoList | null
  /** Original detail response size, used only to bound renderer snapshots. */
  payloadBytes?: number
  historyTarget?: { turnId: string; itemId?: string; previousCursor?: string; nextCursor?: string }
  historyCursor?: string
  hasMoreHistory?: boolean
  designProfile?: DesignTaskProfile
  additionalWorkspaces?: string[]
}

export type ThreadEventSink = {
  /**
   * Wrap one inbound event batch so intermediate store writes commit once.
   * Optional: sinks without it dispatch event-by-event as before.
   */
  runEventBatch?<T>(work: () => Promise<T>): Promise<T>
  /** The HTTP/SSE stream is established, even when no replay or live event is pending. */
  onConnected?(): void
  /** Persisted replay reached the server's fixed synchronization boundary. */
  onReplaySynchronized?(cursor: number): void
  onSeq(seq: number): void
  onDeltas(deltas: ThreadDeltaEvent[]): void
  onAssistantItem?(item: AssistantItemSnapshotPayload): void
  onUserMessage(ev: UserMessageEventPayload, seq?: number): void
  onTool(ev: ToolEventPayload): void
  onCompaction(ev: CompactionEventPayload): void
  onReview?(ev: ReviewEventPayload): void
  onApproval(req: ApprovalRequestPayload): void
  onApprovalStatus?(ev: ApprovalStatusPayload): void
  onApprovalReview?(ev: ApprovalReviewEventPayload): void
  onUserInput(req: UserInputRequestPayload): void
  onUserInputStatus(ev: UserInputStatusPayload): void
  onRuntimeStatus?(ev: RuntimeStatusEventPayload): void
  onRuntimeError?(ev: RuntimeErrorEventPayload): void
  onGoal(ev: { threadId: string; goal: ThreadGoal | null; cleared?: boolean; createdAt?: string }): void
  onTodos?(ev: { threadId: string; todos: ThreadTodoList | null; cleared?: boolean; createdAt?: string }): void
  /** Thread metadata changed out-of-band (e.g. the backend LLM titler upgraded the title). */
  onThreadUpdated?(ev: {
    threadId: string
    title?: string
    titleAuto?: boolean
    status?: string
    agentSurface?: 'code' | 'write' | 'design'
    designProfile?: DesignTaskProfile
  }): void
  /** Parent turn reached a terminal state. Identity fields let the store reject stale or child-scoped completion. */
  onTurnComplete(event?: TurnTerminalEvent): void
  onError(err: Error, options?: ThreadErrorOptions): void
  /** Optional: cumulative usage update for the thread. */
  onUsage?(usage: ThreadUsageSnapshot): void
  /** Optional: request-local context accounting for the main agent. */
  onContextSnapshot?(snapshot: RequestContextSnapshot): void
  onDelegatedRuntimeState?(state: DelegatedRuntimeState): void
  onHarnessRuntimeState?(state: HarnessRuntimeState): void
  /** Harness-reported session surface: native commands, mode (03 §7.3). */
  onHarnessSessionState?(state: import('@shared/ade-harnesses').AdeHarnessSessionState): void
  /** Task-workspace lifecycle on the owning thread (docs/ade/07 §5). */
  onTaskWorkspace?(ev: import('@shared/task-workspace').TaskWorkspaceThreadEvent): void
  /** Deterministic handoff brief injected into a delegated turn (docs/ade/08). */
  onHandoff?(ev: HandoffEventPayload): void
  /** Safe child lifecycle/activity projected onto the parent thread. */
  onChildRuntimeEvent?(event: RuntimeChildEventPayload): void
  /** Raw versioned Graph envelope; the Graph projection owns validation/reconciliation. */
  onGraphEvent?(event: unknown): void
  /** Raw versioned Graph planning lifecycle; the Graph projection owns reconciliation. */
  onGraphPlanningEvent?(event: unknown): void
}

export interface AgentProvider {
  readonly id: 'kun'
  readonly displayName: string
  getCapabilities(): {
    interrupt: boolean
    stream: boolean
    approvals: boolean
    attachFiles: boolean
    review?: boolean
  }
  connect(): Promise<void>
  listThreads(options?: ThreadListOptions): Promise<NormalizedThread[]>
  /** Optional paginated listing used by the sidebar "show more" flow. */
  listThreadsPage?(options?: ThreadListOptions): Promise<ThreadListPage>
  /** Execution-unit activity feed (docs/ade/06 §9); absent when unsupported. */
  getActivitySnapshot?(options?: {
    scope?: 'all' | 'workspace'
    workspace?: string
  }): Promise<ActivitySnapshotResponse>
  pollActivity?(
    cursor: string,
    waitMs: number,
    signal?: AbortSignal
  ): Promise<ActivityPollResponse>
  ackActivity?(unitId: string): Promise<void>
  dismissActivity?(unitId: string): Promise<void>
  pinActivity?(unitId: string, pinned?: boolean): Promise<void>
  /** Foreground-thread report for activity dormancy (docs/ade/06 §7.2 cond. 4). */
  reportActivityForeground?(threadId: string): Promise<void>
  /** Pending approvals, optionally scoped to a thread (P3-19 attention list). */
  listPendingApprovals?(threadId?: string): Promise<import('@shared/ade-approvals').PendingApprovalItem[]>
  /** Task workspaces bound to a thread (docs/ade/07 §11). */
  listTaskWorkspaces?(options?: {
    boundThreadId?: string
    ownerThreadId?: string
  }): Promise<import('@shared/task-workspace').TaskWorkspaceListResponse>
  /** Create an isolated task workspace; returns the `creating` record (07 §5). */
  createTaskWorkspace?(
    input: import('@shared/task-workspace').CreateTaskWorkspaceRequest
  ): Promise<import('@shared/task-workspace').TaskWorkspaceRecordResponse>
  retryTaskWorkspace?(workspaceId: string): Promise<import('@shared/task-workspace').TaskWorkspaceRecordResponse>
  /** Per-file diff stats for the review panel (docs/ade/11 §3). */
  getTaskWorkspaceDiff?(
    workspaceId: string
  ): Promise<import('@shared/task-workspace').TaskWorkspaceDiffListResponse>
  getTaskWorkspaceDiffFile?(
    workspaceId: string,
    path: string
  ): Promise<import('@shared/task-workspace').TaskWorkspaceDiffFileResponse>
  /** Per-line AI authorship for the file's current content (11 §6). */
  getTaskWorkspaceAttribution?(
    workspaceId: string,
    path: string
  ): Promise<import('@shared/task-workspace').TaskWorkspaceAttribution>
  /** Forge availability + PR snapshot for the workspace (11 §7.2). */
  getChangeRequest?(
    workspaceId: string
  ): Promise<import('@shared/task-workspace').ChangeRequestStatus>
  /** Push the workspace branch and open a PR through `gh`. */
  createChangeRequest?(
    workspaceId: string,
    input?: import('@shared/task-workspace').CreateChangeRequestRequest
  ): Promise<{ request: import('@shared/task-workspace').ChangeRequestSnapshot | undefined }>
  /** Read-only integrate availability for the review primary action (11 §7.1). */
  getTaskWorkspaceIntegratePreview?(
    workspaceId: string
  ): Promise<import('@shared/task-workspace').TaskWorkspaceIntegratePreviewResponse>
  integrateTaskWorkspace?(
    workspaceId: string,
    mode: import('@shared/task-workspace').TaskWorkspaceIntegrateMode,
    previewToken?: string
  ): Promise<import('@shared/task-workspace').TaskWorkspaceIntegrateResponse>
  previewTaskWorkspaceDiscard?(
    workspaceId: string
  ): Promise<import('@shared/task-workspace').TaskWorkspaceDiscardPreview>
  discardTaskWorkspace?(
    workspaceId: string
  ): Promise<import('@shared/task-workspace').TaskWorkspaceRecordResponse>
  cleanupTaskWorkspace?(
    workspaceId: string
  ): Promise<import('@shared/task-workspace').TaskWorkspaceRecordResponse>
  /** Branches kept for human review after integrate cleanup (07 §8.3). */
  listPreservedBranches?(
    repoRoot: string
  ): Promise<import('@shared/task-workspace').PreservedBranchesResponse>
  /** ADE team overview for Mission Control cards (docs/ade/09 §9). */
  getTeamOverview?(
    managerThreadId: string
  ): Promise<import('@shared/ade-teams').AdeTeamOverview | null>
  /** User answers a worker question (09 §6.4; `answeredBy: 'user'`). */
  answerTeamQuestion?(questionId: string, answer: string): Promise<void>
  /** Worker + owning team for the worker-thread banner (09 §9). */
  getTeamWorker?(
    workerId: string
  ): Promise<{ team: import('@shared/ade-teams').AdeTeamRecord; worker: import('@shared/ade-teams').AdeTeamWorker } | null>
  /**
   * Harness catalog rows with cached detection status (01 §7, 12 §7.2).
   * `waitMs` asks the runtime to hold the response until inflight
   * detections settle or the budget elapses (P4-02).
   */
  listHarnesses?(options?: {
    includeDisabled?: boolean
    waitMs?: number
  }): Promise<import('@shared/ade-harnesses').AdeHarnessRow[]>
  /** Models a harness accepts (01 §9): static, probed, or provider-derived. */
  listHarnessModels?(
    harnessId: string,
    credentialMode?: string,
    selectedModel?: string
  ): Promise<import('@shared/ade-harnesses').AdeHarnessModels>
  /** Force fresh detection for one harness; returns the updated row. */
  probeHarness?(
    harnessId: string
  ): Promise<import('@shared/ade-harnesses').AdeHarnessRow>
  /**
   * Progressive connection test (p4 §3.5, P4-10): detect → handshake →
   * optional trial turn. Trial consumes quota on the harness's credential.
   */
  testHarness?(
    harnessId: string,
    input: import('@shared/ade-harnesses').AdeHarnessTestRequest,
    options?: { signal?: AbortSignal }
  ): Promise<import('@shared/ade-harnesses').AdeHarnessTestResult>
  /**
   * Pre-save handshake for a custom ACP definition (p4 §3.7, P4-12).
   */
  probeHarnessDefinition?(
    input: import('@shared/ade-harnesses').AdeHarnessProbeDefinitionRequest,
    options?: { signal?: AbortSignal }
  ): Promise<import('@shared/ade-harnesses').AdeHarnessProbeDefinitionResult>
  /** Store a `secretEnv` value; returns the opaque credential-store ref. */
  storeHarnessSecret?(value: string): Promise<string>
  /** Release a stored secret (e.g. when a secretEnv row is removed). */
  deleteHarnessSecret?(secretRef: string): Promise<void>
  /** Worker control: take-over / hand-back / stop / detach (09 §9). */
  controlTeamWorker?(
    workerId: string,
    action: 'take-over' | 'hand-back' | 'stop' | 'detach'
  ): Promise<void>
  /** Same-task race compare + user decision (docs/ade/10 §6, 11 §5). */
  getRaceComparison?(raceId: string): Promise<import('@shared/ade-teams').AdeRaceComparison>
  decideRace?(raceId: string, winnerDispatchId: string): Promise<void>
  discardRaceOthers?(raceId: string): Promise<void>
  /** Host check commands against the worker's task workspace (10 §4.2). */
  runTeamWorkerChecks?(
    workerId: string
  ): Promise<import('@shared/ade-teams').AdeRunWorkerChecksResult>
  /** Per-workspace review comments shared across clients (docs/ade/11 §4). */
  listReviewComments?(
    workspaceId: string
  ): Promise<import('@shared/review-comment').ReviewCommentFile>
  createReviewComment?(
    workspaceId: string,
    input: import('@shared/review-comment').CreateReviewCommentInput
  ): Promise<{ comment: import('@shared/review-comment').ReviewComment }>
  updateReviewComment?(
    workspaceId: string,
    commentId: string,
    input: import('@shared/review-comment').UpdateReviewCommentInput
  ): Promise<{ comment: import('@shared/review-comment').ReviewComment }>
  sendReview?(
    workspaceId: string,
    input: import('@shared/review-comment').SendReviewInput,
    language?: string
  ): Promise<import('@shared/review-comment').SendReviewResponse>
  /** Rebuild a recorded handoff brief on demand (docs/ade/impl §P0-14). */
  getHandoffPreview?(threadId: string, turnId: string): Promise<{
    turnId: string
    reason: string
    mode: string
    from: { harnessName: string; model?: string }
    to: { harnessName: string; model?: string }
    brief: string
    briefDigest: string
    recordedBriefDigest: string
  }>
  createThread(input: { workspace?: string; title?: string; titleAuto?: boolean; mode?: string; agentSurface?: 'code' | 'write' | 'design'; workspaceMode?: 'code' | 'ade'; collaboration?: { enabled: boolean }; routeIntent?: 'explicit' | 'inherit'; workspaceIsolation?: 'local' | 'worktree'; projectDefaultsRevision?: string; agentId?: string; providerId?: string; accountId?: string; model?: string; systemPrompt?: string; additionalWorkspaces?: string[]; harnessId?: string; credentialMode?: string; taskWorkspaceId?: string }): Promise<NormalizedThread>
  getThreadDetail(threadId: string, options?: {
    before?: string
    turnId?: string
    itemId?: string
    signal?: AbortSignal
    priority?: 'foreground' | 'background'
  }): Promise<ThreadDetail>
  /** Lean single-thread projection for targeted sidebar hydration. */
  getThreadSummary?(threadId: string): Promise<NormalizedThread>
  getThreadState(threadId: string, options?: { signal?: AbortSignal }): Promise<ThreadRuntimeState>
  /** Optional bounded bulk capability for background observers. */
  getThreadStates?(threadIds: string[]): Promise<ThreadRuntimeStateBatchResult[]>
  sendUserMessage(
    threadId: string,
    text: string,
    options?: {
      clientRequestId?: string
      /** Queue this turn durably when the thread already has an active turn. */
      enqueueIfBusy?: boolean
      mode?: string
      orchestration?: 'direct' | 'graph'
      model?: string
      providerId?: string
      accountId?: string
      /** ADE harness override for this turn; absent inherits the thread (01 §4). */
      harnessId?: string
      /** Harness credential path; absent = the harness's default. */
      credentialMode?: 'native-login' | 'provider' | 'kun-gateway'
      reasoningEffort?: string
      serviceTier?: 'priority'
      subagentResume?: { childId: string; expectedResumeCount: number }
      messageSource?: 'design_continuation'
      displayText?: string
      guiPlan?: {
        operation: 'draft' | 'refine'
        workspaceRoot: string
        relativePath: string
        planId: string
        sourceRequest?: string
        title?: string
      }
      guiDesignCanvas?: boolean
      guiExcalidrawCanvas?: boolean
      guiDesignMode?: boolean
      persona?: string
      agentSurface?: 'code' | 'write' | 'design'
      approvalPolicy?: ApprovalPolicy
      sandboxMode?: SandboxMode
      approvalReviewer?: ApprovalReviewer
      designProfile?: DesignTaskProfileInput
      designDocumentTarget?: DesignDocumentTarget
      designImagePlacementTarget?: DesignImagePlacementTarget
      guiDesignArtifact?: {
        kind: 'svg'
        artifactId: string
        relativePath: string
      }
      attachmentIds?: string[]
      workspaceCheckpointId?: string
      workspaceCheckpointRequestId?: string
      fileReferences?: UserFileReference[]
      composerContexts?: ComposerContextAttachment[]
      /** ADE manager sends acknowledge these worker notices on admission. */
      ackNoticeIds?: string[]
      /** Managed plan-build turn; Kun enforces isolated-worktree admission (07 §10). */
      planBuild?: boolean
      writeContext?: WriteTurnContext
    }
  ): Promise<{
    turnId: string
    threadId: string
    userMessageItemId?: string
    status?: 'queued' | 'running' | 'completed' | 'failed' | 'aborted'
    queuedPosition?: number
    agentSurface?: 'code' | 'write' | 'design'
    /** Durable thread ownership; agentSurface above is only this turn's intent. */
    threadAgentSurface?: 'code' | 'write' | 'design'
    designProfile?: DesignTaskProfile
    designDocumentTarget?: DesignDocumentTarget
  }>
  rewindThread?(threadId: string, turnId: string): Promise<void>
  reviewThread?(
    threadId: string,
    target: ReviewTarget,
    options?: {
      model?: string
      providerId?: string
      accountId?: string
      reasoningEffort?: ModelReasoningEffort
    }
  ): Promise<{ turnId: string; threadId: string; userMessageItemId?: string; reviewItemId?: string }>
  getRuntimeInfo?(): Promise<CoreRuntimeInfoJson>
  getToolDiagnostics?(): Promise<CoreRuntimeToolDiagnosticsJson>
  getMcpOAuthDiagnostics?(): Promise<CoreMcpOAuthDiagnosticJson[]>
  clearMcpOAuthCredentials?(serverId?: string): Promise<string[]>
  authorizeMcpOAuthCredentials?(serverId: string): Promise<import('./kun-contract').CoreMcpOAuthAuthorizeResponseJson>
  listSkills?(): Promise<CoreRuntimeSkillJson[]>
  uploadAttachment?(input: {
    name: string
    mimeType?: string
    dataBase64: string
    documentText?: string
    documentFormat?: 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'text' | 'csv' | 'json' | 'xml'
    sourceSha256?: string
    pageCount?: number
    localFilePath?: string
    textFallback?: CoreAttachmentTextFallbackJson
    visualPreview?: CoreAttachmentTextFallbackJson
    threadId?: string
    workspace?: string
  }): Promise<CoreAttachmentMetadataJson>
  getAttachmentContent?(
    attachmentId: string,
    options?: { threadId?: string; workspace?: string }
  ): Promise<CoreAttachmentContentResponseJson>
  listMemories?(options?: { workspace?: string; project?: string; includeDeleted?: boolean; all?: boolean }): Promise<CoreMemoryRecordJson[]>
  createMemory?(input: {
    content: string
    scope?: 'user' | 'workspace' | 'project'
    workspace?: string
    project?: string
    tags?: string[]
    confidence?: number
    type?: CoreMemoryRecordJson['type']
    authority?: CoreMemoryRecordJson['authority']
    importance?: number
    observedAt?: string
    validFrom?: string
    validTo?: string
    expiresAt?: string
    disabled?: boolean
    sources?: Array<Omit<NonNullable<CoreMemoryRecordJson['sources']>[number], 'id'> & { id?: string }>
  }): Promise<CoreMemoryRecordJson>
  updateMemory?(
    memoryId: string,
    patch: { content?: string; tags?: string[]; confidence?: number; importance?: number; type?: CoreMemoryRecordJson['type']; authority?: CoreMemoryRecordJson['authority']; disabled?: boolean },
    options?: { workspace?: string; project?: string }
  ): Promise<CoreMemoryRecordJson>
  deleteMemory?(memoryId: string, options?: { workspace?: string; project?: string }): Promise<CoreMemoryRecordJson>
  getMemoryDiagnostics?(): Promise<CoreMemoryDiagnosticsJson>
  confirmMemory?(
    memoryId: string,
    operationId: string,
    access?: { workspace?: string; project?: string }
  ): Promise<CoreMemoryConfirmResultJson>
  correctMemory?(
    memoryId: string,
    operationId: string,
    replacement: {
      content: string
      tags?: string[]
      confidence?: number
      importance?: number
      type?: CoreMemoryRecordJson['type']
      observedAt?: string
      validFrom?: string | null
      validTo?: string | null
      expiresAt?: string | null
    },
    access?: { workspace?: string; project?: string }
  ): Promise<CoreMemoryCorrectResultJson>
  listMemoryDistillationCandidates?(workspace: string): Promise<CorePendingMemoryCandidateJson[]>
  decideMemoryDistillationCandidate?(
    candidateId: string,
    decision: 'allow' | 'deny' | 'withdraw',
    workspace: string
  ): Promise<CorePendingMemoryCandidateJson>
  steerUserMessage?(
    threadId: string,
    turnId: string,
    text: string,
    options?: { displayText?: string; attachmentIds?: string[]; operationId?: string; sourceTurnId?: string }
  ): Promise<void>
  interruptTurn(threadId: string, turnId: string, options?: { discard?: boolean }): Promise<void>
  cancelQueuedTurn?(threadId: string, turnId: string): Promise<void>
  moveQueuedTurn?(
    threadId: string,
    turnId: string,
    position: { beforeTurnId?: string; afterTurnId?: string }
  ): Promise<void>
  resumeQueuedTurns?(threadId: string): Promise<{ started: boolean; turnId?: string }>
  cancelToolCall?(
    threadId: string,
    turnId: string,
    callId: string
  ): Promise<{ status: 'cancellation_requested' | 'already_requested' }>
  /**
   * Rename a thread. `auto` marks the title as provisional/auto (true, e.g. the
   * client first-message heuristic — the backend LLM titler may upgrade it) or
   * user-set/locked (false). Omit to leave the title's auto flag unchanged.
   */
  renameThread(threadId: string, title: string, auto?: boolean): Promise<void>
  updateThreadWorkspace?(threadId: string, workspace: string): Promise<void>
  updateThreadCollaboration?(threadId: string, enabled: boolean): Promise<NormalizedThread>
  /** Atomically bind a ready task workspace (07 §5): path + taskWorkspaceId. */
  bindThreadTaskWorkspace?(
    threadId: string,
    input: { taskWorkspaceId: string; workspace: string }
  ): Promise<NormalizedThread>
  updateThreadAdditionalWorkspaces?(threadId: string, additionalWorkspaces: string[]): Promise<NormalizedThread>
  updateThreadKnowledgeBases?(threadId: string, mounts: KnowledgeBaseMount[]): Promise<NormalizedThread>
  getThreadKnowledgeBases?(threadId: string): Promise<{
    mounts: KnowledgeBaseMount[]
    statuses: KnowledgeBaseIndexStatus[]
  }>
  reindexThreadKnowledgeBase?(threadId: string, knowledgeBaseId: string): Promise<KnowledgeBaseIndexStatus>
  updateThreadPinned?(threadId: string, pinned: boolean): Promise<void>
  archiveThread?(threadId: string, archived: boolean): Promise<void>
  deleteThread(threadId: string): Promise<void>
  deleteThreadsByWorkspace?(workspace: string): Promise<string[]>
  compactThread?(threadId: string, reason?: string): Promise<{ replacedTokens: number } | void>
  archiveThreadHistory?(threadId: string, cutoffTurnId: string): Promise<{
    replacedTokens: number
    archivedItems: number
    retainedItems: number
    archivePath: string
  }>
  getThreadGoal?(threadId: string): Promise<ThreadGoal | null>
  setThreadGoal?(
    threadId: string,
    patch: { objective?: string; status?: ThreadGoalStatus; tokenBudget?: number | null }
  ): Promise<ThreadGoal>
  clearThreadGoal?(threadId: string): Promise<boolean>
  getThreadTodos?(threadId: string): Promise<ThreadTodoList | null>
  updateThreadExecutionTask?(threadId: string, taskId: string,
    patch: { expectedRevision: number; clientRequestId: string; status: ThreadTodoStatus }): Promise<ThreadTodoList>
  setThreadTodos?(
    threadId: string,
    todos: Array<{
      id?: string
      content: string
      status: ThreadTodoStatus
      source?: ThreadTodoSource
    }>
  ): Promise<ThreadTodoList>
  syncThreadTodosFromPlan?(
    threadId: string,
    plan: { planId: string; relativePath: string; markdown: string }
  ): Promise<ThreadTodoList>
  clearThreadTodos?(threadId: string): Promise<boolean>
  forkThread?(
    threadId: string,
    options?: {
      relation?: 'primary' | 'fork' | 'side'
      title?: string
      turnId?: string
      workspace?: string
      designDocumentTarget?: DesignDocumentTarget
      designCloneOperationId?: string
    }
  ): Promise<NormalizedThread>
  getResumeSessionMetadata?(sessionId: string): Promise<CoreResumeSessionMetadataJson>
  getQueuedTurns?(threadId: string): Promise<CoreQueuedTurnsResponseJson>
  resumeSession?(
    sessionId: string,
    options?: {
      model?: string
      mode?: string
      workspace?: string
      designDocumentTarget?: DesignDocumentTarget
      designCloneOperationId?: string
    }
  ): Promise<{ threadId: string; sessionId: string }>
  subscribeThreadEvents(
    threadId: string,
    sinceSeq: number,
    sink: ThreadEventSink,
    signal: AbortSignal
  ): Promise<void>
  /** Protected Main-owned approval decision; raw renderer HTTP is forbidden. */
  submitApprovalDecision?(
    approvalId: string,
    decision: 'allow' | 'deny',
    userInitiated?: boolean
  ): Promise<'submitted' | 'cancelled' | void>
  /** Runtime HTTP compatibility path for request_user_input responses. */
  submitUserInputResponse?(requestId: string, answers: UserInputAnswer[]): Promise<void>
  cancelUserInput?(requestId: string): Promise<void>
}
