import type { ReactElement } from 'react'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import type { KunSpeechToTextSettingsV1, CodeAgentPresetV1 } from '@shared/app-settings'
import { isSpeechToTextConfigured } from '@shared/speech-to-text'
import type { AttachmentReference, ChatBlock, ReviewTarget } from '../../agent/types'
import type { AppRoute } from '../../store/chat-store-types'
import type { ComposerFileReference } from '../../lib/composer-file-references'
import type { DesignComposerContext } from '../../design/design-composer-context'
import type { QueuedComposerMessage } from './FloatingComposerQueuedMessages'
import type { ComposerExecutionSettings } from './FloatingComposerExecutionPicker'
import type { ComposerReasoningEffort } from './FloatingComposerModelPicker'
import type { PendingUserInputBlock, ResolveUserInput } from './use-composer-user-input'
import type {
  ComposerTaskSurface,
  DesignTaskComposerProfile
} from './FloatingComposerTaskProfile'

export function shouldShowVoiceDictation(
  speechToText: KunSpeechToTextSettingsV1 | null | undefined,
  credentialReady = false
): boolean {
  return speechToText != null && isSpeechToTextConfigured(speechToText, { credentialReady })
}

export type ComposerPrimaryActionKind = 'interrupt' | 'submit'

export function resolveComposerPrimaryActionKind({
  busy,
  input,
  attachmentUploadEnabled,
  attachmentCount,
  fileReferenceEnabled,
  fileReferenceCount
}: {
  busy: boolean
  input: string
  attachmentUploadEnabled: boolean
  attachmentCount: number
  fileReferenceEnabled: boolean
  fileReferenceCount: number
}): ComposerPrimaryActionKind {
  const hasDraftPayload = input.trim().length > 0
    || (attachmentUploadEnabled && attachmentCount > 0)
    || (fileReferenceEnabled && fileReferenceCount > 0)

  return busy && !hasDraftPayload ? 'interrupt' : 'submit'
}

export function returnQueuedMessageToComposer(
  message: QueuedComposerMessage,
  onRemove: (id: string) => void,
  setInput: (value: string) => void
): void {
  onRemove(message.id)
  setInput(message.displayText ?? message.text)
}

export function shouldSurfaceComposerUserInput(route: AppRoute, compact: boolean): boolean {
  // Write owns a single compact composer in its assistant rail, so it must
  // surface the same runtime gate there. Other compact composers mirror a main
  // Chat/Design surface and would duplicate the prompt if they rendered it.
  if (route === 'write') return true
  return !compact && (route === 'chat' || route === 'design')
}

export function shouldShowWorkspaceControls({
  compact,
  route,
  hasActiveThread,
  hasConversationStarted
}: {
  compact: boolean
  route: AppRoute
  hasActiveThread: boolean
  hasConversationStarted: boolean
}): boolean {
  return !compact && route === 'chat' && (!hasActiveThread || !hasConversationStarted)
}

export function shouldShowUsageHistory({
  compact,
  route,
  runtimeReady
}: {
  compact: boolean
  route: AppRoute
  runtimeReady: boolean
}): boolean {
  return !compact && route === 'chat' && runtimeReady
}

export function codeExecutionControlsAvailable(
  taskSurface: ComposerTaskSurface | undefined
): boolean {
  return taskSurface !== 'design'
}
export type { DesignComposerContext } from '../../design/design-composer-context'

