import {
  Editor,
  Input,
  Markdown,
  ProcessTerminal,
  TUI,
  decodeKittyPrintable,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type EditorTheme,
  type Focusable,
  type MarkdownTheme,
  type OverlayHandle,
  type SelectListTheme,
  type SlashCommand
} from '@earendil-works/pi-tui'
import {
  providerCatalogEntries,
  type ProviderCatalogAuthFlow,
  type ProviderCatalogAuthType,
  type ProviderCatalogKind
} from '@kun/provider-catalog'
import { spawn } from 'node:child_process'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, sep } from 'node:path'
import { stdin as processStdin, stdout as processStdout } from 'node:process'
import { redactSecrets, redactSecretText } from '../config/secret-redaction.js'
import { withRuntimeDataDirAncillaryWriter } from '../server/runtime-data-dir-lease.js'
import type { AttachmentMetadata } from '../contracts/attachments.js'
import type { TurnItem } from '../contracts/items.js'
import type { ModelReasoningEffort } from '../contracts/capabilities.js'
import {
  KUN_TOOL_PERMISSION_MODES,
  kunToolPermissionModeFromSettings,
  kunToolPermissionModeSettings,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type KunToolPermissionMode,
  type SandboxMode
} from '../contracts/policy.js'
import {
  isModelConnectionProfileUsable,
  type ClaudeSdkInstallStatus,
  type ModelConnectionOAuthStatus,
  type ModelConnectionProfile,
  type ModelConnectionSnapshot
} from '../contracts/model-connections.js'
import type { TuiCommand, TuiCommandDefinition } from './commands.js'
import { parseTuiCommand, TUI_COMMAND_DEFINITIONS, TUI_SLASH_COMMANDS } from './commands.js'
import { runSelfUpdateCommand } from '../cli/self-update.js'
import {
  activityFrame,
  formatContextGauge,
  formatTokenCount,
  type ActivityVisualKind
} from './activity.js'
import { parseTuiKeymapConfig, type TuiKeyAction, type TuiKeymap } from './keymap.js'
import { TuiClientError, type KunTuiClient, type SkillsSnapshot } from './client.js'
import type { TuiControllerState } from './controller.js'
import { TuiController } from './controller.js'
import {
  sanitizeTerminalText as stripTerminalControls,
  wrapText
} from './layout.js'
import { codeFenceLanguage, highlightTerminalCode, terminalAssistantMarkdown } from './markdown-code.js'
import {
  contextualFooter,
  pageFrame,
  sectionLabel,
  selectionRow,
  statusGlyph,
  visual,
  visualDensity
} from './visual-system.js'
import { InlineStreamTerminal, ScrollbackPreservingTerminal } from './pi-terminal.js'
import { ProviderQuotaDialog } from './provider-quota.js'
import { UsageDialog } from './usage-report.js'
import {
  installAntigravityCli,
  resolveAntigravityCliCommand,
  resolveGeminiCliCommand,
  type OfficialProviderCliId
} from '../services/official-provider-cli.js'
import {
  copyWithSystemClipboard,
  editTextInExternalEditor,
  lastAssistantText,
  osc52ClipboardSequence,
  renderThreadMarkdown,
  runInteractiveProviderCli,
  writeThreadExport
} from './operations.js'
import {
  applyRuntimeEvent,
  hydrateProjectedChildRuns,
  matchingRequestContextSnapshot,
  projectThreadSnapshot,
  type ProjectedApprovalReview,
  type ProjectedChildRun,
  type ProjectedTurnActivity,
  type ThreadProjection
} from './state.js'
import type { TerminalInput, TerminalOutput } from './pi-terminal.js'
import {
  latestTuiGraphRun,
  moveTuiGraphBoardSelection,
  projectTuiGraphBoard,
  type TuiGraphBoardNode,
  type TuiGraphBoardProjection,
  summarizeTuiGraphRun
} from './graph-mode.js'
import {
  answerCurrentUserInputWithText,
  confirmCurrentUserInput,
  createUserInputSession,
  currentUserInputQuestion,
  isUserInputSessionComplete,
  moveUserInputOption,
  orderedUserInputAnswers,
  selectedUserInputLabels,
  toggleCurrentUserInputOption,
  type UserInputSession
} from './user-input.js'
import {
  ClipboardImageError,
  clipboardImageEmptyHint,
  readClipboardImage,
  type ClipboardImage
} from './clipboard-image.js'
import { WorkspaceFileAutocompleteProvider } from './file-mentions.js'
import { bold, dim, blue, cyan, green, yellow, red, magenta, italic, isCancelInput, EXIT_CONFIRM_WINDOW_MS, UNDO_ESCAPE_WINDOW_MS, TOTAL_ELAPSED_MIN_START_GAP_MS, BRACKETED_PASTE_START, BRACKETED_PASTE_END, ENABLE_MOUSE_TRACKING, DISABLE_MOUSE_TRACKING, DIRECT_SEMANTIC_ACTIONS, sanitizeTerminalText, selectTheme, editorTheme, markdownTheme, parseSgrMouseEvent, writeLocalShareSnapshot, removeLocalShareSnapshot, type SgrMouseEvent, type ExclusiveRouteHandle } from './pi-common.js'
import { TranscriptComponent } from './transcript.js'
import { printableInput } from './render-utils.js'
import { renderActivityRow, renderConversationContext, renderGraphProgressRow, renderKunComposerFrame, renderKunWelcome, renderShortcutFooter, safeError } from './render-layout.js'

