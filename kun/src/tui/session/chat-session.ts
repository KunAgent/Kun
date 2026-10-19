import { spawn } from 'node:child_process'
import { safeError } from '../chat-format.js'
import { parseTuiCommand, type TuiCommand } from '../commands.js'
import type { TuiKeyAction } from '../keymap.js'
import {
  copyWithSystemClipboard,
  lastAssistantText,
  renderThreadMarkdown,
  runInteractiveProviderCli,
  writeThreadExport
} from '../operations.js'
import { removeLocalShareSnapshot, writeLocalShareSnapshot } from '../local-share.js'
import { sanitizeTerminalText } from '../safe-text.js'
import { sidebarDocks } from '../session-view-model.js'
import { isActiveChildRun } from '../subagent-format.js'
import { runSelfUpdateCommand } from '../../cli/self-update.js'
import {
  installAntigravityCli,
  resolveAntigravityCliCommand,
  resolveGeminiCliCommand,
  type OfficialProviderCliId
} from '../../services/official-provider-cli.js'
import { ChatSessionInput } from './chat-session-input.js'

export class ChatSession extends ChatSessionInput {
  // ---- composer submission ----------------------------------------------

  /** The composer's Enter (textarea submit). */
  async submitComposer(): Promise<void> {
    const raw = this.composer.getText()
    const text = raw.trim()
    if (!text) return
    this.autocompleteAbort?.abort()
    this.autocompleteValue = undefined
    const command = parseTuiCommand(text)
    if (!command) {
      if (!await this.controller.prepareFileMentions(text)) {
        // Mention preparation is atomic; keep the exact draft for repair.
        this.changed()
        return
      }
      if (!this.controller.validatePendingAttachmentsForCurrentModel()) {
        this.changed()
        return
      }
      // Consume the prompt immediately so the local "sending" phase shows
      // before thread creation or the start-turn acknowledgement.
      this.addToHistory(raw)
      this.composer.setText('')
      this.changed()
      await this.controller.submit(text)
      return
    }
    if (
      command.kind === 'skill' && command.prompt &&
      (!await this.controller.prepareFileMentions(command.prompt) || !this.controller.validatePendingAttachmentsForCurrentModel())
    ) {
      this.changed()
      return
    }
    this.addToHistory(raw)
    // /editor deliberately leaves the edited draft in the composer.
    if (command.kind !== 'editor') this.composer.setText('')
    this.changed()
    await this.execute(command)
    this.changed()
  }

  async steerComposer(): Promise<void> {
    if (!this.state.projection?.runningTurnId) {
      this.controller.notify('Ctrl+S steers only while a turn is running; press Enter to send.', 'error')
      return
    }
    const raw = this.composer.getText()
    const text = raw.trim()
    if (!text) {
      this.controller.notify('Type guidance before pressing Ctrl+S.', 'error')
      return
    }
    // A running turn cannot accept attachment IDs; keep the draft intact
    // instead of silently treating @file as ordinary text.
    if (!await this.controller.prepareFileMentions(text)) return
    if (this.state.pendingAttachments.length) {
      this.controller.notify('Attachments cannot be added to queued guidance. They remain attached for the next new turn.', 'error')
      return
    }
    this.addToHistory(raw)
    this.composer.setText('')
    this.changed()
    await this.controller.submit(text)
  }

  async submitStartupGraphPrompt(prompt: string): Promise<boolean> {
    this.composer.setText(prompt)
    const submitted = await this.controller.submitGraphRequirement(prompt)
    if (submitted) this.composer.setText('')
    this.changed()
    return submitted
  }

  protected override async executeSlash(name: string): Promise<void> {
    const command = parseTuiCommand(`/${name}`)
    if (command) await this.execute(command)
    this.changed()
  }

  // ---- display toggles --------------------------------------------------

  toggleToolDetails(): void {
    this.showToolDetailsValue = !this.showToolDetailsValue
    this.controller.notify(this.showToolDetailsValue
      ? `Tool details expanded · ${this.keymap.display('tool_details_toggle')} collapses them.`
      : 'Tool details collapsed.')
    this.changed()
  }

  toggleReasoning(): void {
    this.showReasoningValue = !this.showReasoningValue
    this.liveReasoningOverrides.clear()
    this.controller.notify(this.showReasoningValue ? 'Thinking expanded.' : 'Thinking collapsed.')
    this.refreshEntries()
    this.changed()
  }

  toggleSidebar(): void {
    if (sidebarDocks(this.terminal?.size().width ?? 0)) {
      this.sidebarVisibleValue = !this.sidebarVisibleValue
      this.sidebarOverlayValue = false
    } else {
      this.sidebarOverlayValue = !this.sidebarOverlayValue
    }
    this.changed()
  }

