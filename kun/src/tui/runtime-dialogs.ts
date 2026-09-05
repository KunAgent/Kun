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
import { oneLine, popupFrame, summarize } from './render-utils.js'

export type TimelineEntry = {
  turnId: string
  ordinal: number
  label: string
  preview: string[]
}

export class TimelineDialog implements Component, Focusable {
  private _focused = true
  private index = 0
  private expanded = false
  private readonly openedFromJump: boolean
  private detailOffset = 0
  private readonly entries: TimelineEntry[]

  constructor(
    private readonly controller: TuiController,
    projection: ThreadProjection,
    query: string | undefined,
    target: string | undefined,
    private readonly close: () => void,
    private readonly height: () => number
  ) {
    this.openedFromJump = Boolean(target)
    const needle = query?.trim().toLowerCase()
    this.entries = projection.thread.turns.flatMap((turn, turnIndex) => {
      const user = turn.items.find((item): item is Extract<TurnItem, { kind: 'user_message' }> => item.kind === 'user_message')
      const assistant = turn.items.filter((item): item is Extract<TurnItem, { kind: 'assistant_text' }> => item.kind === 'assistant_text')
      const text = [user?.displayText ?? user?.text ?? turn.prompt, ...assistant.map((item) => item.text)].join('\n')
      if (needle && !text.toLowerCase().includes(needle) && !turn.id.toLowerCase().includes(needle)) return []
      return [{
        turnId: turn.id,
        ordinal: turnIndex + 1,
        label: `${turnIndex + 1}. ${oneLine(user?.displayText ?? user?.text ?? turn.prompt)}`,
        preview: text.split('\n').filter(Boolean).map((line) => sanitizeTerminalText(line))
      }]
    })
    const numeric = Number(target)
    const selected = Number.isSafeInteger(numeric) && numeric > 0
      ? this.entries.findIndex((entry) => entry.ordinal === numeric)
      : target
        ? this.entries.findIndex((entry) => `${entry.turnId} ${entry.label}`.toLowerCase().includes(target.toLowerCase()))
        : -1
    if (selected >= 0) this.index = selected
    if (target && selected >= 0) this.expanded = true
  }

  get focused(): boolean { return this._focused }
  set focused(value: boolean) { this._focused = value }

  render(width: number): string[] {
    const selected = this.entries[this.index]
    if (this.expanded && selected) {
      const bodyHeight = Math.max(6, this.height() - 8)
      const lines = selected.preview.length ? selected.preview : ['No text was recorded for this turn.']
      const maxOffset = Math.max(0, lines.length - bodyHeight)
      this.detailOffset = Math.min(this.detailOffset, maxOffset)
      return pageFrame({
        path: ['KUN', 'Timeline', `Turn ${selected.ordinal}`],
        right: `${selected.turnId} · ${this.detailOffset + 1}-${Math.min(lines.length, this.detailOffset + bodyHeight)}/${lines.length}`,
        body: lines.slice(this.detailOffset, this.detailOffset + bodyHeight),
        footer: [
          { key: '↑/↓ PgUp/PgDn', label: 'scroll' },
          { key: 'f', label: 'fork here' },
          { key: 'Esc', label: 'turn list' }
        ],
        width
      })
    }
    const start = Math.max(0, this.index - 4)
    const visible = this.entries.slice(start, start + 9)
    return pageFrame({
      path: ['KUN', 'Timeline'],
      right: `${this.entries.length} turns`,
      body: [
      ...(visible.length
        ? visible.map((entry) =>
            selectionRow(
              truncateToWidth(entry.label, Math.max(10, width - 16)),
              entry === selected ? `turn ${entry.ordinal}` : '',
              width - 2,
              entry === selected
            )
          )
        : [dim('No matching turns.')]),
      '',
      ...(selected ? [bold(`Turn ${selected.ordinal} · ${sanitizeTerminalText(selected.turnId)}`), ...selected.preview.slice(0, 6).map(dim)] : []),
      ],
      footer: [
        { key: '↑/↓', label: 'choose' },
        { key: 'Enter', label: 'open turn' },
        { key: 'f', label: 'fork here' },
        { key: 'Esc', label: 'back' }
      ],
      width
    })
  }

