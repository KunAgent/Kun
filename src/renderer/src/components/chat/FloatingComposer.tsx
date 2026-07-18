import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement
} from 'react'
import {
  BarChart3,
  FileEdit,
  FileText,
  Folder,
  GitBranch,
  ImagePlus,
  ListTodo,
  Loader2,
  Mic,
  Monitor,
  Paperclip,
  PauseCircle,
  Pencil,
  Plus,
  Puzzle,
  PlayCircle,
  SearchCode,
  Send,
  Sparkles,
  Square,
  Target,
  Trash2,
  Type as TypeIcon,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import type { AttachmentReference, ReviewTarget } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import type { AppRoute } from '../../store/chat-store-types'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import {
  COMPOSER_FILE_REFERENCE_DRAG_MIME,
  composerFileReferenceFromPath,
  isComposerDirectoryReference,
  parseComposerFileReferenceDragData,
  type ComposerFileReference
} from '../../lib/composer-file-references'
import {
  buildResearchPrompt,
  getGoalPanelDraftObjective,
  getSlashQuery,
  parseBtwCommand,
  parseCompactCommand,
  parseGoalCommand,
  parseNewCommand,
  parseResearchCommand,
  parseReviewCommand,
  type SlashCommandId
} from './floating-composer-commands'
export { buildResearchPrompt, parseBtwCommand, parseCompactCommand, parseGoalCommand, parseNewCommand, parseResearchCommand, parseReviewCommand } from './floating-composer-commands'
import {
  formatCompactNumber,
  formatCost,
  formatPercent,
  cumulativeCacheHitRate,
  useThreadUsageState
} from '../../hooks/use-thread-usage'
import { FloatingComposerContextCapacity } from './FloatingComposerContextCapacity'
export { calculateContextCapacityPopoverPlacement } from './FloatingComposerContextCapacity'
import { GitBranchPicker } from './GitBranchPicker'
import { WorkspaceProjectPicker } from './WorkspaceProjectPicker'
import {
  FloatingComposerModelPicker,
  type ComposerReasoningEffort
} from './FloatingComposerModelPicker'
import { FloatingComposerAgentPicker } from './FloatingComposerAgentPicker'
import { FloatingComposerUserInputPanel } from './FloatingComposerUserInputPanel'
import { BackgroundShellOverlay } from './BackgroundShellOverlay'
import { useComposerUserInput, type PendingUserInputBlock } from './use-composer-user-input'
import { selectLivePendingUserInput } from './user-input-panel-logic'
import {
  FloatingComposerQueuedMessages,
  type QueuedComposerMessage
} from './FloatingComposerQueuedMessages'
import {
  FloatingComposerExecutionPicker,
  type ComposerExecutionSettings
} from './FloatingComposerExecutionPicker'
import {
  FloatingComposerAttachments,
  composerImageMimeTypeFromFileName as imageMimeTypeFromFileName,
  handleComposerImagePaste,
  imageFilesFromTransfer,
  imageTransferHasImages,
  isComposerImageMimeType as isImageMimeType,
  isComposerPdfFile as isPdfFile
} from './FloatingComposerAttachments'
export {
  handleComposerImagePaste,
  imageFilesFromTransfer,
  imageTransferHasImages
} from './FloatingComposerAttachments'
export type {
  ComposerClipboardImageSource,
  ComposerImageTransferSource
} from './FloatingComposerAttachments'
import { useComposerDraft } from './use-composer-draft'
import { usePromptOptimizationSettings, useSpeechToTextSettings, useVoiceDictation } from './use-voice-dictation'
import { VoiceRecordingStrip } from './VoiceRecordingStrip'
import type { ComposerChangedFile } from '../../lib/composer-change-summary'
import type { DesignComposerContext } from '../../design/design-composer-context'
export { calculateComposerMenuScrollTop } from './composer-menu-scroll'
import { useComposerFileMentions } from './use-composer-file-mentions'
export { shouldCaptureFileMentionCommitKey } from './use-composer-file-mentions'
import { FloatingComposerFileMentionMenu } from './FloatingComposerFileMentionMenu'
import { useComposerSlashCommandMenu } from './use-composer-slash-command-menu'
import { FloatingComposerSlashCommandMenu } from './FloatingComposerSlashCommandMenu'
import { FloatingComposerTodoProgress } from './FloatingComposerTodoProgress'

export type { ComposerFileReference } from '../../lib/composer-file-references'
export type { ComposerExecutionSettings } from './FloatingComposerExecutionPicker'

export function shouldSurfaceComposerUserInput(route: AppRoute, compact: boolean): boolean {
  // Write owns a single compact composer in its assistant rail, so it must
  // surface the same runtime gate there. Other compact composers mirror a main
  // Chat/Design surface and would duplicate the prompt if they rendered it.
  if (route === 'write') return true
  return !compact && (route === 'chat' || route === 'design')
}
export type { DesignComposerContext } from '../../design/design-composer-context'

type Props = {
  variant?: 'default' | 'compact'
  workspaceRootOverride?: string
  input: string
  setInput: (v: string) => void
  mode: 'plan' | 'agent'
  setMode: (m: 'plan' | 'agent') => void
  busy: boolean
  runtimeReady: boolean
  hasActiveThread: boolean
  composerModel: string
  composerProviderId?: string
  composerPickList: string[]
  composerModelGroups?: ModelProviderModelGroup[]
  composerReasoningEffort?: string
  onComposerModelChange: (modelId: string, providerId?: string) => void
  onComposerReasoningEffortChange?: (effort: ComposerReasoningEffort) => void
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
  changedFiles?: ComposerChangedFile[]
  changedFileStats?: { added: number; removed: number } | null
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
  /** Worktree parallel mode toggle (single-use per new conversation). */
  useWorktreePool?: boolean
  worktreeBranch?: string
  onWorktreeBranchChange?: (branch: string) => void
  onToggleWorktreeMode?: () => void
  onReviewCommand?: (target: ReviewTarget) => void
  onExecutionSettingsChange?: (patch: Partial<ComposerExecutionSettings>) => void
  onOpenChanges?: () => void
  onReviewChanges?: () => void
  reviewChangesDisabled?: boolean
  /**
   * When set, the `/btw` slash command is offered. It is omitted from
   * side-conversation composers (non-goal: no nested `/btw`).
   */
  onBtwCommand?: (seedText?: string) => void
  /**
   * Hide the `/btw` slash entry (e.g. inside a side conversation).
   */
  hideBtwCommand?: boolean
  /** Active model's context window, for the 上下文容量 gauge. */
  contextWindowTokens?: number
  /** Tool definitions advertised to the model (built-ins are added on top). */
  runtimeToolCount?: number
  /** Skills in the always-injected catalog. */
  runtimeSkillCount?: number
}

const EMPTY_MODEL_GROUPS: ModelProviderModelGroup[] = []
const EMPTY_ATTACHMENTS: AttachmentReference[] = []
const EMPTY_CONTEXT_CHIPS: DesignComposerContext[] = []
const EMPTY_FILE_REFERENCES: ComposerFileReference[] = []
const EMPTY_CHANGED_FILES: ComposerChangedFile[] = []
const EMPTY_SKILL_COMMANDS: NonNullable<Props['skillCommands']> = []

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

export function FloatingComposer({
  variant = 'default',
  workspaceRootOverride,
  input,
  setInput,
  mode,
  setMode,
  busy,
  runtimeReady,
  hasActiveThread,
  composerModel,
  composerProviderId,
  composerPickList,
  composerModelGroups = EMPTY_MODEL_GROUPS,
  composerReasoningEffort,
  onComposerModelChange,
  onComposerReasoningEffortChange,
  onConfigureProviders,
  hideModelPicker = false,
  modelPickerMode = 'select',
  modelControlVariant = 'combined',
  queuedMessages,
  onRemoveQueuedMessage,
  onGuideQueuedMessage,
  attachments = EMPTY_ATTACHMENTS,
  attachmentUploadEnabled = false,
  attachmentUploadBusy = false,
  attachmentUploadError = null,
  contextChips = EMPTY_CONTEXT_CHIPS,
  fileReferenceEnabled = false,
  fileReferences = EMPTY_FILE_REFERENCES,
  extraFileMentionCandidates = EMPTY_FILE_REFERENCES,
  executionSettings = null,
  executionSettingsApplying = false,
  changedFiles = EMPTY_CHANGED_FILES,
  changedFileStats = null,
  skillCommands = EMPTY_SKILL_COMMANDS,
  disabledSkillIds,
  onPickAttachments,
  onPasteClipboardImage,
  onRemoveAttachment,
  onRemoveContextChip,
  onAddFileReference,
  onPickFileReferences,
  onOpenFileReferencePicker,
  onOpenDesignReferencePicker,
  onRemoveFileReference,
  onSend,
  onInterrupt,
  onPlanCommand,
  onNewCommand,
  useWorktreePool = false,
  worktreeBranch = '',
  onWorktreeBranchChange,
  onToggleWorktreeMode,
  onReviewCommand,
  onExecutionSettingsChange,
  onOpenChanges,
  onReviewChanges,
  reviewChangesDisabled = false,
  onBtwCommand,
  hideBtwCommand = false,
  contextWindowTokens,
  runtimeToolCount,
  runtimeSkillCount
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const route = useChatStore((s) => s.route)
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const usageRefreshKey = useChatStore((s) => s.usageRefreshKey)
  const lastTurnUsage = useChatStore((s) => s.lastTurnUsage)
  const threads = useChatStore((s) => s.threads)
  const compactActiveThread = useChatStore((s) => s.compactActiveThread)
  const forkActiveThread = useChatStore((s) => s.forkActiveThread)
  const archiveThread = useChatStore((s) => s.archiveThread)
  const activeThreadGoal = useChatStore((s) => s.activeThreadGoal)
  const activeThreadTodos = useChatStore((s) => s.activeThreadTodos)
  const setActiveThreadGoal = useChatStore((s) => s.setActiveThreadGoal)
  const setActiveThreadGoalStatus = useChatStore((s) => s.setActiveThreadGoalStatus)
  const clearActiveThreadGoal = useChatStore((s) => s.clearActiveThreadGoal)
  const clawChannels = useChatStore((s) => s.clawChannels)
  const activeClawChannelId = useChatStore((s) => s.activeClawChannelId)
  const blocks = useChatStore((s) => s.blocks)
  const resolveUserInput = useChatStore((s) => s.resolveUserInput)
  const compact = variant === 'compact'
  // The pending ask-user request for the active thread, surfaced as a panel
  // docked above this composer. The main Chat and Design composers host it, as
  // does Write's only (compact) composer. Other compact side composers would
  // otherwise mirror the active thread's prompt. The timeline bubble remains
  // the record in every surface.
  const pendingUserInputBlock = useMemo<PendingUserInputBlock | null>(() => {
    if (!shouldSurfaceComposerUserInput(route, compact)) return null
    // Only surface a request the live runtime is actively awaiting. A stale
    // `pending` block rehydrated from a finished thread must not re-prompt the
    // user (issue #606) — resolving it would hit a dead gate.
    return selectLivePendingUserInput(blocks)
  }, [blocks, compact, route])
  const userInput = useComposerUserInput(pendingUserInputBlock, resolveUserInput)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const speechToTextSettings = useSpeechToTextSettings()
  const promptOptimizationSettings = usePromptOptimizationSettings()
  const dictationInputRef = useRef(input)
  useEffect(() => {
    dictationInputRef.current = input
  }, [input])
  const dictationPrimaryActionRef = useRef<(() => void) | null>(null)
  const dictation = useVoiceDictation({
    speechToText: speechToTextSettings,
    onText: (text, intent) => {
      const existing = dictationInputRef.current.replace(/\s+$/, '')
      setInput(existing ? `${existing} ${text}` : text)
      if (intent === 'send') {
        // 等 setInput 的重渲染落地后再走正常的发送路径,
        // 这样语音直发和手动点发送行为完全一致。
        window.setTimeout(() => dictationPrimaryActionRef.current?.(), 0)
      }
    }
  })
  const showVoiceDictation = Boolean(
    speechToTextSettings?.enabled &&
    speechToTextSettings.model.trim() &&
    (speechToTextSettings.protocol === 'local-whisper' ||
      (speechToTextSettings.baseUrl.trim() && speechToTextSettings.apiKey.trim()))
  )
  const activeClawChannel = useMemo(
    () => clawChannels.find((channel) => channel.id === activeClawChannelId) ?? null,
    [activeClawChannelId, clawChannels]
  )
  const activeThreadWorkspace = activeThreadId
    ? threads.find((thread) => thread.id === activeThreadId)?.workspace
    : ''
  const activeThread = activeThreadId
    ? threads.find((thread) => thread.id === activeThreadId) ?? null
    : null
  const activeThreadArchived = activeThread?.archived === true
  const showThreadUsageFooter = !compact && route === 'chat' && Boolean(activeThreadId) && runtimeReady
  const threadUsageState = useThreadUsageState(
    activeThreadId,
    showThreadUsageFooter,
    `${activeThread?.updatedAt ?? ''}:${busy ? 'busy' : 'idle'}:${usageRefreshKey}`
  )
  const threadUsage = threadUsageState.usage
  const effectiveWorkspaceRoot = normalizeWorkspaceRoot(activeThreadWorkspace || workspaceRootOverride || workspaceRoot)
  const clawAgentName =
    activeClawChannel?.agentProfile.name.trim()
    || activeClawChannel?.label.trim()
    || t('clawEmptyHeroFallbackName')
  const clawHasInboundConversation = Boolean(
    activeThreadId ||
    activeClawChannel?.threadId.trim() ||
    activeClawChannel?.conversations.some((conversation) => conversation.localThreadId.trim()) ||
    activeClawChannel?.conversations.length ||
    activeClawChannel?.remoteSession?.chatId?.trim()
  )

  const canEditComposer = route === 'claw' ? clawHasInboundConversation : true
  const canCompose = runtimeReady && (
    route === 'claw'
      ? clawHasInboundConversation
      : (hasActiveThread || !!effectiveWorkspaceRoot)
  )
  // Code's split controls configure the next submission. The active turn has
  // already captured its model and reasoning effort, so busy must not lock them.
  const canChangeModel = canCompose && (modelControlVariant === 'split' || !busy)
  const canSend = canCompose && (
    input.trim().length > 0 ||
    (attachmentUploadEnabled && attachments.length > 0) ||
    (fileReferenceEnabled && fileReferences.length > 0)
  )
  const canPickAttachment = canCompose && attachmentUploadEnabled && !attachmentUploadBusy
  const canPickFileReference = canCompose && fileReferenceEnabled && Boolean(effectiveWorkspaceRoot) && Boolean(onOpenFileReferencePicker)
  const canPickDesignReference = canCompose && fileReferenceEnabled && Boolean(onOpenDesignReferencePicker)
  const canPickLocalFileReference = canCompose && fileReferenceEnabled && Boolean(onPickFileReferences)
  const canAddFileReference = canCompose && fileReferenceEnabled && Boolean(effectiveWorkspaceRoot) && Boolean(onAddFileReference)
  const showIntentToolbar = !compact && route === 'chat'
  const showComposerMenuButton = showIntentToolbar
  const canTogglePlanMode = canCompose && Boolean(onPlanCommand)
  const canCreateNewThread = runtimeReady && route !== 'claw' && Boolean(effectiveWorkspaceRoot) && Boolean(onNewCommand)
  const canOpenGoalPanel = canCompose && route !== 'claw'
  const canRunReview = canCompose && route !== 'claw' && Boolean(onReviewCommand)
  const canToggleWorktreeMode = canCompose && route !== 'claw' && Boolean(onToggleWorktreeMode)
  const canOpenComposerMenu = showComposerMenuButton
    && (canPickFileReference || canPickDesignReference || canPickLocalFileReference || canTogglePlanMode || canCreateNewThread || canOpenGoalPanel || canRunReview || canToggleWorktreeMode)
  const showToolbarStartControls = showComposerMenuButton
  const showExecutionSettingsPicker = showIntentToolbar
    && Boolean(executionSettings)
    && Boolean(onExecutionSettingsChange)
  const showChangeSummary = !compact && route === 'chat' && changedFiles.length > 0
  const effectiveChangedFileStats = changedFileStats ?? changedFiles.reduce(
    (stats, file) => ({
      added: stats.added + file.added,
      removed: stats.removed + file.removed
    }),
    { added: 0, removed: 0 }
  )
  const visibleChangedFiles = changedFiles.slice(0, 3)
  const hiddenChangedFileCount = Math.max(0, changedFiles.length - visibleChangedFiles.length)
  const stretchModelPicker =
    compact && modelPickerMode === 'combobox' && !showToolbarStartControls && !hideModelPicker
  const draft = useComposerDraft({ input, canCompose: canEditComposer })
  const slashQuery = getSlashQuery(input)
  const [composerMenuOpen, setComposerMenuOpen] = useState(false)
  const [worktreeBranches, setWorktreeBranches] = useState<string[]>([])
  const [goalPanelOpen, setGoalPanelOpen] = useState(false)
  const [goalRuntimeNowMs, setGoalRuntimeNowMs] = useState(() => Date.now())
  const [promptOptimizationBusy, setPromptOptimizationBusy] = useState(false)
  const [promptOptimizationError, setPromptOptimizationError] = useState<string | null>(null)
  const fileMentions = useComposerFileMentions({
    enabled: fileReferenceEnabled,
    canCompose,
    input,
    setInput,
    workspaceRoot: effectiveWorkspaceRoot,
    slashQuery,
    menuBlocked: composerMenuOpen || goalPanelOpen,
    references: fileReferences,
    extraCandidates: extraFileMentionCandidates,
    textareaRef: draft.textareaRef,
    focusComposer: draft.focusComposer,
    onAdd: onAddFileReference,
    onRemove: onRemoveFileReference
  })
  const slashCommandMenu = useComposerSlashCommandMenu({
    slashQuery,
    route,
    runtimeReady,
    busy,
    activeThreadId,
    activeThreadArchived,
    canOpenGoalPanel,
    canCreateNewThread,
    workspaceRoot: effectiveWorkspaceRoot,
    hasPlanCommand: Boolean(onPlanCommand),
    hasBtwCommand: Boolean(onBtwCommand),
    hideBtwCommand,
    hasReviewCommand: Boolean(onReviewCommand),
    skillCommands,
    disabledSkillIds,
    onDismiss: () => setInput('')
  })
  const slashCommands = slashCommandMenu.commands
  const filteredSlashCommands = slashCommandMenu.filteredCommands
  const highlightedSlashCommand = slashCommandMenu.highlightedCommand
  const composerRootRef = useRef<HTMLDivElement | null>(null)
  const composerMenuButtonRef = useRef<HTMLButtonElement | null>(null)
  const composerMenuPanelRef = useRef<HTMLDivElement | null>(null)
  const goalPanelRef = useRef<HTMLDivElement | null>(null)
  const lastTurnInputTokens =
    lastTurnUsage && lastTurnUsage.threadId === activeThreadId
      ? lastTurnUsage.snapshot.inputTokens
      : null
  const goalRuntimeStartedAtRef = useRef<number | null>(null)
  const placeholder = !runtimeReady
    ? t('runtimeActionNeedsConnection')
    : pendingUserInputBlock
      ? t('userInputComposerPlaceholder')
    : !hasActiveThread && !effectiveWorkspaceRoot
      ? t('workspaceRequiredToCreateThread')
      : goalPanelOpen && route !== 'claw'
        ? t('goalComposerPlaceholder')
      : busy
        ? t('composerQueuePlaceholder')
        : route === 'claw'
            ? clawHasInboundConversation
              ? t('clawPlaceholder', { name: clawAgentName })
              : t('clawPlaceholderNeedsInbound')
            : mode === 'plan'
              ? t('composerPlanPlaceholder')
              : hasActiveThread
                ? t('placeholder')
                : t('composerStartsThread')
  const footerHint = !runtimeReady
    ? t('composerOfflineHint')
    : !hasActiveThread && !effectiveWorkspaceRoot
      ? t('composerWorkspaceHint')
      : route === 'claw'
          ? clawHasInboundConversation
            ? t('clawComposerHint')
            : t('clawComposerHintNeedsInbound')
          : useWorktreePool
            ? t('composerWorktreeModeHint')
            : null
  const showTodoProgress = !compact
    && route === 'chat'
    && Boolean(activeThreadId)
    && activeThreadTodos?.threadId === activeThreadId
    && activeThreadTodos.items.length > 0
    && slashQuery == null
    && !composerMenuOpen
    && !goalPanelOpen
    && !pendingUserInputBlock

  useEffect(() => {
    if (!useWorktreePool || !effectiveWorkspaceRoot || typeof window.kunGui?.getGitBranches !== 'function') {
      setWorktreeBranches([])
      return
    }
    let cancelled = false
    void window.kunGui.getGitBranches(effectiveWorkspaceRoot).then((result) => {
      if (cancelled || !result.ok) return
      const names = result.branches.map((branch) => branch.name)
      setWorktreeBranches(names)
      if (!worktreeBranch.trim() && result.currentBranch) {
        onWorktreeBranchChange?.(result.currentBranch)
      }
    }).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [effectiveWorkspaceRoot, onWorktreeBranchChange, useWorktreePool, worktreeBranch])
  const parsedGoalCommand = parseGoalCommand(input)
  const goalPanelDraftObjective = getGoalPanelDraftObjective(input, goalPanelOpen)
  const canSetGoalPanelDraft =
    route !== 'claw'
    && runtimeReady
    && canOpenGoalPanel
    && goalPanelDraftObjective.length > 0
  const primaryActionLabel = highlightedSlashCommand
    ? t('slashCommandApply')
    : userInput.active
      ? t('userInputSubmit')
    : canSetGoalPanelDraft
      ? t('goalSetCurrentInput')
    : busy
      ? t('queueMessage')
      : t('send')
  const primaryActionDisabled = highlightedSlashCommand
    ? highlightedSlashCommand.disabled === true
    : userInput.active
      ? !canCompose || input.trim().length === 0
    : canSetGoalPanelDraft
      ? false
    : !canSend
  const primaryActionLoading = !runtimeReady
  const canOptimizePrompt =
    promptOptimizationSettings?.enabled === true &&
    canEditComposer &&
    !promptOptimizationBusy &&
    input.trim().length > 0 &&
    typeof window !== 'undefined' &&
    typeof window.kunGui?.optimizePrompt === 'function'
  const goalRuntimeStartedAtMs = goalRuntimeStartedAtRef.current
  const liveGoalElapsedSeconds =
    busy && activeThreadGoal?.status === 'active' && goalRuntimeStartedAtMs != null
      ? Math.max(0, Math.floor((goalRuntimeNowMs - goalRuntimeStartedAtMs) / 1000))
      : 0
  const goalElapsedLabel = activeThreadGoal
    ? formatGoalElapsedSeconds((activeThreadGoal.timeUsedSeconds ?? 0) + liveGoalElapsedSeconds)
    : ''
  const goalBannerLabel = activeThreadGoal
    ? activeThreadGoal.status === 'active'
      ? t('goalActiveHeading')
      : t(`goalStatusShort.${activeThreadGoal.status}`)
    : ''
  const goalMenuChecked = activeThreadGoal?.status === 'active'
  const showGoalFloater = shouldShowGoalFloater({
    compact,
    hasActiveGoal: Boolean(activeThreadGoal),
    slashQuery,
    goalPanelOpen,
    composerMenuOpen
  })

  useEffect(() => {
    if (slashQuery != null || goalPanelOpen) setComposerMenuOpen(false)
  }, [goalPanelOpen, slashQuery])

  useEffect(() => {
    if (!composerMenuOpen && !goalPanelOpen) return

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (composerMenuButtonRef.current?.contains(target)) return
      if (composerMenuPanelRef.current?.contains(target)) return
      if (goalPanelRef.current?.contains(target)) return
      setComposerMenuOpen(false)
      setGoalPanelOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setComposerMenuOpen(false)
      setGoalPanelOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [composerMenuOpen, goalPanelOpen])

  useEffect(() => {
    const shouldTimeGoal = busy && activeThreadGoal?.status === 'active'
    if (!shouldTimeGoal) {
      goalRuntimeStartedAtRef.current = null
      setGoalRuntimeNowMs(Date.now())
      return
    }

    if (goalRuntimeStartedAtRef.current == null) {
      const startedAt = Date.now()
      goalRuntimeStartedAtRef.current = startedAt
      setGoalRuntimeNowMs(startedAt)
    }

    const interval = window.setInterval(() => {
      setGoalRuntimeNowMs(Date.now())
    }, 1000)
    return () => window.clearInterval(interval)
  }, [busy, activeThreadGoal?.createdAt, activeThreadGoal?.objective, activeThreadGoal?.status])

  const applySlashCommand = (commandId: SlashCommandId): void => {
    if (commandId.startsWith('skill:')) {
      const command = slashCommands.find((item) => item.id === commandId)
      if (command?.skillPrompt) {
        setInput(command.skillPrompt)
        draft.focusComposer()
      }
      return
    }
    if (commandId === 'plan') {
      setInput('')
      setMode('plan')
      onPlanCommand?.()
      draft.focusComposer()
      return
    }
    if (commandId === 'new' && onNewCommand) {
      setInput('')
      onNewCommand()
      draft.focusComposer()
      return
    }
    if (commandId === 'compact') {
      setInput('')
      void compactActiveThread()
      draft.focusComposer()
      return
    }
    if (commandId === 'goal') {
      setInput('')
      setGoalPanelOpen(true)
      draft.focusComposer()
      return
    }
    if (commandId === 'research') {
      setMode('agent')
      setInput(buildResearchPrompt(t('slashCommandResearchPrompt'), null))
      draft.focusComposer()
      return
    }
    if (commandId === 'review' && onReviewCommand) {
      setInput('')
      void onReviewCommand({ kind: 'uncommittedChanges' })
      draft.focusComposer()
      return
    }
    if (commandId === 'fork') {
      setInput('')
      void forkActiveThread()
      draft.focusComposer()
      return
    }
    if (commandId === 'archive' && activeThreadId) {
      setInput('')
      void archiveThread(activeThreadId, true)
      draft.focusComposer()
      return
    }
    if (commandId === 'restore' && activeThreadId) {
      setInput('')
      void archiveThread(activeThreadId, false)
      draft.focusComposer()
      return
    }
    if (commandId === 'btw' && onBtwCommand) {
      // Empty aside — open a side conversation without a seed question.
      setInput('')
      void onBtwCommand()
      return
    }
  }

  const runGoalCommand = (command: ReturnType<typeof parseGoalCommand>): boolean => {
    if (command === false) return false
    if (!canOpenGoalPanel) return true
    setInput('')
    setGoalPanelOpen(false)
    if (command.action === 'menu') {
      setGoalPanelOpen(true)
      draft.focusComposer()
      return true
    }
    if (command.action === 'set') {
      void setActiveThreadGoal(command.objective)
      return true
    }
    if (command.action === 'pause') {
      void setActiveThreadGoalStatus('paused')
      return true
    }
    if (command.action === 'resume') {
      void setActiveThreadGoalStatus('active')
      return true
    }
    if (command.action === 'clear') {
      void clearActiveThreadGoal()
      return true
    }
    return true
  }

  const setGoalFromComposerInput = (): boolean => {
    if (!canSetGoalPanelDraft) return false
    setInput('')
    setGoalPanelOpen(false)
    void setActiveThreadGoal(goalPanelDraftObjective)
    draft.focusComposer()
    return true
  }

  const handleComposerMenuButtonClick = (): void => {
    if (!canOpenComposerMenu) return
    setGoalPanelOpen(false)
    setComposerMenuOpen((open) => !open)
    draft.focusComposer()
  }

  const handleAttachmentMenuClick = (): void => {
    if (!canPickAttachment || !onPickAttachments) return
    setComposerMenuOpen(false)
    fileInputRef.current?.click()
    draft.focusComposer()
  }

  const handleFileReferenceMenuClick = (): void => {
    if (!canPickFileReference) return
    setComposerMenuOpen(false)
    onOpenFileReferencePicker?.()
    draft.focusComposer()
  }

  const handleDesignReferenceMenuClick = (): void => {
    if (!canPickDesignReference) return
    setComposerMenuOpen(false)
    onOpenDesignReferencePicker?.()
    draft.focusComposer()
  }

  const handleLocalFileReferenceMenuClick = (): void => {
    if (!canPickLocalFileReference) return
    setComposerMenuOpen(false)
    onPickFileReferences?.()
    draft.focusComposer()
  }

  const handlePlanToolbarClick = (): void => {
    if (!canTogglePlanMode) return
    setComposerMenuOpen(false)
    if (mode === 'plan') {
      setMode('agent')
    } else {
      setMode('plan')
      onPlanCommand?.()
    }
    draft.focusComposer()
  }

  const handleGoalMenuClick = (): void => {
    if (!canOpenGoalPanel) return
    setComposerMenuOpen(false)
    if (activeThreadGoal?.status === 'active') {
      void setActiveThreadGoalStatus('paused')
    } else if (activeThreadGoal) {
      void setActiveThreadGoalStatus('active')
    } else {
      setGoalPanelOpen(true)
    }
    draft.focusComposer()
  }

  const handleWorktreeToolbarClick = (): void => {
    if (!onToggleWorktreeMode) return
    setComposerMenuOpen(false)
    onToggleWorktreeMode()
    draft.focusComposer()
  }

  const handlePromptOptimizationClick = (): void => {
    if (!canOptimizePrompt) return
    const sourceText = input
    setPromptOptimizationBusy(true)
    setPromptOptimizationError(null)
    void window.kunGui.optimizePrompt({ text: sourceText })
      .then((result) => {
        if (!result.ok) {
          setPromptOptimizationError(result.message)
          return
        }
        setInput(result.text)
        window.requestAnimationFrame(() => {
          const textarea = draft.textareaRef.current
          if (!textarea) return
          textarea.focus()
          const cursor = result.text.length
          textarea.setSelectionRange(cursor, cursor)
          fileMentions.setCursor(cursor)
        })
      })
      .catch((error) => {
        setPromptOptimizationError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setPromptOptimizationBusy(false))
  }

  const handlePrimaryAction = (): void => {
    // While an ask-user request is pending, a plain text reply answers the
    // current question instead of being sent/queued as a chat message. Routing
    // through resolveUserInput (not onSend) bypasses the busy-turn queue. Slash
    // commands (input starting with "/") fall through so they stay escape
    // hatches; an empty composer is a no-op (chips still work via the panel).
    if (userInput.active) {
      const trimmed = input.trim()
      if (!trimmed.startsWith('/')) {
        if (trimmed && userInput.submitTypedText(input)) {
          setInput('')
          draft.focusComposer()
        }
        return
      }
    }
    if (highlightedSlashCommand) {
      if (highlightedSlashCommand.disabled) return
      applySlashCommand(highlightedSlashCommand.id)
      return
    }
    if (setGoalFromComposerInput()) {
      return
    }
    if (runGoalCommand(parsedGoalCommand)) {
      return
    }
    if (onNewCommand && parseNewCommand(input)) {
      const command = slashCommands.find((item) => item.id === 'new')
      if (command?.disabled) return
      setInput('')
      onNewCommand()
      draft.focusComposer()
      return
    }
    const compactCommand = parseCompactCommand(input)
    if (compactCommand) {
      const command = slashCommands.find((item) => item.id === 'compact')
      if (command?.disabled) return
      setInput('')
      void compactActiveThread(compactCommand.reason)
      draft.focusComposer()
      return
    }
    const researchTopic = parseResearchCommand(input)
    if (researchTopic !== false) {
      const command = slashCommands.find((item) => item.id === 'research')
      if (command?.disabled) return
      setMode('agent')
      setInput(buildResearchPrompt(t('slashCommandResearchPrompt'), researchTopic))
      draft.focusComposer()
      return
    }
    if (onReviewCommand) {
      const reviewCommand = parseReviewCommand(input)
      if (reviewCommand !== false) {
        const command = slashCommands.find((item) => item.id === 'review')
        if (command?.disabled) return
        setInput('')
        void onReviewCommand(reviewCommand)
        draft.focusComposer()
        return
      }
    }
    // Send-time interception: `/btw <question>` is treated as a side
    // conversation spawn, mirroring the plan-mode interception.
    if (onBtwCommand && !hideBtwCommand) {
      const parsed = parseBtwCommand(input)
      if (parsed !== false) {
        setInput('')
        void onBtwCommand(parsed ?? undefined)
        return
      }
    }
    // Trailing fallback for a pending ask: text that began with "/" but matched
    // no real command (e.g. a free-form answer like "/usr/local/bin") still
    // answers the current question instead of leaking into chat via onSend.
    if (userInput.active && input.trim() && userInput.submitTypedText(input)) {
      setInput('')
      draft.focusComposer()
      return
    }
    onSend()
  }
  dictationPrimaryActionRef.current = primaryActionDisabled ? null : handlePrimaryAction

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    const sendByEnter =
      event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey
    const composing = draft.isComposingEvent(event)

    if (fileMentions.handleKeyDown(event, composing)) return

    if (slashCommandMenu.handleKeyDown(event, composing)) return

    // Esc cancels a pending ask-user request. (Option picking is click-only:
    // a bare-digit accelerator would hijack the first character of a
    // digit-leading custom answer, which the type-to-answer design must allow.)
    if (!composing && userInput.active && event.key === 'Escape') {
      event.preventDefault()
      userInput.cancel()
      return
    }

    if (!sendByEnter || composing) return

    event.preventDefault()
    handlePrimaryAction()
  }

  const handleComposerShellMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!canEditComposer) return
    const target = event.target
    if (
      target instanceof Element &&
      target.closest("button,input,textarea,select,a,summary,[role='button'],[contenteditable='true']")
    ) {
      return
    }
    event.preventDefault()
    draft.textareaRef.current?.focus()
  }

  useEffect(() => {
    if (compact || route !== 'chat' || !canEditComposer) return
    const active = document.activeElement
    const activeIsExternalEditor =
      active instanceof HTMLElement &&
      Boolean(active.closest("input,textarea,select,[contenteditable='true']")) &&
      !composerRootRef.current?.contains(active)
    if (activeIsExternalEditor) return

    const frame = window.requestAnimationFrame(() => {
      const current = document.activeElement
      const currentIsExternalEditor =
        current instanceof HTMLElement &&
        Boolean(current.closest("input,textarea,select,[contenteditable='true']")) &&
        !composerRootRef.current?.contains(current)
      if (!currentIsExternalEditor) {
        draft.textareaRef.current?.focus()
      }
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeThreadId, canEditComposer, compact, route, runtimeReady, draft.textareaRef])

  const handleAttachmentInput = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0 || !onPickAttachments) return
    onPickAttachments(files)
  }

  const handleComposerPaste = (event: ReactClipboardEvent<HTMLElement>): void => {
    handleComposerImagePaste({
      canPickAttachment,
      clipboardData: event.clipboardData,
      preventDefault: () => event.preventDefault(),
      onPickAttachments,
      onPasteClipboardImage
    })
  }

  const handleComposerDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    const dataTransferTypes = Array.from(event.dataTransfer.types ?? [])
    const canAcceptFileReference = canAddFileReference && dataTransferTypes.includes(COMPOSER_FILE_REFERENCE_DRAG_MIME)
    const canAcceptImages = canPickAttachment && imageTransferHasImages(event.dataTransfer)
    const canAcceptPdf = canPickAttachment && Array.from(event.dataTransfer.files ?? []).some(isPdfFile)
    if (!dataTransferTypes.includes('Files') && !canAcceptImages && !canAcceptPdf && !canAcceptFileReference) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleComposerDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    const draggedReference = canAddFileReference
      ? parseComposerFileReferenceDragData(
          event.dataTransfer.getData(COMPOSER_FILE_REFERENCE_DRAG_MIME),
          effectiveWorkspaceRoot
        )
      : null
    const imageFiles = canPickAttachment ? imageFilesFromTransfer(event.dataTransfer) : []
    const rawFiles = Array.from(event.dataTransfer.files ?? [])
    const isImageLike = (file: File): boolean =>
      isImageMimeType(file.type) || Boolean(imageMimeTypeFromFileName(file.name))
    const pdfFiles = canPickAttachment ? rawFiles.filter(isPdfFile) : []
    const pathFiles = canPickLocalFileReference && onAddFileReference
      ? rawFiles.filter((file) => !isImageLike(file) && !isPdfFile(file))
      : []
    if (!draggedReference && imageFiles.length === 0 && pdfFiles.length === 0 && pathFiles.length === 0) return
    event.preventDefault()
    if (draggedReference) onAddFileReference?.(draggedReference)
    if ((imageFiles.length > 0 || pdfFiles.length > 0) && onPickAttachments) {
      onPickAttachments([...imageFiles, ...pdfFiles])
    }
    if (pathFiles.length > 0) {
      const paths: string[] = []
      for (const file of pathFiles) {
        try {
          const path = window.kunGui.getPathForFile(file)
          if (path) paths.push(path)
        } catch {
          // ignore files we cannot resolve a filesystem path for
        }
      }
      for (const path of paths) {
        onAddFileReference?.(composerFileReferenceFromPath(path, effectiveWorkspaceRoot))
      }
    }
    draft.focusComposer()
  }

  return (
    <div
      ref={composerRootRef}
      className={compact
        ? 'ds-floating-composer ds-no-drag pointer-events-auto w-full pb-0 pt-0'
        : 'ds-floating-composer ds-no-drag ds-chat-column-inset ds-chat-content-max-width pointer-events-auto w-full pb-3 pt-0'}
    >
      <FloatingComposerQueuedMessages
        messages={queuedMessages}
        onRemove={onRemoveQueuedMessage}
        onGuide={onGuideQueuedMessage}
      />

      <div className="relative">
        <div className="pointer-events-none absolute inset-x-0 bottom-full z-30 mb-2 flex flex-col items-center gap-2">
          {runtimeReady ? <BackgroundShellOverlay /> : null}
          {showGoalFloater && activeThreadGoal && !pendingUserInputBlock ? (
            <div className="pointer-events-auto flex min-h-11 w-full max-w-[46rem] items-center gap-2 rounded-full border border-ds-border bg-white px-3 py-1.5 text-ds-muted shadow-[0_12px_34px_rgba(20,47,95,0.10)] backdrop-blur-xl dark:bg-ds-card">
              <Target className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.9} />
              <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] leading-5">
                <span className="shrink-0 font-semibold text-ds-ink">
                  {goalBannerLabel}
                </span>
                <span className="min-w-0 truncate text-ds-muted">
                  {activeThreadGoal.objective}
                </span>
                <span className="shrink-0 text-ds-faint">
                  · {goalElapsedLabel}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setGoalPanelOpen(true)
                    draft.focusComposer()
                  }}
                  className="ds-no-drag flex h-7 w-7 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                  aria-label={t('goalActionEdit')}
                  title={t('goalActionEdit')}
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.9} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void setActiveThreadGoalStatus(activeThreadGoal.status === 'active' ? 'paused' : 'active')
                  }}
                  className="ds-no-drag flex h-7 w-7 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                  aria-label={activeThreadGoal.status === 'active' ? t('goalActionPause') : t('goalActionResume')}
                  title={activeThreadGoal.status === 'active' ? t('goalActionPause') : t('goalActionResume')}
                >
                  {activeThreadGoal.status === 'active' ? (
                    <PauseCircle className="h-3.5 w-3.5" strokeWidth={1.9} />
                  ) : (
                    <PlayCircle className="h-3.5 w-3.5" strokeWidth={1.9} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void clearActiveThreadGoal()
                  }}
                  className="ds-no-drag flex h-7 w-7 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                  aria-label={t('goalActionClear')}
                  title={t('goalActionClear')}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                </button>
              </div>
            </div>
          ) : null}
          {showTodoProgress && activeThreadTodos ? (
            <FloatingComposerTodoProgress todos={activeThreadTodos} />
          ) : null}
        </div>

        {composerMenuOpen && slashQuery == null ? (
          <div
            ref={composerMenuPanelRef}
            className="absolute bottom-12 left-1 z-40 w-48 overflow-hidden rounded-[18px] border border-ds-border bg-white py-1.5 text-[13px] text-ds-muted shadow-[0_18px_48px_rgba(20,47,95,0.16)] dark:bg-ds-card"
          >
            {fileReferenceEnabled ? (
              <button
                type="button"
                disabled={!canPickLocalFileReference}
                onClick={handleLocalFileReferenceMenuClick}
                className="ds-no-drag flex h-8 w-full items-center gap-2 px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ds-muted"
              >
                <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                <span className="min-w-0 flex-1 truncate">{t('composerAddLocalFiles')}</span>
              </button>
            ) : null}
            {fileReferenceEnabled ? (
              <button
                type="button"
                disabled={!canPickFileReference}
                onClick={handleFileReferenceMenuClick}
                className="ds-no-drag flex h-8 w-full items-center gap-2 px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ds-muted"
              >
                <Paperclip className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                <span className="min-w-0 flex-1 truncate">{t('composerBrowseWorkspaceFiles')}</span>
              </button>
            ) : null}
            {fileReferenceEnabled ? (
              <button
                type="button"
                disabled={!canPickDesignReference}
                onClick={handleDesignReferenceMenuClick}
                className="ds-no-drag flex h-8 w-full items-center gap-2 px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ds-muted"
              >
                <Folder className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                <span className="min-w-0 flex-1 truncate">{t('composerBrowseDesignDocs')}</span>
              </button>
            ) : null}
            {attachmentUploadEnabled ? (
              <>
                {fileReferenceEnabled ? <div className="my-1 h-px bg-ds-border-muted/70" /> : null}
                <button
                  type="button"
                  disabled={!canPickAttachment || !onPickAttachments}
                  onClick={handleAttachmentMenuClick}
                  className="ds-no-drag flex h-8 w-full items-center gap-2 px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ds-muted"
                >
                  {attachmentUploadBusy ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={1.9} />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                  )}
                  <span className="min-w-0 flex-1 truncate">{t('composerAddImage')}</span>
                </button>
                <div className="my-1 h-px bg-ds-border-muted/70" />
              </>
            ) : null}
            <button
              type="button"
              disabled={!canTogglePlanMode}
              onClick={handlePlanToolbarClick}
              className="ds-no-drag flex h-8 w-full items-center gap-2 px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ds-muted"
            >
              <ListTodo className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
              <span className="min-w-0 flex-1 truncate">{t('composerMenuPlanMode')}</span>
              <span
                role="switch"
                aria-checked={mode === 'plan'}
                className={`relative h-5 w-9 shrink-0 rounded-full ring-1 transition ${
                  mode === 'plan'
                    ? 'bg-accent ring-accent/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]'
                    : 'bg-ds-border-muted ring-ds-border-muted'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white ring-1 ring-black/5 transition ${
                    mode === 'plan' ? 'translate-x-[17px]' : 'translate-x-0.5'
                  } shadow-[0_1px_4px_rgba(20,47,95,0.28)]`}
                />
              </span>
            </button>
            <button
              type="button"
              disabled={!canOpenGoalPanel}
              onClick={handleGoalMenuClick}
              className="ds-no-drag flex h-8 w-full items-center gap-2 px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ds-muted"
            >
              <Target className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
              <span className="min-w-0 flex-1 truncate">{t('composerMenuPursueGoal')}</span>
              <span
                role="switch"
                aria-checked={goalMenuChecked}
                className={`relative h-5 w-9 shrink-0 rounded-full ring-1 transition ${
                  goalMenuChecked
                    ? 'bg-accent ring-accent/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]'
                    : 'bg-ds-border-muted ring-ds-border-muted'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white ring-1 ring-black/5 transition ${
                    goalMenuChecked ? 'translate-x-[17px]' : 'translate-x-0.5'
                  } shadow-[0_1px_4px_rgba(20,47,95,0.28)]`}
                />
              </span>
            </button>
            {canToggleWorktreeMode ? (
              <button
                type="button"
                disabled={!canToggleWorktreeMode}
                onClick={handleWorktreeToolbarClick}
                className="ds-no-drag flex h-8 w-full items-center gap-2 px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ds-muted"
              >
                <GitBranch className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                <span className="min-w-0 flex-1 truncate">
                  {useWorktreePool ? t('composerEnvironmentWorktree') : t('composerEnvironmentLocal')}
                </span>
                <span
                  role="switch"
                  aria-checked={useWorktreePool}
                  className={`relative h-5 w-9 shrink-0 rounded-full ring-1 transition ${
                    useWorktreePool
                      ? 'bg-accent ring-accent/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]'
                      : 'bg-ds-border-muted ring-ds-border-muted'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white ring-1 ring-black/5 transition ${
                      useWorktreePool ? 'translate-x-[17px]' : 'translate-x-0.5'
                    } shadow-[0_1px_4px_rgba(20,47,95,0.28)]`}
                  />
                </span>
              </button>
            ) : null}
          </div>
        ) : null}

        {slashQuery != null ? (
          <FloatingComposerSlashCommandMenu
            commands={filteredSlashCommands}
            highlighted={highlightedSlashCommand}
            selectedIndex={slashCommandMenu.selectedIndex}
            onSelect={applySlashCommand}
          />
        ) : null}

        {fileMentions.showMenu ? (
          <FloatingComposerFileMentionMenu
            suggestions={fileMentions.suggestions}
            loading={fileMentions.loading}
            selectedIndex={fileMentions.selectedIndex}
            highlighted={fileMentions.highlighted}
            onSelect={fileMentions.applyReference}
          />
        ) : null}

        {goalPanelOpen && slashQuery == null && !pendingUserInputBlock ? (
          <div
            ref={goalPanelRef}
            className="absolute inset-x-2 bottom-full z-30 mb-3 overflow-hidden rounded-[26px] border border-ds-border bg-white p-3 shadow-[0_18px_52px_rgba(20,47,95,0.14)] backdrop-blur-xl dark:bg-ds-card"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ds-border-muted text-ds-muted">
                <Target className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="truncate text-[14px] font-semibold text-ds-ink">
                    {activeThreadGoal ? activeThreadGoal.objective : t('goalNoActiveTitle')}
                  </div>
                  {activeThreadGoal ? (
                    <span className="shrink-0 rounded-lg border border-ds-border-muted bg-ds-card px-2 py-0.5 text-[11px] font-semibold text-ds-muted">
                      {t(`goalStatusShort.${activeThreadGoal.status}`)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {canSetGoalPanelDraft ? (
                    <button
                      type="button"
                      onClick={setGoalFromComposerInput}
                      className="rounded-full border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] font-semibold text-ds-ink transition hover:bg-ds-hover"
                    >
                      {t('goalSetCurrentInput')}
                    </button>
                  ) : null}
                  {activeThreadGoal?.status === 'active' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setGoalPanelOpen(false)
                        void setActiveThreadGoalStatus('paused')
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-ds-border bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                      aria-label={t('goalActionPause')}
                      title={t('goalActionPause')}
                    >
                      <PauseCircle className="h-4 w-4" strokeWidth={1.9} />
                    </button>
                  ) : activeThreadGoal ? (
                    <button
                      type="button"
                      onClick={() => {
                        setGoalPanelOpen(false)
                        void setActiveThreadGoalStatus('active')
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-ds-border bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                      aria-label={t('goalActionResume')}
                      title={t('goalActionResume')}
                    >
                      <PlayCircle className="h-4 w-4" strokeWidth={1.9} />
                    </button>
                  ) : null}
                  {activeThreadGoal ? (
                    <button
                      type="button"
                      onClick={() => {
                        setGoalPanelOpen(false)
                        void clearActiveThreadGoal()
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-ds-border bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                      aria-label={t('goalActionClear')}
                      title={t('goalActionClear')}
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.9} />
                    </button>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGoalPanelOpen(false)}
                className="rounded-lg p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                aria-label={t('close')}
                title={t('close')}
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        ) : null}

        {userInput.active ? (
          <FloatingComposerUserInputPanel controller={userInput} t={t} />
        ) : null}

        <div
          className={`ds-composer-shell ds-chat-composer ds-frosted ds-no-drag flex flex-col gap-1 px-3 pb-2 pt-2 transition ${
            draft.focused ? 'ds-chat-composer-focus' : ''
          } ${compact ? 'rounded-[24px] px-3 py-2 shadow-none' : ''}`}
          onMouseDown={handleComposerShellMouseDown}
          onPaste={handleComposerPaste}
          onDragOver={handleComposerDragOver}
          onDrop={handleComposerDrop}
        >
          {showChangeSummary ? (
            <div className="ds-no-drag mb-1 rounded-2xl border border-ds-border-muted bg-ds-card px-3 py-2 shadow-sm">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ds-hover text-ds-muted">
                  <FileEdit className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] font-semibold text-ds-ink">
                    <span className="truncate">{t('composerChangedFilesTitle', { count: changedFiles.length })}</span>
                    <span className="font-mono text-[12px] text-ds-diff-added">
                      +{effectiveChangedFileStats.added}
                    </span>
                    <span className="font-mono text-[12px] text-ds-diff-removed">
                      -{effectiveChangedFileStats.removed}
                    </span>
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ds-muted">
                    {visibleChangedFiles.map((file) => (
                      <span key={file.path} className="max-w-[220px] truncate" title={file.path}>
                        {file.path}
                      </span>
                    ))}
                    {hiddenChangedFileCount > 0 ? (
                      <span className="text-ds-faint">
                        {t('composerChangedFilesMore', { count: hiddenChangedFileCount })}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {onOpenChanges ? (
                    <button
                      type="button"
                      onClick={onOpenChanges}
                      className="rounded-full border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] font-semibold text-ds-ink transition hover:bg-ds-hover"
                    >
                      {t('composerOpenChanges')}
                    </button>
                  ) : null}
                  {onReviewChanges ? (
                    <button
                      type="button"
                      disabled={reviewChangesDisabled}
                      onClick={onReviewChanges}
                      className="inline-flex items-center gap-1.5 rounded-full border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] font-semibold text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <SearchCode className="h-3.5 w-3.5" strokeWidth={1.8} />
                      {t('composerReviewChanges')}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          {contextChips.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 px-1">
              {contextChips.map((chip) => {
                const Icon =
                  chip.kind === 'extension-context'
                    ? Puzzle
                    : chip.kind === 'design-target' || chip.kind === 'canvas-selection'
                    ? Target
                    : chip.kind === 'html-element'
                      ? TypeIcon
                      : Monitor
                const title = chip.detail ? `${chip.label} - ${chip.detail}` : chip.label
                const removable = chip.removable !== false && Boolean(onRemoveContextChip)
                return (
                  <span
                    key={chip.id}
                    className="ds-no-drag inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg border border-accent/25 bg-accent/10 px-2 text-[12px] font-medium text-ds-muted"
                    title={title}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.8} />
                    <span className="max-w-52 truncate text-ds-ink">{chip.label}</span>
                    {chip.detail ? (
                      <span className="hidden max-w-44 truncate text-ds-faint sm:inline">
                        {chip.detail}
                      </span>
                    ) : null}
                    {removable ? (
                      <button
                        type="button"
                        onClick={() => onRemoveContextChip?.(chip.id)}
                        className="rounded-full p-0.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                        aria-label={t('composerRemoveContext', 'Remove context')}
                        title={t('composerRemoveContext', 'Remove context')}
                      >
                        <X className="h-3 w-3" strokeWidth={2} />
                      </button>
                    ) : null}
                  </span>
                )
              })}
            </div>
          ) : null}
          <textarea
            ref={draft.textareaRef}
            rows={1}
            className={`ds-no-drag block w-full min-w-0 resize-none break-words bg-transparent px-1 py-2.5 text-[15px] leading-[1.45] text-ds-ink placeholder:text-ds-faint focus:outline-none [overflow-wrap:anywhere] ${
              canEditComposer ? '' : 'opacity-80'
            } ${compact ? 'text-[14px] py-2' : 'min-h-[40px]'}`}
            placeholder={placeholder}
            value={input}
            disabled={!canEditComposer}
            onChange={(e) => {
              fileMentions.updateInput(
                e.target.value,
                e.target.selectionStart ?? e.target.value.length
              )
            }}
            onSelect={(e) => fileMentions.syncCursor(e.currentTarget)}
            onFocus={draft.onFocus}
            onBlur={draft.onBlur}
            onCompositionStart={draft.onCompositionStart}
            onCompositionEnd={draft.onCompositionEnd}
            onKeyDown={handleComposerKeyDown}
          />
          {fileReferences.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 px-1">
              {fileReferences.map((reference) => {
                const isDirectory = isComposerDirectoryReference(reference)
                const displayPath = isDirectory ? `${reference.relativePath}/` : reference.relativePath
                return (
                  <span
                    key={`${reference.type ?? 'file'}:${reference.relativePath}`}
                    className="ds-no-drag inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg border border-ds-border-muted bg-ds-card px-2 text-[12px] font-medium text-ds-muted"
                    title={displayPath}
                  >
                    {isDirectory ? (
                      <Folder className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
                    ) : (
                      <FileText className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
                    )}
                    <span className="max-w-52 truncate">{displayPath}</span>
                    {onRemoveFileReference ? (
                      <button
                        type="button"
                        onClick={() => fileMentions.removeReference(reference)}
                        className="rounded-full p-0.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                        aria-label={t('composerRemoveFileReference')}
                        title={t('composerRemoveFileReference')}
                      >
                        <X className="h-3 w-3" strokeWidth={2} />
                      </button>
                    ) : null}
                  </span>
                )
              })}
            </div>
          ) : null}
          <FloatingComposerAttachments
            attachments={attachments}
            attachmentUploadError={attachmentUploadError}
            onRemoveAttachment={onRemoveAttachment}
          />
          {attachmentUploadEnabled ? (
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf,.pdf"
              multiple
              className="hidden"
              onChange={handleAttachmentInput}
            />
          ) : null}
          {dictation.error ? (
            <div className="px-1">
              <span className="min-w-0 break-words text-[12px] font-medium text-red-600 dark:text-red-300">
                {dictation.error}
              </span>
            </div>
          ) : null}
          {promptOptimizationError ? (
            <div className="px-1">
              <span className="min-w-0 break-words text-[12px] font-medium text-red-600 dark:text-red-300">
                {promptOptimizationError}
              </span>
            </div>
          ) : null}
          <div
            className={`ds-composer-toolbar flex min-h-9 min-w-0 items-center gap-2 ${
              showToolbarStartControls ? 'justify-between' : 'justify-end'
            }`}
          >
            {showToolbarStartControls ? (
              <div className="ds-composer-toolbar-start flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overflow-y-hidden">
                {showComposerMenuButton ? (
                  <>
                    <button
                      ref={composerMenuButtonRef}
                      type="button"
                      disabled={!canOpenComposerMenu}
                      onClick={handleComposerMenuButtonClick}
                      className={`ds-no-drag flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 ${
                        composerMenuOpen ? 'bg-ds-hover text-ds-ink' : ''
                      }`}
                      aria-label={t('composerMenuTitle')}
                      title={t('composerMenuTitle')}
                    >
                      <Plus className="h-5 w-5" strokeWidth={1.8} />
                    </button>
                    {mode === 'plan' ? (
                      <span
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-ds-hover px-2.5 text-[13px] font-medium text-ds-muted"
                        title={t('slashCommandPlanTitle')}
                      >
                        <ListTodo className="h-3.5 w-3.5" strokeWidth={1.9} />
                        <span>{t('slashCommandPlanTitle')}</span>
                      </span>
                    ) : null}
                    {activeThreadGoal?.status === 'active' ? (
                      <span
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-ds-hover px-2.5 text-[13px] font-medium text-ds-muted"
                        title={t('slashCommandGoalTitle')}
                      >
                        <Target className="h-3.5 w-3.5" strokeWidth={1.9} />
                        <span>{t('slashCommandGoalTitle')}</span>
                      </span>
                    ) : null}
                  </>
                ) : null}
                {showExecutionSettingsPicker && executionSettings && onExecutionSettingsChange ? (
                  <FloatingComposerExecutionPicker
                    value={executionSettings}
                    applying={executionSettingsApplying}
                    disabled={!canCompose || busy}
                    onChange={onExecutionSettingsChange}
                  />
                ) : null}
              </div>
            ) : null}
            <div
              className={`ds-composer-toolbar-actions flex min-w-0 items-center justify-end gap-1.5 ${
                showToolbarStartControls || stretchModelPicker || dictation.status === 'recording' ? 'flex-1' : 'shrink-0'
              }`}
            >
              {dictation.status === 'recording' ? (
                <>
                  <VoiceRecordingStrip
                    getLevel={dictation.getLevel}
                    startedAtMs={dictation.startedAtMs}
                  />
                  <button
                    type="button"
                    onClick={() => dictation.stop('insert')}
                    className="ds-no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-ds-border bg-ds-card text-ds-ink shadow-sm transition hover:bg-ds-hover"
                    aria-label={t('composerVoiceStop')}
                    title={t('composerVoiceStop')}
                  >
                    <Square className="h-3 w-3 fill-current" strokeWidth={2.4} />
                  </button>
                  <button
                    type="button"
                    onClick={() => dictation.stop('send')}
                    className="ds-no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white shadow-[0_10px_22px_rgba(20,47,95,0.22)] transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                    aria-label={t('composerVoiceSend')}
                    title={t('composerVoiceSend')}
                  >
                    <Send className="h-4 w-4" strokeWidth={2.2} />
                  </button>
                </>
              ) : (
                <>
                  <FloatingComposerContextCapacity
                    compact={compact}
                    route={route}
                    activeThreadId={activeThreadId}
                    lastTurnInputTokens={lastTurnInputTokens}
                    contextWindowTokens={contextWindowTokens}
                    runtimeToolCount={runtimeToolCount}
                    runtimeSkillCount={runtimeSkillCount}
                  />
                  {hideModelPicker ? null : (
                    <FloatingComposerModelPicker
                      compact={compact}
                      mode={modelPickerMode}
                      composerModel={composerModel}
                      composerProviderId={composerProviderId}
                      composerPickList={composerPickList}
                      composerModelGroups={composerModelGroups}
                      composerReasoningEffort={composerReasoningEffort}
                      canChangeModel={canChangeModel}
                      controlVariant={modelControlVariant}
                      stretch={stretchModelPicker || showToolbarStartControls}
                      onComposerModelChange={onComposerModelChange}
                      onComposerReasoningEffortChange={onComposerReasoningEffortChange}
                      onConfigureProviders={onConfigureProviders}
                    />
                  )}
                  {hideModelPicker ? null : (
                    <FloatingComposerAgentPicker compact={compact} disabled={!canCompose || busy} />
                  )}
                  {showVoiceDictation ? (
                    <button
                      type="button"
                      disabled={dictation.status === 'transcribing' || !canEditComposer}
                      onClick={dictation.toggle}
                      className="ds-no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-60"
                      aria-label={
                        dictation.status === 'transcribing'
                          ? t('composerVoiceTranscribing')
                          : t('composerVoiceStart')
                      }
                      title={
                        dictation.status === 'transcribing'
                          ? t('composerVoiceTranscribing')
                          : t('composerVoiceStart')
                      }
                    >
                      {dictation.status === 'transcribing' ? (
                        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
                      ) : (
                        <Mic className="h-4 w-4" strokeWidth={2} />
                      )}
                    </button>
                  ) : null}
                  {promptOptimizationSettings?.enabled === true ? (
                    <button
                      type="button"
                      disabled={!canOptimizePrompt}
                      onClick={handlePromptOptimizationClick}
                      className="ds-no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-60"
                      aria-label={promptOptimizationBusy ? t('composerPromptOptimizing') : t('composerPromptOptimize')}
                      title={promptOptimizationBusy ? t('composerPromptOptimizing') : t('composerPromptOptimize')}
                    >
                      {promptOptimizationBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
                      ) : (
                        <Sparkles className="h-4 w-4" strokeWidth={2} />
                      )}
                    </button>
                  ) : null}
                  {busy ? (
                    <button
                      type="button"
                      onClick={() => onInterrupt()}
                      className="ds-no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white shadow-[0_10px_22px_rgba(20,47,95,0.22)] transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                      aria-label={t('interrupt')}
                      title={t('interrupt')}
                    >
                      <Square className="h-3.5 w-3.5 fill-current" strokeWidth={2.4} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={primaryActionDisabled}
                    onClick={handlePrimaryAction}
                    className="ds-no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white shadow-[0_10px_22px_rgba(20,47,95,0.22)] transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-ds-card disabled:text-ds-faint disabled:shadow-none dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 dark:disabled:bg-ds-card dark:disabled:text-ds-faint"
                    aria-label={primaryActionLabel}
                    title={primaryActionLabel}
                  >
                    {primaryActionLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
                    ) : (
                      <Send className="h-4 w-4" strokeWidth={2.2} />
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      {compact ? null : (
        <div className="ds-composer-footer mt-1 flex min-h-7 flex-wrap items-center justify-between gap-x-2.5 gap-y-1.5 px-3">
          <div className="ds-composer-footer-left flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {route === 'chat' ? (
              <WorkspaceProjectPicker currentWorkspaceRoot={effectiveWorkspaceRoot} />
            ) : null}
            <GitBranchPicker workspaceRoot={effectiveWorkspaceRoot} />
            {useWorktreePool && worktreeBranches.length > 0 ? (
              <label className="ds-no-drag inline-flex min-h-7 max-w-[220px] items-center gap-1.5 rounded-lg border border-ds-border-muted bg-ds-card px-2 py-0.5 text-[12.5px] font-medium text-ds-muted shadow-sm">
                <GitBranch className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                <select
                  value={worktreeBranch || worktreeBranches[0]}
                  onChange={(event) => onWorktreeBranchChange?.(event.target.value)}
                  className="min-w-0 bg-transparent text-ds-muted outline-none"
                  title={t('composerWorktreeBranch')}
                >
                  {worktreeBranches.map((branch) => (
                    <option key={branch} value={branch}>
                      {branch}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {showThreadUsageFooter ? (
              <div
                className="ds-composer-usage ds-no-drag inline-flex min-h-7 max-w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 overflow-visible rounded-lg border border-ds-border-muted bg-ds-card px-2.5 py-0.5 text-[12.5px] font-medium leading-5 text-ds-muted shadow-sm"
                title={
                  threadUsage
                    ? t(
                        threadUsage.lastTurnCacheHitRate != null
                          ? 'sessionUsageDetailsTitleWithLatestCache'
                          : 'sessionUsageDetailsTitle',
                        {
                        tokens: formatCompactNumber(threadUsage.totalTokens),
                        cost: formatCost(threadUsage.costUsd, i18n.language, threadUsage.costCny),
                        saved: formatCompactNumber(threadUsage.tokenEconomySavingsTokens),
                        cache: formatPercent(threadUsage.cacheHitRate),
                        latestCache: formatPercent(threadUsage.lastTurnCacheHitRate),
                        cached: formatCompactNumber(threadUsage.cachedTokens),
                        miss: formatCompactNumber(threadUsage.cacheMissTokens),
                        turns: threadUsage.turns
                        }
                      )
                    : t('sessionUsageUnavailable')
                }
              >
                <BarChart3 className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.9} />
                {threadUsage ? (
                  <>
                    <span className="ds-composer-usage-tokens shrink-0 truncate tabular-nums">
                      {t('sessionUsageTokens', {
                        tokens: formatCompactNumber(threadUsage.totalTokens)
                      })}
                    </span>
                    <span className="ds-composer-usage-cost-separator text-ds-faint">·</span>
                    <span className="ds-composer-usage-cost shrink-0 truncate tabular-nums">
                      {t('sessionUsageCost', {
                        cost: formatCost(threadUsage.costUsd, i18n.language, threadUsage.costCny)
                      })}
                    </span>
                    {threadUsage.tokenEconomySavingsTokens > 0 ? (
                      <>
                        <span className="ds-composer-usage-context-savings-separator text-ds-faint">·</span>
                        <span
                          className="ds-composer-usage-context-savings shrink-0 tabular-nums text-emerald-700 dark:text-emerald-300"
                          title={t('sessionUsageContextSavingsTitle', {
                            tokens: formatCompactNumber(threadUsage.tokenEconomySavingsTokens)
                          })}
                        >
                          {t('sessionUsageContextSavings', {
                            tokens: formatCompactNumber(threadUsage.tokenEconomySavingsTokens)
                          })}
                        </span>
                      </>
                    ) : null}
                    {threadUsage.turns > 1 ? (
                      <>
                        <span className="ds-composer-usage-cache-separator text-ds-faint">·</span>
                        <span className="ds-composer-usage-cache shrink-0 truncate tabular-nums">
                          {t('sessionUsageCache', {
                            cache: formatPercent(cumulativeCacheHitRate(threadUsage))
                          })}
                        </span>
                      </>
                    ) : null}
                    <span className="ds-composer-usage-turns-separator text-ds-faint">·</span>
                    <span className="ds-composer-usage-turns shrink-0 truncate tabular-nums">
                      {t('sessionUsageTurns', { turns: threadUsage.turns })}
                    </span>
                  </>
                ) : (
                  <span className="shrink-0 text-ds-faint">
                    {threadUsageState.loading
                      ? t('sessionUsageLoading')
                      : t('sessionUsageUnavailable')}
                  </span>
                )}
              </div>
            ) : null}
          </div>
          {footerHint ? (
            <div className="ds-composer-footer-hint min-w-0 flex-1 text-right text-[12.5px] font-medium text-ds-faint">
              <span className="block truncate">{footerHint}</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
