import { basename } from 'node:path'
import {
  KUN_TOOL_PERMISSION_MODES,
  kunToolPermissionModeFromSettings,
  kunToolPermissionModeSettings,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type KunToolPermissionMode,
  type SandboxMode
} from '../../contracts/policy.js'
import { safeError } from '../chat-format.js'
import type { TuiController, TuiControllerState } from '../controller.js'
import { isCancelKey, isKey, letter, printableText, type TuiKeyEvent } from '../keys.js'
import type { TuiKeymap } from '../keymap.js'
import {
  rowBlock,
  sectionBlock,
  type PageBlock,
  type PageMouseEvent,
  type PageSize,
  type PageView,
  type TuiPage
} from '../page-model.js'
import { plainLines } from '../render-utils.js'
import { sanitizeTerminalText } from '../safe-text.js'
import { TextField } from '../text-field.js'
import { statusGlyph, visual, visualDensity } from '../visual-system.js'
import { listCapacity, navigateShortList, visibleWindow, type Invalidate } from './page-kit.js'

const { strong: bold, muted: dim, focus: cyan, warning: yellow, danger: red } = visual

export class SessionsPage implements TuiPage {
  readonly kind = 'sessions'
  private state: TuiControllerState
  private readonly search: TextField
  private deleteConfirmId?: string

  constructor(
    private readonly controller: TuiController,
    private readonly keymap: TuiKeymap,
    private readonly invalidate: Invalidate
  ) {
    this.state = controller.state
    this.search = new TextField(this.state.threadSearch)
  }

  update(state: TuiControllerState): void {
    this.state = state
    this.invalidate()
  }

  view(size: PageSize): PageView {
    const density = visualDensity(size.width)
    const selectedIndex = this.state.selectedThreadIndex
    const body: PageBlock[] = [{ kind: 'field', field: this.search, label: 'Search', focused: !this.deleteConfirmId }, { kind: 'spacer' }]
    for (const { value: thread, index } of visibleWindow(this.state.threads, selectedIndex, listCapacity(size, 4))) {
      const current = thread.id === this.state.projection?.thread.id
      const marker = `${thread.pinned ? '◆' : '◇'}${current ? '*' : ' '}`
      const updated = thread.updatedAt.slice(5, 16).replace('T', ' ')
      const right = density === 'wide'
        ? `${thread.status} · ${sanitizeTerminalText(thread.model)} · ${basename(thread.workspace)} · ${updated}`
        : density === 'compact'
          ? `${thread.status} · ${sanitizeTerminalText(thread.model)} · ${updated}`
          : `${thread.status} · ${updated}`
      body.push(rowBlock(`${marker} ${sanitizeTerminalText(thread.title || 'Untitled')}`, right, index === selectedIndex, index))
    }
    if (!this.state.threads.length) body.push({ kind: 'line', text: dim('No sessions found. Ctrl+X N creates one.') })
    const selected = this.state.threads[selectedIndex]
    if (this.deleteConfirmId && selected?.id === this.deleteConfirmId) {
      body.push({ kind: 'spacer' }, { kind: 'line', text: red(` Delete “${sanitizeTerminalText(selected.title || selected.id)}” permanently?`) })
    }
    return {
      path: ['KUN', 'Sessions'],
      right: `${this.state.threads.length} ${this.state.threadListMode === 'archived' ? 'archived' : 'saved'}`,
      body,
      footer: this.deleteConfirmId
        ? [{ key: 'Enter', label: 'delete permanently', tone: 'danger' }, { key: 'Esc', label: 'cancel' }]
        : [
            { key: 'Enter', label: 'open' },
            { key: this.keymap.display('session_pin'), label: 'pin' },
            this.state.threadListMode === 'archived' ? { key: 'u', label: 'restore' } : { key: 'a', label: 'archives' },
            { key: this.keymap.display('session_delete'), label: 'delete' },
            { key: 'Esc', label: 'back' }
          ]
    }
  }

