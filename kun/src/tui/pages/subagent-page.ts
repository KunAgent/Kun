import { formatTokenCount } from '../activity.js'
import { safeError } from '../chat-format.js'
import { TuiClientError, type KunTuiClient } from '../client.js'
import type { TuiController } from '../controller.js'
import { isCancelKey, isKey, letter, printableText, type TuiKeyEvent } from '../keys.js'
import {
  PageScrollState,
  rowBlock,
  sectionBlock,
  type PageAction,
  type PageBlock,
  type PageMouseEvent,
  type PageSize,
  type PageTranscript,
  type PageView,
  type TuiPage
} from '../page-model.js'
import { elapsedDuration, formatDurationMs } from '../render-utils.js'
import { sanitizeTerminalText } from '../safe-text.js'
import {
  applyRuntimeEvent,
  hydrateProjectedChildRuns,
  projectThreadSnapshot,
  type ProjectedChildRun,
  type ThreadProjection
} from '../state.js'
import { childMetrics, isActiveChildRun, isForegroundChildRun } from '../subagent-format.js'
import { TextField } from '../text-field.js'
import { statusGlyph, visual } from '../visual-system.js'
import { listCapacity, navigateList, visibleWindow, type Invalidate } from './page-kit.js'

const { muted: dim, success: green, warning: yellow } = visual

type Connection = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

/**
 * Subagent browser and live child transcript. ChildRunExecutor persists side
 * threads with id === childId, so a child session is opened by that
 * authoritative id and never guessed from a display label.
 */
export class SubagentPage implements TuiPage {
  readonly kind: string
  private readonly search = new TextField()
  private parentProjection: ThreadProjection
  private childProjection?: ThreadProjection
  private selectedChild?: ProjectedChildRun
  private index = 0
  private loading = false
  private error = ''
  private connection: Connection = 'idle'
  private showReasoning = false
  private readonly reasoningOverrides = new Map<string, boolean>()
  private readonly scroll = new PageScrollState()
  private detailAbort?: AbortController
  private openGeneration = 0

  constructor(
    private readonly controller: TuiController,
    projection: ThreadProjection,
    private readonly close: () => void,
    private readonly invalidate: Invalidate,
    private readonly detailOnly = false
  ) {
    this.parentProjection = projection
    this.kind = detailOnly ? 'subagent-popup' : 'subagents'
  }

  get animated(): boolean {
    return this.loading || (this.selectedChild ? isActiveChildRun(this.selectedChild) : this.parentProjection.childRuns.some(isActiveChildRun))
  }

  updateParentProjection(projection: ThreadProjection | undefined): void {
    if (!projection || projection.thread.id !== this.parentProjection.thread.id) return
    this.parentProjection = projection
    if (this.selectedChild) {
      this.selectedChild = projection.childRuns.find((run) => run.childId === this.selectedChild?.childId) ?? this.selectedChild
    }
    this.invalidate()
  }

  dispose(): void {
    this.openGeneration += 1
    this.detailAbort?.abort()
    this.detailAbort = undefined
  }

  view(size: PageSize): PageView {
    return this.selectedChild ? this.detailView(this.selectedChild) : this.listView(size)
  }

  private children(): ProjectedChildRun[] {
    const query = this.search.getValue().trim().toLowerCase()
    const children = [...this.parentProjection.childRuns].reverse()
    return query
      ? children.filter((child) => [child.label, child.profile, child.model, child.prompt, child.text, child.childId]
          .filter(Boolean).join(' ').toLowerCase().includes(query))
      : children
  }

