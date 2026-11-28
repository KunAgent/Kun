import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { foldedRanges, syntaxTree } from '@codemirror/language'
import { markdown as cmMarkdown, markdownLanguage as cmMarkdownLang } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, Prec, StateEffect, Transaction, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, placeholder, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type {
  DailyNoteLinkSummary,
  DailyNotesApi,
  DailyNoteTargetThread
} from '@shared/daily-notes'
import type { DailyNotesCopy } from './copy'
import { MentionPopover, type MentionTriggerState } from './mention-menu'
import {
  dailyNoteFoldingExtension,
  isTaskSubtreeFolded,
  OutlinerBulletWidget,
  type OutlinerFoldCallbacks
} from './outliner-fold'
import {
  cycleDailyNoteTodo,
  handleDailyNoteEnter,
  indentDailyNoteLine,
  moveDailyNoteBlock,
  outdentDailyNoteLine
} from './outliner-keymap'
import {
  applyNoteChange, formatKunThreadUrl, linkChange, parseTasks, QUADRANT_NUMERALS,
  setDailyNoteTaskQuadrantChange, toggleDailyNoteTaskChange,
  type NoteTask, type Quadrant
} from './tasks'

const refreshLinksEffect = StateEffect.define<null>()

type EditorCallbacks = {
  copy: DailyNotesCopy
  summaries: Readonly<Record<string, DailyNoteLinkSummary>>
  canSend: boolean
  canStartSession: boolean
  canZoom: boolean
  onSendLine: (line: number, draftOnly: boolean) => void
  onStartSessionLine?: (line: number) => void
  onZoomLine?: (line: number) => void
  onZoomOut?: () => void
  onOpenLink: (url: string) => void
}

class TaskCheckbox extends WidgetType {
  constructor(readonly checked: boolean, readonly markerOffset: number, readonly label: string) { super() }

  eq(other: TaskCheckbox): boolean {
    return this.checked === other.checked && this.markerOffset === other.markerOffset && this.label === other.label
  }

  toDOM(view: EditorView): HTMLInputElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'note-checkbox'
    box.checked = this.checked
    box.setAttribute('aria-label', this.label)
    box.addEventListener('change', () => {
      const marker = view.posAtDOM(box) + this.markerOffset
      view.dispatch({ changes: { from: marker + 1, to: marker + 2, insert: box.checked ? 'x' : ' ' }, userEvent: 'input' })
    })
    return box
  }
}

class QuadrantChip extends WidgetType {
  constructor(readonly quadrant: Quadrant, readonly label: string) { super() }
  eq(other: QuadrantChip): boolean { return this.quadrant === other.quadrant && this.label === other.label }
  toDOM(view: EditorView): HTMLElement {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = `note-quadrant note-q${this.quadrant}`
    chip.textContent = QUADRANT_NUMERALS[this.quadrant]
    chip.title = this.label
    chip.setAttribute('aria-label', this.label)
    chip.addEventListener('mousedown', event => {
      event.preventDefault()
      const pos = view.posAtDOM(chip)
      const docLine = view.state.doc.lineAt(pos)
      const parsed = parseTasks(docLine.text)[0]
      if (!parsed) return
      const next = this.quadrant < 4 ? (this.quadrant + 1) as Quadrant : null
      const change = setDailyNoteTaskQuadrantChange(parsed, next)
      view.dispatch({
        changes: { from: docLine.from + change.from, to: docLine.from + change.to, insert: change.insert },
        userEvent: 'input'
      })
    })
    return chip
  }
  ignoreEvent(): boolean { return true }
}

class TaskLinkWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly text: string,
    readonly tone: string,
    readonly detail: string,
    readonly showCheck: boolean,
    readonly taskLabel: string,
    readonly completeLabel: string,
    readonly unlinkLabel: string,
    readonly onOpen: (url: string) => void
  ) { super() }

  eq(other: TaskLinkWidget): boolean {
    return this.url === other.url && this.text === other.text &&
      this.tone === other.tone && this.detail === other.detail &&
      this.showCheck === other.showCheck && this.taskLabel === other.taskLabel
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'note-editor-link'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `note-link-pill is-${this.tone}`
    button.title = this.detail ? `${this.text} — ${this.detail}` : this.text
    button.setAttribute('aria-label', button.title)
    const dot = document.createElement('i')
    dot.setAttribute('aria-hidden', 'true')
    const span = document.createElement('span')
    span.textContent = this.text
    button.append(dot, span)
    button.addEventListener('mousedown', event => {
      event.preventDefault()
      this.onOpen(this.url)
    })
    wrap.append(button)

    if (this.showCheck) {
      const check = document.createElement('button')
      check.type = 'button'
      check.className = 'note-complete-pill'
      check.title = this.completeLabel
      check.setAttribute('aria-label', `${this.taskLabel}: ${this.completeLabel}`)
      check.textContent = '✓'
      check.addEventListener('mousedown', event => {
        event.preventDefault()
        const pos = view.posAtDOM(wrap)
        const docLine = view.state.doc.lineAt(pos)
        const parsed = parseTasks(docLine.text)[0]
        if (!parsed || parsed.done) return
        const change = toggleDailyNoteTaskChange(parsed, true)
        view.dispatch({
          changes: { from: docLine.from + change.from, to: docLine.from + change.to, insert: change.insert },
          userEvent: 'input'
        })
      })
      wrap.append(check)
    }

    const unlink = document.createElement('button')
    unlink.type = 'button'
    unlink.className = 'note-unlink-inline'
    unlink.title = this.unlinkLabel
    unlink.setAttribute('aria-label', `${this.taskLabel}: ${this.unlinkLabel}`)
    unlink.textContent = '×'
    unlink.addEventListener('mousedown', event => {
      event.preventDefault()
      const pos = view.posAtDOM(wrap)
      const docLine = view.state.doc.lineAt(pos)
      const parsed = parseTasks(docLine.text)[0]
      if (!parsed || !parsed.link) return
      const change = linkChange(parsed, null)
      view.dispatch({
        changes: { from: docLine.from + change.from, to: docLine.from + change.to, insert: change.insert },
        userEvent: 'input'
      })
    })
    wrap.append(unlink)
    return wrap
  }
  ignoreEvent(): boolean { return true }
}

class InlineTaskActionsWidget extends WidgetType {
  constructor(
    readonly taskLabel: string,
    readonly sendLabel: string,
    readonly startLabel: string,
    readonly canSend: boolean,
    readonly canStartSession: boolean,
    readonly onSend: (line: number, draftOnly: boolean) => void,
    readonly onStartSession?: (line: number) => void
  ) {
    super()
  }
  eq(other: InlineTaskActionsWidget): boolean {
    return this.taskLabel === other.taskLabel && this.sendLabel === other.sendLabel &&
      this.startLabel === other.startLabel && this.canSend === other.canSend &&
      this.canStartSession === other.canStartSession
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'note-inline-actions'

    if (this.canStartSession && this.onStartSession) {
      const startBtn = document.createElement('button')
      startBtn.type = 'button'
      startBtn.className = 'note-start-session is-inline'
      startBtn.textContent = '▶'
      startBtn.title = this.startLabel
      startBtn.setAttribute('aria-label', `${this.taskLabel}: ${this.startLabel}`)
      startBtn.addEventListener('mousedown', event => {
        event.preventDefault()
        const pos = view.posAtDOM(wrap)
        const lineIndex = view.state.doc.lineAt(pos).number - 1
        this.onStartSession?.(lineIndex)
      })
      wrap.append(startBtn)
    }

    if (this.canSend) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'note-send-kun is-inline'
      btn.textContent = this.sendLabel
      btn.title = this.sendLabel
      btn.setAttribute('aria-label', `${this.taskLabel}: ${this.sendLabel}`)
      btn.addEventListener('mousedown', event => {
        event.preventDefault()
        const pos = view.posAtDOM(wrap)
        const lineIndex = view.state.doc.lineAt(pos).number - 1
        this.onSend(lineIndex, event.altKey)
      })
      wrap.append(btn)
    }
    return wrap
  }
  ignoreEvent(): boolean { return true }
}

