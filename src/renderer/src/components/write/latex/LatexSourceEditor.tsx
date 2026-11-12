import { useEffect, useRef, type ReactElement } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, drawSelection, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, foldGutter } from '@codemirror/language'
import { linter, lintGutter } from '@codemirror/lint'
import type { LatexDiagnostic } from '@shared/latex-project'
import { latexSyntax } from './latex-syntax'
import { latexCompletion } from './latex-completion'
import { selectionState } from '../write-markdown-editor-support'
import type { WriteEditorSelectionState } from '../WriteMarkdownEditor'

export type LatexSourceHandle = { insert: (text: string) => void; cursor: () => { line: number; column: number } }
type Props = {
  sessionKey: string; file: string; value: string; readOnly: boolean; diagnostics: LatexDiagnostic[]
  jump: { file: string; line: number; token: number } | null
  onChange: (content: string) => void; onSave: () => void
  onSelection: (selection: WriteEditorSelectionState, cursor: { line: number; column: number }) => void
  handleRef: React.MutableRefObject<LatexSourceHandle | null>
}

export function LatexSourceEditor(props: Props): ReactElement {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorView | null>(null)
  const latest = useRef(props)
  latest.current = props
  const states = useRef(new Map<string, { state: EditorState; scrollTop: number }>())
  const compartments = useRef({ readOnly: new Compartment(), diagnostics: new Compartment() })
  const diagnostics = () => linter((view) => latest.current.diagnostics.filter((d) => d.line && d.file?.replace(/^\.\//, '') === latest.current.file)
    .map((d) => {
      const line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, d.line!)))
      return { from: line.from, to: line.to, severity: d.level, message: d.message }
    }))
  useEffect(() => {
    if (!host.current) return
    const initial = latest.current
    const file = initial.file
    const handleRef = initial.handleRef
    const editorStates = states.current
    const saved = editorStates.get(file)
    const notify = (view: EditorView): void => {
      const line = view.state.doc.lineAt(view.state.selection.main.head)
      latest.current.onSelection(selectionState(view), { line: line.number, column: view.state.selection.main.head - line.from + 1 })
    }
    const state = saved?.state.doc.toString() === initial.value ? saved.state : EditorState.create({ doc: initial.value, extensions: [
      history(), drawSelection(), lineNumbers(), highlightActiveLine(), bracketMatching(), foldGutter(), lintGutter(), latexSyntax,
      latexCompletion(props.sessionKey), EditorView.lineWrapping,
      compartments.current.readOnly.of(EditorState.readOnly.of(initial.readOnly)), compartments.current.diagnostics.of(diagnostics()),
      keymap.of([{ key: 'Mod-s', run: () => { latest.current.onSave(); return true } }, indentWithTab, ...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) latest.current.onChange(update.state.doc.toString())
        if (update.docChanged || update.selectionSet) notify(update.view)
      }),
      EditorView.theme({
        '&': { height: '100%', fontSize: '13px', color: 'var(--ds-text)', backgroundColor: 'transparent' },
        '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '1.85' },
        '.cm-content': { padding: '24px 18px 64px 8px', caretColor: 'var(--ds-text)' },
        '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--ds-text-faint, #9a9ca1)', border: 'none', padding: '0 6px 0 8px' },
        '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--ds-text) 3%, transparent)' },
        '.cm-activeLineGutter': { backgroundColor: 'transparent' },
        '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, #5b78ff 20%, transparent)' },
        '.cm-tooltip': { backgroundColor: 'var(--ds-surface-card)', color: 'var(--ds-text)', border: '1px solid var(--ds-border)', borderRadius: '10px', overflow: 'hidden' }
      })
    ] })
    const view = new EditorView({ parent: host.current, state })
    editor.current = view
    if (saved) view.scrollDOM.scrollTop = saved.scrollTop
    handleRef.current = {
      insert: (text) => { if (view.state.readOnly) return; const range = view.state.selection.main; view.dispatch({ changes: { from: range.from, to: range.to, insert: text }, selection: { anchor: range.from + text.length } }); view.focus() },
      cursor: () => { const line = view.state.doc.lineAt(view.state.selection.main.head); return { line: line.number, column: view.state.selection.main.head - line.from + 1 } }
    }
    notify(view)
    return () => {
      editorStates.set(file, { state: view.state, scrollTop: view.scrollDOM.scrollTop })
      view.destroy(); editor.current = null; handleRef.current = null
    }
  }, [props.sessionKey, props.file, props.handleRef])
  useEffect(() => {
    const view = editor.current
    if (view && view.state.doc.toString() !== props.value) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.value } })
  }, [props.value])
  useEffect(() => {
    editor.current?.dispatch({ effects: [compartments.current.readOnly.reconfigure(EditorState.readOnly.of(props.readOnly)), compartments.current.diagnostics.reconfigure(diagnostics())] })
  }, [props.readOnly, props.diagnostics, props.file])
  useEffect(() => {
    const view = editor.current
    if (!view || props.jump?.file !== props.file) return
    const line = view.state.doc.line(Math.min(view.state.doc.lines, Math.max(1, props.jump.line)))
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) }); view.focus()
  }, [props.jump, props.file])
  return <div ref={host} className="latex-source-editor min-h-0 min-w-0 flex-1" data-latex-source={props.file} />
}