export class ChatRoot implements Component, Focusable {
  private state: TuiControllerState
  private readonly transcript = new TranscriptComponent()
  private readonly editor: Editor
  // Keep the transcript readable by default: reasoning fragments continue to
  // accumulate, but only their compact disclosure row is shown until the user
  // expands all Thinking bodies with /thinking.
  private showReasoning = false
  private showToolDetails = false
  private pointerMode = false
  private transientHint?: string
  private leaderHint?: Array<{ action: TuiKeyAction; key: string }>
  private primaryRoutes: Array<{ kind: string; component: Component & Focusable }> = []
  private _focused = false
  private animationFrame = 0
  private transcriptStartRow?: number
  private graphProgressContentRow?: number
  private lastRenderedLineCount = 0
  private pasteBuffer?: string
  private pasteProcessing = false
  private deferredPasteInput = ''

  constructor(
    private readonly tui: TUI,
    private readonly controller: TuiController,
    private readonly keymap: TuiKeymap,
    private readonly actions: {
      onConnect: () => void
      onModel: () => void
      onUsage: () => void
      onQuota: () => void
      onVariants: () => void
      onGoal: () => void
      onPermission: () => void
      onTimeline: (query?: string, target?: string) => void
      onSubagents: () => void
      onSkills: (query?: string) => void
      onEditor: (initial: string) => Promise<string>
      onCopy: () => void
      onExport: (path?: string) => void
      onPointerMode: (action?: string) => void
      onTheme: (name?: string) => void
      onShare: () => void
      onUnshare: () => void
      onConsole: () => void
      onDiff: () => void
      onTerminal: () => void
      onSessions: () => void
      onExtensions: () => void
      onPasteImage: () => Promise<void>
      onClear: () => void
    }
  ) {
    this.state = controller.state
    this.editor = new Editor(tui, editorTheme, { paddingX: 1, autocompleteMaxVisible: 8 })
    this.setAutocomplete([], controller.options.workspace)
    this.editor.onSubmit = (text) => void this.submit(text)
  }

  get focused(): boolean { return this._focused }
  set focused(value: boolean) {
    this._focused = value
    this.editor.focused = value
  }

  update(state: TuiControllerState): void {
    this.state = state
    this.transcript.update(
      state.projection,
      this.showReasoning,
      this.showToolDetails,
      this.controller.runtime.legacyGui === true,
      state.attachmentMetadata
    )
  }

  tickAnimation(): void {
    this.animationFrame = (this.animationFrame + 1) % 80
  }

  editorEmpty(): boolean { return this.editor.getText().length === 0 }

  composerEmpty(): boolean {
    return this.editorEmpty() && this.state.pendingAttachments.length === 0
  }

  clearEditor(): void { this.editor.setText(''); this.tui.requestRender() }

  clearComposer(): void {
    this.editor.setText('')
    this.controller.clearPendingAttachments()
    this.tui.requestRender()
  }

  insertNewline(): void { this.editor.handleInput('\x0a'); this.tui.requestRender() }