function decorateLineTask(
  view: EditorView,
  ranges: Range<Decoration>[],
  lineFrom: number,
  markerFrom: number,
  markerTo: number,
  markerOffset: number,
  parsed: NoteTask,
  callbacks: RefObject<EditorCallbacks>
): void {
  const { copy, summaries, canSend, canStartSession, canZoom, onSendLine, onStartSessionLine, onZoomLine, onOpenLink } = callbacks.current
  const rel = (pos: number): number => lineFrom + (pos - parsed.lineFrom)
  const bulletStart = markerFrom - markerOffset
  const hasChildren = parsed.subLineCount > 0
  const folded = hasChildren && isTaskSubtreeFolded(view.state, parsed)
  const taskLabel = parsed.text || copy.task

  if (hasChildren || (canZoom && onZoomLine)) {
    const bulletWidget = new OutlinerBulletWidget(
      hasChildren,
      folded,
      parsed.subLineCount,
      taskLabel,
      copy.zoomIn,
      folded ? copy.unfoldSubnotes : copy.foldSubnotes,
      Boolean(canZoom && onZoomLine),
      onZoomLine
    )
    ranges.push(Decoration.widget({ widget: bulletWidget, side: -1 }).range(bulletStart))
  }

  const widget = new TaskCheckbox(parsed.done, markerOffset, taskLabel)
  ranges.push(Decoration.replace({ widget }).range(bulletStart, markerTo))

  const textEnd = rel(parsed.metaFrom)
  if (parsed.done && markerTo < textEnd) {
    ranges.push(Decoration.mark({ class: 'note-completed' }).range(markerTo, textEnd))
  }

  const metaDecorations: Array<{ from: number; to: number; decoration: Decoration }> = []
  if (parsed.link && parsed.linkRange) {
    const summary = summaries[parsed.link.url]
    const linkWidget = new TaskLinkWidget(
      parsed.link.url,
      summary?.statusText || parsed.link.label,
      summary?.tone ?? 'idle',
      summary?.detail ?? '',
      Boolean(!parsed.done && summary?.canMarkDone),
      taskLabel,
      copy.completeTodo,
      copy.unlinkSession,
      onOpenLink
    )
    metaDecorations.push({
      from: rel(parsed.linkRange.from),
      to: rel(parsed.linkRange.to),
      decoration: Decoration.replace({ widget: linkWidget })
    })
  }
  if (parsed.quadrant && parsed.quadrantRange) {
    const chip = new QuadrantChip(parsed.quadrant, copy[`q${parsed.quadrant}` as const])
    metaDecorations.push({
      from: rel(parsed.quadrantRange.from),
      to: rel(parsed.quadrantRange.to),
      decoration: Decoration.replace({ widget: chip })
    })
  }
  metaDecorations.sort((a, b) => a.from - b.from)
  for (const item of metaDecorations) {
    ranges.push(item.decoration.range(item.from, item.to))
  }

  if (!parsed.link && !parsed.done && parsed.text.length > 0 && (canSend || canStartSession)) {
    const actionsWidget = new InlineTaskActionsWidget(
      parsed.text,
      copy.sendToKun,
      copy.startSession,
      canSend,
      canStartSession,
      onSendLine,
      onStartSessionLine
    )
    ranges.push(Decoration.widget({ widget: actionsWidget, side: 1 }).range(rel(parsed.end)))
  }
}

function taskDecorations(view: EditorView, callbacks: RefObject<EditorCallbacks>): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const tasksByLine = new Map(parseTasks(view.state.doc.toString()).map(task => [task.line, task]))
  for (const visible of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      ...visible,
      enter({ name, from, to }) {
        if (name !== 'TaskMarker') return
        const line = view.state.doc.lineAt(from)
        const prefix = view.state.doc.sliceString(line.from, from)
        const markerOffset = /[-+*]\s+$/.exec(prefix)?.[0].length ?? 0
        const parsed = tasksByLine.get(line.number - 1)
        if (!parsed) return
        decorateLineTask(view, ranges, line.from, from, to, markerOffset, parsed, callbacks)
      }
    })
  }
  return Decoration.set(ranges, true)
}

function markdownTasks(callbacks: RefObject<EditorCallbacks>) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = taskDecorations(view, callbacks) }
    update(update: ViewUpdate): void {
      const refreshed = update.transactions.some(tr => tr.effects.some(e => e.is(refreshLinksEffect)))
      const foldChanged = foldedRanges(update.startState) !== foldedRanges(update.state)
      if (refreshed || foldChanged || update.docChanged || update.viewportChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = taskDecorations(update.view, callbacks)
      }
    }
  }, { decorations: plugin => plugin.decorations })
}

class LineHint extends WidgetType {
  constructor(readonly text: string) { super() }
  eq(other: LineHint): boolean { return this.text === other.text }
  toDOM(): HTMLElement {
    const hint = document.createElement('span')
    hint.className = 'note-line-hint'
    hint.setAttribute('aria-hidden', 'true')
    hint.textContent = this.text
    return hint
  }
  ignoreEvent(): boolean { return false }
}