export type FloatingComposerProps = {
  variant?: 'default' | 'compact' | 'side'
  workspaceRootOverride?: string
  /** Bind compact or side composers to the thread they render. */
  activeThreadIdOverride?: string | null
  /** Blocks owned by the thread rendered by this composer. */
  userInputBlocksOverride?: ChatBlock[]
  /** Resolver paired with userInputBlocksOverride. */
  onResolveUserInput?: ResolveUserInput
  input: string
  setInput: (v: string) => void
  mode: 'plan' | 'agent'
  setMode: (m: 'plan' | 'agent') => void
  /** Next-turn intent. Undefined hides the control on compact/non-Code surfaces. */
  taskSurface?: ComposerTaskSurface
  taskSurfaceLocked?: boolean
  /** Gives an empty conversation a larger composer and moves its intent selector into the hero. */
  emptyTaskLayout?: boolean
  designTaskProfile?: DesignTaskComposerProfile
  designProfileLocked?: boolean
  imageGenerationEnabled?: boolean
  imageGenerationAvailable?: boolean
  imageGenerationReason?: string
  onTaskSurfaceChange?: (surface: ComposerTaskSurface) => void
  onDesignTaskProfileChange?: (patch: Partial<DesignTaskComposerProfile>) => void
  onConfigureImageGeneration?: () => void
  orchestration?: 'direct' | 'graph'
  graphEnabled?: boolean
  onOrchestrationChange?: (mode: 'direct' | 'graph') => void
  onOpenGraph?: (runId: string, nodeId?: string) => void
  onOpenGraphChild?: (
    runId: string,
    nodeId: string,
    attemptId: string,
    childThreadId: string
  ) => void
  /** Hard-disable editing and submission for an external destructive operation. */
  disabled?: boolean
  /** Visible explanation when an external lifecycle makes the composer read-only. */
  disabledReason?: string
  busy: boolean
  currentTurnOrchestration?: 'direct' | 'graph' | null
  runtimeReady: boolean
  hasActiveThread: boolean
  composerModel: string
  composerProviderId?: string
  composerPickList: string[]
  composerModelGroups?: ModelProviderModelGroup[]
  composerReasoningEffort?: string
  composerFastMode?: boolean
  /** Selected Code-persona preset id; undefined hides the picker (non-Code surfaces). */
  composerPersonaId?: string
  codeAgentPresets?: readonly CodeAgentPresetV1[]
  showProviderInModelLabel?: boolean
  onComposerModelChange: (modelId: string, providerId?: string) => void
  onComposerReasoningEffortChange?: (effort: ComposerReasoningEffort) => void
  onComposerFastModeChange?: (enabled: boolean) => void
  onComposerPersonaChange?: (presetId: string) => void
  onConfigureProviders?: () => void
  hideModelPicker?: boolean
  modelPickerMode?: 'select' | 'combobox'
  modelControlVariant?: 'combined' | 'split'
  queuedMessages: QueuedComposerMessage[]
  onRemoveQueuedMessage: (id: string) => void
  onGuideQueuedMessage?: (id: string) => void | Promise<unknown>
  attachments?: AttachmentReference[]
  attachmentUploadEnabled?: boolean
  attachmentUploadBusy?: boolean
  attachmentUploadError?: string | null
  contextChips?: DesignComposerContext[]
  fileReferenceEnabled?: boolean
  fileReferences?: ComposerFileReference[]
  extraFileMentionCandidates?: ComposerFileReference[]
  webAccessAvailable?: boolean
  executionSettings?: ComposerExecutionSettings | null
  executionSettingsApplying?: boolean
  skillCommands?: Array<{
    id: string
    name: string
    description?: string
    root?: string
    scope?: 'project' | 'global'
    legacy?: boolean
    triggers?: {
      commands?: string[]
      fileTypes?: string[]
      promptPatterns?: string[]
    }
  }>
  disabledSkillIds?: string[]
  onPickAttachments?: (files: File[]) => void
  onPasteClipboardImage?: (options?: { silentNoImage?: boolean }) => void | Promise<void>
  onRemoveAttachment?: (id: string) => void
  onRemoveContextChip?: (id: string) => void
  onAddFileReference?: (reference: ComposerFileReference) => void
  onPickFileReferences?: () => void
  onOpenFileReferencePicker?: () => void
  onOpenDesignReferencePicker?: () => void
  onRemoveFileReference?: (relativePath: string) => void
  onSend: () => void
  onInterrupt: (options?: { discard?: boolean }) => void
  onPlanCommand?: () => void
  onNewCommand?: () => void
  /** Starts a new structured requirement from the empty Code home. */
  onNewRequirement?: () => void
  /** Worktree parallel mode toggle (single-use per new conversation). */
  useWorktreePool?: boolean
  worktreeBranch?: string
  onWorktreeBranchChange?: (branch: string) => void
  onToggleWorktreeMode?: () => void
  onReviewCommand?: (target: ReviewTarget) => void
  onExecutionSettingsChange?: (patch: Partial<ComposerExecutionSettings>) => void
  /**
   * When set, the `/btw` slash command is offered. It is omitted from
   * side-conversation composers (non-goal: no nested `/btw`).
   */
  onBtwCommand?: (seedText?: string) => void
  /**
   * Hide the `/btw` slash entry (e.g. inside a side conversation).
   */
  hideBtwCommand?: boolean
}

export const EMPTY_MODEL_GROUPS: ModelProviderModelGroup[] = []
export const EMPTY_ATTACHMENTS: AttachmentReference[] = []
export const EMPTY_CONTEXT_CHIPS: DesignComposerContext[] = []
export const EMPTY_FILE_REFERENCES: ComposerFileReference[] = []
export const EMPTY_SKILL_COMMANDS: NonNullable<FloatingComposerProps['skillCommands']> = []

export function formatGoalElapsedSeconds(seconds: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  if (value < 60) return `${value}s`
  const minutes = Math.floor(value / 60)
  const remainingSeconds = value % 60
  if (value < 3600) {
    return remainingSeconds === 0
      ? `${minutes}m`
      : `${minutes}m ${remainingSeconds}s`
  }
  const hours = Math.floor(value / 3600)
  const remainingMinutes = Math.floor((value % 3600) / 60)
  return remainingMinutes === 0
    ? `${hours}h`
    : `${hours}h ${remainingMinutes}m`
}

export function shouldShowGoalFloater({
  compact,
  hasActiveGoal,
  slashQuery,
  goalPanelOpen,
  composerMenuOpen
}: {
  compact: boolean
  hasActiveGoal: boolean
  slashQuery: string | null
  goalPanelOpen: boolean
  composerMenuOpen: boolean
}): boolean {
  return !compact && hasActiveGoal && slashQuery == null && !goalPanelOpen && !composerMenuOpen
}
