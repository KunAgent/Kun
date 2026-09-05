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
import { ChildRunComponent, childActivityVisualKind, childMetrics, childStatusColor, childStatusLabel, isActiveChildRun, isForegroundChildRun, sortChildRuns } from './subagent-components.js'
import { elapsedDuration, formatDurationMs, popupFrame } from './render-utils.js'
import { joinSides, safeError } from './render-layout.js'
import { visibleWindow } from './model-dialog.js'

export class SubagentDialog implements Component, Focusable {
  private readonly input = new Input()
  private readonly transcript = new TranscriptComponent()
  private parentProjection: ThreadProjection
  private childProjection?: ThreadProjection
  private selectedChild?: ProjectedChildRun
  private index = 0
  private _focused = false
  private loading = false
  private error = ''
  private connection: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' = 'idle'
  private showReasoning = false
  private detailAbort?: AbortController
  private openGeneration = 0
  private detailOffset = 0
  private detailPageSize = 1
  private detailMaxOffset = 0
  private followDetailTail = true
  private detailPanelHeight = 0
  private transcriptPanelStartRow?: number

  constructor(
    private readonly tui: TUI,
    private readonly controller: TuiController,
    projection: ThreadProjection,
    private readonly close: () => void,
    private readonly detailOnly = false
  ) {
    this.parentProjection = projection
  }

  get focused(): boolean { return this._focused }
  set focused(value: boolean) { this._focused = value; this.input.focused = value && !this.selectedChild }

  updateParentProjection(projection: ThreadProjection | undefined): void {
    if (!projection || projection.thread.id !== this.parentProjection.thread.id) return
    this.parentProjection = projection
    if (this.selectedChild) {
      this.selectedChild = projection.childRuns.find((run) => run.childId === this.selectedChild?.childId) ??
        this.selectedChild
    }
    this.tui.requestRender()
  }

  dispose(): void {
    this.openGeneration += 1
    this.detailAbort?.abort()
    this.detailAbort = undefined
  }

  render(width: number): string[] {
    return this.selectedChild ? this.renderDetail(width) : this.renderList(width)
  }

  handleInput(data: string): void {
    const mouse = parseSgrMouseEvent(data)
    if (mouse) {
      this.handleMouse(mouse)
      return
    }
    if (this.selectedChild) {
      if (isCancelInput(data)) {
        if (this.detailOnly) this.close()
        else this.leaveDetail()
        return
      }
      if (data.toLowerCase() === 't') {
        this.showReasoning = !this.showReasoning
        this.transcript.clearReasoningOverrides()
        this.transcript.update(this.childProjection, this.showReasoning, false)
        this.tui.requestRender()
        return
      }
      if (data.toLowerCase() === 'a' && this.isSelectedChildActive()) {
        void this.runChildAction('abort')
        return
      }
      if (data.toLowerCase() === 'b' && this.isSelectedChildForeground()) {
        void this.runChildAction('background')
        return
      }
      if (data.toLowerCase() === 'r' && !this.isSelectedChildActive()) {
        void this.runChildAction('retry')
        return
      }
      if (matchesKey(data, 'up') || data.toLowerCase() === 'k') this.scrollDetail(-1)
      else if (matchesKey(data, 'down') || data.toLowerCase() === 'j') this.scrollDetail(1)
      else if (matchesKey(data, 'pageUp') || matchesKey(data, 'ctrl+u')) this.scrollDetail(-this.detailPageSize)
      else if (matchesKey(data, 'pageDown') || matchesKey(data, 'ctrl+d')) this.scrollDetail(this.detailPageSize)
      else if (matchesKey(data, 'home') || data === 'g') this.scrollDetailTo(0)
      else if (matchesKey(data, 'end') || data === 'G') this.scrollDetailTo(this.detailMaxOffset, true)
      return
    }
    if (isCancelInput(data)) {
      this.close()
      return
    }
    const children = this.children()
    if (matchesKey(data, 'up') || matchesKey(data, 'ctrl+p')) this.index = Math.max(0, this.index - 1)
    else if (matchesKey(data, 'down') || matchesKey(data, 'ctrl+n')) this.index = Math.min(Math.max(0, children.length - 1), this.index + 1)
    else if (matchesKey(data, 'pageUp')) this.index = Math.max(0, this.index - 10)
    else if (matchesKey(data, 'pageDown')) this.index = Math.min(Math.max(0, children.length - 1), this.index + 10)
    else if (matchesKey(data, 'home')) this.index = 0
    else if (matchesKey(data, 'end')) this.index = Math.max(0, children.length - 1)
    else if (matchesKey(data, 'enter') && children[this.index]) void this.openChild(children[this.index]!)
    else if (data.toLowerCase() === 'a' && children[this.index] && isActiveChildRun(children[this.index]!)) {
      void this.runListChildAction(children[this.index]!, 'abort')
    } else if (data.toLowerCase() === 'b' && children[this.index] && isForegroundChildRun(children[this.index]!)) {
      void this.runListChildAction(children[this.index]!, 'background')
    } else if (data.toLowerCase() === 'r' && children[this.index] && !isActiveChildRun(children[this.index]!)) {
      void this.runListChildAction(children[this.index]!, 'retry')
    }
    else {
      this.input.handleInput(data)
      this.index = 0
    }
    this.tui.requestRender()
  }