function lineHints(text: string) {
  const hintAt = (view: EditorView): DecorationSet => {
    const { state } = view
    const head = state.selection.main
    if (!view.hasFocus || !head.empty || state.doc.length === 0) return Decoration.none
    const line = state.doc.lineAt(head.head)
    if (line.length) return Decoration.none
    return Decoration.set([Decoration.widget({ widget: new LineHint(text), side: 1 }).range(line.from)])
  }
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = hintAt(view) }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.focusChanged) this.decorations = hintAt(update.view)
    }
  }, { decorations: plugin => plugin.decorations })
}

const taskShortcut = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== ']' && text !== '】') return false
  const line = view.state.doc.lineAt(from)
  const before = /^(\s*)[[【]$/.exec(view.state.doc.sliceString(line.from, from))
  if (!before) return false
  const start = line.from + before[1].length
  const insert = '- [ ] '
  view.dispatch({ changes: { from: start, to, insert }, selection: { anchor: start + insert.length }, userEvent: 'input' })
  return true
})

export function insertDailyTask(view: EditorView): void {
  const end = view.state.doc.length
  const insert = (view.state.doc.lineAt(end).length ? '\n' : '') + '- [ ] '
  view.dispatch({ changes: { from: end, insert }, selection: { anchor: end + insert.length }, scrollIntoView: true, userEvent: 'input' })
  view.focus()
}

function lineHintText(template: string): string {
  const mac = navigator.userAgent.includes('Macintosh')
  return template.replace('{{toggle}}', mac ? '\u2318\u21b5' : 'Ctrl+Enter')
}

function detectMention(view: EditorView, host: HTMLElement | null): MentionTriggerState | null {
  if (!host || !view.hasFocus || view.composing) return null
  const main = view.state.selection.main
  if (!main.empty) return null
  const line = view.state.doc.lineAt(main.head)
  const before = view.state.doc.sliceString(line.from, main.head)
  const match = /(?:^|\s)([@＠]([^\s@＠[\]()]{0,36}))$/.exec(before)
  if (!match) return null
  const token = match[1]
  const atFrom = main.head - token.length
  const coords = view.coordsAtPos(atFrom)
  const hostRect = host.getBoundingClientRect()
  if (!coords) return null
  return {
    lineNumber: line.number,
    atFrom,
    atTo: main.head,
    query: match[2] ?? '',
    top: coords.bottom - hostRect.top + 4,
    left: Math.max(0, Math.min(hostRect.width - 240, coords.left - hostRect.left))
  }
}

type EditorProps = {
  day: string
  value: string
  copy: DailyNotesCopy
  summaries: Readonly<Record<string, DailyNoteLinkSummary>>
  canSend: boolean
  canStartSession?: boolean
  canZoom?: boolean
  placeholderText?: string
  ariaLabel?: string
  api?: DailyNotesApi
  viewRef: RefObject<EditorView | null>
  onEdit: (day: string, text: string) => void
  onSendLine: (line: number, draftOnly: boolean) => void
  onStartSessionLine?: (line: number) => void
  onZoomLine?: (line: number) => void
  onZoomOut?: () => void
  onOpenLink: (url: string) => void
}

