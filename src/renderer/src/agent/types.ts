import type {
  CoreAttachmentContentResponseJson, CoreAttachmentMetadataJson,
  CoreAttachmentTextFallbackJson, CoreMemoryDiagnosticsJson,
  CoreChildRuntimeMetadataJson, CoreMemoryRecordJson, CoreMcpOAuthDiagnosticJson, CoreRuntimeInfoJson,
  CoreRuntimeSkillJson, CoreRuntimeToolDiagnosticsJson
} from './kun-contract'
import type { ApprovalPolicy, ApprovalReviewer, SandboxMode } from '@shared/app-settings'
import type {
  DelegatedRuntimeState,
  RequestContextSnapshot,
  ThreadUsageSnapshot
} from './thread-runtime-types'
import type { CoreModelRequestFailureJson } from './kun-contract'
import type { ComposerContextAttachment } from '@kun/extension-api'
import type { RendererChartSpec } from './chart-spec-adapter'

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
export type DiagramPrototypeStatus = ComponentPrototypeStatus

/** Durable `show_diagram` HTML result rendered as an inline conversation card. */
export type DiagramPrototypeMetadata = {
  version: 1
  status: DiagramPrototypeStatus
  artifactId: string
  title: string
  relativePath: string
  viewport: { width: number; height: number }
  byteSize?: number
  contentHash?: string
  summary?: string
  error?: string
}

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
  childLauncher?: 'delegate_task' | 'fast_context' | 'ppt_agent' | 'component_design' | 'graph'
  childTerminationReason?: 'user_stop' | 'manual_stop' | 'runtime_restart' | 'child_error'
  resumable?: boolean
  resumeCount?: number
  failure?: CoreChildRuntimeMetadataJson['failure']
  proactiveRetry?: CoreChildRuntimeMetadataJson['proactiveRetry']
  detached?: boolean
  prefixReused?: boolean
  inheritedHistoryItems?: number
  toolInvocations?: number
  /** Start of the current resume attempt; cumulative child timing remains in durationMs. */
  attemptStartedAt?: string
  /** Elapsed milliseconds for the current resume attempt. */
  attemptDurationMs?: number
  durationMs?: number
  queuedMs?: number
  summaryTruncated?: boolean
  resultRef?: {
    artifactId: string
    byteSize: number
    lineCount: number
    mimeType: 'text/markdown'
  }
  resultUnavailableReason?: string
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

/** A terminal turn event with the identity needed to reject stale or child-scoped completion. */
export type TurnTerminalEvent = {
  status: 'completed' | 'aborted'
  threadId?: string
  turnId?: string
  seq?: number
  child?: RuntimeChildMetadata
}
export type WebCitationSource = {
  sourceId?: string
  url?: string
  title?: string
  retrievedAt?: string
}
export type RuntimeDisclosureMetadata = {
  displayText?: string
  /** Effective per-turn mode used to gate live guidance after hydration. */
  mode?: 'agent' | 'plan'
  /** Durable per-turn intent used by mixed Code/Design timeline consumers. */
  agentSurface?: 'code' | 'write' | 'design'
  /** Persisted turn routing hint so edit/resend can rebuild live canvas context. */
  guiDesignCanvas?: boolean
  guiDesignMode?: boolean
  designProfile?: import('./design-task-profile').DesignTaskProfileInput | import('./design-task-profile').DesignTaskProfile
  designDocumentTarget?: import('./design-task-profile').DesignDocumentTarget
  designImagePlacementTarget?: import('./design-task-profile').DesignImagePlacementTarget
  messageSource?: 'background_shell' | 'background_subagent' | 'graph_runtime' | 'subagent_resume' | 'design_continuation' // client-only rendering hint
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
  recommended?: boolean
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
  /** Durable product surface that owns this thread. Absent for legacy Code threads. */
  agentSurface?: 'code' | 'write' | 'design'
  /** Immutable task mode derived from the first accepted turn. */
  lockedTaskSurface?: 'code' | 'write' | 'design'
  /** Immutable runtime-owned profile for a Design task. */
  designProfile?: import('./design-task-profile').DesignTaskProfile
  designCloneOperation?: {
    operationId: string
    kind: 'fork' | 'resume'
    sourceId: string
  }
  /** Whether the title is auto/provisional (true) vs user-set/locked (false); absent = legacy. */
  titleAuto?: boolean
  updatedAt: string
  model: string
  mode: string
  workspace?: string
  knowledgeBases?: KnowledgeBaseMount[]
  status?: string
  latestSeq?: number
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
  summary?: string // Whole-conversation summary shown as the list subtitle.
  latestTurnId?: string
  latestTurnStatus?: string
  relation?: 'primary' | 'fork' | 'side'
  parentThreadId?: string
  /** Legacy plan-build linkage retained for read-only history compatibility. */
  planBuildRunId?: string
  forkedFromThreadId?: string
  forkedFromTitle?: string
  forkedAt?: string
  forkedFromMessageCount?: number
  forkedFromTurnCount?: number
  goal?: ThreadGoal | null
  todos?: ThreadTodoList | null
}
export type KnowledgeBaseMount = {
  id: string
  root: string
  name: string
  source: 'write-workspace'
  access: 'read-only'
}