  setPointerModeFromCommand(action?: string): void {
    const normalized = action?.trim().toLowerCase()
    if (normalized && !['on', 'off', 'toggle'].includes(normalized)) {
      this.controller.notify('Usage: /mouse [on|off]', 'error')
      return
    }
    this.setPointerMode(normalized === 'on' ? true : normalized === 'off' ? false : !this.pointerModeValue)
  }

  setPointerMode(enabled: boolean, notify = true): void {
    if (this.pointerModeValue === enabled) return
    this.pointerModeValue = enabled
    this.terminal?.setMouseEnabled(enabled)
    if (notify) {
      this.controller.notify(enabled
        ? 'Mouse on · the wheel scrolls, clicks open rows, and dragging selects and copies text.'
        : `Mouse off · the terminal owns selection; PgUp/PgDn scroll · ${this.keymap.display('pointer_mode_toggle')} turns the mouse back on.`)
    }
    this.changed()
  }

  // ---- key actions ------------------------------------------------------

  protected override executeKeyAction(action: TuiKeyAction): void {
    if (action.startsWith('session_quick_')) {
      void this.controller.openQuickSession(Number(action.slice('session_quick_'.length)))
      return
    }
    switch (action) {
      case 'session_new': void this.controller.createThread(); break
      case 'session_list': this.controller.showThreads(); break
      case 'session_timeline': this.showTimeline(); break
      case 'session_compact': void this.controller.compact(); break
      case 'session_export': void this.exportThread(); break
      case 'session_status': void this.controller.showStatus(); break
      case 'messages_copy': void this.copyLastResponse(); break
      case 'session_undo': void this.controller.undoLastTurn(); break
      case 'session_redo': void this.controller.redoBranch(); break
      case 'session_child_first': void this.controller.navigateSessionRelation('child'); break
      case 'session_parent': void this.controller.navigateSessionRelation('parent'); break
      case 'session_sibling_next': void this.controller.navigateSessionRelation('next-sibling'); break
      case 'session_sibling_previous': void this.controller.navigateSessionRelation('previous-sibling'); break
      case 'model_list': void this.showModels(); break
      case 'agent_list': this.showAgentModes(); break
      case 'thinking_toggle': this.toggleReasoning(); break
      case 'pointer_mode_toggle': this.setPointerModeFromCommand(); break
      case 'tool_details_toggle': this.toggleToolDetails(); break
      case 'messages_page_up': this.viewport?.scroll('page-up'); break
      case 'messages_page_down': this.viewport?.scroll('page-down'); break
      case 'messages_line_up': this.viewport?.scroll('line-up'); break
      case 'messages_line_down': this.viewport?.scroll('line-down'); break
      case 'messages_half_page_up': this.viewport?.scroll('half-page-up'); break
      case 'messages_half_page_down': this.viewport?.scroll('half-page-down'); break
      case 'messages_first': this.viewport?.scroll('first'); break
      case 'messages_last': this.viewport?.scroll('last'); break
      case 'subagent_detach': {
        const child = [...(this.state.projection?.childRuns ?? [])].reverse().find((run) => !run.detached && isActiveChildRun(run))
        if (child) void this.controller.manageSubagents(`background ${child.childId}`)
        else this.controller.notify('No foreground subagent is available to move into the background.', 'error')
        break
      }
      case 'input_editor': void this.openExternalEditor(); break
      case 'input_steer': void this.steerComposer(); break
      case 'input_paste': void this.pasteClipboardImage(); break
      case 'app_exit': this.requestQuit(); break
      case 'command_list': this.showCommandPalette(); break
      case 'variant_cycle': this.controller.cycleReasoningEffort(); break
      case 'sidebar_toggle': this.toggleSidebar(); break
      case 'theme_list': this.controller.setTheme(); break
      case 'session_share':
      case 'share': void this.shareThread(); break
      case 'session_unshare': void this.unshareThread(); break
      case 'plugin_list': void this.controller.manageExtensions(); break
      case 'console_toggle': void this.controller.showRuntimeConsole(); break
      case 'diff_toggle': void this.controller.showWorkspaceDiff(); break
      case 'terminal_toggle': void this.openInteractiveTerminal(); break
      default: this.controller.notify(`Action ${action} is unavailable in this context.`, 'error')
    }
    this.changed()
  }

  // ---- slash commands ---------------------------------------------------

