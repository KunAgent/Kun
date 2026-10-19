import { safeError } from '../chat-format.js'
import { ClipboardImageError, clipboardImageEmptyHint } from '../clipboard-image.js'
import { TUI_SLASH_COMMANDS } from '../commands.js'
import { WorkspaceFileAutocompleteProvider } from '../file-mentions.js'
import { isCancelKey, isKey, keyEventType, type TuiKeyEvent } from '../keys.js'
import type { TuiKeyAction } from '../keymap.js'
import { parsePastedFilePaths } from '../pasted-paths.js'
import { isActiveChildRun } from '../subagent-format.js'
import type { SkillsSnapshot } from '../client.js'
import { ChatSessionPages } from './chat-session-pages.js'
import type { LiveClickTarget } from './session-types.js'

export const EXIT_CONFIRM_WINDOW_MS = 1_500
export const UNDO_ESCAPE_WINDOW_MS = 600
const MAX_HISTORY = 200

export const DIRECT_SEMANTIC_ACTIONS: readonly TuiKeyAction[] = [
  'session_new', 'session_list', 'session_timeline', 'session_compact', 'session_export',
  'session_status', 'session_undo', 'session_redo', 'session_child_first', 'session_parent',
  'session_sibling_next', 'session_sibling_previous', 'messages_copy', 'model_list',
  'agent_list', 'thinking_toggle', 'pointer_mode_toggle', 'tool_details_toggle', 'input_editor', 'input_steer',
  'input_paste', 'sidebar_toggle', 'theme_list', 'session_share', 'session_unshare', 'share',
  'plugin_list', 'console_toggle', 'diff_toggle', 'terminal_toggle',
  'session_quick_1', 'session_quick_2', 'session_quick_3', 'session_quick_4', 'session_quick_5',
  'session_quick_6', 'session_quick_7', 'session_quick_8', 'session_quick_9',
  'messages_page_up', 'messages_page_down', 'messages_line_up', 'messages_line_down',
  'messages_half_page_up', 'messages_half_page_down',
  'messages_first', 'messages_last'
]

const SLASH_CONTEXT = /^\/[^\s]*$/u
const MENTION_CONTEXT = /(?:^|\s)@(?:"[^"]*|[^\s]*)$/u
const PATH_CONTEXT = /(?:^|\s)(?:\/[^\s]*|@[^\s]*|\.{1,2}\/[^\s]*|~\/[^\s]*)$/u

export abstract class ChatSessionInput extends ChatSessionPages {
  protected leaderPending = false
  protected history: string[] = []
  protected historyIndex = -1
  protected historyDraft = ''
  protected autocompleteProvider = new WorkspaceFileAutocompleteProvider(TUI_SLASH_COMMANDS, this.controller.options.workspace)
  protected autocompleteAbort?: AbortController
  protected autocompleteWorkspace?: string
  protected autocompleteRequest?: Promise<void>

  protected abstract executeKeyAction(action: TuiKeyAction): void
  protected abstract submitComposer(): Promise<void>

