import type {
  CoreAttachmentContentResponseJson,
  CoreAttachmentMetadataJson,
  CoreAttachmentTextFallbackJson,
  CoreMemoryDiagnosticsJson,
  CoreMemoryRecordJson,
  CoreMcpOAuthDiagnosticJson,
  CoreRuntimeInfoJson,
  CoreRuntimeSkillJson,
  CoreRuntimeToolDiagnosticsJson
} from './kun-contract'
import type {
  ApprovalPolicy,
  ApprovalReviewer,
  SandboxMode
} from '@shared/app-settings'
import type { ComposerContextAttachment } from '@kun/extension-api'

export type ToolItemKind = 'tool_call' | 'command_execution' | 'file_change'
export type RuntimeErrorSeverity = 'info' | 'warning' | 'error'

export type AttachmentReference = {
  id: string
  kind?: 'image' | 'document'
  name?: string
  mimeType?: string
  byteSize?: number
  width?: number
  height?: number
  pageCount?: number
  truncated?: boolean
  textPreview?: string
  documentText?: string
  documentFormat?: 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'text' | 'csv' | 'json' | 'xml'
  sourceSha256?: string
  previewUnavailableReason?: string
  previewUrl?: string
}

export type GeneratedFileReference = {
  id?: string
  artifactId?: string
  mediaHandleId?: string
  availability?: 'available' | 'unavailable'
  name?: string
  mimeType?: string
  byteSize?: number
  width?: number
  height?: number
  durationMicros?: number
  mediaKind?: 'video' | 'audio' | 'image' | 'subtitle' | 'document' | 'data' | 'other'
  completionIdentity?: string
  ownerExtensionId?: string
  ownerExtensionVersion?: string
  workspaceId?: string
  provenance?: {
    jobId?: string
    invocationId?: string
    operation: string
  }
  previewUrl?: string
  path?: string
  relativePath?: string
  absolutePath?: string
}

export type ComponentPrototypeStatus = 'preparing' | 'running' | 'completed' | 'failed'
export type ComponentPrototypeProducer = 'main-agent' | 'component-designer'

/** Durable `design_component` result rendered as an inline conversation card. */
export type ComponentPrototypeMetadata = {
  version: 1
  status: ComponentPrototypeStatus
  artifactId: string
  title: string
  relativePath: string
  viewport: { width: number; height: number }
  producer: ComponentPrototypeProducer
  profile?: 'component-designer'
  childId?: string
  byteSize?: number
  contentHash?: string
  summary?: string
  error?: string
}

export type RuntimeChildActivity = {
  phase: 'starting' | 'thinking' | 'responding' | 'tool' | 'retrying' | 'compacting' | 'waiting'
  label: string
  toolName?: string
  startedAt: string
  updatedAt: string
}

export type UserFileReference = {
  path: string
  relativePath: string
  name: string
  kind?: 'file' | 'directory'
}

export type RuntimeChildMetadata = {
  parentThreadId: string
  parentTurnId: string
  childId: string
  childLabel?: string
  /** Subagent profile id (e.g. `general`, `explore`) resolved by the runtime. */
  childProfile?: string
  /** Profile display name snapshotted for this child run. */
  childProfileName?: string
  /** Model override the child ran under, when one was resolved. */
  childModel?: string
  /** Provider the child ran through, when one was resolved. */
  childProviderId?: string
  /** Tool policy applied to the child run. */
  childToolPolicy?: 'readOnly' | 'inherit'
  childStatus: 'queued' | 'running' | 'completed' | 'failed' | 'aborted'
  childSeq: number
  detached?: boolean
  prefixReused?: boolean
  inheritedHistoryItems?: number
  toolInvocations?: number
  durationMs?: number
  queuedMs?: number
  totalTokens?: number
  cacheHitRate?: number | null
  costUsd?: number
  costCny?: number
  /** Safe bounded liveness projection; never includes reasoning or tool output. */
  activity?: RuntimeChildActivity
}