  setEditorText(text: string): void { this.editor.setText(text); this.tui.requestRender() }

  setPointerMode(enabled: boolean): void {
    this.pointerMode = enabled
    this.tui.requestRender()
  }

  setTransientHint(hint: string | undefined): void {
    this.transientHint = hint
  }

  toggleToolDetails(): void {
    this.showToolDetails = !this.showToolDetails
    this.transcript.update(
      this.state.projection,
      this.showReasoning,
      this.showToolDetails,
      this.controller.runtime.legacyGui === true,
      this.state.attachmentMetadata
    )
    this.controller.notify(`Tool details ${this.showToolDetails ? 'expanded' : 'collapsed'}.`)
    this.tui.requestRender()
  }

  async openExternalEditor(): Promise<void> {
    const initial = this.editor.getText()
    try {
      const edited = await this.actions.onEditor(initial)
      this.editor.setText(edited.replace(/\s+$/u, ''))
    } catch (error) {
      this.controller.notify(safeError(error), 'error')
    }
    this.tui.requestRender()
  }

  async steerEditor(): Promise<void> {
    if (!this.state.projection?.runningTurnId) {
      this.controller.notify('Ctrl+S steers only while a turn is running; press Enter to send.', 'error')
      return
    }
    const raw = this.editor.getText()
    const text = raw.trim()
    if (!text) {
      this.controller.notify('Type guidance before pressing Ctrl+S.', 'error')
      return
    }
    if (!await this.controller.prepareFileMentions(text)) {
      // A running turn cannot accept attachment IDs. Keep the guidance draft
      // intact instead of silently treating @file as ordinary text.
      this.tui.requestRender()
      return
    }
    if (this.state.pendingAttachments.length) {
      this.controller.notify(
        'Attachments cannot be added to queued guidance. They remain attached for the next new turn.',
        'error'
      )
      return
    }
    this.editor.addToHistory(raw)
    this.editor.setText('')
    this.tui.requestRender()
    await this.controller.submit(text)
  }

  mayHaveAutocomplete(): boolean {
    const text = this.editor.getText()
    return /(?:^|\s)(?:\/[^\s]*|@[^\s]*|\.{1,2}\/[^\s]*|~\/[^\s]*)$/u.test(text)
  }

  setLeaderHint(hint: Array<{ action: TuiKeyAction; key: string }> | undefined): void {
    this.leaderHint = hint
  }

  hasPrimaryRoute(): boolean { return this.primaryRoutes.length > 0 }

  activePrimaryRoute(): Component & Focusable | undefined {
    return this.primaryRoutes.at(-1)?.component
  }

  childAtTerminalRow(terminalRow: number): ProjectedChildRun | undefined {
    const renderedRow = this.transcriptRenderedRowAtTerminalRow(terminalRow)
    return renderedRow === undefined ? undefined : this.transcript.childAtRenderedRow(renderedRow)
  }

  graphProgressAtTerminalRow(terminalRow: number): boolean {
    if (this.graphProgressContentRow === undefined || terminalRow < 1) return false
    const viewportStart = Math.max(0, this.lastRenderedLineCount - this.tui.terminal.rows)
    const contentRow = viewportStart + terminalRow - 1
    return contentRow === this.graphProgressContentRow
  }

  toggleThinkingAtTerminalRow(terminalRow: number): boolean {
    const renderedRow = this.transcriptRenderedRowAtTerminalRow(terminalRow)
    if (renderedRow === undefined || !this.transcript.toggleReasoningAtRenderedRow(renderedRow)) return false
    this.tui.requestRender()
    return true
  }

  private transcriptRenderedRowAtTerminalRow(terminalRow: number): number | undefined {
    if (this.transcriptStartRow === undefined || terminalRow < 1) return undefined
    const viewportStart = Math.max(0, this.lastRenderedLineCount - this.tui.terminal.rows)
    const contentRow = viewportStart + terminalRow - 1
    return contentRow - this.transcriptStartRow
  }

  showPrimaryRoute(kind: string, component: Component & Focusable): void {
    this.primaryRoutes = this.primaryRoutes.filter((route) => route.component !== component)
    this.primaryRoutes.push({ kind, component })
    this.editor.focused = false
  }