  async execute(command: TuiCommand): Promise<void> {
    const c = this.controller
    switch (command.kind) {
      case 'help': c.showHelp(); break
      case 'threads': c.showThreads(command.search); break
      case 'resume': await c.resumeLatest(command.search); break
      case 'clear': this.terminal?.repaint(); break
      case 'new': await c.createThread(command.title); break
      case 'open': await c.openThread(command.threadId); break
      case 'rename': await c.rename(command.title); break
      case 'archive': await c.archive(); break
      case 'archives': c.showThreads(command.search, 'archived'); break
      case 'fork': await c.fork(command.title); break
      case 'compact': await c.compact(); break
      case 'connect': await this.showConnect(); break
      case 'usage-report': this.showUsage(); break
      case 'quota': this.showQuota(); break
      case 'model': await this.showModels(); break
      case 'variants': this.showVariants(); break
      case 'reasoning': this.toggleReasoning(); break
      case 'mouse': this.setPointerModeFromCommand(command.action); break
      case 'status': await c.showStatus(); break
      case 'copy': await this.copyLastResponse(); break
      case 'export': await this.exportThread(command.path); break
      case 'details': this.toggleToolDetails(); break
      case 'sidebar': this.toggleSidebar(); break
      case 'permission': this.showPermissions(); break
      case 'undo': await c.undoLastTurn(); break
      case 'redo': await c.redoBranch(); break
      case 'init': await c.initializeWorkspace(command.instructions); break
      case 'import': await c.importAgentContext(command.args); break
      case 'mcp': await c.showMcp(command.action); break
      case 'timeline': this.showTimeline(command.query); break
      case 'jump': this.showTimeline(undefined, command.target); break
      case 'subagents': if (!(await c.manageSubagents(command.action))) this.showSubagents(); break
      case 'tasks': await c.manageTodos(command.action); break
      case 'attach': await c.manageAttachments(command.path); break
      case 'paste': await this.pasteClipboardImage(); break
      case 'memory': await c.manageMemory(command.action); break
      case 'shells': await c.manageShells(command.action); break
      case 'extensions': await c.manageExtensions(command.action); break
      case 'theme': c.setTheme(command.name); break
      case 'share': await this.shareThread(); break
      case 'unshare': await this.unshareThread(); break
      case 'console': await c.showRuntimeConsole(); break
      case 'diff': await c.showWorkspaceDiff(); break
      case 'terminal': await this.openInteractiveTerminal(); break
      case 'update': await this.runUpdate(command.confirm); break
      case 'plan': {
        const action = command.action?.trim().toLowerCase()
        if (!action || action === 'plan' || action === 'on') await c.setPlanMode('plan')
        else if (action === 'agent' || action === 'off' || action === 'build') await c.setPlanMode('agent')
        else if (action === 'status' || action === 'tasks') await c.showPlan()
        else c.notify('Usage: /plan [status|tasks|off]', 'error')
        break
      }
      case 'graph':
        if (command.prompt) await c.submitGraphRequirement(command.prompt)
        else await c.manageGraphMode(command.action)
        break
      case 'agent': await c.setPlanMode('agent'); break
      case 'goal':
        if (command.action?.trim()) await c.manageGoal(command.action)
        else this.showGoal()
        break
      case 'skills': await this.showSkills(command.query); break
      case 'skill': await c.invokeSkill(command.name, command.prompt); break
      case 'editor':
        this.composer.setText(command.initial ?? '')
        await this.openExternalEditor()
        break
      case 'add-dir': await c.addDirectory(command.path); break
      case 'btw': await c.askSideQuestion(command.question); break
      case 'context': await c.showContext(); break
      case 'capabilities': c.showCapabilities(); break
      case 'queue': await c.showQueue(command.action); break
      case 'quit': c.requestQuit(); break
      case 'command-usage': c.notify(`Usage: ${command.usage}`, 'error'); break
      case 'unknown': c.notify(`Unknown command: /${command.name}`, 'error'); break
    }
  }

  private async runUpdate(confirm: boolean): Promise<void> {
    let output = ''
    let errorOutput = ''
    const code = await runSelfUpdateCommand(confirm ? ['--yes'] : ['--check'], {
      stdout: { write: (chunk) => { output += chunk } },
      stderr: { write: (chunk) => { errorOutput += chunk } },
      env: process.env
    })
    if (!confirm && code === 10) output += '\nRun /update yes to confirm download and installation.'
    const informational = code === 0 || code === 10
    const message = (informational ? output : errorOutput).trim()
    this.controller.notify(message || `Kun update exited with code ${code}.`, informational ? 'info' : 'error')
    if (code === 0 && (output.includes('installed') || output.includes('staged'))) this.controller.requestQuit()
  }

  // ---- terminal-owning operations ----------------------------------------

  protected async withSuspendedTerminal<T>(work: () => Promise<T>): Promise<T> {
    if (!this.terminal) return work()
    this.suspended = true
    this.changed()
    try {
      return await this.terminal.suspend(work)
    } finally {
      this.suspended = false
      this.terminal.setTitle('Kun')
      this.changed()
    }
  }

  protected override editExternal(initial: string): Promise<string> {
    return this.withSuspendedTerminal(() => this.editTextImpl(initial))
  }

