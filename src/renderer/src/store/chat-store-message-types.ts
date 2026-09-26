import type {
  AttachmentReference,
  UserFileReference
} from '../agent/types'
import type {
  ApprovalPolicy,
  ApprovalReviewer,
  SandboxMode
} from '@shared/app-settings'
import type { ComposerContextAttachment } from '@kun/extension-api'
import type {
  DesignDocumentTarget,
  DesignImagePlacementTarget,
  DesignTaskProfileInput
} from '../agent/design-task-profile'

export type QueuedUserMessage = {
  id: string
  text: string
  /** Stable idempotency key reused while this user submission is retried. */
  clientRequestId?: string
  editIntent?: 'cancelling' | 'restoring'
  steeringRequest?: { operationId: string; turnId: string }
  waitForRuntimeAdmission?: boolean
  /** Pending/paused items wait locally; admitted items remain until runtime execution starts. */
  deliveryState?: 'pending' | 'paused' | 'starting' | 'in_flight' | 'failed'
  deliveryTurnId?: string
  deliveryUserMessageItemId?: string
  /** Structured code of a terminal deterministic rejection (e.g. `task_surface_locked`). */
  errorCode?: string
  /** Localized summary of a terminal rejection for inline retry UI. */
  errorMessage?: string
  /** Frozen runtime prompt reused for idempotent background admission retries. */
  backgroundRuntimeText?: string
  /** Frozen checkpoint request id reused with the same clientRequestId. */
  backgroundCheckpointRequestId?: string
  displayText?: string
  mode?: string
  orchestration?: 'direct' | 'graph'
  model?: string
  providerId?: string
  accountId?: string
  modelLabel?: string
  reasoningEffort?: string
  serviceTier?: 'priority'
  subagentResume?: { childId: string; expectedResumeCount: number }
  messageSource?: 'design_continuation'
  /** Renderer-only guard that prevents a scoped send from falling back to another thread. */
  expectedThreadId?: string
  attachmentIds?: string[]
  attachments?: AttachmentReference[]
  fileReferences?: UserFileReference[]
  composerContexts?: ComposerContextAttachment[]
  /** ADE worker notices acknowledged by this send; paired with the attached
   *  worker-notices composer context frozen at enqueue time. */
  ackNoticeIds?: string[]
  /** GUI plan context forwarded to Kun for its reserved plan artifact. */
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
  /** True only for the product Design surface; Code whiteboards leave this unset. */
  guiDesignMode?: boolean
  /** Turn-scoped persona text resolved from the composer preset. */
  persona?: string
  agentSurface?: 'code' | 'write' | 'design'
  /** Frozen Design task profile used for admission, retry, and queue recovery. */
  designProfile?: DesignTaskProfileInput
  /** Turn-scoped writable document target; must match the profile target. */
  designDocumentTarget?: DesignDocumentTarget
  designImagePlacementTarget?: DesignImagePlacementTarget
  guiDesignArtifact?: GuiDesignArtifactMessageContext
  writeContext?: WriteAssistantMessageContext
  /** Execution settings frozen at enqueue time; empty fields fall back to runtime defaults. */
  approvalPolicy?: ApprovalPolicy
  sandboxMode?: SandboxMode
  approvalReviewer?: ApprovalReviewer
}

/**
 * GUI plan context attached to a send-message call. Mirrors the
 * Kun `GuiPlanContextSchema` and is forwarded to the runtime
 * request body so plan/refine turns are scoped to a reserved path.
 */
export type GuiPlanMessageContext = {
  operation: 'draft' | 'refine'
  workspaceRoot: string
  relativePath: string
  planId: string
  sourceRequest?: string
  title?: string
}

export type GuiDesignArtifactMessageContext = {
  kind: 'svg'
  artifactId: string
  relativePath: string
}

/** Renderer-only routing context that keeps a Write send bound to the file and
 * conversation selected when the user submitted it. */
export type WriteAssistantMessageContext = {
  workspaceRoot: string
  activeFilePath: string | null
  documentEpoch: number
  contentRevision: number
  /** Present for a first-class Work whiteboard send; fences async sends across board switches. */
  whiteboardId?: string
  whiteboardRevision?: number
  /** Filled after the first explicit ensure; queued sends keep this identity. */
  threadId?: string
  /** SHA-256 of the saved document bytes; the runtime recomputes this at promotion. */
  expectedSha256?: string
}

export type SendMessageOverrides = {
  queued?: QueuedUserMessage
  /** Optional stable idempotency key for callers that retry one logical submission. */
  clientRequestId?: string
  /** Per-send execution settings that override the composer snapshot for this submission. */
  approvalPolicy?: ApprovalPolicy
  sandboxMode?: SandboxMode
  approvalReviewer?: ApprovalReviewer
  /** Resolve the send only after Kun accepts it, including when it first enters the queue. */
  waitForRuntimeAdmission?: boolean
  model?: string
  providerId?: string
  accountId?: string
  modelLabel?: string
  reasoningEffort?: string
  serviceTier?: 'priority'
  /** Structured one-click resume identity forwarded to Kun. */
  subagentResume?: { childId: string; expectedResumeCount: number }
  /** Internal Design runner progress retained by Kun but hidden as a user bubble. */
  messageSource?: 'design_continuation'
  /** Renderer-only guard that prevents Design/Write-style sends from changing thread identity. */
  expectedThreadId?: string
  displayText?: string
  orchestration?: 'direct' | 'graph'
  guiPlan?: GuiPlanMessageContext
  guiDesignCanvas?: boolean
  guiExcalidrawCanvas?: boolean
  guiDesignMode?: boolean
  /** Turn-scoped persona text resolved from the composer preset. */
  persona?: string
  agentSurface?: 'code' | 'write' | 'design'
  designProfile?: DesignTaskProfileInput
  designDocumentTarget?: DesignDocumentTarget
  designImagePlacementTarget?: DesignImagePlacementTarget
  guiDesignArtifact?: GuiDesignArtifactMessageContext
  attachmentIds?: string[]
  attachments?: AttachmentReference[]
  fileReferences?: UserFileReference[]
  composerContexts?: ComposerContextAttachment[]
  writeContext?: WriteAssistantMessageContext
}

export type ClearDesignHistoryOptions = {
  /** Create and bind one empty replacement thread after the old history is gone. */
  recreate?: boolean
  /** Known provisional ids to clean even if the renderer registry write failed. */
  includeThreadIds?: string[]
}

export type CreateDesignThreadOptions = {
  /** Select the new thread and navigate to Design. Defaults to true. */
  activate?: boolean
  /** Keep the current route when creation fails during background maintenance. */
  suppressSettingsRedirect?: boolean
}

export type ClearDesignHistoryResult = {
  /** True only when no runtime thread or local chat mirror remains to retry. */
  cleared: boolean
  deletedThreadIds: string[]
  retainedThreadIds: string[]
  recreatedThreadId: string | null
}

export type InitialSetupMode = 'required' | 'preview'
