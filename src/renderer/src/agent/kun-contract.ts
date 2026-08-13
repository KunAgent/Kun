import { GUI_PLAN_CREATE_PLAN_TOOL_NAME } from '@shared/gui-plan'
import type { ComposerContextAttachment } from '@kun/extension-api'

export type CoreComposerContextAttachmentJson = ComposerContextAttachment

export type CoreThreadStatus = 'idle' | 'running' | 'archived' | 'deleted'
export type CoreTurnStatus = 'queued' | 'running' | 'completed' | 'failed' | 'aborted'
export type CoreItemStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'allowed'
  | 'denied'
  | 'expired'
  | string

export type CoreThreadSummaryJson = {
  id: string
  title: string
  /** Durable product surface that owns the thread. Absent for legacy Code threads. */
  agentSurface?: 'code' | 'write' | 'design'
  /** Whether the title is auto/provisional (see ThreadSchema.titleAuto on the core). */
  titleAuto?: boolean
  /** Optional whole-conversation summary produced by the summarize route. */
  summary?: string
  workspace?: string
  model: string
  mode: string
  status: CoreThreadStatus
  approvalPolicy?: string
  sandboxMode?: string
  approvalReviewer?: string
  modelRequestCaptureEnabled?: boolean
  pinned?: boolean
  providerId?: string
  agentId?: string
  systemPrompt?: string
  relation?: 'primary' | 'fork' | 'side'
  parentThreadId?: string
  forkedFromThreadId?: string
  forkedFromTitle?: string
  forkedAt?: string
  forkedFromMessageCount?: number
  forkedFromTurnCount?: number
  goal?: CoreThreadGoalJson | null
  todos?: CoreThreadTodoListJson | null
  createdAt: string
  updatedAt: string
}

export type CoreThreadJson = CoreThreadSummaryJson & {
  turns?: CoreTurnJson[]
  latestSeq?: number
  /** Request ids the runtime is still actively awaiting (live ask-user gate). */
  pendingUserInputIds?: string[]
  /** Approval ids the runtime is still actively awaiting (live approval gate). */
  pendingApprovalIds?: string[]
}

export type CoreThreadRuntimeStateJson = {
  id: string
  status: string
  updatedAt: string
  latestSeq: number
  latestTurn: {
    id: string
    status: string
    orchestration: 'direct' | 'graph'
  } | null
}

export type CoreAttachmentMetadataJson = {
  id: string
  name: string
  kind?: 'image' | 'document'
  mimeType: string
  byteSize: number
  hash: string
  width?: number
  height?: number
  documentText?: string
  documentFormat?: 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'text' | 'csv' | 'json' | 'xml'
  sourceSha256?: string
  pageCount?: number
  truncated?: boolean
  localFilePath?: string
  textFallback?: CoreAttachmentTextFallbackJson
  visualPreview?: CoreAttachmentTextFallbackJson
  threadIds?: string[]
  workspaces?: string[]
  createdAt: string
  updatedAt: string
}

export type CoreAttachmentTextFallbackJson = {
  dataBase64: string
  mimeType: string
  byteSize: number
  width?: number
  height?: number
  wasCompressed?: boolean
}

export type CoreUserFileReferenceJson = {
  path: string
  relativePath: string
  name: string
  kind?: 'file' | 'directory'
}

export type CoreAttachmentDiagnosticsJson = {
  enabled: boolean
  rootDir: string
  count: number
  totalBytes: number
}

export type CoreMemoryRecordJson = {
  id: string
  content: string
  scope: 'user' | 'workspace' | 'project'
  workspace?: string
  project?: string
  sourceThreadId?: string
  sourceTurnId?: string
  tags?: string[]
  confidence?: number
  createdAt: string
  updatedAt: string
  disabledAt?: string
  deletedAt?: string
}

export type CoreThreadGoalStatusJson =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usageLimited'
  | 'budgetLimited'
  | 'complete'

export type CoreThreadGoalJson = {
  threadId: string
  objective: string
  status: CoreThreadGoalStatusJson
  tokenBudget?: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: string
  updatedAt: string
}