export type KnowledgeBaseIndexStatus = {
  id: string
  state: 'pending' | 'indexing' | 'ready' | 'stale' | 'unavailable' | 'error'
  documentCount: number
  nodeCount: number
  availableDocumentCount?: number
  unavailableDocumentCount?: number
  truncatedDocumentCount?: number
  formatCounts?: Record<string, number>
  diagnostics?: string[]
  lastIndexedAt?: string
  error?: string
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
  limit?: number; search?: string; includeArchived?: boolean; archivedOnly?: boolean
  includeSide?: boolean; summary?: boolean; cursor?: string; workspace?: string; lean?: boolean
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

export type ChartBlock = {
  kind: 'chart'
  id: string
  turnId?: string
  createdAt?: string
  spec: RendererChartSpec
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
  | ChartBlock
  | {
      kind: 'system'
      id: string
      turnId?: string
      createdAt?: string
      text: string
      code?: string
      detail?: string
      modelRequestFailure?: CoreModelRequestFailureJson
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
      status: 'pending' | 'submitted' | 'cancelled' | 'timeout' | 'error'
      answers?: UserInputAnswer[]
      errorMessage?: string
      /** Auto-resolve budget; the model proceeds on its own when it elapses. */
      timeoutSeconds?: number
      /** True only while the live runtime awaits this request (see #606). */
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
  retryReason?: 'network' | 'stream_transport' | 'context_overflow'
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
  modelRequestFailure?: CoreModelRequestFailureJson
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
  timeoutSeconds?: number
}

export type UserInputStatusPayload = {
  itemId: string
  status: 'submitted' | 'cancelled' | 'timeout' | 'error'
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
  /** UTF-16 offset of this incremental delta within the identified item. */
  deltaOffset?: number
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
  /**
   * Conversation-scoped failures already have a durable runtime-error card in
   * the owning thread. Runtime-scoped failures use the global recovery banner.
   */
  scope?: 'conversation' | 'runtime'
  /**
   * Terminal identity of the failed turn, when known. Lets the store reject a
   * replayed/out-of-order failure from an older turn before it can clear a
   * newer active turn, mirroring the onTurnComplete stale guard. Transport
   * errors and legacy events omit these and keep their existing semantics.
   */
  threadId?: string
  turnId?: string
  seq?: number
}

export type { AgentProvider, ThreadDetail, ThreadEventSink } from './provider-types'
export type {
  DelegatedRuntimeState,
  RequestContextSnapshot,
  ThreadUsageSnapshot
} from './thread-runtime-types'