  handleMouse(mouse: SgrMouseEvent): void {
    if (!mouse.pressed || !this.selectedChild) return
    if ((mouse.button & 64) !== 0) {
      this.scrollDetail((mouse.button & 1) === 0 ? -3 : 3)
      return
    }
    if ((mouse.button & 3) !== 0 || this.transcriptPanelStartRow === undefined) return
    const panelRow = this.panelRowAtTerminalRow(mouse.y)
    if (panelRow === undefined) return
    const transcriptRow = this.detailOffset + panelRow - this.transcriptPanelStartRow
    if (!this.transcript.toggleReasoningAtRenderedRow(transcriptRow)) return
    this.followDetailTail = false
    this.tui.requestRender()
  }

  invalidate(): void {
    this.input.invalidate()
    this.transcript.invalidate()
  }

  private children(): ProjectedChildRun[] {
    const query = this.input.getValue().trim().toLowerCase()
    const children = [...this.parentProjection.childRuns].reverse()
    return query
      ? children.filter((child) => [
          child.label,
          child.profile,
          child.model,
          child.prompt,
          child.text,
          child.childId
        ].filter(Boolean).join(' ').toLowerCase().includes(query))
      : children
  }

  private renderList(width: number): string[] {
    const inner = Math.max(16, width - 4)
    const children = this.children()
    this.index = Math.min(this.index, Math.max(0, children.length - 1))
    const active = children.filter((child) => child.status === 'queued' || child.status === 'running').length
    const rows = visibleWindow(children, this.index, 14).flatMap(({ value: child, index }) => {
      const selected = index === this.index
      const running = child.status === 'queued' || child.status === 'running'
      const icon = statusGlyph(
        running ? 'running' : child.status === 'completed' ? 'success' : 'failed'
      )
      const label = sanitizeTerminalText(child.label || child.profile || child.childId)
      const right = [
        child.model,
        child.detached ? 'background' : undefined,
        child.toolInvocations !== undefined ? `${child.toolInvocations} tools` : undefined,
        child.totalTokens ? `${formatTokenCount(child.totalTokens)} tok` : undefined,
        child.durationMs !== undefined ? formatDurationMs(child.durationMs) : elapsedDuration(child.startedAt, undefined, running)
      ].filter(Boolean).join(' · ')
      const line = selectionRow(`${icon} ${label}  ${dim(child.profile ?? '')}`, right, inner, selected)
      const summary = isActiveChildRun(child) && child.activity
        ? child.activity.label
        : child.text || child.prompt
      return [
        line,
        ...(summary
          ? [`    ${dim(truncateToWidth(sanitizeTerminalText(summary).replace(/\s+/gu, ' '), Math.max(8, inner - 4)))}`]
          : [])
      ]
    })
    return pageFrame({
      path: ['KUN', 'Subagents'],
      right: `${active} active · ${children.length} total`,
      description: 'Delegated work from the current session.',
      body: [
        ` ${dim('Search')}  ${this.input.render(Math.max(10, inner - 10)).join(' ')}`,
        '',
        ...(rows.length ? rows : [` ${dim('No delegated child sessions in this conversation yet.')}`])
      ],
      footer: [
        { key: 'Enter', label: 'open transcript' },
        { key: 'A', label: 'abort active' },
        { key: 'B', label: 'background active' },
        { key: 'R', label: 'retry finished' },
        { key: 'PgUp/PgDn', label: 'navigate' },
        { key: 'Esc', label: 'back' }
      ],
      width
    })
  }