export type RuntimeChildEventPayload = {
  child: RuntimeChildMetadata
  /** Monotonic sequence from the parent thread event stream. */
  seq?: number
  timestamp?: string
}

export type WebCitationSource = {
  sourceId?: string
  url?: string
  title?: string
  retrievedAt?: string
}

export type RuntimeDisclosureMetadata = {
  displayText?: string
  /** Persisted turn routing hint so edit/resend can rebuild live canvas context. */
  guiDesignCanvas?: boolean
  guiDesignMode?: boolean
  messageSource?: 'background_shell' | 'background_subagent' | 'graph_runtime' // client-only rendering hint; never sent to the runtime
  turnId?: string
  workspaceCheckpointId?: string
  attachmentIds?: string[]
  attachments?: AttachmentReference[]
  fileReferences?: UserFileReference[]
  composerContexts?: ComposerContextAttachment[]
  generatedFiles?: GeneratedFileReference[]
  activeSkillIds?: string[]
  injectedMemoryIds?: string[]
  injectedMemorySummaries?: Array<{ id: string; content: string }>
  skillInjectionBytes?: number
  injectedInstructionSources?: Array<{ scope: 'global' | 'workspace'; path: string; bytes: number; truncated?: boolean }>
  instructionInjectionBytes?: number
  child?: RuntimeChildMetadata
  sources?: WebCitationSource[]
}

export type UserInputOption = {
  label: string
  description: string
}

export type UserInputQuestion = {
  header: string
  id: string
  question: string
  options: UserInputOption[]
  selectionMode?: 'single' | 'multiple'
  minSelections?: number
  maxSelections?: number
}

export type UserInputAnswer = {
  id: string
  label: string
  value: string
  labels?: string[]
  values?: string[]
}

export type NormalizedThread = {
  id: string
  title: string
  /** Whether the title is auto/provisional (true) vs user-set/locked (false); absent = legacy. */
  titleAuto?: boolean
  updatedAt: string
  model: string
  mode: string
  workspace?: string
  status?: string
  approvalPolicy?: ApprovalPolicy
  sandboxMode?: SandboxMode
  approvalReviewer?: ApprovalReviewer
  /** Whether future model requests are retained for Agent Perspective. */
  modelRequestCaptureEnabled?: boolean
  /** Optional provider id when this thread is pinned to a non-default provider. */
  providerId?: string
  /** Optional subagent profile id this thread is bound to (primary-agent persona). */
  agentId?: string
  /** Optional persona systemPrompt snapshot applied to every ModelRequest on this thread. */
  systemPrompt?: string
  archived?: boolean
  pinned?: boolean
  preview?: string
  /** Whole-conversation summary produced by the summarize route; shown as the list subtitle. */
  summary?: string
  latestTurnId?: string
  latestTurnStatus?: string
  relation?: 'primary' | 'fork' | 'side'
  parentThreadId?: string
  forkedFromThreadId?: string
  forkedFromTitle?: string
  forkedAt?: string
  forkedFromMessageCount?: number
  forkedFromTurnCount?: number
  goal?: ThreadGoal | null
  todos?: ThreadTodoList | null
}

export type ThreadGoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usageLimited'
  | 'budgetLimited'
  | 'complete'

export type ThreadGoal = {
  threadId: string
  objective: string
  status: ThreadGoalStatus
  tokenBudget?: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: string
  updatedAt: string
}

export type ThreadTodoStatus = 'pending' | 'in_progress' | 'completed'

export type ThreadTodoSource = {
  kind: 'plan'
  planId: string
  relativePath: string
  ordinal: number
  contentHash: string
}

export type ThreadTodoItem = {
  id: string
  content: string
  status: ThreadTodoStatus
  source?: ThreadTodoSource
  createdAt: string
  updatedAt: string
}

export type ThreadTodoList = {
  threadId: string
  items: ThreadTodoItem[]
  updatedAt: string
}

export type RuntimeConnectionStatus = 'idle' | 'checking' | 'ready' | 'offline'

export type ThreadListOptions = {
  limit?: number
  search?: string
  includeArchived?: boolean
  archivedOnly?: boolean
  summary?: boolean
}