export type CoreThreadGoalResponseJson = {
  goal: CoreThreadGoalJson | null
}

export type CoreClearThreadGoalResponseJson = {
  cleared: boolean
}

export type CoreThreadTodoStatusJson = 'pending' | 'in_progress' | 'completed'

export type CoreThreadTodoSourceJson = {
  kind: 'plan'
  planId: string
  relativePath: string
  ordinal: number
  contentHash: string
}

export type CoreThreadTodoItemJson = {
  id: string
  content: string
  status: CoreThreadTodoStatusJson
  source?: CoreThreadTodoSourceJson
  createdAt: string
  updatedAt: string
}

export type CoreThreadTodoListJson = {
  threadId: string
  items: CoreThreadTodoItemJson[]
  updatedAt: string
}

export type CoreThreadTodosResponseJson = {
  todos: CoreThreadTodoListJson | null
}

export type CoreClearThreadTodosResponseJson = {
  cleared: boolean
}

export type CoreMemoryDiagnosticsJson = {
  enabled: boolean
  rootDir: string
  activeCount: number
  tombstoneCount: number
  lastInjectedIds?: string[]
}

export type CoreRuntimeCapabilityStateJson = {
  status: 'available' | 'disabled' | 'unavailable' | 'interaction-required'
  enabled: boolean
  available: boolean
  reason?: string
}

export type CoreRuntimeCapabilityManifestJson = {
  contractVersion: number
  model: {
    id: string
    inputModalities: Array<'text' | 'image'>
    outputModalities: Array<'text' | 'image'>
    supportsToolCalling: boolean
    contextWindowTokens?: number
    messageParts: Array<'text' | 'image_url' | 'input_image'>
  }
  cli: Record<'serve' | 'run' | 'chat' | 'exec', CoreRuntimeCapabilityStateJson>
  mcp: CoreRuntimeCapabilityStateJson & {
    configuredServers: number
    connectedServers: number
    toolCount: number
    search?: {
      enabled: boolean
      mode: 'direct' | 'search' | 'auto'
      active: boolean
      indexedToolCount: number
      advertisedToolCount: number
    }
  }
  web: CoreRuntimeCapabilityStateJson & {
    fetch: CoreRuntimeCapabilityStateJson
    search: CoreRuntimeCapabilityStateJson
    provider?: string
  }
  skills: CoreRuntimeCapabilityStateJson & {
    configuredRoots: number
    discoveredSkills: number
  }
  /** Optional so the GUI keeps working against older Kun builds without the capability. */
  instructions?: CoreRuntimeCapabilityStateJson & {
    lastSourceCount?: number
    lastInjectedBytes?: number
  }
  subagents: CoreRuntimeCapabilityStateJson & {
    useExistingAgents?: boolean
    maxParallel: number
    maxChildRuns: number
    defaultToolPolicy?: 'readOnly' | 'inherit'
    defaultProfile?: string
    profiles?: Array<{ name: string; model?: string; toolPolicy: 'readOnly' | 'inherit' }>
  }
  attachments: CoreRuntimeCapabilityStateJson & {
    maxImageBytes: number
    maxImageDimension: number
    allowedMimeTypes: string[]
    allowedDocumentMimeTypes?: string[]
    maxDocumentBytes?: number
    maxDocumentTextChars?: number
    textFallbackMaxBase64Bytes?: number
    textFallbackMaxImageDimension?: number
    textFallbackPreferredMimeType?: string
  }
  memory: CoreRuntimeCapabilityStateJson & {
    scopes: Array<'user' | 'workspace' | 'project'>
    maxInjectedRecords: number
    minConfidence: number
  }
  /** Optional so the GUI keeps working against older Kun builds without the capability. */
  imageGen?: CoreRuntimeCapabilityStateJson & {
    model?: string
  }
  speechGen?: CoreRuntimeCapabilityStateJson & {
    model?: string
  }
  musicGen?: CoreRuntimeCapabilityStateJson & {
    model?: string
  }
  videoGen?: CoreRuntimeCapabilityStateJson & {
    model?: string
  }
  computerUse?: CoreRuntimeCapabilityStateJson & {
    mode?: 'auto' | 'always' | 'off'
  }
  browserUse?: CoreRuntimeCapabilityStateJson & {
    mode?: 'public' | 'local-development'
  }
}