  private renderDetail(width: number): string[] {
    const child = this.selectedChild!
    const label = sanitizeTerminalText(child.label || child.profile || child.childId)
    const running = child.status === 'queued' || child.status === 'running'
    const statusKind = child.status === 'completed'
      ? 'success'
      : child.status === 'failed' || child.status === 'aborted'
        ? 'failed'
        : running
          ? 'running'
          : 'idle'
    const status = `${statusGlyph(statusKind)} ${sanitizeTerminalText(child.status)}`
    const transcriptLines: string[] = []
    if (this.loading) {
      transcriptLines.push(` ${statusGlyph('running', Math.floor(Date.now() / 200))} ${bold('Opening child transcript…')}`)
    } else if (this.error) {
      transcriptLines.push(` ${statusGlyph('failed')} ${red(sanitizeTerminalText(this.error))}`)
    } else if (this.childProjection) {
      transcriptLines.push(...this.transcript.render(Math.max(12, width - 4)))
      if (!this.childProjection.items.length) {
        transcriptLines.push(dim(' Waiting for the child session to emit output…'))
      }
    }
    this.detailPageSize = Math.max(3, Math.floor(this.tui.terminal.rows * 0.85) - 11)
    this.detailMaxOffset = Math.max(0, transcriptLines.length - this.detailPageSize)
    if (this.followDetailTail) this.detailOffset = this.detailMaxOffset
    else this.detailOffset = Math.min(this.detailOffset, this.detailMaxOffset)
    const visibleTranscript = transcriptLines.slice(
      this.detailOffset,
      this.detailOffset + this.detailPageSize
    )
    const scrollStatus = transcriptLines.length > this.detailPageSize
      ? `${this.detailOffset + 1}-${Math.min(transcriptLines.length, this.detailOffset + this.detailPageSize)}/${transcriptLines.length}`
      : `${transcriptLines.length} lines`
    const beforeTranscript = [
      ` ${dim('Parent')}  ${sanitizeTerminalText(this.parentProjection.thread.title || this.parentProjection.thread.id)}`,
      ` ${dim('Child')}   ${dim(child.childId)}${child.model ? `  ${dim('·')}  ${sanitizeTerminalText(child.model)}` : ''}`,
      ` ${dim('Status')}  ${status}${childMetrics(child) ? `  ${dim('·')}  ${dim(childMetrics(child))}` : ''}`,
      ...(child.prompt
        ? [` ${dim('Task')}    ${truncateToWidth(sanitizeTerminalText(child.prompt).replace(/\s+/gu, ' '), Math.max(8, width - 14))}`]
        : []),
      sectionLabel('Transcript', Math.max(12, width - (this.detailOnly ? 4 : 0)))
    ]
    this.transcriptPanelStartRow = this.childProjection
      ? (this.detailOnly ? 1 : 3) + beforeTranscript.length
      : undefined
    const body = [
      ...beforeTranscript,
      ...visibleTranscript,
      joinSides(
        ` ${this.connection === 'connected' ? green('● live') : this.connection === 'reconnecting' ? yellow('● reconnecting') : dim(`● ${this.connection}`)}`,
        dim(scrollStatus),
        Math.max(12, width - 4)
      )
    ]
    const actionFooter = running
      ? { key: 'A', label: 'abort' }
      : { key: 'R', label: 'retry' }
    const backgroundFooter = this.isSelectedChildForeground()
      ? [{ key: 'B', label: 'run in background' }]
      : []
    const rendered = this.detailOnly
      ? popupFrame(`Subagent · ${label}`, [
          joinSides(status, dim('live child session'), Math.max(12, width - 4)),
          ...body,
          '',
          contextualFooter([
            actionFooter,
            ...backgroundFooter,
            { key: 'Esc', label: 'close' },
            { key: 'T', label: `${this.showReasoning ? 'collapse' : 'expand'} Thinking` },
            { key: '↑/↓', label: 'scroll' }
          ], Math.max(12, width - 4))
        ], width)
      : pageFrame({
          path: ['KUN', 'Subagents', label],
          right: `${status} · child session`,
          body,
          footer: [
            actionFooter,
            ...backgroundFooter,
            { key: 'Esc', label: 'back to list' },
            { key: 'T', label: `${this.showReasoning ? 'collapse' : 'expand'} Thinking` },
            { key: '↑/↓', label: 'scroll' }
          ],
          width
        })
    this.detailPanelHeight = rendered.length
    return rendered
  }