  private listView(size: PageSize): PageView {
    const children = this.children()
    this.index = Math.min(this.index, Math.max(0, children.length - 1))
    const active = children.filter(isActiveChildRun).length
    const rows: PageBlock[] = []
    for (const { value: child, index } of visibleWindow(children, this.index, Math.max(2, Math.floor(listCapacity(size, 3) / 2)))) {
      const running = isActiveChildRun(child)
      const icon = statusGlyph(running ? 'running' : child.status === 'completed' ? 'success' : 'failed')
      const right = [
        child.model,
        child.detached ? 'background' : undefined,
        child.toolInvocations !== undefined ? `${child.toolInvocations} tools` : undefined,
        child.totalTokens ? `${formatTokenCount(child.totalTokens)} tok` : undefined,
        child.durationMs !== undefined ? formatDurationMs(child.durationMs) : elapsedDuration(child.startedAt, undefined, running)
      ].filter(Boolean).join(' · ')
      rows.push(rowBlock(`${icon} ${sanitizeTerminalText(child.label || child.profile || child.childId)}  ${dim(child.profile ?? '')}`, right, index === this.index, index))
      const summary = running && child.activity ? child.activity.label : child.text || child.prompt
      if (summary) rows.push({ kind: 'line', text: `    ${dim(sanitizeTerminalText(summary).replace(/\s+/gu, ' '))}` })
    }
    return {
      path: ['KUN', 'Subagents'],
      right: `${active} active · ${children.length} total`,
      description: 'Delegated work from the current session.',
      body: [
        { kind: 'field', field: this.search, label: 'Search', focused: true },
        { kind: 'spacer' },
        ...(rows.length ? rows : [{ kind: 'line' as const, text: ` ${dim('No delegated child sessions in this conversation yet.')}` }])
      ],
      footer: [
        { key: 'Enter', label: 'open transcript' },
        { key: 'A', label: 'abort active' },
        { key: 'B', label: 'background active' },
        { key: 'R', label: 'retry finished' },
        { key: 'PgUp/PgDn', label: 'navigate' },
        { key: 'Esc', label: 'back' }
      ]
    }
  }

  private detailView(child: ProjectedChildRun): PageView {
    const label = sanitizeTerminalText(child.label || child.profile || child.childId)
    const running = isActiveChildRun(child)
    const statusKind = child.status === 'completed' ? 'success' : child.status === 'failed' || child.status === 'aborted' ? 'failed' : running ? 'running' : 'idle'
    const status = `${statusGlyph(statusKind, Math.floor(Date.now() / 120))} ${sanitizeTerminalText(child.status)}`
    const metrics = childMetrics(child)
    const transcript: PageTranscript = {
      ...(this.childProjection ? { projection: this.childProjection } : {}),
      showReasoning: this.showReasoning,
      showToolDetails: false,
      reasoningOverrides: this.reasoningOverrides,
      toggleReasoning: (itemId) => {
        const expanded = !(this.reasoningOverrides.get(itemId) ?? this.showReasoning)
        this.reasoningOverrides.set(itemId, expanded)
        this.invalidate()
      },
      scroll: this.scroll,
      ...(this.loading
        ? { placeholder: [` ${statusGlyph('running', Math.floor(Date.now() / 200))} Opening child transcript…`] }
        : this.error
          ? { placeholder: [` ${statusGlyph('failed')} ${sanitizeTerminalText(this.error)}`] }
          : this.childProjection && !this.childProjection.items.length
            ? { placeholder: [dim(' Waiting for the child session to emit output…')] }
            : {})
    }
    const body: PageBlock[] = [
      ...(this.detailOnly ? [] : [{ kind: 'line' as const, text: ` ${dim('Parent')}  ${sanitizeTerminalText(this.parentProjection.thread.title || this.parentProjection.thread.id)}` }]),
      { kind: 'line', text: ` ${dim('Child')}   ${dim(child.childId)}${child.model ? `  ${dim('·')}  ${sanitizeTerminalText(child.model)}` : ''}` },
      { kind: 'line', text: ` ${dim('Status')}  ${status}${metrics ? `  ${dim('·')}  ${dim(metrics)}` : ''}` },
      ...(child.prompt ? [{ kind: 'line' as const, text: ` ${dim('Task')}    ${sanitizeTerminalText(child.prompt).replace(/\s+/gu, ' ')}` }] : []),
      sectionBlock('Transcript'),
      { kind: 'transcript', transcript }
    ]
    const footer: PageAction[] = [
      running ? { key: 'A', label: 'abort' } : { key: 'R', label: 'retry' },
      ...(isForegroundChildRun(child) ? [{ key: 'B', label: 'run in background' }] : []),
      { key: 'Esc', label: this.detailOnly ? 'close' : 'back to list' },
      { key: 'T', label: `${this.showReasoning ? 'collapse' : 'expand'} Thinking` },
      { key: '↑/↓', label: 'scroll' }
    ]
    const connection = this.connection === 'connected'
      ? green('● live')
      : this.connection === 'reconnecting' ? yellow('● reconnecting') : dim(`● ${this.connection}`)
    return {
      path: ['KUN', 'Subagents', label],
      right: `${status} · child session`,
      ...(this.detailOnly ? { frame: 'popup' as const, popupTitle: `Subagent · ${label}` } : {}),
      body,
      status: { left: ` ${connection}`, right: dim(this.scroll.label()) },
      footer
    }
  }

