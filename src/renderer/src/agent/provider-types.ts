import type {
  CoreAttachmentContentResponseJson,
  CoreAttachmentMetadataJson,
  CoreAttachmentTextFallbackJson,
  CoreMemoryDiagnosticsJson,
  CoreMemoryRecordJson,
  CoreMcpOAuthDiagnosticJson,
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

export type ThreadListOptions = {
  limit?: number
  search?: string
  includeArchived?: boolean
  archivedOnly?: boolean
  includeSide?: boolean
  summary?: boolean
  cursor?: string
  workspace?: string
  lean?: boolean
}

/** Paginated sidebar thread listing result. */
export type ThreadListPage = {
  threads: NormalizedThread[]
  nextCursor?: string
  hasMore: boolean
  total?: number
}

export type ThreadRuntimeState = {
  status: string
  updatedAt: string
  latestSeq: number
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
  historyCursor?: string
  hasMoreHistory?: boolean
  designProfile?: DesignTaskProfile
}

export type ThreadEventSink = {
  /** The HTTP/SSE stream is established, even when no replay or live event is pending. */
  onConnected?(): void
  /** Persisted replay reached the server's fixed synchronization boundary. */
  onReplaySynchronized?(cursor: number): void
  onSeq(seq: number): void
  onDeltas(deltas: ThreadDeltaEvent[]): void
  onAssistantItem?(item: AssistantItemSnapshotPayload): void
  onUserMessage(ev: UserMessageEventPayload): void
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
  createThread(input: { workspace?: string; title?: string; titleAuto?: boolean; mode?: string; agentSurface?: 'code' | 'write' | 'design'; agentId?: string; providerId?: string; accountId?: string; model?: string; systemPrompt?: string }): Promise<NormalizedThread>
  getThreadDetail(threadId: string, options?: { before?: string }): Promise<ThreadDetail>
  getThreadState(threadId: string): Promise<ThreadRuntimeState>
  /** Optional bounded bulk capability for background observers. */
  getThreadStates?(threadIds: string[]): Promise<ThreadRuntimeStateBatchResult[]>
  sendUserMessage(
    threadId: string,
    text: string,
    options?: {
      clientRequestId?: string
      mode?: string
      orchestration?: 'direct' | 'graph'
      model?: string
      providerId?: string
      accountId?: string
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
      guiDesignMode?: boolean
      persona?: string
      agentSurface?: 'code' | 'write' | 'design'
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
    }
  ): Promise<{
    turnId: string
    threadId: string
    userMessageItemId?: string
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
  listMemories?(options?: { workspace?: string; includeDeleted?: boolean; all?: boolean }): Promise<CoreMemoryRecordJson[]>
  createMemory?(input: {
    content: string
    scope?: 'user' | 'workspace' | 'project'
    workspace?: string
    project?: string
    tags?: string[]
    confidence?: number
  }): Promise<CoreMemoryRecordJson>
  updateMemory?(
    memoryId: string,
    patch: { content?: string; tags?: string[]; confidence?: number; disabled?: boolean },
    options?: { workspace?: string }
  ): Promise<CoreMemoryRecordJson>
  deleteMemory?(memoryId: string, options?: { workspace?: string }): Promise<CoreMemoryRecordJson>
  getMemoryDiagnostics?(): Promise<CoreMemoryDiagnosticsJson>
  steerUserMessage?(
    threadId: string,
    turnId: string,
    text: string,
    options?: { displayText?: string; attachmentIds?: string[] }
  ): Promise<void>
  interruptTurn(threadId: string, turnId: string, options?: { discard?: boolean }): Promise<void>
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
  setThreadTodos?(
    threadId: string,
    todos: Array<{
      id?: string
      content: string
      status: ThreadTodoStatus
      source?: ThreadTodoSource
    }>
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