export type CoreRuntimeInfoJson = {
  host: string
  port: number
  dataDir: string
  configPath?: string
  model?: string
  approvalPolicy?: string
  sandboxMode?: string
  approvalReviewer?: string
  tokenEconomyMode?: boolean
  insecure?: boolean
  startedAt: string
  pid?: number
  memoryUsage?: {
    rssBytes: number
    peakRssBytes: number
    heapUsedBytes: number
    heapTotalBytes: number
    externalBytes: number
  }
  capabilities: CoreRuntimeCapabilityManifestJson
}

export type CoreRuntimeToolDiagnosticsJson = {
  providers?: Array<Record<string, unknown>>
  mcpServers?: Array<Record<string, unknown>>
  mcpOAuth?: CoreMcpOAuthDiagnosticJson[]
  mcpSearch?: {
    enabled?: boolean
    mode?: 'direct' | 'search' | 'auto'
    active?: boolean
    indexedToolCount?: number
    advertisedToolCount?: number
    topKDefault?: number
    topKMax?: number
	    minScore?: number
	    lastRefreshedAt?: string
	    lastError?: string
	    catalogFingerprint?: string
	    catalogDrift?: boolean
	  }
  webProviders?: Array<Record<string, unknown>>
  skills?: {
    enabled?: boolean
    roots?: Array<Record<string, unknown>>
    skills?: Array<Record<string, unknown>>
    validationErrors?: Array<Record<string, unknown> | string>
    lastActivations?: Array<Record<string, unknown>>
  }
  instructions?: {
    enabled?: boolean
    globalPath?: string
    workspaceFileName?: string
    maxFileBytes?: number
    maxTotalBytes?: number
    readErrors?: Array<Record<string, unknown> | string>
    lastInjection?: {
      sources?: Array<Record<string, unknown>>
      injectedBytes?: number
      budgetBytes?: number
    }
  }
  attachments?: CoreAttachmentDiagnosticsJson
  memory?: CoreMemoryDiagnosticsJson
  subagents?: {
    enabled?: boolean
    active?: number
    childRuns?: Array<Record<string, unknown>>
  }
}

export type CoreMcpOAuthDiagnosticJson = {
  serverId: string
  enabled: boolean
  configured: boolean
  transport: string
  url?: string
  status: 'disabled' | 'empty' | 'partial' | 'authorized' | 'expired' | 'error'
  hasClientInformation: boolean
  hasTokens: boolean
  hasRefreshToken: boolean
  hasCodeVerifier: boolean
  hasDiscoveryState: boolean
  grantedScopes?: string[]
  expiresAt?: string
  lastError?: string
  lastErrorAt?: string
}

export type CoreMcpOAuthDiagnosticsResponseJson = {
  servers: CoreMcpOAuthDiagnosticJson[]
}

export type CoreMcpOAuthClearResponseJson = {
  cleared: string[]
}

export type CoreMcpOAuthAuthorizeResponseJson = {
  serverId: string
  status: CoreMcpOAuthDiagnosticJson['status']
  authorized: boolean
}

export type CoreRuntimeSkillJson = {
  id: string
  name: string
  description?: string
  version?: string
  root?: string
  scope?: 'project' | 'global'
  legacy?: boolean
  triggers?: {
    commands?: string[]
    promptPatterns?: string[]
    fileTypes?: string[]
  }
  allowedTools?: string[]
}

export type CoreRuntimeSkillsResponseJson = {
  enabled?: boolean
  roots?: string[]
  skills?: CoreRuntimeSkillJson[]
  validationErrors?: Array<Record<string, unknown> | string>
}

export type CoreChildRunActivityJson = {
  phase: 'starting' | 'thinking' | 'responding' | 'tool' | 'retrying' | 'compacting' | 'waiting'
  label: string
  toolName?: string
  startedAt: string
  updatedAt: string
}