export type ToolBlock = {
  kind: 'tool'
  id: string
  turnId?: string
  createdAt?: string
  summary: string
  status: 'running' | 'success' | 'error'
  toolKind?: ToolItemKind
  /** Full text content from runtime: stdout/stderr or unified patch text */
  detail?: string
  /** Resolved file path for file_change items, when known */
  filePath?: string
  /** Optional structured metadata, e.g. { exit_code, duration_ms, command } */
  meta?: Record<string, unknown>
}

export type CompactionBlock = {
  kind: 'compaction'
  id: string
  turnId?: string
  createdAt?: string
  summary: string
  status: 'running' | 'success' | 'error'
  detail?: string
  auto?: boolean
  messagesBefore?: number
  messagesAfter?: number
}

export type ReviewTarget =
  | { kind: 'uncommittedChanges' }
  | { kind: 'baseBranch'; branch: string }
  | { kind: 'commit'; sha: string }
  | { kind: 'custom'; instructions: string }

export type ReviewFinding = {
  title: string
  body: string
  confidenceScore: number
  priority: number
  codeLocation: {
    absoluteFilePath: string
    lineRange: { start: number; end: number }
  }
}

export type ReviewOutput = {
  findings: ReviewFinding[]
  overallCorrectness: 'patch is correct' | 'patch is incorrect'
  overallExplanation: string
  overallConfidenceScore: number
}

export type ReviewBlock = {
  kind: 'review'
  id: string
  turnId?: string
  createdAt?: string
  title: string
  status: 'running' | 'success' | 'error'
  target?: ReviewTarget
  reviewText?: string
  output?: ReviewOutput
}

export type ChatBlock =
  | {
      kind: 'user'
      id: string
      turnId?: string
      createdAt?: string
      text: string
      modelLabel?: string
      managedBy?: 'claw'
      meta?: RuntimeDisclosureMetadata
    }
  | { kind: 'assistant'; id: string; turnId?: string; createdAt?: string; text: string }
  | { kind: 'reasoning'; id: string; turnId?: string; createdAt?: string; text: string }
  | ToolBlock
  | CompactionBlock
  | ReviewBlock
  | {
      kind: 'system'
      id: string
      turnId?: string
      createdAt?: string
      text: string
      code?: string
      detail?: string
      severity?: RuntimeErrorSeverity
      /** Distinguishes durable runtime failures from ordinary system status rows. */
      runtimeError?: true
    }
  | {
      kind: 'approval'
      id: string
      turnId?: string
      createdAt?: string
      approvalId: string
      summary: string
      toolName?: string
      status: 'pending' | 'submitting' | 'allowed' | 'denied' | 'expired' | 'error'
      errorMessage?: string
      meta?: RuntimeDisclosureMetadata
    }
  | {
      kind: 'approval_review'
      id: string
      turnId?: string
      createdAt?: string
      reviewId: string
      approvalId: string
      summary: string
      toolName?: string
      status:
        | 'in-progress'
        | 'approved'
        | 'denied'
        | 'timed-out'
        | 'failed-closed'
        | 'aborted'
      decision?: 'allow' | 'deny'
      riskLevel?: 'low' | 'medium' | 'high' | 'critical'
      rationale?: string
    }
  | {
      kind: 'user_input'
      id: string
      turnId?: string
      createdAt?: string
      requestId: string
      questions: UserInputQuestion[]
      status: 'pending' | 'submitted' | 'cancelled' | 'error'
      answers?: UserInputAnswer[]
      errorMessage?: string
      /**
       * True only for a request the live runtime is currently awaiting (set by
       * the `onUserInput` stream event). Historical blocks rehydrated from a
       * finished thread never carry it, so a stale `pending` request reopened
       * from history is not re-surfaced as an actionable prompt (issue #606).
       */
      live?: boolean
    }

export type ApprovalRequestPayload = {
  approvalId: string
  turnId?: string
  createdAt?: string
  summary: string
  toolName?: string
  meta?: RuntimeDisclosureMetadata
}