  hidePrimaryRoute(component: Component & Focusable): void {
    this.primaryRoutes = this.primaryRoutes.filter((route) => route.component !== component)
  }

  async executeSlash(name: string): Promise<void> {
    const command = parseTuiCommand(`/${name}`)
    if (command) await this.execute(command)
    this.tui.requestRender()
  }

  setAutocomplete(skills: SkillsSnapshot['skills'], workspace: string): void {
    const skillCommands: SlashCommand[] = skills.map((skill) => ({
      name: `skill:${skill.id}`,
      description: skill.description || `Invoke ${skill.name}`,
      argumentHint: '[prompt]'
    }))
    this.editor.setAutocompleteProvider(new WorkspaceFileAutocompleteProvider(
      [...TUI_SLASH_COMMANDS, ...skillCommands],
      workspace
    ))
  }

  render(width: number): string[] {
    const safeWidth = Math.max(20, width)
    const projection = this.state.projection
    const primaryRoute = this.primaryRoutes.at(-1)
    this.transcriptStartRow = undefined
    this.graphProgressContentRow = undefined
    const lines: string[] = []
    if (primaryRoute) {
      lines.push(...primaryRoute.component.render(safeWidth))
      // Keep an exclusive route at least one terminal tall. The blank tail is
      // intentional: it erases the previous welcome/transcript/composer frame
      // in normal-screen inline rendering without switching screen buffers.
      const tail = Math.max(0, this.tui.terminal.rows - lines.length)
      lines.push(...Array.from({ length: tail }, () => ''))
      this.lastRenderedLineCount = lines.length
      return lines.map((line) => truncateToWidth(line, safeWidth))
    }
    if (projection) {
      lines.push(renderConversationContext(this.state, this.controller, safeWidth), dim('─'.repeat(safeWidth)), '')
      this.transcriptStartRow = lines.length
      lines.push(...this.transcript.render(safeWidth, this.animationFrame))
    } else {
      lines.push(...renderKunWelcome(this.state, this.controller, safeWidth, this.tui.terminal.rows))
    }

    const composerLines = renderKunComposerFrame(
      this.editor.render(Math.max(8, safeWidth - 5)),
      this.state,
      this.controller,
      safeWidth,
      this.keymap
    )
    const activity = renderActivityRow(this.state, this.controller, safeWidth, this.animationFrame, this.transientHint)
    const graphProgress = renderGraphProgressRow(this.state, safeWidth)
    const bottom = [
      ...(activity ? [activity] : []),
      ...(graphProgress ? [graphProgress] : []),
      ...composerLines,
      renderShortcutFooter(this.state, this.keymap, safeWidth, this.leaderHint, this.pointerMode)
    ]
    // Keep the activity/composer cluster at the bottom of a roomy terminal.
    // Once the transcript grows, the spacer naturally disappears and the
    // normal terminal scrollback takes over.
    const spacer = Math.max(1, this.tui.terminal.rows - lines.length - bottom.length)
    if (graphProgress) {
      this.graphProgressContentRow = lines.length + spacer + (activity ? 1 : 0)
    }
    lines.push(...Array.from({ length: spacer }, () => ''), ...bottom)
    this.lastRenderedLineCount = lines.length
    return lines.map((line) => truncateToWidth(line, safeWidth))
  }

  handleInput(data: string): void {
    if (this.pasteProcessing) {
      this.deferredPasteInput += data
      return
    }
    if (this.pasteBuffer !== undefined) {
      this.consumePasteChunk(data)
      return
    }
    const startIndex = data.indexOf(BRACKETED_PASTE_START)
    if (startIndex < 0) {
      this.editor.handleInput(data)
      return
    }
    const prefix = data.slice(0, startIndex)
    if (prefix) this.editor.handleInput(prefix)
    this.pasteBuffer = ''
    this.consumePasteChunk(data.slice(startIndex + BRACKETED_PASTE_START.length))
  }

  invalidate(): void {
    this.editor.invalidate()
    this.transcript.invalidate()
  }

