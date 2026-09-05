import type { ReactElement } from 'react'
import type { JsonValue } from '@kun/extension-api'
import type { ChatBlock, RuntimeConnectionStatus } from '../../agent/types'
import type { RegisteredContribution } from '../../extensions/contribution-registry'
import type { PlanBuildOrchestration } from '../../plan/plan-build'
import type { GuiPlanToolMeta } from '../../plan/plan-tool'
import type { OpenChildThreadHandler } from './SubagentCallCard'
import type {
  GeneratedDocumentArtifact,
  GeneratedDocumentCollection
} from './generated-document-artifacts'

export type MessageTimelineProps = {
  blocks: ChatBlock[]
  liveReasoning: string
  live: string
  activeThreadId: string | null
  runtimeConnection: RuntimeConnectionStatus
  runtimeError?: string | null
  onRetryConnection: () => void
  onOpenSettings: () => void
  onSelectSuggestion?: (prompt: string) => void
  focusModeEnabled?: boolean
  devPreviewCard?: ReactElement | null
  planActionsBusy?: boolean
  graphEnabled?: boolean
  onBuildPlan?: (orchestration: PlanBuildOrchestration, meta?: GuiPlanToolMeta) => void
  onOpenPlan?: (meta?: GuiPlanToolMeta) => void
  onOpenChanges?: () => void
  onReviewChanges?: () => void
  reviewChangesDisabled?: boolean
  onPreviewGeneratedDocument?: (
    file: GeneratedDocumentArtifact,
    workspaceRoot: string
  ) => void
  onOpenGeneratedDocuments?: (collection: GeneratedDocumentCollection) => void
  compactCards?: boolean
  onOpenChildThread?: OpenChildThreadHandler
  onComponentPrototypePrompt?: (prompt: string) => void
  extensionMessageActions?: readonly RegisteredContribution<'actions.message'>[]
  extensionContextMenus?: readonly RegisteredContribution<'contextMenus'>[]
  extensionAttachmentContextMenus?: readonly RegisteredContribution<'contextMenus'>[]
  extensionCommands?: readonly RegisteredContribution<'commands'>[]
  extensionResultPreviews?: readonly RegisteredContribution<'message.resultPreviews'>[]
  messageContributionsForSurface?: (surface: 'code' | 'design') => {
    actions: readonly RegisteredContribution<'actions.message'>[]
    contextMenus: readonly RegisteredContribution<'contextMenus'>[]
    attachmentContextMenus: readonly RegisteredContribution<'contextMenus'>[]
    resultPreviews: readonly RegisteredContribution<'message.resultPreviews'>[]
  } | null
  onExtensionCommand?: (commandId: string, context: JsonValue) => void | Promise<unknown>
}