  async open(child: ProjectedChildRun): Promise<void> {
    await this.openChild(child)
  }

  private async openChild(child: ProjectedChildRun): Promise<void> {
    this.dispose()
    const generation = this.openGeneration
    this.selectedChild = child
    this.childProjection = undefined
    this.loading = true
    this.error = ''
    this.connection = 'connecting'
    this.detailOffset = 0
    this.followDetailTail = true
    this.input.focused = false
    this.tui.requestRender()
    try {
      let detail: Awaited<ReturnType<KunTuiClient['getThread']>>
      let delegation: Awaited<ReturnType<KunTuiClient['delegationDiagnostics']>> | undefined
      for (;;) {
        try {
          const delegationRequest = typeof this.controller.client.delegationDiagnostics === 'function'
            ? this.controller.client.delegationDiagnostics(child.childId).catch(() => undefined)
            : Promise.resolve(undefined)
          ;[detail, delegation] = await Promise.all([
            this.controller.client.getThread(child.childId),
            delegationRequest
          ])
          break
        } catch (error) {
          if (generation !== this.openGeneration) return
          const current = this.selectedChild
          const pending = current?.status === 'queued' || current?.status === 'running'
          if (!pending || !(error instanceof TuiClientError) || (error.status !== 404 && error.status !== 410)) throw error
          // Child records are published before a queued executor receives a
          // slot and creates its side thread. Keep this route useful during
          // that window instead of flashing a false permanent failure.
          await new Promise((resolve) => setTimeout(resolve, 300))
        }
      }
      if (generation !== this.openGeneration || this.selectedChild?.childId !== child.childId) return
      this.childProjection = hydrateProjectedChildRuns(projectThreadSnapshot(detail), delegation)
      this.transcript.update(this.childProjection, this.showReasoning, false)
      this.loading = false
      const abort = new AbortController()
      this.detailAbort = abort
      const subscription = this.controller.client.subscribeThreadEvents({
        threadId: child.childId,
        sinceSeq: this.childProjection.lastSeq,
        signal: abort.signal,
        onConnection: (connection) => {
          if (this.detailAbort !== abort) return
          this.connection = connection
          this.tui.requestRender()
        },
        onEvent: (event) => {
          if (this.detailAbort !== abort || !this.childProjection) return
          this.childProjection = applyRuntimeEvent(this.childProjection, event)
          this.transcript.update(this.childProjection, this.showReasoning, false)
          this.tui.requestRender()
        },
        onReplayResetRequired: async () => {
          const delegationRequest = typeof this.controller.client.delegationDiagnostics === 'function'
            ? this.controller.client.delegationDiagnostics(child.childId).catch(() => undefined)
            : Promise.resolve(undefined)
          const [detail, delegation] = await Promise.all([
            this.controller.client.getThread(child.childId),
            delegationRequest
          ])
          if (this.detailAbort !== abort || abort.signal.aborted) {
            throw new Error('child subscription was replaced during replay recovery')
          }
          this.childProjection = hydrateProjectedChildRuns(projectThreadSnapshot(detail), delegation)
          this.transcript.update(this.childProjection, this.showReasoning, false)
          this.tui.requestRender()
          return this.childProjection.lastSeq
        },
        onError: (error) => {
          if (this.detailAbort !== abort) return
          this.error = safeError(error)
          this.tui.requestRender()
        }
      })
      void subscription.catch((error) => {
        if (this.detailAbort !== abort || abort.signal.aborted) return
        this.error = safeError(error)
        this.connection = 'disconnected'
        this.tui.requestRender()
      })
    } catch (error) {
      if (generation !== this.openGeneration) return
      this.loading = false
      this.connection = 'disconnected'
      this.error = `Unable to open this child session: ${safeError(error)}`
      this.tui.requestRender()
    }
  }