  private async submit(raw: string): Promise<void> {
    const text = raw.trim()
    if (!text) return
    const command = parseTuiCommand(text)
    if (!command) {
      if (!await this.controller.prepareFileMentions(text)) {
        // pi-tui clears before onSubmit. File mention preparation is atomic,
        // and the exact draft is restored so the user can repair any path.
        this.editor.setText(raw)
        this.tui.requestRender()
        return
      }
      if (!this.controller.validatePendingAttachmentsForCurrentModel()) {
        // pi-tui clears the editor before invoking onSubmit. Restore the exact
        // expanded prompt so a capability rejection never discards the
        // user's message while the queued attachment waits for /model.
        this.editor.setText(raw)
        this.tui.requestRender()
        return
      }
      // Match Kimi's perceived-latency behavior: consume the prompt and let
      // the controller publish its local "preparing/sending" phase before
      // waiting for thread creation or the start-turn HTTP acknowledgement.
      this.editor.addToHistory(raw)
      this.editor.setText('')
      this.tui.requestRender()
      await this.controller.submit(text)
      return
    }
    if (
      command.kind === 'skill' &&
      command.prompt &&
      (
        !await this.controller.prepareFileMentions(command.prompt) ||
        !this.controller.validatePendingAttachmentsForCurrentModel()
      )
    ) {
      this.editor.setText(raw)
      this.tui.requestRender()
      return
    }
    await this.execute(command)
    this.editor.addToHistory(raw)
    // /editor deliberately leaves the edited draft in the composer. Every
    // other command consumes its input as usual.
    if (command.kind !== 'editor') this.editor.setText('')
    this.tui.requestRender()
  }

  private consumePasteChunk(data: string): void {
    if (this.pasteBuffer === undefined) return
    this.pasteBuffer += data
    const endIndex = this.pasteBuffer.indexOf(BRACKETED_PASTE_END)
    if (endIndex < 0) return
    const pastedText = this.pasteBuffer.slice(0, endIndex)
    const trailing = this.pasteBuffer.slice(endIndex + BRACKETED_PASTE_END.length)
    this.pasteBuffer = undefined
    this.pasteProcessing = true
    void this.processCompletedPaste(pastedText).finally(() => {
      this.pasteProcessing = false
      const deferred = trailing + this.deferredPasteInput
      this.deferredPasteInput = ''
      if (deferred) this.handleInput(deferred)
    })
  }

  private async processCompletedPaste(pastedText: string): Promise<void> {
    // Some terminal hosts wrap an image-only platform paste in bracketed-paste
    // markers but have no text payload to place between them. Treat that exact
    // empty gesture as the semantic clipboard-image action. Whitespace remains
    // ordinary composer text.
    if (pastedText.length === 0) {
      await this.actions.onPasteImage()
      this.tui.requestRender()
      return
    }
    const attached = await this.controller.attachPastedPaths(pastedText)
    if (!attached) {
      // Let pi-tui preserve its normal multiline-paste marker behavior when
      // the clipboard content is prose, a missing path, or an unsupported
      // file. Replaying the bracket markers keeps undo/history semantics.
      this.editor.handleInput(`${BRACKETED_PASTE_START}${pastedText}${BRACKETED_PASTE_END}`)
    }
    this.tui.requestRender()
  }