  handleKey(key: TuiKeyEvent): void {
    if (this.deleteConfirmId) {
      if (isCancelKey(key)) this.deleteConfirmId = undefined
      else if (isKey(key, 'enter')) {
        this.deleteConfirmId = undefined
        void this.controller.deleteSelectedThread()
      } else return
      this.invalidate()
      return
    }
    if (isCancelKey(key)) { this.controller.showChat(); return }
    if (isKey(key, 'up', 'ctrl+p')) { this.controller.selectThread(-1); return }
    if (isKey(key, 'down', 'ctrl+n')) { this.controller.selectThread(1); return }
    if (isKey(key, 'pageUp')) { this.controller.selectThread(-10); return }
    if (isKey(key, 'pageDown')) { this.controller.selectThread(10); return }
    if (isKey(key, 'home')) { this.controller.selectThread(-Number.MAX_SAFE_INTEGER); return }
    if (isKey(key, 'end')) { this.controller.selectThread(Number.MAX_SAFE_INTEGER); return }
    // Plain letters only act as shortcuts while the search box is empty, so
    // searching for "api" or "undo" still works.
    const empty = !this.search.getValue()
    if (empty && printableText(key) === 'a' && this.state.threadListMode === 'active') {
      this.controller.showThreads('', 'archived')
      return
    }
    if (empty && printableText(key) === 'u' && this.state.threadListMode === 'archived') {
      void this.controller.restoreSelectedThread()
      return
    }
    if (this.keymap.matches('session_pin', key)) { void this.controller.toggleSelectedThreadPin(); return }
    if (this.keymap.matches('session_delete', key)) {
      this.deleteConfirmId = this.state.threads[this.state.selectedThreadIndex]?.id
      this.invalidate()
      return
    }
    if (isKey(key, 'enter')) { void this.controller.openSelectedThread(); return }
    if (this.search.handleKey(key)) {
      this.invalidate()
      void this.controller.refreshThreads(this.search.getValue())
    }
  }

  handlePaste(text: string): void {
    this.search.insert(text)
    this.invalidate()
    void this.controller.refreshThreads(this.search.getValue())
  }

  handleMouse(event: PageMouseEvent): void {
    if (event.type === 'scroll') { this.controller.selectThread(event.delta); return }
    const delta = event.index - this.state.selectedThreadIndex
    if (delta === 0 && event.activate) { void this.controller.openSelectedThread(); return }
    if (delta !== 0) this.controller.selectThread(delta)
  }
}

export class HelpPage implements TuiPage {
  readonly kind = 'help'
  constructor(private readonly controller: TuiController, private readonly keymap: TuiKeymap) {}

  view(): PageView {
    const key = (value: string) => cyan(bold(value))
    return {
      path: ['KUN', 'Help'],
      description: `Press ${this.keymap.display('command_list')} to search every command.`,
      body: [
        sectionBlock('Conversation'),
        { kind: 'text', text: ` ${key('Enter')} ${dim('send or steer')}  ·  ${key('Ctrl+J')} ${dim('newline')}  ·  ${key('Esc')} ${dim('stop turn')}` },
        { kind: 'text', text: ` ${key(this.keymap.display('variant_cycle'))} ${dim('reasoning effort')}  ·  ${key(this.keymap.display('session_list'))} ${dim('sessions')}` },
        { kind: 'spacer' },
        sectionBlock('Start and switch'),
        { kind: 'text', text: ` ${key('/connect')} ${dim('providers')}  ·  ${key('/model')} ${dim('model')}  ·  ${key('/sessions')} ${dim('previous work')}` },
        { kind: 'text', text: ` ${key(this.keymap.display('agent_list'))} ${dim('Agent / Plan / Graph / Goal mode')}  ·  ${key('/graph')} ${dim('Graph then type requirement')}` },
        { kind: 'spacer' },
        sectionBlock('Transcript'),
        { kind: 'text', text: ` ${key(this.keymap.display('tool_details_toggle'))} ${dim('open the full transcript with tool details and Thinking')}` },
        { kind: 'text', text: ` ${dim('Finished output is written to the terminal scrollback: wheel or Shift+PgUp scrolls it, drag selects text to copy.')}` },
        { kind: 'text', text: ` ${key(this.keymap.display('pointer_mode_toggle'))} ${dim('enable direct clicks on live Thinking/Subagent rows; toggle again to restore native selection')}` },
        { kind: 'text', text: ` ${dim('Ctrl+C acts as back on every page.')}` }
      ],
      footer: [
        { key: this.keymap.display('command_list'), label: 'all commands' },
        { key: 'Esc', label: 'back' }
      ]
    }
  }

  handleKey(key: TuiKeyEvent): void {
    if (isCancelKey(key) || printableText(key) === '?') this.controller.showChat()
  }
}

export function inspectionDescription(title: string): string {
  switch (title) {
    case 'Status': return 'Current session, model, permissions, and shared runtime connection.'
    case 'MCP servers': return 'Configured tool servers and their live availability.'
    case 'Tasks': return 'Subagents, background commands, plan work, goals, and extension jobs.'
    case 'Plan': return 'Persisted plan items for the current session.'
    case 'Goal': return 'Persistent objective and its current budget state.'
    case 'Context': return 'Token usage reported for the current session.'
    case 'Queued guidance': return 'Messages waiting to steer the active turn.'
    default: return 'Read-only details from the shared runtime.'
  }
}

