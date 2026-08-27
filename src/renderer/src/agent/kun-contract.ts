import { GUI_PLAN_CREATE_PLAN_TOOL_NAME } from '@shared/gui-plan'
import type { ComposerContextAttachment } from '@kun/extension-api'
import type { CoreTurnJson } from './kun-contract-runtime'
import type { DesignTaskProfile } from './design-task-profile'

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
  /** Immutable Code/Design mode derived from the first accepted turn. */
  lockedTaskSurface?: 'code' | 'write' | 'design'
  designProfile?: DesignTaskProfile
  designCloneOperation?: {
    operationId: string
    kind: 'fork' | 'resume'
    sourceId: string
  }
  /** Whether the title is auto/provisional (see ThreadSchema.titleAuto on the core). */
  titleAuto?: boolean
  /** Optional whole-conversation summary produced by the summarize route. */
  summary?: string
  workspace?: string
  knowledgeBases?: Array<{
    id: string
    root: string
    name: string
    source: 'write-workspace'
    access: 'read-only'
  }>
  model: string
  mode: string
  status: CoreThreadStatus
  /** Rebuildable event-log high-water mark available on lean list responses. */
  latestSeq?: number
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
  planBuildRunId?: string
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

export type CoreThreadTimelineJson = CoreThreadJson & {
  latestTurn?: Omit<CoreTurnJson, 'items'> | null
  timeline: {
    nextCursor?: string
    hasMore: boolean
    itemCount: number
    itemBytes: number
  }
}

export type CoreThreadRuntimeStateJson = {
  schemaVersion?: number
  id: string
  status: string
  updatedAt: string
  latestSeq: number
  /** Omitted by legacy owners; do not confuse omission with a live empty gate. */
  pendingUserInputIds?: string[]
  latestTurn: {
    id: string
    status: string
    orchestration: 'direct' | 'graph'
  } | null
}

export type CoreThreadRuntimeStateBatchResponseJson = {
  results: Array<
    | { id: string; ok: true; state: CoreThreadRuntimeStateJson }
    | {
        id: string
        ok: false
        error: { code: 'not_found' | 'unavailable'; message: string }
      }
  >
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
    proactiveRetry?: { enabled: boolean; maxAttempts: number }
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
  }
  /** Optional so the GUI keeps working against older Kun builds without the capability. */
  imageGen?: CoreRuntimeCapabilityStateJson & {
    model?: string
    supportsReferenceEdit?: boolean
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

export * from './kun-contract-runtime'