  /**
   * Route one key press. Returns true when the session consumed it; the app
   * then prevents the focused composer from also receiving the key.
   */
  handleKey(key: TuiKeyEvent): boolean {
    if (this.stopped || this.suspended) return true
    const type = keyEventType(key)
    if (type === 'release') return false
    const page = this.page
    if (page) {
      this.clearPendingGestures()
      page.handleKey(key)
      return true
    }
    this.cancelPendingGesturesForDifferentInput(key)
    if (this.sidebarOverlayValue && isCancelKey(key)) {
      this.sidebarOverlayValue = false
      this.changed()
      return true
    }
    if (this.leaderPending) {
      this.cancelLeader()
      this.changed()
      if (isCancelKey(key)) return true
      const match = this.keymap.leaderMatch(key)
      if (match) this.executeKeyAction(match.action)
      else this.controller.notify('Unknown Leader sequence.', 'error')
      return !(match && (match.binding.preventDefault === false || match.binding.fallthrough))
    }
    if (this.keymap.matchesLeader(key)) {
      this.beginLeader()
      return this.consumes('leader', key)
    }
    if (this.autocompleteValue && this.handleAutocompleteKey(key)) return true
    if (this.keymap.matches('command_list', key)) {
      this.showCommandPalette()
      return this.consumes('command_list', key)
    }
    if (this.keymap.matches('variant_cycle', key)) {
      this.controller.cycleReasoningEffort()
      return this.consumes('variant_cycle', key)
    }
    if (this.keymap.matches('subagent_detach', key)) {
      const child = [...(this.state.projection?.childRuns ?? [])].reverse().find((run) => !run.detached && isActiveChildRun(run))
      // Contextual: backgrounds a live foreground agent, otherwise Ctrl+B
      // stays the editor's cursor-left key.
      if (!child) return false
      void this.controller.manageSubagents(`background ${child.childId}`)
      return this.consumes('subagent_detach', key)
    }
    if (this.keymap.matches('input_newline', key)) {
      this.composer.insertNewline()
      return this.consumes('input_newline', key)
    }
    const editorEmpty = this.composer.getText().length === 0
    const composerEmpty = editorEmpty && this.state.pendingAttachments.length === 0
    if (editorEmpty && this.state.pendingAttachments.length > 0 && isKey(key, 'backspace', 'ctrl+backspace', 'delete')) {
      this.clearPendingGestures()
      this.controller.removeLastPendingAttachment()
      return true
    }
    if (this.keymap.matches('input_clear', key) && !composerEmpty) {
      this.clearPendingGestures()
      this.clearComposer()
      return this.consumes('input_clear', key)
    }
    if (this.keymap.matches('app_exit', key)) {
      if (!composerEmpty) return false
      const exitKey = isKey(key, 'ctrl+c') ? 'ctrl+c' : isKey(key, 'ctrl+d') ? 'ctrl+d' : undefined
      if (exitKey === 'ctrl+c' && this.state.projection?.runningTurnId) {
        this.clearPendingGestures()
        void this.controller.interrupt()
      } else if (!exitKey || this.pendingExit?.key === exitKey) {
        this.clearPendingGestures()
        this.requestQuit()
      } else {
        this.armPendingExit(exitKey)
      }
      return this.consumes('app_exit', key)
    }
    if (this.keymap.matches('session_interrupt', key)) {
      if (this.state.projection?.runningTurnId) {
        this.clearPendingGestures()
        void this.controller.interrupt()
        return this.consumes('session_interrupt', key)
      }
      if (isKey(key, 'escape') && composerEmpty && this.state.projection) {
        if (this.pendingUndoTimer) {
          this.clearPendingUndo()
          void this.controller.undoLastTurn()
        } else this.armPendingUndo()
        return this.consumes('session_interrupt', key)
      }
      return false
    }
    if (composerEmpty && this.state.projection) {
      if (isKey(key, 'left')) { void this.controller.navigateSessionRelation('previous-sibling'); return true }
      if (isKey(key, 'right')) { void this.controller.navigateSessionRelation('next-sibling'); return true }
    }
    if (this.keymap.matches('session_rename', key) && composerEmpty) {
      this.setComposerText('/rename ')
      return this.consumes('session_rename', key)
    }
    if (this.keymap.matches('agent_cycle', key) || this.keymap.matches('agent_cycle_reverse', key)) {
      if (PATH_CONTEXT.test(this.textBeforeCursor())) {
        this.requestAutocomplete(true)
        return true
      }
      const mode = this.state.projection?.thread.mode ?? this.state.composerMode
      void this.controller.setPlanMode(mode === 'agent' ? 'plan' : 'agent')
      return this.consumes(this.keymap.matches('agent_cycle', key) ? 'agent_cycle' : 'agent_cycle_reverse', key)
    }
    if (this.keymap.matches('model_cycle_recent', key)) {
      void this.controller.cycleRecentModel(1)
      return this.consumes('model_cycle_recent', key)
    }
    if (this.keymap.matches('model_cycle_recent_reverse', key)) {
      void this.controller.cycleRecentModel(-1)
      return this.consumes('model_cycle_recent_reverse', key)
    }
    if (this.keymap.matches('app_suspend', key)) {
      this.suspendProcess()
      return this.consumes('app_suspend', key)
    }
    const direct = DIRECT_SEMANTIC_ACTIONS.find((action) => this.keymap.matches(action, key))
    if (direct) {
      this.executeKeyAction(direct)
      return this.consumes(direct, key)
    }
    if (isKey(key, 'ctrl+l')) {
      this.terminal?.repaint()
      return true
    }
    if (isKey(key, 'up') && this.browseHistory(1)) return true
    if (isKey(key, 'down') && this.browseHistory(-1)) return true
    return false
  }