export type ApprovalStatusPayload = {
  approvalId: string
  status: 'allowed' | 'denied' | 'expired' | 'error'
  errorMessage?: string
}

export type ApprovalReviewEventPayload = {
  reviewId: string
  approvalId: string
  turnId?: string
  createdAt?: string
  summary: string
  toolName?: string
  status:
    | 'in-progress'
    | 'approved'
    | 'denied'
    | 'timed-out'
    | 'failed-closed'
    | 'aborted'
  decision?: 'allow' | 'deny'
  riskLevel?: 'low' | 'medium' | 'high' | 'critical'
  rationale?: string
}

export type ToolEventPayload = {
  itemId: string
  turnId?: string
  summary: string
  status: 'running' | 'success' | 'error'
  updateOnly?: boolean
  createdAt?: string
  toolKind?: ToolItemKind
  detail?: string
  filePath?: string
  meta?: Record<string, unknown>
}

export type RuntimeStatusEventPayload = {
  kind:
    | 'tool_result_upload_wait'
    | 'model_request_retry'
    | 'tool_catalog_changed'
    | 'tool_storm_suppressed'
    | 'compaction_summary_fallback'
    | 'required_tool_gate'
  itemId: string
  turnId?: string
  createdAt?: string
  message?: string
  toolResultCount?: number
  status?: number
  attempt?: number
  maxAttempts?: number
  delayMs?: number
  retryReason?: 'network' | 'stream_transport'
  changeKind?: 'additive' | 'breaking'
  toolName?: string
  callId?: string
  phase?: 'preparing' | 'retrying' | 'succeeded' | 'failed'
  failureSummary?: string
  code?: string
}

export type RuntimeErrorEventPayload = {
  itemId: string
  turnId?: string
  createdAt?: string
  message: string
  code?: string
  details?: unknown
  severity?: RuntimeErrorSeverity
}

export type CompactionEventPayload = {
  itemId: string
  turnId?: string
  summary: string
  status: 'running' | 'success' | 'error'
  detail?: string
  auto?: boolean
  messagesBefore?: number
  messagesAfter?: number
  createdAt?: string
}

export type ReviewEventPayload = {
  itemId: string
  turnId?: string
  createdAt?: string
  title: string
  status: 'running' | 'success' | 'error'
  target?: ReviewTarget
  reviewText?: string
  output?: ReviewOutput
}

export type UserInputRequestPayload = {
  itemId: string
  turnId?: string
  createdAt?: string
  requestId: string
  questions: UserInputQuestion[]
}

export type UserInputStatusPayload = {
  itemId: string
  status: 'submitted' | 'cancelled' | 'error'
  answers?: UserInputAnswer[]
  errorMessage?: string
}

export type UserMessageEventPayload = {
  itemId: string
  turnId?: string
  createdAt?: string
  text: string
  modelLabel?: string
  managedBy?: 'claw'
  meta?: RuntimeDisclosureMetadata
}

export type ThreadDeltaEvent = {
  text: string
  kind: 'agent_message' | 'agent_reasoning'
  seq?: number
  threadId?: string
  turnId?: string
  itemId?: string
  createdAt?: string
}

export type AssistantItemSnapshotPayload = {
  itemId: string
  threadId: string
  turnId: string
  kind: 'agent_message' | 'agent_reasoning'
  status: string
  createdAt: string
  text: string
}

export type ThreadErrorOptions = {
  terminal?: boolean
  /** Runtime terminal identity prevents a replayed old turn from settling a newer one. */
  threadId?: string
  turnId?: string
  /**
   * Conversation-scoped failures already have a durable runtime-error card in
   * the owning thread. Runtime-scoped failures use the global recovery banner.
   */
  scope?: 'conversation' | 'runtime'
}

/** Cumulative usage/cost for a Kun thread. */
export type ThreadUsageSnapshot = {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  cacheMissTokens: number
  cacheHitRate: number | null
  totalTokens: number
  costUsd: number
  costCny: number | null
  tokenEconomySavingsTokens: number
  turns: number
}