  async openExternalEditor(): Promise<void> {
    try {
      const edited = await this.editExternal(this.composer.getText())
      this.composer.setText(edited.replace(/\s+$/u, ''))
    } catch (error) {
      this.controller.notify(safeError(error), 'error')
    }
    this.changed()
  }

  async openInteractiveTerminal(): Promise<void> {
    const shell = process.platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : process.env.SHELL || '/bin/sh'
    try {
      await this.withSuspendedTerminal(() => new Promise<void>((resolve, reject) => {
        const child = spawn(shell, [], {
          cwd: this.state.projection?.thread.workspace ?? this.controller.options.workspace,
          stdio: 'inherit',
          windowsHide: false
        })
        child.once('error', reject)
        child.once('close', () => resolve())
      }))
    } catch (error) {
      this.controller.notify(safeError(error), 'error')
    }
  }

  protected override async authenticateOfficialProvider(provider: OfficialProviderCliId): Promise<void> {
    if (this.officialProviderAuthenticator) {
      await this.officialProviderAuthenticator(provider)
      return
    }
    let command = provider === 'gemini-cli'
      ? resolveGeminiCliCommand()
      : resolveAntigravityCliCommand(this.controller.options.dataDir)
    if (!command && provider === 'antigravity') {
      this.controller.notify('Installing the official Antigravity CLI…')
      command = await installAntigravityCli({ dataDir: this.controller.options.dataDir })
    }
    if (!command) {
      throw new Error('The official Gemini CLI is unavailable. Install @google/gemini-cli or use a current standalone Kun TUI build.')
    }
    const resolved = command
    await this.withSuspendedTerminal(async () => {
      process.stdout.write([
        '',
        `Kun opened ${resolved.displayName} for provider-owned authentication.`,
        provider === 'gemini-cli'
          ? 'Use /auth to sign in again if needed, then use /quit to return to Kun.'
          : 'Complete Google sign-in, then use /quit to return to Kun.',
        ''
      ].join('\r\n'))
      await runInteractiveProviderCli(resolved, {
        cwd: this.state.projection?.thread.workspace ?? this.controller.options.workspace
      })
    })
  }

  /** Copy text selected with the mouse (OSC 52 plus the host clipboard). */
  async copySelection(text: string): Promise<void> {
    const safeText = sanitizeTerminalText(text)
    if (!safeText.trim()) return
    this.terminal?.copyToClipboard(safeText)
    const method = await copyWithSystemClipboard(safeText)
    const count = Array.from(safeText).length
    this.controller.notify(`Copied ${count} character${count === 1 ? '' : 's'}${method ? ` with ${method}` : ' with OSC52'}.`)
  }

  async copyLastResponse(): Promise<void> {
    const projection = this.state.projection
    if (!projection) { this.controller.notify('Open or create a thread first.', 'error'); return }
    const text = lastAssistantText(projection.thread)
    if (!text) { this.controller.notify('No assistant response is available to copy.', 'error'); return }
    const safeText = sanitizeTerminalText(text)
    // Always send OSC 52 so remote terminals receive the copy, then report
    // the native clipboard method when the host has one.
    this.terminal?.copyToClipboard(safeText)
    const method = await copyWithSystemClipboard(safeText)
    this.controller.notify(`Copied the last assistant response${method ? ` with ${method}` : ' with OSC52'}.`)
  }

  async exportThread(path?: string): Promise<void> {
    const projection = this.state.projection
    if (!projection) { this.controller.notify('Open or create a thread first.', 'error'); return }
    try {
      const written = await writeThreadExport(projection.thread, path)
      this.controller.notify(`Exported Markdown: ${written}`)
    } catch (error) {
      this.controller.notify((error as NodeJS.ErrnoException).code === 'EEXIST'
        ? 'Export target already exists; choose a new path so Kun does not overwrite it.'
        : safeError(error), 'error')
    }
  }

  async shareThread(): Promise<void> {
    const projection = this.state.projection
    if (!projection) { this.controller.notify('Open or create a session first.', 'error'); return }
    try {
      const path = await writeLocalShareSnapshot(this.controller.options.dataDir, projection.thread.id, renderThreadMarkdown(projection.thread))
      this.controller.notify(`Local share snapshot updated: ${path}`)
    } catch (error) {
      this.controller.notify(safeError(error), 'error')
    }
  }

  async unshareThread(): Promise<void> {
    const projection = this.state.projection
    if (!projection) { this.controller.notify('Open or create a session first.', 'error'); return }
    try {
      await removeLocalShareSnapshot(this.controller.options.dataDir, projection.thread.id)
      this.controller.notify('Local share snapshot removed.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.controller.notify('No local share snapshot exists.')
      else this.controller.notify(safeError(error), 'error')
    }
  }
}