  /** A click outside a dialog closes it the way Esc does. */
  dismissPage(): void {
    const page = this.page
    if (!page || this.stopped || this.suspended) return
    page.handleKey({ name: 'escape', ctrl: false, meta: false, shift: false, sequence: '\x1b' })
    this.changed()
  }

  protected consumes(action: TuiKeyAction, key: TuiKeyEvent): boolean {
    const binding = this.keymap.match(action, key)
    return binding?.preventDefault !== false && !binding?.fallthrough
  }

  protected suspendProcess(): void {
    if (process.platform === 'win32') {
      this.controller.notify('Process suspend is only available on Unix terminals.', 'error')
      return
    }
    this.terminal?.suspendProcess()
  }

  protected textBeforeCursor(): string {
    const cursor = this.composer.cursor()
    const lines = this.composer.getText().split('\n')
    return (lines[cursor.line] ?? '').slice(0, cursor.col)
  }

  // ---- gestures ----------------------------------------------------------

  protected cancelPendingGesturesForDifferentInput(key: TuiKeyEvent): void {
    if (this.pendingExit && !isKey(key, this.pendingExit.key)) this.clearPendingExit()
    if (this.pendingUndoTimer && !isKey(key, 'escape')) this.clearPendingUndo()
  }

  protected armPendingExit(key: 'ctrl+c' | 'ctrl+d'): void {
    this.clearPendingExit()
    this.transientHintValue = `Press ${key === 'ctrl+c' ? 'Ctrl+C' : 'Ctrl+D'} again to exit`
    this.pendingExit = { key, timer: setTimeout(() => this.clearPendingExit(), EXIT_CONFIRM_WINDOW_MS) }
    this.changed()
  }

  protected clearPendingExit(): void {
    if (!this.pendingExit) return
    clearTimeout(this.pendingExit.timer)
    this.pendingExit = undefined
    this.transientHintValue = undefined
    this.changed()
  }

  protected armPendingUndo(): void {
    this.clearPendingUndo()
    this.transientHintValue = 'Press Esc again to undo the last turn'
    this.pendingUndoTimer = setTimeout(() => this.clearPendingUndo(), UNDO_ESCAPE_WINDOW_MS)
    this.changed()
  }

  protected clearPendingUndo(): void {
    if (!this.pendingUndoTimer) return
    clearTimeout(this.pendingUndoTimer)
    this.pendingUndoTimer = undefined
    this.transientHintValue = undefined
    this.changed()
  }

  protected override clearPendingGestures(): void {
    this.clearPendingExit()
    this.clearPendingUndo()
  }

  protected beginLeader(): void {
    this.cancelLeader()
    this.leaderPending = true
    this.leaderHintValue = this.keymap.leaderActions()
    this.leaderTimer = setTimeout(() => {
      this.cancelLeader()
      this.controller.notify('Leader timed out.')
      this.changed()
    }, this.keymap.leaderTimeoutMs)
    this.changed()
  }

  protected override cancelLeader(): void {
    if (this.leaderTimer) clearTimeout(this.leaderTimer)
    this.leaderTimer = undefined
    this.leaderPending = false
    this.leaderHintValue = undefined
  }

  // ---- composer ----------------------------------------------------------

  protected clearComposer(): void {
    this.composer.setText('')
    this.controller.clearPendingAttachments()
    this.autocompleteValue = undefined
    this.historyIndex = -1
    this.changed()
  }

  protected override setComposerText(text: string): void {
    this.composer.setText(text)
    this.historyIndex = -1
    this.onComposerChanged()
  }