  handleKey(key: TuiKeyEvent): void {
    if (this.selectedChild) {
      this.handleDetailKey(key)
      return
    }
    if (isCancelKey(key)) { this.close(); return }
    const children = this.children()
    const child = children[this.index]
    const next = navigateList(key, this.index, children.length)
    if (next !== undefined) this.index = next
    else if (isKey(key, 'enter') && child) { void this.openChild(child); return }
    else if (letter(key) === 'a' && child && isActiveChildRun(child)) void this.runAction(child, 'abort')
    else if (letter(key) === 'b' && child && isForegroundChildRun(child)) void this.runAction(child, 'background')
    else if (letter(key) === 'r' && child && !isActiveChildRun(child)) void this.runAction(child, 'retry')
    else if (this.search.handleKey(key)) this.index = 0
    else return
    this.invalidate()
  }

  private handleDetailKey(key: TuiKeyEvent): void {
    const child = this.selectedChild!
    if (isCancelKey(key)) {
      if (this.detailOnly) this.close()
      else this.leaveDetail()
      return
    }
    const char = printableText(key)
    if (letter(key) === 't') {
      this.showReasoning = !this.showReasoning
      this.reasoningOverrides.clear()
    } else if (letter(key) === 'a' && isActiveChildRun(child)) { void this.runDetailAction('abort'); return }
    else if (letter(key) === 'b' && isForegroundChildRun(child)) { void this.runDetailAction('background'); return }
    else if (letter(key) === 'r' && !isActiveChildRun(child)) { void this.runDetailAction('retry'); return }
    else if (isKey(key, 'up') || char === 'k') this.scroll.scrollBy(-1)
    else if (isKey(key, 'down') || char === 'j') this.scroll.scrollBy(1)
    else if (isKey(key, 'pageUp', 'ctrl+u')) this.scroll.scrollBy(-this.scroll.page())
    else if (isKey(key, 'pageDown', 'ctrl+d')) this.scroll.scrollBy(this.scroll.page())
    else if (isKey(key, 'home') || char === 'g') this.scroll.scrollTo(0)
    else if (isKey(key, 'end') || char === 'G') this.scroll.scrollTo(this.scroll.maxOffset())
    else return
    this.invalidate()
  }

  handlePaste(text: string): void {
    if (this.selectedChild) return
    this.search.insert(text)
    this.index = 0
    this.invalidate()
  }

  handleMouse(event: PageMouseEvent): void {
    if (this.selectedChild) {
      if (event.type === 'scroll') {
        this.scroll.scrollBy(event.delta)
        this.invalidate()
      }
      return
    }
    const children = this.children()
    if (event.type === 'scroll') this.index = Math.max(0, Math.min(children.length - 1, this.index + event.delta))
    else if (event.activate && event.index === this.index && children[this.index]) { void this.openChild(children[this.index]!); return }
    else this.index = event.index
    this.invalidate()
  }

  async open(child: ProjectedChildRun): Promise<void> {
    await this.openChild(child)
  }