  private leaveDetail(): void {
    this.dispose()
    this.selectedChild = undefined
    this.childProjection = undefined
    this.loading = false
    this.error = ''
    this.connection = 'idle'
    this.detailOffset = 0
    this.followDetailTail = true
    this.input.focused = this._focused
    this.tui.requestRender()
  }

  private isSelectedChildActive(): boolean {
    return this.selectedChild !== undefined && isActiveChildRun(this.selectedChild)
  }

  private isSelectedChildForeground(): boolean {
    return this.selectedChild !== undefined && isForegroundChildRun(this.selectedChild)
  }

  private async runListChildAction(
    child: ProjectedChildRun,
    action: 'abort' | 'background' | 'retry'
  ): Promise<void> {
    await this.controller.manageSubagents(`${action} ${child.childId}`)
    this.tui.requestRender()
  }

  private async runChildAction(action: 'abort' | 'background' | 'retry'): Promise<void> {
    const child = this.selectedChild
    if (!child) return
    await this.controller.manageSubagents(`${action} ${child.childId}`)
    if (action === 'abort') {
      this.selectedChild = { ...child, status: 'aborted', updatedAt: new Date().toISOString() }
    } else if (action === 'background') {
      this.selectedChild = { ...child, detached: true, updatedAt: new Date().toISOString() }
    }
    this.tui.requestRender()
  }

  private scrollDetail(delta: number): void {
    this.scrollDetailTo(this.detailOffset + delta)
  }

  private scrollDetailTo(target: number, followTail = false): void {
    this.detailOffset = Math.max(0, Math.min(target, this.detailMaxOffset))
    this.followDetailTail = followTail || this.detailOffset >= this.detailMaxOffset
    this.tui.requestRender()
  }

  private panelRowAtTerminalRow(terminalRow: number): number | undefined {
    if (terminalRow < 1 || this.detailPanelHeight < 1) return undefined
    if (!this.detailOnly) {
      // Exclusive primary routes start on the terminal's first rendered row.
      return terminalRow - 1
    }
    // Mirror pi-tui's centered 85%-height overlay calculation so absolute SGR
    // coordinates map back to this popup's local rows.
    const terminalHeight = this.tui.terminal.rows
    const availableHeight = Math.max(1, terminalHeight - 2)
    const maxHeight = Math.max(1, Math.min(Math.floor(terminalHeight * 0.85), availableHeight))
    const effectiveHeight = Math.min(this.detailPanelHeight, maxHeight)
    const overlayTop = 1 + Math.floor((availableHeight - effectiveHeight) / 2)
    const panelRow = terminalRow - 1 - overlayTop
    return panelRow >= 0 && panelRow < effectiveHeight ? panelRow : undefined
  }
}