export type RequestContextSnapshot = {
  threadId: string
  turnId?: string
  model: string
  providerId?: string
  stepIndex: number
  contextWindowTokens: number
  softThresholdTokens: number
  hardThresholdTokens: number
  estimatedInputTokens: number
  breakdown: {
    tools: number
    system: number
    skills: number
    messages: number
    other: number
  }
  toolCount: number
  activeSkillIds: string[]
  contextManagement?: 'kun-managed' | 'sdk-managed'
  nativeHistory?: 'known' | 'unknown' | 'none'
}

export type DelegatedRuntimeState = {
  threadId: string
  turnId?: string
  providerKind: 'agent-sdk' | 'cursor-sdk' | 'antigravity-cli'
  providerId: string
  phase: 'portable' | 'resumed' | 'rebased'
  reason?:
    | 'new'
    | 'route_changed'
    | 'capabilities_changed'
    | 'history_changed'
    | 'native_state_unavailable'
  capabilities: {
    nativeResume: boolean
    structuredStreaming: boolean
    kunTools: boolean
    externalApproval: boolean
    liveSteering: boolean
    nativeContextTelemetry: boolean
    fork: boolean
  }
}

export type ThreadEventSink = {
  /** The HTTP/SSE stream is established, even when no replay or live event is pending. */
  onConnected?(): void
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
  onThreadUpdated?(ev: { threadId: string; title?: string; titleAuto?: boolean; status?: string }): void
  onTurnComplete(event?: { threadId?: string; turnId?: string }): void
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
  createThread(input: { workspace?: string; title?: string; titleAuto?: boolean; mode?: string; agentId?: string; providerId?: string; accountId?: string; model?: string; systemPrompt?: string }): Promise<NormalizedThread>
  getThreadDetail(threadId: string): Promise<{
    blocks: ChatBlock[]
    latestSeq: number
    threadStatus?: string
    latestTurnId?: string
    latestTurnOrchestration?: 'direct' | 'graph'
    latestUserMessageId?: string
    turnDurationByUserId?: Record<string, number>
    usage?: ThreadUsageSnapshot
    relation?: 'primary' | 'fork' | 'side'
    parentThreadId?: string
    model?: string
    goal?: ThreadGoal | null
    todos?: ThreadTodoList | null
  }>
  sendUserMessage(
    threadId: string,
    text: string,
    options?: {
      mode?: string
      orchestration?: 'direct' | 'graph'
      model?: string
      providerId?: string
      accountId?: string
      reasoningEffort?: string
      serviceTier?: 'priority'
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
      agentSurface?: 'code' | 'write' | 'design'
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
  ): Promise<{ turnId: string; threadId: string; userMessageItemId?: string }>
  rewindThread?(threadId: string, turnId: string): Promise<void>
  reviewThread?(
    threadId: string,
    target: ReviewTarget,
    options?: { model?: string; providerId?: string; accountId?: string }
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
    options?: { displayText?: string }
  ): Promise<void>
  interruptTurn(threadId: string, turnId: string, options?: { discard?: boolean }): Promise<void>
  /**
   * Rename a thread. `auto` marks the title as provisional/auto (true, e.g. the
   * client first-message heuristic — the backend LLM titler may upgrade it) or
   * user-set/locked (false). Omit to leave the title's auto flag unchanged.
   */
  renameThread(threadId: string, title: string, auto?: boolean): Promise<void>
  updateThreadWorkspace?(threadId: string, workspace: string): Promise<void>
  updateThreadPinned?(threadId: string, pinned: boolean): Promise<void>
  archiveThread?(threadId: string, archived: boolean): Promise<void>
  deleteThread(threadId: string): Promise<void>
  compactThread?(threadId: string, reason?: string): Promise<{ replacedTokens: number } | void>
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
    options?: { relation?: 'primary' | 'fork' | 'side'; title?: string; turnId?: string }
  ): Promise<NormalizedThread>
  resumeSession?(
    sessionId: string,
    options?: { model?: string; mode?: string }
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