  private async loadChild(childId: string): Promise<ThreadProjection> {
    const client = this.controller.client
    const delegationRequest: Promise<Awaited<ReturnType<KunTuiClient['delegationDiagnostics']>> | undefined> =
      typeof client.delegationDiagnostics === 'function'
        ? client.delegationDiagnostics(childId).catch(() => undefined)
        : Promise.resolve(undefined)
    const [detail, delegation] = await Promise.all([client.getThread(childId), delegationRequest])
    return hydrateProjectedChildRuns(projectThreadSnapshot(detail), delegation)
  }

  private async openChild(child: ProjectedChildRun): Promise<void> {
    this.dispose()
    const generation = this.openGeneration
    this.selectedChild = child
    this.childProjection = undefined
    this.loading = true
    this.error = ''
    this.connection = 'connecting'
    this.scroll.follow = true
    this.reasoningOverrides.clear()
    this.invalidate()
    try {
      let projection: ThreadProjection
      for (;;) {
        try {
          projection = await this.loadChild(child.childId)
          break
        } catch (error) {
          if (generation !== this.openGeneration) return
          const pending = this.selectedChild ? isActiveChildRun(this.selectedChild) : false
          if (!pending || !(error instanceof TuiClientError) || (error.status !== 404 && error.status !== 410)) throw error
          // Child records are published before a queued executor receives a
          // slot and creates its side thread. Keep waiting instead of showing
          // a false permanent failure.
          await new Promise((resolve) => setTimeout(resolve, 300))
        }
      }
      if (generation !== this.openGeneration || this.selectedChild?.childId !== child.childId) return
      this.childProjection = projection
      this.loading = false
      this.invalidate()
      const abort = new AbortController()
      this.detailAbort = abort
      const subscription = this.controller.client.subscribeThreadEvents({
        threadId: child.childId,
        sinceSeq: projection.lastSeq,
        signal: abort.signal,
        onConnection: (connection) => {
          if (this.detailAbort !== abort) return
          this.connection = connection
          this.invalidate()
        },
        onEvent: (event) => {
          if (this.detailAbort !== abort || !this.childProjection) return
          this.childProjection = applyRuntimeEvent(this.childProjection, event)
          this.invalidate()
        },
        onReplayResetRequired: async () => {
          const reloaded = await this.loadChild(child.childId)
          if (this.detailAbort !== abort || abort.signal.aborted) {
            throw new Error('child subscription was replaced during replay recovery')
          }
          this.childProjection = reloaded
          this.invalidate()
          return reloaded.lastSeq
        },
        onError: (error) => {
          if (this.detailAbort !== abort) return
          this.error = safeError(error)
          this.invalidate()
        }
      })
      void subscription.catch((error) => {
        if (this.detailAbort !== abort || abort.signal.aborted) return
        this.error = safeError(error)
        this.connection = 'disconnected'
        this.invalidate()
      })
    } catch (error) {
      if (generation !== this.openGeneration) return
      this.loading = false
      this.connection = 'disconnected'
      this.error = `Unable to open this child session: ${safeError(error)}`
      this.invalidate()
    }
  }

  private leaveDetail(): void {
    this.dispose()
    this.selectedChild = undefined
    this.childProjection = undefined
    this.loading = false
    this.error = ''
    this.connection = 'idle'
    this.scroll.follow = true
    this.invalidate()
  }

  private async runAction(child: ProjectedChildRun, action: 'abort' | 'background' | 'retry'): Promise<void> {
    await this.controller.manageSubagents(`${action} ${child.childId}`)
    this.invalidate()
  }

  private async runDetailAction(action: 'abort' | 'background' | 'retry'): Promise<void> {
    const child = this.selectedChild
    if (!child) return
    await this.controller.manageSubagents(`${action} ${child.childId}`)
    if (action === 'abort') this.selectedChild = { ...child, status: 'aborted', updatedAt: new Date().toISOString() }
    else if (action === 'background') this.selectedChild = { ...child, detached: true, updatedAt: new Date().toISOString() }
    this.invalidate()
  }
}
