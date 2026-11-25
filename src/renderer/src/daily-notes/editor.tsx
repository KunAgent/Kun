import { useLayoutEffect, useRef, type RefObject } from 'react'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, placeholder, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { DailyNotesCopy } from './copy'

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

function taskDecorations(view: EditorView, label: string): DecorationSet {
  const ranges: Range<Decoration>[] = []
  for (const visible of view.visibleRanges) {
    syntaxTree(view.state).iterate({ ...visible, enter({ name, from, to }) {
      if (name !== 'TaskMarker') return
      const line = view.state.doc.lineAt(from)
      const prefix = view.state.doc.sliceString(line.from, from)
      const markerOffset = /[-+*]\s+$/.exec(prefix)?.[0].length ?? 0
      const checked = view.state.doc.sliceString(from + 1, to - 1).toLowerCase() === 'x'
      const text = view.state.doc.sliceString(to, line.to).trim()
      const widget = new TaskCheckbox(checked, markerOffset, text || label)
      ranges.push(Decoration.replace({ widget }).range(from - markerOffset, to))
      if (checked && to < line.to) ranges.push(Decoration.mark({ class: 'note-completed' }).range(to, line.to))
    } })
  }
  return Decoration.set(ranges, true)
}

function markdownTasks(label: string) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = taskDecorations(view, label) }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = taskDecorations(update.view, label)
      }
    }
  }, { decorations: plugin => plugin.decorations })
}

export function insertDailyTask(view: EditorView): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const insert = (line.length ? '\n' : '') + '- [ ] '
  view.dispatch({ changes: { from: line.to, insert }, selection: { anchor: line.to + insert.length }, scrollIntoView: true })
  view.focus()
}

type EditorProps = {
  day: string
  initialText: string
  copy: DailyNotesCopy
  viewRef: RefObject<EditorView | null>
  onEdit: (day: string, text: string) => void
}

export function NoteEditor({ day, initialText, copy, viewRef, onEdit }: EditorProps) {
  const host = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({ doc: initialText, extensions: [
        markdown({ base: markdownLanguage }), markdownTasks(copy.task), history(),
        keymap.of([...historyKeymap, ...defaultKeymap]), EditorView.lineWrapping,
        placeholder(copy.placeholder),
        EditorView.contentAttributes.of({ role: 'textbox', 'aria-label': copy.title, 'aria-multiline': 'true' }),
        EditorView.updateListener.of(update => {
          if (update.docChanged) onEdit(day, update.state.doc.toString())
        })
      ] })
    })
    viewRef.current = view
    view.focus()
    return () => { viewRef.current = null; view.destroy() }
  }, [copy, day, initialText, onEdit, viewRef])
  return <div className="note-editor" ref={host} />
}