export type CoreChildRuntimeMetadataJson = {
  parentThreadId: string
  parentTurnId: string
  childId: string
  childLabel?: string
  childStatus: 'queued' | 'running' | 'completed' | 'failed' | 'aborted'
  childSeq: number
  detached?: boolean
  childModel?: string
  childProviderId?: string
  childProfile?: string
  childProfileName?: string
  childToolPolicy?: 'readOnly' | 'inherit'
  prefixReused?: boolean
  inheritedHistoryItems?: number
  toolInvocations?: number
  durationMs?: number
  queuedMs?: number
  totalTokens?: number
  cacheHitRate?: number | null
  costUsd?: number
  costCny?: number
  activity?: CoreChildRunActivityJson
}

export type CoreWebSourceJson = {
  sourceId?: string
  url?: string
  title?: string
  retrievedAt?: string
}

export type CoreTurnJson = {
  id: string
  threadId: string
  status: CoreTurnStatus
  prompt: string
  model?: string
  providerId?: string
  clientSurface?: 'gui' | 'tui' | 'cli' | 'api' | 'im' | 'extension'
  orchestration?: 'direct' | 'graph'
  createdAt: string
  startedAt?: string
  finishedAt?: string
  items?: CoreTurnItemJson[]
  attachmentIds?: string[]
  composerContexts?: CoreComposerContextAttachmentJson[]
  activeSkillIds?: string[]
  injectedMemoryIds?: string[]
  injectedMemorySummaries?: Array<{ id: string; content: string }>
  skillInjectionBytes?: number
  injectedInstructionSources?: Array<{ scope: 'global' | 'workspace'; path: string; bytes: number; truncated?: boolean }>
  instructionInjectionBytes?: number
  workspaceCheckpointId?: string
  workspaceCheckpointRequestId?: string
  guiDesignCanvas?: boolean
  guiDesignMode?: boolean
  agentSurface?: 'code' | 'write' | 'design'
  error?: string
}

export type CoreTurnItemJson = {
  id: string
  turnId: string
  threadId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  status: CoreItemStatus
  createdAt: string
  finishedAt?: string
  kind: string
  text?: string
  displayText?: string
  guiDesignCanvas?: boolean
  guiDesignMode?: boolean
  messageSource?: 'background_shell' | 'background_subagent' | 'graph_runtime'
  toolName?: string
  callId?: string
  cancelRequestedAt?: string
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
  arguments?: Record<string, unknown>
  output?: unknown
  isError?: boolean
  approvalId?: string
  approvalReviewer?: 'user' | 'agent'
  decisionSource?: 'user' | 'agent'
  inputId?: string
  prompt?: string
  questions?: Array<{
    header?: string
    id: string
    question?: string
    prompt?: string
    message?: string
    options: Array<{ label: string; description: string }>
    selectionMode?: 'single' | 'multiple'
    minSelections?: number
    maxSelections?: number
  }>
  answers?: Array<{
    id: string
    label: string
    value?: string
    labels?: string[]
    values?: string[]
  }>
  summary?: string
  replacedTokens?: number
  auto?: boolean
  pinnedConstraints?: string[]
  sourceDigest?: string
  digestMarker?: string
  sourceItemIds?: string[]
  message?: string
  code?: string
  details?: unknown
  severity?: 'info' | 'warning' | 'error'
  attachmentIds?: string[]
  composerContexts?: CoreComposerContextAttachmentJson[]
  fileReferences?: CoreUserFileReferenceJson[]
  workspaceCheckpointId?: string
  activeSkillIds?: string[]
  injectedMemoryIds?: string[]
  injectedMemorySummaries?: Array<{ id: string; content: string }>
  skillInjectionBytes?: number
  injectedInstructionSources?: Array<{ scope: 'global' | 'workspace'; path: string; bytes: number; truncated?: boolean }>
  instructionInjectionBytes?: number
  target?: CoreReviewTargetJson
  title?: string
  reviewText?: string
}

