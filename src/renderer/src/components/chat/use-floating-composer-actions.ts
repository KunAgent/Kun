import {
  useEffect,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'
import type { SlashCommand, SlashCommandId } from './floating-composer-commands'
import type { ComposerFileDropOptions } from './composer-file-drop'
import type { FloatingComposerRenderContext } from './floating-composer-view-context'

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
  } = context
  const applySlashCommand = (commandId: SlashCommandId): void => {
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
    if (!goalInputMode || objective.length === 0 || objective.startsWith('/')) return false
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
          inputHistory.push(input)
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
    // Trailing fallback for a pending ask: text that began with "/" but matched
    // no real command (e.g. a free-form answer like "/usr/local/bin") still
    // answers the current question instead of leaking into chat via onSend.
    if (userInput.active && input.trim() && userInput.submitTypedText(input)) {
      inputHistory.push(input)
      setInput('')
      draft.focusComposer()
      return
    }
    inputHistory.push(input)
    onSend()
  }
  dictationPrimaryActionRef.current = primaryActionDisabled ? null : handlePrimaryAction

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    const sendByHotkey = isComposerSendHotkey(event, composerSendKey)
    const composing = draft.isComposingEvent(event)

    if (fileMentions.handleKeyDown(event, composing)) return

    if (slashCommandMenu.handleKeyDown(event, composing)) return

    if (inputHistory.handleKeyDown(event, { input, setInput, composing })) return

    if (shouldOpenAttachmentPickerOnKeyDown(event, { composing, canPickAttachment })) {
      event.preventDefault()
      fileInputRef.current?.click()
      return
    }

    // Esc cancels a pending ask-user request. (Option picking is click-only:
    // a bare-digit accelerator would hijack the first character of a
    // digit-leading custom answer, which the type-to-answer design must allow.)
    if (!composing && userInput.active && event.key === 'Escape') {
      event.preventDefault()
      userInput.cancel()
      return
    }

    if (!sendByHotkey || composing) return

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
      onPasteClipboardImage
    })
  }

  const composerFileDropOptions: ComposerFileDropOptions = {
    canPickAttachment,
    canPickLocalFileReference,
    canAddFileReference,
    workspaceRoot: effectiveWorkspaceRoot,
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
    handlePromptOptimizationClick,
    setGoalFromComposerInput
  }
}