  async execute(command: TuiCommand): Promise<void> {
    switch (command.kind) {
      case 'help': this.controller.showHelp(); break
      case 'threads': this.controller.showThreads(command.search); break
      case 'resume': await this.controller.resumeLatest(command.search); break
      case 'clear': this.actions.onClear(); break
      case 'new': await this.controller.createThread(command.title); break
      case 'open': await this.controller.openThread(command.threadId); break
      case 'rename': await this.controller.rename(command.title); break
      case 'archive': await this.controller.archive(); break
      case 'archives': this.controller.showThreads(command.search, 'archived'); break
      case 'fork': await this.controller.fork(command.title); break
      case 'compact': await this.controller.compact(); break
      case 'connect': this.actions.onConnect(); break
      case 'usage-report': this.actions.onUsage(); break
      case 'quota': this.actions.onQuota(); break
      case 'model': this.actions.onModel(); break
      case 'variants': this.actions.onVariants(); break
      case 'reasoning':
        this.showReasoning = !this.showReasoning
        this.transcript.clearReasoningOverrides()
        this.transcript.update(
          this.state.projection,
          this.showReasoning,
          this.showToolDetails,
          this.controller.runtime.legacyGui === true,
          this.state.attachmentMetadata
        )
        this.controller.notify(this.showReasoning
          ? 'Thinking is expanded.'
          : 'Thinking is collapsed.')
        break
      case 'mouse': this.actions.onPointerMode(command.action); break
      case 'status': await this.controller.showStatus(); break
      case 'copy': this.actions.onCopy(); break
      case 'export': this.actions.onExport(command.path); break
      case 'details':
        this.toggleToolDetails()
        break
      case 'permission': this.actions.onPermission(); break
      case 'undo': await this.controller.undoLastTurn(); break
      case 'redo': await this.controller.redoBranch(); break
      case 'init': await this.controller.initializeWorkspace(command.instructions); break
      case 'import': await this.controller.importAgentContext(command.args); break
      case 'mcp': await this.controller.showMcp(command.action); break
      case 'timeline': this.actions.onTimeline(command.query); break
      case 'jump': this.actions.onTimeline(undefined, command.target); break
      case 'subagents':
        if (!(await this.controller.manageSubagents(command.action))) this.actions.onSubagents()
        break
      case 'tasks': await this.controller.manageTodos(command.action); break
      case 'attach': await this.controller.manageAttachments(command.path); break
      case 'paste': await this.actions.onPasteImage(); break
      case 'memory': await this.controller.manageMemory(command.action); break
      case 'shells': await this.controller.manageShells(command.action); break
      case 'extensions': await this.controller.manageExtensions(command.action); break
      case 'theme': this.actions.onTheme(command.name); break
      case 'share': this.actions.onShare(); break
      case 'unshare': this.actions.onUnshare(); break
      case 'console': this.actions.onConsole(); break
      case 'diff': this.actions.onDiff(); break
      case 'terminal': this.actions.onTerminal(); break
      case 'update': {
        let output = ''
        let errorOutput = ''
        const code = await runSelfUpdateCommand(command.confirm ? ['--yes'] : ['--check'], {
          stdout: { write: (chunk) => { output += chunk } },
          stderr: { write: (chunk) => { errorOutput += chunk } },
          env: process.env
        })
        if (!command.confirm && code === 10) {
          output += '\nRun /update yes to confirm download and installation.'
        }
        const isInformational = code === 0 || code === 10
        const message = (isInformational ? output : errorOutput).trim()
        this.controller.notify(
          message || `Kun update exited with code ${code}.`,
          isInformational ? 'info' : 'error'
        )
        if (code === 0 && (output.includes('installed') || output.includes('staged'))) {
          this.controller.requestQuit()
        }
        break
      }
      case 'plan': {
        const action = command.action?.trim().toLowerCase()
        if (!action || action === 'plan' || action === 'on') await this.controller.setPlanMode('plan')
        else if (action === 'agent' || action === 'off' || action === 'build') await this.controller.setPlanMode('agent')
        else if (action === 'status' || action === 'tasks') await this.controller.showPlan()
        else this.controller.notify('Usage: /plan [status|tasks|off]', 'error')
        break
      }
      case 'graph':
        if (command.prompt) await this.controller.submitGraphRequirement(command.prompt)
        else await this.controller.manageGraphMode(command.action)
        break
      case 'agent': await this.controller.setPlanMode('agent'); break
      case 'goal':
        if (command.action?.trim()) await this.controller.manageGoal(command.action)
        else this.actions.onGoal()
        break
      case 'skills': this.actions.onSkills(command.query); break
      case 'skill': await this.controller.invokeSkill(command.name, command.prompt); break
      case 'editor': {
        const initial = command.initial ?? ''
        this.editor.setText(initial)
        await this.openExternalEditor()
        break
      }
      case 'add-dir': await this.controller.addDirectory(command.path); break
      case 'btw': await this.controller.askSideQuestion(command.question); break
      case 'context': await this.controller.showContext(); break
      case 'capabilities': this.controller.showCapabilities(); break
      case 'queue': await this.controller.showQueue(command.action); break
      case 'quit': this.controller.requestQuit(); break
      case 'command-usage': this.controller.notify(`Usage: ${command.usage}`, 'error'); break
      case 'unknown': this.controller.notify(`Unknown command: /${command.name}`, 'error'); break
    }
  }
}