  handleInput(data: string): void {
    if (this.expanded) {
      if (isCancelInput(data)) {
        if (this.openedFromJump) {
          this.close()
          return
        }
        this.expanded = false
        this.detailOffset = 0
        return
      }
      if (matchesKey(data, 'up') || data.toLowerCase() === 'k') this.detailOffset = Math.max(0, this.detailOffset - 1)
      else if (matchesKey(data, 'down') || data.toLowerCase() === 'j') this.detailOffset += 1
      else if (matchesKey(data, 'pageUp')) this.detailOffset = Math.max(0, this.detailOffset - 10)
      else if (matchesKey(data, 'pageDown')) this.detailOffset += 10
      else if (matchesKey(data, 'home')) this.detailOffset = 0
      else if (data.toLowerCase() === 'f' && this.entries[this.index]) this.forkSelected()
      return
    }
    if (isCancelInput(data)) { this.close(); return }
    if (matchesKey(data, 'up') || matchesKey(data, 'ctrl+p')) this.index = Math.max(0, this.index - 1)
    else if (matchesKey(data, 'down') || matchesKey(data, 'ctrl+n')) this.index = Math.min(Math.max(0, this.entries.length - 1), this.index + 1)
    else if (matchesKey(data, 'pageUp')) this.index = Math.max(0, this.index - 8)
    else if (matchesKey(data, 'pageDown')) this.index = Math.min(Math.max(0, this.entries.length - 1), this.index + 8)
    else if (matchesKey(data, 'home')) this.index = 0
    else if (matchesKey(data, 'end')) this.index = Math.max(0, this.entries.length - 1)
    else if (matchesKey(data, 'enter') && this.entries[this.index]) {
      this.expanded = true
      this.detailOffset = 0
    } else if (data.toLowerCase() === 'f' && this.entries[this.index]) this.forkSelected()
  }

  invalidate(): void {}

  private forkSelected(): void {
    const entry = this.entries[this.index]
    if (!entry) return
    this.close()
    void this.controller.forkAtTurn(entry.turnId, `Fork at turn ${entry.ordinal}`)
  }

}

export class SkillsDialog implements Component, Focusable {
  private _focused = true
  private index = 0
  private readonly entries: SkillsSnapshot['skills']
  private deleteConfirm = false

  constructor(
    private readonly controller: TuiController,
    private readonly snapshot: SkillsSnapshot,
    query: string | undefined,
    private readonly editText: (initial: string) => Promise<string>,
    private readonly changed: () => Promise<void>,
    private readonly close: () => void
  ) {
    const needle = query?.trim().toLowerCase()
    this.entries = needle
      ? snapshot.skills.filter((skill) => `${skill.id} ${skill.name} ${skill.description ?? ''}`.toLowerCase().includes(needle))
      : snapshot.skills
  }

  get focused(): boolean { return this._focused }
  set focused(value: boolean) { this._focused = value }

  render(width: number): string[] {
    const selected = this.entries[this.index]
    const start = Math.max(0, this.index - 5)
    return pageFrame({
      path: ['KUN', 'Skills'],
      right: `${this.entries.length} visible · ${this.snapshot.enabled ? 'enabled' : 'disabled'}`,
      description: 'Workspace and user skills available to this session.',
      body: [
      ...this.entries.slice(start, start + 11).map((skill) =>
        selectionRow(
          sanitizeTerminalText(skill.id),
          `${skill.source}${skill.description ? ` · ${sanitizeTerminalText(skill.description)}` : ''}`,
          width - 2,
          skill === selected
        )),
      ...(this.snapshot.validationErrors.length
        ? ['', red(`${this.snapshot.validationErrors.length} skill validation error(s)`) ]
        : [])
      ],
      footer: [
        { key: '↑/↓', label: 'choose' },
        { key: 'Enter', label: 'invoke' },
        { key: 'e', label: 'edit' },
        { key: 'd', label: 'disable' },
        { key: 'x', label: this.deleteConfirm ? 'Enter confirms delete' : 'delete managed' },
        { key: 'Esc', label: 'back' }
      ],
      width
    })
  }

  handleInput(data: string): void {
    if (this.deleteConfirm) {
      if (isCancelInput(data)) {
        this.deleteConfirm = false
        return
      }
      if (matchesKey(data, 'enter') && this.entries[this.index]) {
        const skill = this.entries[this.index]!
        this.close()
        void this.runMutation(`delete ${skill.id} --yes`)
      }
      return
    }
    if (isCancelInput(data)) { this.close(); return }
    if (matchesKey(data, 'up') || matchesKey(data, 'ctrl+p')) this.index = Math.max(0, this.index - 1)
    else if (matchesKey(data, 'down') || matchesKey(data, 'ctrl+n')) this.index = Math.min(Math.max(0, this.entries.length - 1), this.index + 1)
    else if (matchesKey(data, 'pageUp')) this.index = Math.max(0, this.index - 10)
    else if (matchesKey(data, 'pageDown')) this.index = Math.min(Math.max(0, this.entries.length - 1), this.index + 10)
    else if (matchesKey(data, 'home')) this.index = 0
    else if (matchesKey(data, 'end')) this.index = Math.max(0, this.entries.length - 1)
    else if (matchesKey(data, 'enter') && this.entries[this.index]) {
      const skill = this.entries[this.index]!
      this.close()
      void this.controller.invokeSkill(skill.id)
    } else if (data.toLowerCase() === 'e' && this.entries[this.index]) {
      const skill = this.entries[this.index]!
      this.close()
      void this.runMutation(`edit ${skill.id}`)
    } else if (data.toLowerCase() === 'd' && this.entries[this.index]) {
      const skill = this.entries[this.index]!
      this.close()
      void this.runMutation(`disable ${skill.id}`)
    } else if (data.toLowerCase() === 'x' && this.entries[this.index]) {
      this.deleteConfirm = true
    }
  }