export function NoteEditor({
  day,
  value,
  copy,
  summaries,
  canSend,
  canStartSession = false,
  canZoom = true,
  placeholderText,
  ariaLabel,
  api,
  viewRef,
  onEdit,
  onSendLine,
  onStartSessionLine,
  onZoomLine,
  onZoomOut,
  onOpenLink
}: EditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const startDoc = useRef(value)
  startDoc.current = value
  const syncingExternal = useRef(false)
  const [mention, setMention] = useState<MentionTriggerState | null>(null)
  const [threads, setThreads] = useState<DailyNoteTargetThread[]>([])

  const callbacks = useRef<EditorCallbacks>({
    copy, summaries, canSend, canStartSession, canZoom,
    onSendLine, onStartSessionLine, onZoomLine, onZoomOut, onOpenLink
  })
  callbacks.current = {
    copy, summaries, canSend, canStartSession, canZoom,
    onSendLine, onStartSessionLine, onZoomLine, onZoomOut, onOpenLink
  }

  const foldCallbacks = useRef<OutlinerFoldCallbacks>({ copy, onZoomTask: onZoomLine })
  foldCallbacks.current = { copy, onZoomTask: onZoomLine }

  const mentionActive = Boolean(mention)
  useEffect(() => {
    if (!mentionActive || !api?.listTargets) return
    let cancelled = false
    void api.listTargets().then(snapshot => {
      if (!cancelled && snapshot) setThreads(snapshot.threads)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [api, mentionActive])

  const applyMentionSelection = useCallback((thread: DailyNoteTargetThread): void => {
    const view = viewRef.current
    if (!view || !mention) return
    const line = view.state.doc.line(mention.lineNumber)
    const stripped = (
      view.state.doc.sliceString(line.from, mention.atFrom) +
      view.state.doc.sliceString(mention.atTo, line.to)
    ).replace(/\s+$/, '')

    const label = (thread.title || copy.threadBadge).slice(0, 24)
    const url = formatKunThreadUrl(thread.id)
    const parsed = parseTasks(stripped)[0]

    let nextLineText: string
    if (parsed) {
      let baseLine = stripped
      if (!parsed.text && thread.title.trim()) {
        const prefixEnd = parsed.bodyFrom
        baseLine = stripped.slice(0, prefixEnd) + ' ' + thread.title.trim() + stripped.slice(parsed.metaFrom)
      }
      const reparsed = parseTasks(baseLine)[0]!
      nextLineText = applyNoteChange(baseLine, linkChange(reparsed, { label, url }))
    } else {
      const indent = /^\s*/.exec(stripped)![0]
      const body = stripped.trim().replace(/^[-+*]\s*/, '') || thread.title.trim() || copy.task
      nextLineText = `${indent}- [ ] ${body} [${label}](${url})`
    }

    setMention(null)
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: nextLineText },
      selection: EditorSelection.cursor(line.from + nextLineText.length),
      userEvent: 'input'
    })
    view.focus()
  }, [copy.task, copy.threadBadge, mention, viewRef])

  useLayoutEffect(() => {
    const outlinerKeys = Prec.high(keymap.of([
      { key: 'Mod-Enter', run: cycleDailyNoteTodo },
      { key: 'Enter', run: handleDailyNoteEnter },
      { key: 'Tab', run: indentDailyNoteLine },
      { key: 'Shift-Tab', run: outdentDailyNoteLine },
      { key: 'Mod-Shift-ArrowUp', run: view => moveDailyNoteBlock(view, -1) },
      { key: 'Mod-Shift-ArrowDown', run: view => moveDailyNoteBlock(view, 1) },
      {
        key: 'Alt-ArrowRight',
        run: view => {
          const cb = callbacks.current
          if (!cb.canZoom || !cb.onZoomLine) return false
          const line = view.state.doc.lineAt(view.state.selection.main.head)
          if (!parseTasks(line.text)[0]) return false
          cb.onZoomLine(line.number - 1)
          return true
        }
      },
      {
        key: 'Alt-ArrowLeft',
        run: () => {
          const cb = callbacks.current
          if (!cb.onZoomOut) return false
          cb.onZoomOut()
          return true
        }
      }
    ]))

    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: startDoc.current,
        extensions: [
          cmMarkdown({ base: cmMarkdownLang }),
          dailyNoteFoldingExtension(foldCallbacks),
          markdownTasks(callbacks),
          history(),
          taskShortcut,
          outlinerKeys,
          keymap.of([...historyKeymap, ...defaultKeymap]),
          EditorView.lineWrapping,
          placeholder(placeholderText ?? copy.placeholder),
          lineHints(lineHintText(copy.lineHint)),
          EditorView.contentAttributes.of({
            role: 'textbox',
            'aria-label': ariaLabel ?? copy.title,
            'aria-multiline': 'true'
          }),
          EditorView.updateListener.of(update => {
            if (update.docChanged && !syncingExternal.current) {
              onEdit(day, update.state.doc.toString())
            }
            if (api?.listTargets && (update.docChanged || update.selectionSet || update.focusChanged)) {
              setMention(detectMention(update.view, host.current))
            }
          })
        ]
      })
    })
    viewRef.current = view
    view.focus()
    return () => { viewRef.current = null; view.destroy() }
  }, [api, ariaLabel, copy, day, onEdit, placeholderText, viewRef])

  // Apply external mutations (e.g. Xiao Kun binding a link or adding a task) without resetting the editor.
  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    const head = Math.min(view.state.selection.main.head, value.length)
    syncingExternal.current = true
    try {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        selection: { anchor: head },
        annotations: Transaction.addToHistory.of(false)
      })
    } finally {
      syncingExternal.current = false
    }
  }, [value, viewRef])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshLinksEffect.of(null) })
  }, [summaries, canSend, canStartSession, viewRef])

  return (
    <div className="note-editor" ref={host}>
      {mention && api?.listTargets && (
        <MentionPopover
          state={mention}
          threads={threads}
          copy={copy}
          onSelect={applyMentionSelection}
          onClose={() => setMention(null)}
        />
      )}
    </div>
  )
}