  protected addToHistory(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    if (this.history.at(-1) !== text) this.history.push(text)
    if (this.history.length > MAX_HISTORY) this.history.splice(0, this.history.length - MAX_HISTORY)
    this.historyIndex = -1
  }

  /** Up/Down browse submitted prompts only from the first/last line. */
  protected browseHistory(direction: 1 | -1): boolean {
    const cursor = this.composer.cursor()
    const lineCount = this.composer.getText().split('\n').length
    if (direction === 1) {
      if (cursor.line !== 0 || !this.history.length) return false
      if (this.historyIndex >= this.history.length - 1) return true
      if (this.historyIndex === -1) this.historyDraft = this.composer.getText()
      this.historyIndex += 1
    } else {
      if (this.historyIndex < 0 || cursor.line !== lineCount - 1) return false
      this.historyIndex -= 1
    }
    const text = this.historyIndex >= 0 ? this.history[this.history.length - 1 - this.historyIndex]! : this.historyDraft
    this.composer.setText(text)
    this.autocompleteValue = undefined
    this.changed()
    return true
  }

  /** Called by the app whenever the composer text or cursor changes. */
  onComposerChanged(): void {
    const before = this.textBeforeCursor()
    const firstLine = this.composer.cursor().line === 0
    if ((firstLine && SLASH_CONTEXT.test(before)) || MENTION_CONTEXT.test(before)) this.requestAutocomplete(false)
    else if (this.autocompleteValue) {
      this.autocompleteAbort?.abort()
      this.autocompleteValue = undefined
      this.changed()
    }
  }

  protected requestAutocomplete(force: boolean): void {
    this.autocompleteAbort?.abort()
    const abort = new AbortController()
    this.autocompleteAbort = abort
    const lines = this.composer.getText().split('\n')
    const cursor = this.composer.cursor()
    void this.autocompleteProvider.getSuggestions(lines, cursor.line, cursor.col, { signal: abort.signal, force })
      .then((suggestions) => {
        if (abort.signal.aborted || this.autocompleteAbort !== abort) return
        const previous = this.autocompleteValue
        this.autocompleteValue = suggestions?.items.length
          ? {
              items: suggestions.items.slice(0, 50),
              prefix: suggestions.prefix,
              selected: previous?.prefix && suggestions.prefix.startsWith(previous.prefix)
                ? Math.min(previous.selected, suggestions.items.length - 1)
                : 0
            }
          : undefined
        this.changed()
      })
      .catch(() => undefined)
  }

  protected handleAutocompleteKey(key: TuiKeyEvent): boolean {
    const view = this.autocompleteValue
    if (!view) return false
    if (isKey(key, 'escape')) {
      this.autocompleteAbort?.abort()
      this.autocompleteValue = undefined
      this.changed()
      return true
    }
    if (isKey(key, 'up', 'ctrl+p')) {
      this.autocompleteValue = { ...view, selected: (view.selected - 1 + view.items.length) % view.items.length }
      this.changed()
      return true
    }
    if (isKey(key, 'down', 'ctrl+n')) {
      this.autocompleteValue = { ...view, selected: (view.selected + 1) % view.items.length }
      this.changed()
      return true
    }
    if (isKey(key, 'tab', 'enter')) {
      const slash = view.prefix.startsWith('/')
      this.applyAutocomplete()
      // Enter on a slash command completes it and submits, like the
      // previous editor; other completions only insert text.
      if (isKey(key, 'enter') && slash) void this.submitComposer()
      return true
    }
    return false
  }

  /** Apply the selected (or given) autocomplete item to the composer. */
  applyAutocomplete(index = this.autocompleteValue?.selected ?? 0): void {
    const view = this.autocompleteValue
    const item = view?.items[index]
    if (!view || !item) return
    const text = this.composer.getText()
    const lines = text.split('\n')
    const cursor = this.composer.cursor()
    const result = this.autocompleteProvider.applyCompletion(lines, cursor.line, cursor.col, item, view.prefix)
    const offset = result.lines.slice(0, result.cursorLine).reduce((sum, line) => sum + line.length + 1, 0) + result.cursorCol
    this.autocompleteAbort?.abort()
    this.autocompleteValue = undefined
    this.composer.setText(result.lines.join('\n'), offset)
    this.changed()
    if (item.label.endsWith('/')) this.onComposerChanged()
  }