export function renderInspectionLine(title: string, value: string, width: number): string[] {
  const safe = sanitizeTerminalText(value)
  if (/^\s{2,}/u.test(value)) {
    const text = safe.trim()
    return [`   ${/\b(error|failed|disconnected)\b/iu.test(text) ? red(text) : dim(text)}`]
  }
  const taskStatus = safe.match(/^(\d+\.\s+)?\[([^\]]+)\]\s+(.+)$/u)
  if (taskStatus) {
    const state = taskStatus[2]!.toLowerCase()
    const glyph = statusGlyph(
      state.includes('progress') || state.includes('running')
        ? 'running'
        : state.includes('complete') || state.includes('done')
          ? 'success'
          : state.includes('fail') ? 'failed' : 'queued'
    )
    return [` ${glyph} ${taskStatus[1] ?? ''}${taskStatus[3]}  ${dim(taskStatus[2]!)}`]
  }
  const field = safe.match(/^([^:]{1,24}):\s*(.*)$/u)
  if (field) {
    const label = field[1]!
    const content = field[2]!
    const glyph = title === 'Status' && label === 'Connection'
      ? `${statusGlyph(content === 'connected' ? 'success' : content === 'reconnecting' ? 'warning' : 'failed')} `
      : ''
    return [` ${glyph}${dim(label.padEnd(Math.min(18, Math.max(8, label.length))))}  ${content}`]
  }
  const numbered = safe.match(/^(\d+)\.\s+(.+)$/u)
  if (numbered) return [` ${cyan(numbered[1]!)}  ${numbered[2]}`]
  return plainLines(safe, width, 1)
}

export class InspectionPage implements TuiPage {
  readonly kind = 'inspection'
  private offset = 0

  constructor(
    private readonly controller: TuiController,
    readonly title: string,
    private readonly lines: readonly string[],
    private readonly invalidate: Invalidate
  ) {}

  private pageSize(height: number): number {
    return Math.max(1, height - 9)
  }

  private lastHeight = 30

  view(size: PageSize): PageView {
    this.lastHeight = size.height
    const pageSize = this.pageSize(size.height)
    const maxOffset = Math.max(0, this.lines.length - pageSize)
    this.offset = Math.min(this.offset, maxOffset)
    const visible = this.lines.slice(this.offset, this.offset + pageSize)
    return {
      path: ['KUN', this.title],
      right: this.lines.length > pageSize
        ? `${this.offset + 1}-${Math.min(this.lines.length, this.offset + pageSize)}/${this.lines.length}`
        : `${this.lines.length} lines`,
      description: inspectionDescription(this.title),
      body: visible.flatMap((line) => renderInspectionLine(this.title, line, Math.max(10, size.width - 2)))
        .map((text): PageBlock => ({ kind: 'line', text })),
      footer: [
        ...(this.lines.length > pageSize ? [{ key: '↑/↓', label: 'scroll' }] : []),
        { key: 'Esc', label: 'back' }
      ]
    }
  }

  handleKey(key: TuiKeyEvent): void {
    const pageSize = this.pageSize(this.lastHeight)
    const maxOffset = Math.max(0, this.lines.length - pageSize)
    if (isCancelKey(key) || isKey(key, 'enter')) { this.controller.dismissInspection(); return }
    if (isKey(key, 'up')) this.offset = Math.max(0, this.offset - 1)
    else if (isKey(key, 'down')) this.offset = Math.min(maxOffset, this.offset + 1)
    else if (isKey(key, 'pageUp')) this.offset = Math.max(0, this.offset - pageSize)
    else if (isKey(key, 'pageDown')) this.offset = Math.min(maxOffset, this.offset + pageSize)
    else return
    this.invalidate()
  }

  handleMouse(event: PageMouseEvent): void {
    if (event.type !== 'scroll') return
    const maxOffset = Math.max(0, this.lines.length - this.pageSize(this.lastHeight))
    this.offset = Math.max(0, Math.min(maxOffset, this.offset + event.delta))
    this.invalidate()
  }
}

export const PERMISSION_PRESET_COPY: Record<KunToolPermissionMode, { label: string; description: string }> = {
  'ask-for-approval': {
    label: 'Ask for approval',
    description: 'Workspace-safe actions run automatically; approval-worthy actions ask you first'
  },
  'approve-for-me': {
    label: 'Approve for me',
    description: 'The selected model reviews approval-worthy actions and denies them if review fails'
  },
  'full-access': {
    label: 'Full access',
    description: 'No Kun approval; tools may access any file, run commands, and use the network'
  }
}