export type CoreComponentPrototypeJson = {
  version: 1
  status: 'preparing' | 'running' | 'completed' | 'failed'
  artifactId: string
  title: string
  relativePath: string
  viewport: { width: number; height: number }
  /** Missing on historical component-designer payloads. */
  producer?: 'main-agent' | 'component-designer'
  profile?: 'component-designer'
  childId?: string
  byteSize?: number
  contentHash?: string
  summary?: string
  error?: string
}

export type CoreReviewTargetJson =
  | { kind: 'uncommittedChanges' }
  | { kind: 'baseBranch'; branch: string }
  | { kind: 'commit'; sha: string }
  | { kind: 'custom'; instructions: string }

export type CoreReviewFindingJson = {
  title: string
  body: string
  confidenceScore: number
  priority: number
  codeLocation: {
    absoluteFilePath: string
    lineRange: { start: number; end: number }
  }
}

export type CoreReviewOutputJson = {
  findings: CoreReviewFindingJson[]
  overallCorrectness: 'patch is correct' | 'patch is incorrect'
  overallExplanation: string
  overallConfidenceScore: number
}

/**
 * Structured plan metadata the renderer expects on a successful
 * `create_plan` tool result. Mirrors the Kun output contract
 * so the Workbench can reload the saved plan file and update the
 * Plan panel without parsing assistant prose.
 */
export type CorePlanToolResultJson = {
  summary?: string
  plan_id: string
  workspace_root: string
  relative_path: string
  absolute_path?: string
  source_request?: string
  title?: string
  operation: 'draft' | 'refine'
  saved_at: string
  content_hash?: string
  byte_size?: number
}

export type CoreStartTurnResponseJson = {
  threadId: string
  turnId: string
  userMessageItemId?: string
}

export type CoreCancelToolCallResponseJson = {
  threadId: string
  turnId: string
  callId: string
  status: 'cancellation_requested' | 'already_requested'
}

export type CoreStartReviewResponseJson = CoreStartTurnResponseJson & {
  reviewItemId?: string
}

export type CoreAttachmentUploadResponseJson = {
  attachment: CoreAttachmentMetadataJson
}

export type CoreAttachmentContentResponseJson = {
  attachment: CoreAttachmentMetadataJson
  dataBase64: string
}

export type CoreMemoryListResponseJson = {
  memories: CoreMemoryRecordJson[]
}

export type CoreResumeSessionResponseJson = {
  thread_id?: string
  threadId?: string
  session_id?: string
  sessionId?: string
  message_count?: number
  summary?: string
}

/**
 * Optional plan context attached to a start-turn request. Carries the
 * reserved plan id, workspace root, and relative path the Kun
 * should expose to the model via the `create_plan` tool.
 */
export type CoreStartTurnPlanContextJson = {
  operation: 'draft' | 'refine'
  workspaceRoot: string
  relativePath: string
  planId: string
  sourceRequest?: string
  title?: string
}

/**
 * Native Kun plan tool name. Re-exported alongside the shared
 * constant for renderer consumers.
 */
export const CORE_PLAN_TOOL_NAME = GUI_PLAN_CREATE_PLAN_TOOL_NAME

export type CoreUsageSnapshotJson = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  cachedTokens?: number
  cacheHitTokens?: number
  cacheMissTokens?: number
  cacheHitRate?: number
  turns?: number
  costUsd?: number
  costCny?: number
  tokenEconomySavingsTokens?: number
  /** Time-to-first-token of this single model request (ms). */
  requestTtftMs?: number
  /** Generation duration of this single model request (ms). */
  requestGenerationMs?: number
  /** Average TTFT across model calls of the current turn. */
  turnAvgTtftMs?: number | null
  /** Average tokens-per-second across model calls of the current turn. */
  turnAvgTokensPerSecond?: number | null
  /** Thread-cumulative average TTFT across all model calls. */
  avgTtftMs?: number | null
  /** Thread-cumulative average tokens-per-second across all model calls. */
  avgTokensPerSecond?: number | null
}

