import {
  useCallback,
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
  Bot,
  FileText,
  Folder,
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
  Send,
  Share2,
  Sparkles,
  Square,
  Target,
  Trash2,
  Type as TypeIcon,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import type { KunSpeechToTextSettingsV1 } from '@shared/app-settings'
import { isSpeechToTextConfigured } from '@shared/speech-to-text'
import type { AttachmentReference, ChatBlock, ReviewTarget } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import type { AppRoute } from '../../store/chat-store-types'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import {
  isComposerDirectoryReference,
  type ComposerFileReference
} from '../../lib/composer-file-references'
import {
  buildResearchPrompt,
  COMPOSER_FOCUS_REQUEST_EVENT,
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
import {
  formatCompactNumber,
  formatCost,
  formatPercent,
  primaryCacheHitRate,
  formatTtftSeconds,
  formatTps,
  mergeLiveThreadUsage,
  useThreadUsageState
} from '../../hooks/use-thread-usage'
import { FloatingComposerContextCapacity } from './FloatingComposerContextCapacity'
import { FloatingComposerUsageHistory } from './FloatingComposerUsageHistory'
import { GitBranchPicker } from './GitBranchPicker'
import { WorkspaceProjectPicker } from './WorkspaceProjectPicker'
import {
  FloatingComposerModelPicker,
  type ComposerReasoningEffort
} from './FloatingComposerModelPicker'
import { FloatingComposerAgentPicker } from './FloatingComposerAgentPicker'
import { FloatingComposerUserInputPanel } from './FloatingComposerUserInputPanel'
import { BackgroundShellOverlay } from './BackgroundShellOverlay'
import {
  useComposerUserInput,
  type PendingUserInputBlock,
  type ResolveUserInput
} from './use-composer-user-input'
import { selectLivePendingUserInput } from './user-input-panel-logic'
import {
  FloatingComposerQueuedMessages,
  type QueuedComposerMessage
} from './FloatingComposerQueuedMessages'
import {
  FloatingComposerExecutionPicker,
  type ComposerExecutionSettings
} from './FloatingComposerExecutionPicker'
import { FloatingComposerActionMenu } from './FloatingComposerActionMenu'
import { resolveCodeAgentPreset } from './code-agent-presets'
import {
  FloatingComposerAttachments,
  handleComposerImagePaste
} from './FloatingComposerAttachments'
import { useComposerDraft } from './use-composer-draft'
import { useComposerInputHistory } from './use-composer-input-history'
import { usePromptOptimizationSettings, useSpeechToTextSettings, useVoiceDictation } from './use-voice-dictation'
import { VoiceRecordingStrip } from './VoiceRecordingStrip'
import type { DesignComposerContext } from '../../design/design-composer-context'
import { useComposerFileMentions } from './use-composer-file-mentions'
import { FloatingComposerFileMentionMenu } from './FloatingComposerFileMentionMenu'
import { useComposerSlashCommandMenu } from './use-composer-slash-command-menu'
import { FloatingComposerSlashCommandMenu } from './FloatingComposerSlashCommandMenu'
import { FloatingComposerTodoProgress } from './FloatingComposerTodoProgress'
import { FloatingComposerGraphProgress } from './FloatingComposerGraphProgress'
import { FloatingComposerAboveInputStack } from './FloatingComposerAboveInputStack'
import {
  canAcceptComposerFileDrop,
  routeComposerFileDrop,
  type ComposerFileDropOptions
} from './composer-file-drop'
import { useComposerSendKeySetting } from '../../lib/composer-send-key-settings'
import { isComposerSendHotkey } from '@shared/app-settings'
import { selectGraphPlanningCorrectionDraft, useGraphStore } from '../../graph/graph-store'
import {
  EMPTY_ATTACHMENTS,
  EMPTY_CONTEXT_CHIPS,
  EMPTY_FILE_REFERENCES,
  EMPTY_MODEL_GROUPS,
  EMPTY_SKILL_COMMANDS,
  codeExecutionControlsAvailable,
  resolveComposerPrimaryActionKind,
  shouldShowGoalFloater,
  shouldShowUsageHistory,
  shouldShowVoiceDictation,
  shouldShowWorkspaceControls,
  shouldSurfaceComposerUserInput,
  type FloatingComposerProps
} from './floating-composer-policy'
import { useFloatingComposerActions } from './use-floating-composer-actions'
import { useGoalElapsedLabel } from './use-goal-elapsed'
import type { FloatingComposerRenderContext } from './floating-composer-view-context'
import { FloatingComposerStackView } from './FloatingComposerStackView'
import { FloatingComposerSurfaceView } from './FloatingComposerSurfaceView'
import { FloatingComposerTaskProfile } from './FloatingComposerTaskProfile'
import { FloatingComposerTaskSurfacePicker } from './FloatingComposerTaskSurfacePicker'
export * from './floating-composer-public'

export function FloatingComposer({
  variant = 'default',
  workspaceRootOverride,
  activeThreadIdOverride,
  userInputBlocksOverride,
  onResolveUserInput,
  input,
  setInput,
  mode,
  setMode,
  taskSurface, taskSurfaceLocked = false, emptyTaskLayout = false, designTaskProfile,
  autoPlanBuildEnabled = false,
  designProfileLocked = false,
  imageGenerationEnabled, imageGenerationAvailable = false, imageGenerationReason,
  onTaskSurfaceChange, onDesignTaskProfileChange, onConfigureImageGeneration,
  orchestration = 'direct',
  graphEnabled = false,
  onOrchestrationChange,
  onOpenGraph,
  onOpenGraphChild,
  disabled = false,
  disabledReason,
  busy,
  currentTurnOrchestration = null,
  runtimeReady,
  hasActiveThread,
  composerModel,
  composerProviderId,
  composerPickList,
  composerModelGroups = EMPTY_MODEL_GROUPS,
  composerReasoningEffort,
  composerFastMode,
  composerPersonaId,
  codeAgentPresets,
  showProviderInModelLabel = false,
  onComposerModelChange,
  onComposerReasoningEffortChange,
  onComposerFastModeChange,
  onComposerPersonaChange,
  onConfigureProviders,
  hideModelPicker = false,
  modelPickerMode = 'select',
  modelControlVariant = 'combined',
  queuedMessages,
  onRemoveQueuedMessage,
  onRestoreQueuedMessageToComposer,
  onReorderQueuedMessage,
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
  onNewRequirement,
  useWorktreePool = false,
  worktreeBranch = '',
  onWorktreeBranchChange,
  onToggleWorktreeMode,
  onReviewCommand,
  onExecutionSettingsChange,
  onBtwCommand,
  hideBtwCommand = false
}: FloatingComposerProps): ReactElement {
  const { t, i18n } = useTranslation('common')
  const composerSendKey = useComposerSendKeySetting()
  const route = useChatStore((s) => s.route)
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const storeActiveThreadId = useChatStore((s) => s.activeThreadId)
  const threadLoadingId = useChatStore((s) => s.threadLoadingId)
  const activeThreadId = activeThreadIdOverride === undefined
    ? storeActiveThreadId
    : activeThreadIdOverride
  const graphPlanningCorrectionDraft = useGraphStore((state) =>
    selectGraphPlanningCorrectionDraft(state.drafts, activeThreadId)
  )
  const usageRefreshKey = useChatStore((s) => s.usageRefreshKey)
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
  const storeReorderQueuedMessage = useChatStore((s) => s.reorderQueuedMessage)
  const openSettings = useChatStore((s) => s.openSettings)
  const compact = variant !== 'default'
  const side = variant === 'side'
  // The pending ask-user request for this composer's thread, surfaced as a
  // panel docked above the input. Thread-scoped rails (for example SDD and
  // side conversations) provide their own blocks + resolver because their
  // compact route would otherwise be mistaken for a duplicate main composer.
  const userInputBlocks = userInputBlocksOverride ?? blocks
  const hasThreadScopedUserInput =
    userInputBlocksOverride !== undefined && onResolveUserInput !== undefined
  const canSurfaceUserInput =
    hasThreadScopedUserInput || (!side && shouldSurfaceComposerUserInput(route, compact))
  const pendingUserInputBlock = useMemo<PendingUserInputBlock | null>(() => {
    if (!canSurfaceUserInput) return null
    // Only surface a request the live runtime is actively awaiting. A stale
    // `pending` block rehydrated from a finished thread must not re-prompt the
    // user (issue #606) — resolving it would hit a dead gate.
    return selectLivePendingUserInput(userInputBlocks)
  }, [canSurfaceUserInput, userInputBlocks])
  const userInput = useComposerUserInput(
    pendingUserInputBlock,
    onResolveUserInput ?? resolveUserInput
  )
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { speechToText: speechToTextSettings, credentialReady: speechCredentialReady } =
    useSpeechToTextSettings()
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
  const showVoiceDictation = shouldShowVoiceDictation(speechToTextSettings, speechCredentialReady)
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
  const showUsageHistoryFooter = shouldShowUsageHistory({ compact, route, runtimeReady })
  const hydratingActiveThread = activeThreadId != null && threadLoadingId === activeThreadId
  const hasConversationStarted = blocks.some((block) => block.kind === 'user')
  const showWorkspaceControls = shouldShowWorkspaceControls({
    compact,
    route,
    hasActiveThread,
    hasConversationStarted
  })
  const threadUsageState = useThreadUsageState(
    activeThreadId,
    showUsageHistoryFooter && Boolean(activeThreadId) && !hydratingActiveThread,
    `${activeThreadId ?? ''}:${usageRefreshKey}`
  )
  const threadUsage = threadUsageState.usage
  /**
   * Prefer the latest usage SSE event while a thread is active, then fall back
   * to the persisted REST summary after reloads, thread switches, or missed
   * events. Both paths carry provider-independent timing aggregates.
   */
  const liveThreadUsage = useChatStore((s) =>
    s.lastTurnUsage && s.lastTurnUsage.threadId === s.activeThreadId
      ? s.lastTurnUsage.snapshot
      : null
  )
  const timingThreadUsage = liveThreadUsage ?? threadUsage
  const displayThreadUsage = mergeLiveThreadUsage(threadUsage, liveThreadUsage)
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

  const canEditComposer = !disabled && !hydratingActiveThread && (route === 'claw' ? clawHasInboundConversation : true)
  const canCompose = !disabled && !hydratingActiveThread && runtimeReady && (
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
  const showIntentToolbar = !compact && route === 'chat', showComposerMenuButton = showIntentToolbar
  const showCodeExecutionControls = codeExecutionControlsAvailable(taskSurface)
  const showPlanMenuOption = showCodeExecutionControls && Boolean(onPlanCommand), canTogglePlanMode = canCompose && showPlanMenuOption
  const showAutoPlanBuildMenuOption = showPlanMenuOption && autoPlanBuildEnabled
  const canToggleAutoPlanBuildMode = canCompose && showAutoPlanBuildMenuOption
  const showGraphMenuOption = showCodeExecutionControls && graphEnabled && Boolean(onOrchestrationChange)
  const canToggleGraphMode = canCompose && !busy && showGraphMenuOption
  const graphPlanningNeedsCorrection = Boolean(
    showCodeExecutionControls && graphEnabled &&
    busy &&
    currentTurnOrchestration === 'graph' &&
    graphPlanningCorrectionDraft
  )
  const runningGraphTurn = showCodeExecutionControls && graphEnabled && busy &&
    currentTurnOrchestration === 'graph' && !graphPlanningNeedsCorrection
  const canCreateNewThread = runtimeReady && route !== 'claw' && Boolean(effectiveWorkspaceRoot) && Boolean(onNewCommand)
  const showGoalMenuOption = showCodeExecutionControls && route !== 'claw', canOpenGoalPanel = canCompose && showGoalMenuOption
  const canRunReview = canCompose && route !== 'claw' && Boolean(onReviewCommand)
  const canToggleWorktreeMode = canCompose && route !== 'claw' && Boolean(onToggleWorktreeMode)
  const canOpenComposerMenu = showComposerMenuButton
    && (canPickFileReference || canPickDesignReference || canPickLocalFileReference || canTogglePlanMode || canToggleAutoPlanBuildMode || showGraphMenuOption || canCreateNewThread || canOpenGoalPanel || canRunReview || (canCompose && Boolean(codeAgentPresets && onComposerPersonaChange)))
  const showToolbarStartControls = showComposerMenuButton
  const showExecutionSettingsPicker = showIntentToolbar
    && Boolean(executionSettings)
    && Boolean(onExecutionSettingsChange)
  const stretchModelPicker =
    compact && modelPickerMode === 'combobox' && !showToolbarStartControls && !hideModelPicker
  // Resolution reads i18n, so memoize per catalog identity rather than per render.
  const resolvedCodeAgentPresets = useMemo(
    () => (codeAgentPresets ?? []).map((preset) => resolveCodeAgentPreset(preset)),
    [codeAgentPresets]
  )
  const draft = useComposerDraft({ input, canCompose: canEditComposer })
  const { focusComposer } = draft
  useEffect(() => {
    const onFocusRequest = (): void => focusComposer()
    window.addEventListener(COMPOSER_FOCUS_REQUEST_EVENT, onFocusRequest)
    return () => window.removeEventListener(COMPOSER_FOCUS_REQUEST_EVENT, onFocusRequest)
  }, [focusComposer])
  const inputHistory = useComposerInputHistory()
  const slashQuery = getSlashQuery(input)
  const [composerMenuOpen, setComposerMenuOpen] = useState(false)
  const [goalPanelOpen, setGoalPanelOpen] = useState(false)
  const [goalInputMode, setGoalInputMode] = useState(false)
  const [promptOptimizationBusy, setPromptOptimizationBusy] = useState(false)
  const [promptOptimizationError, setPromptOptimizationError] = useState<string | null>(null)
  const onDismissPromptOptimizationError = useCallback((): void => {
    setPromptOptimizationError(null)
  }, [])
  useEffect(() => {
    setGoalInputMode(false)
    setGoalPanelOpen(false)
  }, [activeThreadId, route])
  useEffect(() => {
    if (mode === 'plan' || mode === 'auto') setGoalInputMode(false)
  }, [mode])
  const fileMentions = useComposerFileMentions({
    enabled: fileReferenceEnabled,
    canCompose,
    input,
    setInput,
    workspaceRoot: effectiveWorkspaceRoot, activeThreadId,
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
    hasPlanCommand: showPlanMenuOption,
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
  const composerShellRef = useRef<HTMLDivElement | null>(null)
  const composerMenuButtonRef = useRef<HTMLButtonElement | null>(null)
  const composerMenuPanelRef = useRef<HTMLDivElement | null>(null)
  const goalPanelRef = useRef<HTMLDivElement | null>(null)
  const placeholder = disabled && disabledReason
    ? disabledReason
    : !runtimeReady
    ? t('runtimeActionNeedsConnection')
    : pendingUserInputBlock
      ? t('userInputComposerPlaceholder')
    : !hasActiveThread && !effectiveWorkspaceRoot
      ? t('workspaceRequiredToCreateThread')
      : (goalInputMode || goalPanelOpen) && route !== 'claw'
        ? t('goalComposerPlaceholder')
      : busy
        ? currentTurnOrchestration === 'graph'
          ? t('composerGraphQueuePlaceholder')
          : t('composerQueuePlaceholder')
        : route === 'claw'
            ? clawHasInboundConversation
              ? t('clawPlaceholder', { name: clawAgentName })
              : t('clawPlaceholderNeedsInbound')
            : mode === 'auto'
              ? t('composerAutoPlanBuildPlaceholder')
            : mode === 'plan'
              ? t('composerPlanPlaceholder')
              : emptyTaskLayout
                ? t('unifiedTaskComposerPlaceholder')
              : hasActiveThread
                ? t('placeholder')
                : t('composerStartsThread')
  const footerHint = disabled && disabledReason
    ? disabledReason
    : !runtimeReady
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
    && activeThreadTodos != null
    && activeThreadTodos.threadId === activeThreadId
    && activeThreadTodos.items.length > 0
    && activeThreadTodos.items.some((item) => item.status !== 'completed')
    && slashQuery == null
    && !composerMenuOpen
    && !goalPanelOpen
    && !pendingUserInputBlock
  const showGraphProgress = showCodeExecutionControls && graphEnabled
    && !compact
    && route === 'chat'
    && Boolean(activeThreadId)
    && runtimeReady
    && slashQuery == null
    && !composerMenuOpen
    && !goalPanelOpen
    && !pendingUserInputBlock

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
  const primaryActionKind = resolveComposerPrimaryActionKind({
    busy,
    input,
    attachmentUploadEnabled,
    attachmentCount: attachments.length,
    fileReferenceEnabled,
    fileReferenceCount: fileReferences.length
  })
  const canOptimizePrompt =
    promptOptimizationSettings?.enabled === true &&
    canEditComposer &&
    !promptOptimizationBusy &&
    input.trim().length > 0 &&
    typeof window !== 'undefined' &&
    typeof window.kunGui?.optimizePrompt === 'function'
  const goalElapsedLabel = useGoalElapsedLabel({ busy, goal: activeThreadGoal })
  const goalBannerLabel = activeThreadGoal
    ? activeThreadGoal.status === 'active'
      ? t('goalActiveHeading')
      : t(`goalStatusShort.${activeThreadGoal.status}`)
    : ''
  const goalMenuChecked = goalInputMode
  const showGoalFloater = showGoalMenuOption && shouldShowGoalFloater({
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

  const actionContext: FloatingComposerRenderContext = {
    activeThreadId, archiveThread, buildResearchPrompt, canAcceptComposerFileDrop,
    canAddFileReference, canEditComposer, canOpenComposerMenu, canOpenGoalPanel,
    canOptimizePrompt, canPickAttachment, canPickDesignReference, canPickFileReference,
    canPickLocalFileReference, canSetGoalPanelDraft, canToggleAutoPlanBuildMode, canToggleGraphMode, canTogglePlanMode,
    clearActiveThreadGoal, compact, compactActiveThread, composerRootRef, composerSendKey,
    dictationPrimaryActionRef, draft, effectiveWorkspaceRoot, fileInputRef, fileMentions,
    forkActiveThread, goalInputMode, goalPanelDraftObjective, handleComposerImagePaste,
    hideBtwCommand, highlightedSlashCommand, input, inputHistory, isComposerSendHotkey,
    mode, onAddFileReference, onBtwCommand, onNewCommand, onOpenDesignReferencePicker,
    onOpenFileReferencePicker, onOrchestrationChange, onPasteClipboardImage,
    onPickAttachments, onPickFileReferences, onPlanCommand, onReviewCommand, onSend,
    orchestration, parseBtwCommand, parseCompactCommand, parseGoalCommand, parseNewCommand,
    parseResearchCommand, parseReviewCommand, parsedGoalCommand, primaryActionDisabled,
    route, routeComposerFileDrop, runtimeReady, setActiveThreadGoal, setActiveThreadGoalStatus,
    setComposerMenuOpen, setGoalInputMode, setGoalPanelOpen, setInput, setMode,
    setPromptOptimizationBusy, setPromptOptimizationError, slashCommandMenu, slashCommands,
    t, userInput
  }
  const composerActions = useFloatingComposerActions(actionContext)

  const renderContext: FloatingComposerRenderContext = {
    ...actionContext,
    ...composerActions,
    BackgroundShellOverlay, BarChart3, Bot, FileText, FloatingComposerAboveInputStack, FloatingComposerAgentPicker, FloatingComposerAttachments, FloatingComposerContextCapacity, FloatingComposerExecutionPicker,
    FloatingComposerFileMentionMenu, FloatingComposerGraphProgress, FloatingComposerModelPicker, FloatingComposerQueuedMessages, FloatingComposerSlashCommandMenu, FloatingComposerTaskProfile, FloatingComposerTaskSurfacePicker, FloatingComposerTodoProgress, FloatingComposerUsageHistory, FloatingComposerUserInputPanel,
    FloatingComposerActionMenu,
    Folder, GitBranchPicker, ImagePlus, ListTodo, Loader2, Mic, Monitor, Paperclip,
    PauseCircle, Pencil, PlayCircle, Plus, Puzzle, Send, Share2, Sparkles,
    Square, Target, Trash2, TypeIcon, VoiceRecordingStrip, WorkspaceProjectPicker, X, activeThreadGoal,
    activeThreadId, activeThreadTodos, attachmentUploadBusy, attachmentUploadEnabled, attachmentUploadError, attachments, busy, canChangeModel,
    canCompose, canEditComposer, canOpenComposerMenu, canOpenGoalPanel, canOptimizePrompt, canPickAttachment, canPickDesignReference, canPickFileReference,
    canPickLocalFileReference, canSetGoalPanelDraft, canToggleAutoPlanBuildMode, canToggleGraphMode, canTogglePlanMode, canToggleWorktreeMode, clearActiveThreadGoal, compact, composerFastMode,
    composerMenuButtonRef, composerMenuOpen, composerMenuPanelRef, composerShellRef, composerModel, composerModelGroups, composerPickList, composerProviderId, composerReasoningEffort,
    contextChips, primaryCacheHitRate, currentTurnOrchestration, designTaskProfile, designProfileLocked, dictation, draft, effectiveWorkspaceRoot, executionSettings, executionSettingsApplying,
    fileInputRef, fileMentions, fileReferenceEnabled, fileReferences, filteredSlashCommands, footerHint, formatCompactNumber, formatCost,
    formatPercent, formatTps, formatTtftSeconds, goalBannerLabel, goalElapsedLabel, goalInputMode, goalMenuChecked, goalPanelOpen,
    goalPanelRef, graphEnabled, graphPlanningNeedsCorrection, hideModelPicker, highlightedSlashCommand, i18n, input, isComposerDirectoryReference,
    imageGenerationEnabled, imageGenerationAvailable, imageGenerationReason, mode, modelControlVariant, modelPickerMode, onComposerFastModeChange, onComposerModelChange, onComposerReasoningEffortChange, onConfigureImageGeneration, onConfigureProviders, onDesignTaskProfileChange, onExecutionSettingsChange,
    onComposerPersonaChange, codeAgentPresets, composerPersonaId, resolvedCodeAgentPresets,
    onRestoreQueuedMessageToComposer,
    onReorderQueuedMessage: onReorderQueuedMessage ?? storeReorderQueuedMessage,
    onGuideQueuedMessage, onInterrupt, onOpenGraph, onOpenGraphChild, onPickAttachments, onRemoveAttachment, onRemoveContextChip, onRemoveFileReference,
    onRemoveQueuedMessage, onToggleWorktreeMode, onWorktreeBranchChange, openSettings, orchestration, pendingUserInputBlock, placeholder, primaryActionDisabled,
    primaryActionLabel, primaryActionLoading, promptOptimizationBusy, promptOptimizationError, onDismissPromptOptimizationError, promptOptimizationSettings, queuedMessages,
    route, runningGraphTurn, runtimeReady, setActiveThreadGoalStatus, setGoalInputMode, setGoalPanelOpen, setInput, showComposerMenuButton,
    showAutoPlanBuildMenuOption, showCodeExecutionControls, showExecutionSettingsPicker, showGoalFloater, showGoalMenuOption, showGraphMenuOption, showGraphProgress, showPlanMenuOption, showProviderInModelLabel, showTodoProgress, showToolbarStartControls, showUsageHistoryFooter,
    showVoiceDictation, showWorkspaceControls, side, slashCommandMenu, slashQuery, stretchModelPicker, t, displayThreadUsage, primaryActionKind,
    taskSurface, taskSurfaceLocked, emptyTaskLayout, onTaskSurfaceChange, onNewRequirement, threadUsageState, timingThreadUsage, useWorktreePool, userInput, worktreeBranch
  }

  return (
    <div
      ref={composerRootRef}
      data-floating-composer
      className={compact
        ? 'ds-floating-composer ds-no-drag pointer-events-auto w-full pb-0 pt-0'
        : 'ds-floating-composer ds-no-drag ds-chat-column-inset ds-chat-content-max-width pointer-events-auto w-full pb-3 pt-0'}
    >
      <div className="relative" data-composer-stack>
        <FloatingComposerStackView context={renderContext} />
        <FloatingComposerSurfaceView context={renderContext} />
      </div>
    </div>
  )
}
