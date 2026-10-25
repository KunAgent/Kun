import {
  useEffect,
  useRef,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'
import type { SlashCommand, SlashCommandId } from './floating-composer-commands'
import {
  DOUBLE_ENTER_STEER_WINDOW_MS,
  steerableQueuedMessage
} from './floating-composer-policy'
import type { QueuedComposerMessage } from './FloatingComposerQueuedMessages'
import { extraRootsForWorkspace } from '../../lib/code-workspace-folder-lookup'
import { useChatStore } from '../../store/chat-store'
import type { ComposerFileDropOptions } from './composer-file-drop'
import type { FloatingComposerRenderContext } from './floating-composer-view-context'

/** An open popup (picker, menu) whose trigger lives inside the composer. */
export const OPEN_POPUP_TRIGGER_SELECTOR = '[aria-haspopup]:not([aria-haspopup="false"])[aria-expanded="true"]'

/**
 * True when a keydown should open the attachment picker: `Ctrl+U` on
 * Windows/Linux or `Cmd+U` on macOS. IME composition, Alt/Shift modifiers, or
 * an unavailable attachment capability suppress the shortcut so it cannot
 * collide with input-method text or other accelerators.
 */
export function shouldOpenAttachmentPickerOnKeyDown(
  event: {
    key: string
    ctrlKey: boolean
    metaKey: boolean
    altKey: boolean
    shiftKey: boolean
  },
  options: { composing: boolean; canPickAttachment: boolean }
): boolean {
  if (options.composing) return false
  if (!options.canPickAttachment) return false
  if (event.key !== 'u' && event.key !== 'U') return false
  if (event.altKey || event.shiftKey) return false
  return event.ctrlKey || event.metaKey
}

export function useFloatingComposerActions(
  context: FloatingComposerRenderContext
): FloatingComposerRenderContext {
  const {
    activeThreadId, archiveThread, attachments, buildResearchPrompt, busy,
    canAcceptComposerFileDrop,
    canAddFileReference, canEditComposer, canOpenComposerMenu, canOpenGoalPanel,
    canPickAttachment, canPickDesignReference, canPickFileReference,
    canPickLocalFileReference, canSetGoalPanelDraft, canToggleAutoPlanBuildMode, canToggleGraphMode, canTogglePlanMode,
    clearActiveThreadGoal, compact, compactActiveThread, composerInterrupt, composerMenuOpen,
    composerRootRef, composerSendKey, dictationPrimaryActionRef, draft, goalPanelOpen, onInterrupt,
    primaryActionKind, effectiveWorkspaceRoot, fileInputRef, fileMentions,
    forkActiveThread, goalInputMode, goalPanelDraftObjective, handleComposerImagePaste,
    fileReferences, hideBtwCommand, highlightedSlashCommand, input, inputHistory,
    isComposerSendHotkey,
    mode, onAddFileReference, onBtwCommand, onGuideQueuedMessage, onNewCommand, onOpenDesignReferencePicker,
    onOpenFileReferencePicker, onOrchestrationChange, onPasteClipboardImage, onPasteLongText,
    onPickAttachments, onPickFileReferences, onPlanCommand, onReviewCommand, onSend,
    queuedMessages,
    orchestration, parseBtwCommand, parseCompactCommand, parseGoalCommand, parseNewCommand,
    parseResearchCommand, parseReviewCommand, parsedGoalCommand, primaryActionDisabled,
    route, routeComposerFileDrop, runtimeReady, setActiveThreadGoal, setActiveThreadGoalStatus,
    setComposerMenuOpen, setGoalInputMode, setGoalPanelOpen, setInput, setMode,
    promptEnhance, slashCommandMenu, slashCommands,
    t
  } = context
  const folderSets = useChatStore((state) => state.codeWorkspaceFolderSets)
  const extraWorkspaceRoots = extraRootsForWorkspace(effectiveWorkspaceRoot, folderSets)

  // Double-Enter steering window. Arming it on queue growth (rather than on
  // the Enter that queued) also covers messages queued by the toolbar button
  // or another surface, matching how the gesture feels: "I just queued this —
  // Enter again to steer it now."
  const steerWindowExpiresAtRef = useRef(0)
  const previousQueueLengthRef = useRef(queuedMessages.length)
  useEffect(() => {
    const previousLength = previousQueueLengthRef.current
    previousQueueLengthRef.current = queuedMessages.length
    if (queuedMessages.length <= previousLength) return
    if (!busy || !onGuideQueuedMessage) return
    steerWindowExpiresAtRef.current = Date.now() + DOUBLE_ENTER_STEER_WINDOW_MS
  }, [busy, onGuideQueuedMessage, queuedMessages.length])
  const applySlashCommand = (commandId: SlashCommandId): void => {
    if (commandId.startsWith('harness:')) {
      // Harness-native commands go out verbatim — the owning harness parses
      // them, so the builtin parsers must never touch the text.
      const command = slashCommands.find((item: SlashCommand) => item.id === commandId)
      const nativeText = command?.nativeText?.trim()
      if (nativeText) {
        inputHistory.push(nativeText)
        setInput('')
        void useChatStore.getState().sendMessage(nativeText)
      }
      draft.focusComposer()
      return
    }
    if (commandId.startsWith('skill:')) {
      const command = slashCommands.find((item: SlashCommand) => item.id === commandId)
      if (command?.skillPrompt) {
        setInput(command.skillPrompt)
        draft.focusComposer()
      }
      return
    }
    if (commandId === 'plan') {
      setInput('')
      setGoalInputMode(false)
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
      onOrchestrationChange?.('direct')
      setMode('agent')
      setGoalInputMode(true)
      draft.focusComposer()
      return
    }
    if (commandId === 'research') {
      setGoalInputMode(false)
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
      onOrchestrationChange?.('direct')
      setMode('agent')
      setGoalInputMode(true)
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

  const setGoalFromGoalInputMode = (): boolean => {
    const objective = input.trim()
    if (!canOpenGoalPanel || !goalInputMode || objective.length === 0 || objective.startsWith('/')) return false
    inputHistory.push(input)
    setInput('')
    setGoalInputMode(false)
    void setActiveThreadGoal(objective)
    draft.focusComposer()
    return true
  }

  const handleComposerMenuButtonClick = (): void => {
    if (!canOpenComposerMenu) return
    setGoalPanelOpen(false)
    setComposerMenuOpen((open: boolean) => !open)
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
      setGoalInputMode(false)
      onOrchestrationChange?.('direct')
      setMode('plan')
      onPlanCommand?.()
    }
    draft.focusComposer()
  }

  const handleAutoPlanBuildToolbarClick = (): void => {
    if (!canToggleAutoPlanBuildMode) return
    setComposerMenuOpen(false)
    if (mode === 'auto') {
      setMode('agent')
    } else {
      setGoalInputMode(false)
      onOrchestrationChange?.('direct')
      setMode('auto')
    }
    draft.focusComposer()
  }

  const handleGraphToolbarClick = (): void => {
    if (!canToggleGraphMode || !onOrchestrationChange) return
    setComposerMenuOpen(false)
    if (mode === 'agent' && orchestration === 'graph') {
      onOrchestrationChange('direct')
    } else {
      setGoalInputMode(false)
      setMode('agent')
      onOrchestrationChange('graph')
    }
    draft.focusComposer()
  }

  const handleGoalMenuClick = (): void => {
    if (!canOpenGoalPanel) return
    setComposerMenuOpen(false)
    if (goalInputMode) {
      setGoalInputMode(false)
    } else {
      onOrchestrationChange?.('direct')
      setMode('agent')
      setGoalInputMode(true)
    }
    draft.focusComposer()
  }

  const handlePrimaryAction = (): void => {
    // The draft is being rewritten; sending now would race the replacement.
    if (promptEnhance?.running) return
    // An approval / ask-user card holds the input slot; the hidden editor (and
    // voice "send") must not submit underneath it. Answers go through the card.
    if (composerInterrupt) return
    if (highlightedSlashCommand) {
      if (highlightedSlashCommand.disabled) return
      applySlashCommand(highlightedSlashCommand.id)
      return
    }
    if (setGoalFromGoalInputMode()) {
      return
    }
    if (setGoalFromComposerInput()) {
      return
    }
    if (runGoalCommand(parsedGoalCommand)) {
      return
    }
    if (onNewCommand && parseNewCommand(input)) {
      const command = slashCommands.find((item: SlashCommand) => item.id === 'new')
      if (command?.disabled) return
      setInput('')
      onNewCommand()
      draft.focusComposer()
      return
    }
    const compactCommand = parseCompactCommand(input)
    if (compactCommand) {
      const command = slashCommands.find((item: SlashCommand) => item.id === 'compact')
      if (command?.disabled) return
      setInput('')
      void compactActiveThread(compactCommand.reason)
      draft.focusComposer()
      return
    }
    const researchTopic = parseResearchCommand(input)
    if (researchTopic !== false) {
      const command = slashCommands.find((item: SlashCommand) => item.id === 'research')
      if (command?.disabled) return
      setMode('agent')
      setInput(buildResearchPrompt(t('slashCommandResearchPrompt'), researchTopic))
      draft.focusComposer()
      return
    }
    if (onReviewCommand) {
      const reviewCommand = parseReviewCommand(input)
      if (reviewCommand !== false) {
        const command = slashCommands.find((item: SlashCommand) => item.id === 'review')
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
    if (primaryActionDisabled) return
    inputHistory.push(input)
    onSend()
  }
  dictationPrimaryActionRef.current = primaryActionDisabled ? null : handlePrimaryAction

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    const sendByHotkey = isComposerSendHotkey(event, composerSendKey)
    const composing = draft.isComposingEvent(event)

    if (!composing && promptEnhance?.handleKeyDown(event)) return

    if (fileMentions.handleKeyDown(event, composing)) return

    if (slashCommandMenu.handleKeyDown(event, composing)) return

    if (inputHistory.handleKeyDown(event, { input, setInput, composing })) return

    if (shouldOpenAttachmentPickerOnKeyDown(event, { composing, canPickAttachment })) {
      event.preventDefault()
      fileInputRef.current?.click()
      return
    }

    // Esc stops the running turn while the draft is empty (the Stop button's
    // tooltip advertises it). Menus, pickers and an open tray sheet handle Esc
    // first: they either consume it above, mark it handled, or show an open
    // popup trigger. Only popup triggers count: persistent disclosures (an
    // expanded queue list, a document-quote chip) must not disable Esc.
    if (
      !composing && event.key === 'Escape' && !event.defaultPrevented &&
      primaryActionKind === 'interrupt' && !composerMenuOpen && !goalPanelOpen &&
      !composerRootRef.current?.querySelector(OPEN_POPUP_TRIGGER_SELECTOR)
    ) {
      event.preventDefault()
      onInterrupt()
      return
    }

    if (!sendByHotkey || composing) return

    event.preventDefault()
    // Empty-composer Enter is a dead keypress while a turn runs (send rejects
    // empty input; stopping is Esc or the Stop button). Repurpose it for
    // the double-Enter steer gesture while the window from a fresh queue
    // entry is still open.
    if (
      !input.trim() &&
      attachments.length === 0 &&
      fileReferences.length === 0 &&
      onGuideQueuedMessage &&
      Date.now() < steerWindowExpiresAtRef.current
    ) {
      const head = (queuedMessages as QueuedComposerMessage[]).find(
        (message) => steerableQueuedMessage(message, busy)
      )
      if (head) {
        steerWindowExpiresAtRef.current = 0
        void onGuideQueuedMessage(head.id)
        return
      }
    }
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
  }, [activeThreadId, canEditComposer, compact, composerRootRef, route, runtimeReady, draft.textareaRef])

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
      onPasteClipboardImage,
      onPasteLongText
    })
  }

  const composerFileDropOptions: ComposerFileDropOptions = {
    canPickAttachment,
    canPickLocalFileReference,
    canAddFileReference,
    workspaceRoot: effectiveWorkspaceRoot,
    extraWorkspaceRoots,
    onPickAttachments,
    onAddFileReference,
    getPathForFile: (file) => window.kunGui.getPathForFile(file)
  }

  const handleComposerDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!canAcceptComposerFileDrop(event.dataTransfer, composerFileDropOptions)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleComposerDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!routeComposerFileDrop(event.dataTransfer, composerFileDropOptions)) return
    event.preventDefault()
    draft.focusComposer()
  }


  return {
    applySlashCommand,
    handleAttachmentInput,
    handleAttachmentMenuClick,
    handleComposerDragOver,
    handleComposerDrop,
    handleComposerKeyDown,
    handleComposerMenuButtonClick,
    handleComposerPaste,
    handleComposerShellMouseDown,
    handleDesignReferenceMenuClick,
    handleFileReferenceMenuClick,
    handleGoalMenuClick,
    handleGraphToolbarClick,
    handleLocalFileReferenceMenuClick,
    handleAutoPlanBuildToolbarClick,
    handlePlanToolbarClick,
    handlePrimaryAction,
    setGoalFromComposerInput
  }
}