export type CoreRuntimeEventJson = {
  kind?: string
  seq?: number
  /** UTF-16 offset of this incremental assistant delta within its item text. */
  deltaOffset?: number
  timestamp?: string
  threadId?: string
  turnId?: string
  itemId?: string
  item?: CoreTurnItemJson
  approvalId?: string
  reviewId?: string
  approvalPolicy?: string
  sandboxMode?: string
  approvalReviewer?: string
  decisionSource?: 'user' | 'agent'
  reviewer?: 'agent' | 'user'
  toolName?: string
  callId?: string
  readyCount?: number
  toolResultCount?: number
  /** Durable Graph domain event projected through the existing thread SSE. */
  graph?: unknown
  /** Durable pre-run Graph planning lifecycle projected through thread SSE. */
  planning?: unknown
  attempt?: number
  maxAttempts?: number
  delayMs?: number
  fingerprint?: string
  toolCount?: number
  changeKind?: 'additive' | 'breaking'
  toolNames?: string[]
  model?: string
  providerId?: string
  stepIndex?: number
  contextWindowTokens?: number
  softThresholdTokens?: number
  hardThresholdTokens?: number
  estimatedInputTokens?: number
  breakdown?: {
    tools?: number
    system?: number
    skills?: number
    messages?: number
    other?: number
  }
  activeSkillIds?: string[]
  contextManagement?: 'kun-managed' | 'sdk-managed'
  nativeHistory?: 'known' | 'unknown' | 'none'
  providerKind?: 'agent-sdk' | 'cursor-sdk' | 'antigravity-cli'
  phase?: 'portable' | 'resumed' | 'rebased' | 'preparing' | 'retrying' | 'succeeded' | 'failed'
  failureSummary?: string
  capabilities?: {
    nativeResume?: boolean
    structuredStreaming?: boolean
    kunTools?: boolean
    externalApproval?: boolean
    liveSteering?: boolean
    nativeContextTelemetry?: boolean
    fork?: boolean
  }
  status?: string | number
  /** turn_started: the effective routing and reasoning configuration. */
  accountId?: string
  reasoningEffort?: 'auto' | 'off' | 'low' | 'medium' | 'high' | 'max'
  serviceTier?: 'priority'
  mode?: 'agent' | 'plan'
  /** thread_created / thread_updated: the thread's (possibly upgraded) title. */
  title?: string
  /** thread_created / thread_updated: whether that title is auto/provisional. */
  titleAuto?: boolean
  stage?:
    | 'setup'
    | 'pre_start'
    | 'post_start'
    | 'input_received'
    | 'input_cached'
    | 'input_routed'
    | 'input_compressed'
    | 'input_remembered'
    | 'pre_send'
    | 'post_send'
    | 'response_received'
  label?: string
  code?: string
  details?: unknown
  summary?: string
  reason?: string
  decision?: 'allow' | 'deny'
  riskLevel?: 'low' | 'medium' | 'high' | 'critical'
  rationale?: string
  prompt?: string
  inputId?: string
  questions?: Array<{
    header?: string
    id: string
    question?: string
    prompt?: string
    message?: string
    options: Array<{ label: string; description: string }>
    selectionMode?: 'single' | 'multiple'
    minSelections?: number
    maxSelections?: number
  }>
  answers?: Array<{
    id: string
    label: string
    value?: string
    labels?: string[]
    values?: string[]
  }>
  replacedTokens?: number
  auto?: boolean
  pinnedConstraints?: string[]
  sourceDigest?: string
  digestMarker?: string
  sourceItemIds?: string[]
  usage?: CoreUsageSnapshotJson
  goal?: CoreThreadGoalJson | null
  todos?: CoreThreadTodoListJson | null
  cleared?: boolean
  message?: string
  severity?: 'info' | 'warning' | 'error'
  child?: CoreChildRuntimeMetadataJson
}

export type RuntimeErrorJson = {
  code?: string
  error?: string | { message?: string; status?: number }
  message?: string
  details?: unknown
  severity?: 'info' | 'warning' | 'error'
}