  invalidate(): void {}

  private async runMutation(action: string): Promise<void> {
    await this.controller.manageSkills(action, this.editText)
    await this.changed()
  }
}

export class ApprovalDialog implements Component, Focusable {
  private _focused = false
  constructor(
    private readonly controller: TuiController,
    private readonly toolName: string,
    private readonly summary: string
  ) {}
  get focused(): boolean { return this._focused }
  set focused(value: boolean) { this._focused = value }
  render(width: number): string[] {
    const workspace = this.controller.state.projection?.thread.workspace
    return pageFrame({
      path: ['KUN', 'Approval required'],
      right: 'Action required',
      description: 'Review the requested action before Kun continues.',
      body: [
        sectionLabel('Request', width - 2),
        ` ${dim('Tool')}       ${bold(sanitizeTerminalText(this.toolName))}`,
        ...(workspace ? [` ${dim('Workspace')}  ${sanitizeTerminalText(workspace)}`] : []),
        ` ${dim('Summary')}    ${sanitizeTerminalText(this.summary)}`,
        '',
        selectionRow('Allow once', 'run this action now', width - 2, true),
        selectionRow('Deny', 'block this action', width - 2, false)
      ],
      footer: [
        { key: 'y', label: 'allow once', tone: 'warning' },
        { key: 'n', label: 'deny', tone: 'danger' }
      ],
      width
    })
  }
  handleInput(data: string): void {
    if (data.toLowerCase() === 'y') void this.controller.decideApproval('allow')
    else if (data.toLowerCase() === 'n') void this.controller.decideApproval('deny')
  }
  invalidate(): void {}
}

export class UserInputDialog implements Component, Focusable {
  private readonly editor: Editor
  private _focused = false

  constructor(
    tui: TUI,
    private readonly controller: TuiController,
    private session: UserInputSession
  ) {
    this.editor = new Editor(tui, editorTheme, { paddingX: 1 })
  }

  get focused(): boolean { return this._focused }
  set focused(value: boolean) { this._focused = value; this.editor.focused = value }

  render(width: number): string[] {
    const question = currentUserInputQuestion(this.session)
    const selected = selectedUserInputLabels(this.session)
    const options = question.options.map((option, index) => {
      const mark = question.selectionMode === 'multiple'
        ? (selected.has(option.label) ? '[x]' : '[ ]')
        : `${index + 1}.`
      const recommendation = option.recommended ? '[recommended] ' : ''
      return selectionRow(
        `${mark} ${recommendation}${sanitizeTerminalText(option.label)}`,
        option.description ? sanitizeTerminalText(option.description) : '',
        width - 2,
        index === this.session.optionIndex
      )
    })
    return pageFrame({
      path: ['KUN', 'Question', question.header],
      right: `Question ${this.session.questionIndex + 1} of ${this.session.questions.length}`,
      body: [
        ` ${bold(sanitizeTerminalText(question.question))}`,
        '',
        ...options,
        '',
        ...this.editor.render(Math.max(10, width - 2))
      ],
      footer: [
        { key: '↑/↓', label: 'choose' },
        ...(question.selectionMode === 'multiple' ? [{ key: 'Space', label: 'toggle' }] : []),
        { key: 'Enter', label: 'confirm' },
        { key: 'Esc', label: 'cancel' }
      ],
      width
    })
  }

  handleInput(data: string): void {
    const question = currentUserInputQuestion(this.session)
    if (isCancelInput(data)) { void this.controller.cancelUserInput(); return }
    if ((matchesKey(data, 'up') || matchesKey(data, 'ctrl+p')) && !this.editor.getText() && question.options.length) {
      this.session = moveUserInputOption(this.session, -1); return
    }
    if ((matchesKey(data, 'down') || matchesKey(data, 'ctrl+n')) && !this.editor.getText() && question.options.length) {
      this.session = moveUserInputOption(this.session, 1); return
    }
    if (matchesKey(data, 'space') && !this.editor.getText() && question.selectionMode === 'multiple') {
      this.session = toggleCurrentUserInputOption(this.session); return
    }
    if (matchesKey(data, 'enter')) {
      const text = this.editor.getExpandedText().trim()
      this.session = text
        ? answerCurrentUserInputWithText(this.session, text)
        : confirmCurrentUserInput(this.session)
      this.editor.setText('')
      if (isUserInputSessionComplete(this.session)) {
        void this.controller.resolveUserInput(orderedUserInputAnswers(this.session))
      }
      return
    }
    this.editor.handleInput(data)
  }

  invalidate(): void { this.editor.invalidate() }
}