export class PermissionPage implements TuiPage {
  readonly kind = 'permissions'
  private presetIndex: number
  private readonly startsInFullAccess: boolean
  private confirmingFullAccess = false
  private saving = false
  private error = ''

  constructor(
    private readonly controller: TuiController,
    approvalPolicy: ApprovalPolicy,
    sandboxMode: SandboxMode,
    approvalReviewer: ApprovalReviewer,
    private readonly close: () => void,
    private readonly invalidate: Invalidate
  ) {
    const mode = kunToolPermissionModeFromSettings({ approvalPolicy, sandboxMode, approvalReviewer })
    this.presetIndex = Math.max(0, KUN_TOOL_PERMISSION_MODES.indexOf(mode))
    this.startsInFullAccess = mode === 'full-access'
  }

  view(size: PageSize): PageView {
    const saving = { key: statusGlyph('running'), label: 'saving' }
    if (this.confirmingFullAccess) {
      return {
        path: ['KUN', 'Permissions', 'Confirm Full access'],
        description: 'Full access removes Kun-level approval and workspace restrictions.',
        body: [
          { kind: 'text', text: red(bold('Enable Full access?')) },
          { kind: 'spacer' },
          ...plainLines(
            'Kun may access any file on this computer, execute host commands, and use network-capable tools without Kun approval.',
            size.width - 2,
            0
          ).map((text): PageBlock => ({ kind: 'text', text })),
          { kind: 'spacer' },
          { kind: 'text', text: yellow('Only enable Full access for a task and workspace you trust.') },
          ...(this.error ? [{ kind: 'spacer' } as const, { kind: 'text' as const, text: red(this.error) }] : [])
        ],
        footer: this.saving
          ? [saving]
          : [{ key: 'Enter', label: 'enable Full access', tone: 'danger' }, { key: 'Esc', label: 'cancel' }]
      }
    }
    return {
      path: ['KUN', 'Permissions'],
      description: 'Choose who reviews actions that cross the workspace boundary.',
      body: [
        sectionBlock('Tool permission mode'),
        ...KUN_TOOL_PERMISSION_MODES.map((mode, index) => {
          const copy = PERMISSION_PRESET_COPY[mode]
          return rowBlock(copy.label, copy.description, index === this.presetIndex, index)
        }),
        ...(this.error ? [{ kind: 'spacer' } as const, { kind: 'text' as const, text: red(this.error) }] : [])
      ],
      footer: this.saving
        ? [saving]
        : [{ key: '↑/↓', label: 'mode' }, { key: 'Enter', label: 'save' }, { key: 'Esc', label: 'cancel' }]
    }
  }

  handleKey(key: TuiKeyEvent): void {
    if (this.saving) return
    if (this.confirmingFullAccess) {
      if (isCancelKey(key)) {
        this.confirmingFullAccess = false
        this.invalidate()
      } else if (isKey(key, 'enter') || letter(key) === 'y') {
        void this.save('full-access')
      }
      return
    }
    if (isCancelKey(key)) { this.close(); return }
    const next = navigateShortList(key, this.presetIndex, KUN_TOOL_PERMISSION_MODES.length)
    if (next !== undefined) { this.presetIndex = next; this.invalidate(); return }
    if (isKey(key, 'enter')) this.choose()
  }

  handleMouse(event: PageMouseEvent): void {
    if (this.confirmingFullAccess || event.type !== 'row') return
    if (event.activate && event.index === this.presetIndex) this.choose()
    else this.presetIndex = event.index
    this.invalidate()
  }

  private choose(): void {
    const mode = KUN_TOOL_PERMISSION_MODES[this.presetIndex]!
    if (mode === 'full-access' && !this.startsInFullAccess) {
      this.confirmingFullAccess = true
      this.error = ''
      this.invalidate()
      return
    }
    void this.save(mode)
  }

  private async save(mode: KunToolPermissionMode): Promise<void> {
    const settings = kunToolPermissionModeSettings(mode)
    this.saving = true
    this.invalidate()
    try {
      const saved = await this.controller.setPermissions(settings.approvalPolicy, settings.sandboxMode, settings.approvalReviewer)
      if (saved) this.close()
      else this.saving = false
    } catch (error) {
      this.saving = false
      this.error = safeError(error)
    }
    this.invalidate()
  }
}