  protected override async refreshSkillAutocomplete(workspace: string): Promise<void> {
    if (this.autocompleteWorkspace === workspace) return
    if (this.autocompleteRequest) return this.autocompleteRequest
    const request = this.controller.client.skills(workspace).then((snapshot: SkillsSnapshot) => {
      if (this.stopped) return
      this.autocompleteWorkspace = workspace
      this.autocompleteProvider = new WorkspaceFileAutocompleteProvider([
        ...TUI_SLASH_COMMANDS,
        ...snapshot.skills.map((skill) => ({
          name: `skill:${skill.id}`,
          description: skill.description || `Invoke ${skill.name}`,
          argumentHint: '[prompt]'
        }))
      ], workspace)
    }).catch(() => undefined).finally(() => {
      if (this.autocompleteRequest !== request) return
      this.autocompleteRequest = undefined
      const desired = this.state.projection?.thread.workspace ?? this.controller.options.workspace
      if (desired !== this.autocompleteWorkspace) void this.refreshSkillAutocomplete(desired)
    })
    this.autocompleteRequest = request
    return request
  }

  protected override async reloadSkillAutocomplete(): Promise<void> {
    this.autocompleteWorkspace = undefined
    await this.refreshSkillAutocomplete(this.state.projection?.thread.workspace ?? this.controller.options.workspace)
  }

  // ---- paste and pointer -------------------------------------------------

  /**
   * Bracketed paste. An empty paste is the terminal's image-only clipboard
   * gesture; pasted file paths become attachments; anything else is text.
   */
  handlePaste(text: string): boolean {
    if (this.stopped || this.suspended) return true
    const page = this.page
    if (page) {
      page.handlePaste?.(text)
      return true
    }
    if (text.length === 0) {
      void this.pasteClipboardImage()
      return true
    }
    const workspace = this.state.projection?.thread.workspace ?? this.controller.options.workspace
    if (parsePastedFilePaths(text, workspace).length === 0) {
      this.composer.insertText(text)
      this.onComposerChanged()
      return true
    }
    void this.controller.attachPastedPaths(text).then((attached) => {
      if (!attached) {
        this.composer.insertText(text)
        this.onComposerChanged()
      }
      this.changed()
    }).catch((error) => {
      this.controller.notify(safeError(error), 'error')
      this.composer.insertText(text)
    })
    return true
  }

  async pasteClipboardImage(): Promise<void> {
    if (this.clipboardPastePending) {
      this.controller.notify('Kun is already reading the clipboard.')
      return
    }
    this.clipboardPastePending = true
    this.controller.notify('Reading image from the system clipboard…')
    try {
      const image = await this.clipboardImageReader()
      if (!image) {
        this.controller.notify(clipboardImageEmptyHint(), 'error')
        return
      }
      await this.controller.attachClipboardImage(image)
    } catch (error) {
      this.controller.notify(error instanceof ClipboardImageError ? error.message : safeError(error), 'error')
    } finally {
      this.clipboardPastePending = false
      this.changed()
    }
  }

  /** Clicks on transcript rows: Thinking toggles, subagents, the Graph row. */
  handleLiveClick(target: LiveClickTarget): void {
    if (target.kind === 'graph') {
      void this.controller.showGraphStatus()
      return
    }
    if (target.kind === 'thinking') {
      this.toggleLiveReasoning(target.itemId)
      return
    }
    const child = this.state.projection?.childRuns.find((run) => run.childId === target.childId)
    if (child) this.showSubagentPopup(child)
  }

  protected toggleLiveReasoning(itemId: string): void {
    this.liveReasoningOverrides.set(itemId, !(this.liveReasoningOverrides.get(itemId) ?? this.showReasoningValue))
    this.refreshEntries()
    this.changed()
  }

  reasoningExpanded(itemId: string): boolean {
    return this.liveReasoningOverrides.get(itemId) ?? this.showReasoningValue
  }
}
