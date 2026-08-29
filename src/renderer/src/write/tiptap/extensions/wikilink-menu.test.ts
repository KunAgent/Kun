// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import {
  WriteRichWikilinkMenu,
  acceptRichWikilinkMenu,
  closeRichWikilinkMenu,
  moveRichWikilinkSelection,
  richWikilinkMenuRows,
  richWikilinkMenuSelectedIndex,
  richWikilinkMenuVisible,
  setRichWikilinkTargets
} from './wikilink-menu'
import { WriteWikilink } from './wikilink-mark'
import type { WikilinkTarget } from '../../wikilink/wikilink-targets'

const VAULT = '/vault'
const OTHER = '/wp'

function target(relativePath: string, root = VAULT, name = 'vault'): WikilinkTarget {
  return {
    workspaceRoot: root,
    workspaceName: name,
    relativePath,
    name: relativePath.slice(relativePath.lastIndexOf('/') + 1)
  }
}

const TARGETS = [
  target('index.md'),
  target('notes/alpha.md'),
  target('notes/beta.md'),
  target('docs/spec.md', OTHER, 'wp')
]

let editors: Editor[] = []

function mount(options: {
  activePath?: string
  targets?: readonly WikilinkTarget[]
  onRequestTargets?: () => void
  emptyStateText?: (hasTargets: boolean) => string | null
  readOnly?: boolean
} = {}): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    // A minimal schema: the menu only needs a text block, and StarterKit would
    // drag in history and list handling this test does not exercise.
    extensions: [
      Document,
      Paragraph,
      Text,
      WriteRichWikilinkMenu.configure({
        workspaceRoot: () => VAULT,
        activePath: () => options.activePath ?? 'notes/alpha.md',
        isReadOnly: () => options.readOnly ?? false,
        ...(options.onRequestTargets ? { onRequestTargets: options.onRequestTargets } : {}),
        ...(options.emptyStateText ? { emptyStateText: options.emptyStateText } : {})
      })
    ],
    content: ''
  })
  editors.push(editor)
  setRichWikilinkTargets(editor.view, options.targets ?? TARGETS)
  return editor
}

/** Like `mount`, but with the schema-level wikilink mark registered. */
function mountWithWikilinkMark(): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: [
      Document,
      Paragraph,
      Text,
      WriteWikilink,
      WriteRichWikilinkMenu.configure({
        workspaceRoot: () => VAULT,
        activePath: () => 'notes/alpha.md',
        isReadOnly: () => false
      })
    ],
    content: ''
  })
  editors.push(editor)
  setRichWikilinkTargets(editor.view, TARGETS)
  return editor
}

/** Types at the end of the document, the way a caret actually moves. */
function type(editor: Editor, text: string): void {
  const end = editor.state.doc.content.size
  const transaction = editor.state.tr.insertText(text, end - 1, end - 1)
  editor.view.dispatch(transaction)
}

function text(editor: Editor): string {
  return editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n')
}

afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors = []
  document.body.replaceChildren()
})

/** Sends a real keydown through the editor so the shortcuts are exercised. */
function press(editor: Editor, key: string, code = key): boolean {
  return editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true })
  )
}

describe('rich-text wikilink menu', () => {
  it('stays closed until the brackets are typed', () => {
    const editor = mount()
    type(editor, 'see ')
    expect(richWikilinkMenuRows(editor.view)).toEqual([])
  })

  it('opens on `[[` and offers every other file', () => {
    const editor = mount()
    type(editor, '[[')
    expect(richWikilinkMenuRows(editor.view).map((row) => row.relativePath))
      .toEqual(['index.md', 'notes/beta.md', 'docs/spec.md'])
  })

  it('narrows as the query is typed', () => {
    const editor = mount()
    type(editor, '[[bet')
    expect(richWikilinkMenuRows(editor.view).map((row) => row.relativePath))
      .toEqual(['notes/beta.md'])
  })

  it('offers files from other workspaces, flagged as external', () => {
    const editor = mount()
    type(editor, '[[spec')
    const rows = richWikilinkMenuRows(editor.view)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.external).toBe(true)
  })

  it('inserts a relative link and closes the brackets', () => {
    const editor = mount()
    type(editor, 'see [[bet')
    expect(acceptRichWikilinkMenu(editor.view)).toBe(true)
    expect(text(editor)).toBe('see [[beta]]')
    expect(richWikilinkMenuRows(editor.view)).toEqual([])
  })

  it('applies the wikilink mark to the whole inserted reference', () => {
    const editor = mountWithWikilinkMark()
    type(editor, 'see [[bet')
    acceptRichWikilinkMenu(editor.view)
    expect(text(editor)).toBe('see [[beta]]')
    // `[[beta]]` — brackets included — carries the mark; the prose before it
    // does not. Serialization is what depends on this: marked text is written
    // verbatim, unmarked brackets get escaped.
    const paragraph = editor.state.doc.child(0)
    const pieces: { text: string; marked: boolean }[] = []
    paragraph.forEach((node) => {
      pieces.push({
        text: node.text ?? '',
        marked: node.marks.some((mark) => mark.type.name === 'wikilink')
      })
    })
    expect(pieces).toEqual([
      { text: 'see ', marked: false },
      { text: '[[beta]]', marked: true }
    ])
  })

  it('lands the caret after the closing brackets', () => {
    const editor = mount()
    type(editor, '[[bet')
    acceptRichWikilinkMenu(editor.view)
    // Document positions are 1-based inside the paragraph node.
    expect(editor.state.selection.from).toBe('[[beta]]'.length + 1)
  })

  it('walks up out of a subdirectory', () => {
    const editor = mount({ activePath: 'notes/alpha.md' })
    type(editor, '[[ind')
    acceptRichWikilinkMenu(editor.view)
    expect(text(editor)).toBe('[[../index]]')
  })

  it('reaches across workspaces', () => {
    const editor = mount({ activePath: 'index.md' })
    type(editor, '[[spec')
    acceptRichWikilinkMenu(editor.view)
    expect(text(editor)).toBe('[[../wp/docs/spec]]')
  })

  it('does not double the closing brackets when they already exist', () => {
    const editor = mount()
    type(editor, '[[bet]]')
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(6)))
    )
    expect(acceptRichWikilinkMenu(editor.view)).toBe(true)
    expect(text(editor)).toBe('[[beta]]')
  })

  it('moves the selection and wraps at both ends', () => {
    const editor = mount()
    type(editor, '[[')
    expect(richWikilinkMenuSelectedIndex(editor.view)).toBe(0)
    moveRichWikilinkSelection(1)(editor.view)
    expect(richWikilinkMenuSelectedIndex(editor.view)).toBe(1)
    moveRichWikilinkSelection(-1)(editor.view)
    moveRichWikilinkSelection(-1)(editor.view)
    expect(richWikilinkMenuSelectedIndex(editor.view)).toBe(2)
  })

  it('accepts whichever row is selected', () => {
    const editor = mount()
    type(editor, '[[')
    moveRichWikilinkSelection(1)(editor.view)
    acceptRichWikilinkMenu(editor.view)
    expect(text(editor)).toBe('[[beta]]')
  })

  it('is positioned and populated as soon as it opens', () => {
    const editor = mount()
    type(editor, '[[')
    const host = document.querySelector<HTMLElement>('.write-wikilink-menu')
    expect(host?.style.display).toBe('block')
    expect(host?.style.left).not.toBe('')
    expect(host?.style.top).not.toBe('')
    expect(host?.querySelectorAll('.write-wikilink-row').length)
      .toBe(richWikilinkMenuRows(editor.view).length)
  })

  it('stays visible with an explanation when nothing matches', () => {
    const editor = mount({ emptyStateText: () => 'No markdown file matches' })
    type(editor, '[[zzzz')
    expect(richWikilinkMenuVisible(editor.view)).toBe(true)
    expect(document.querySelector('.write-wikilink-empty')?.textContent)
      .toBe('No markdown file matches')
  })

  it('leaves Enter alone when there is nothing to accept', () => {
    const editor = mount({ emptyStateText: () => 'nothing' })
    type(editor, '[[zzzz')
    expect(acceptRichWikilinkMenu(editor.view)).toBe(false)
    expect(moveRichWikilinkSelection(1)(editor.view)).toBe(false)
  })

  it('requests a scan when it opens with no targets', () => {
    const onRequestTargets = vi.fn()
    const editor = mount({ targets: [], onRequestTargets })
    type(editor, '[[')
    expect(onRequestTargets).toHaveBeenCalled()
  })

  it('picks up targets that arrive after the menu opened', () => {
    const editor = mount({ targets: [] })
    type(editor, '[[bet')
    expect(richWikilinkMenuRows(editor.view)).toEqual([])
    setRichWikilinkTargets(editor.view, TARGETS)
    expect(richWikilinkMenuRows(editor.view).map((row) => row.relativePath))
      .toEqual(['notes/beta.md'])
  })

  it('never opens on a read-only document', () => {
    const editor = mount({ readOnly: true, emptyStateText: () => 'nothing' })
    type(editor, '[[')
    expect(richWikilinkMenuVisible(editor.view)).toBe(false)
  })

  it('closes on demand and reports whether it was open', () => {
    const editor = mount()
    type(editor, '[[')
    expect(closeRichWikilinkMenu(editor.view)).toBe(true)
    expect(closeRichWikilinkMenu(editor.view)).toBe(false)
  })

  it('accepts on Enter through the shortcuts', () => {
    const editor = mount()
    type(editor, '[[bet')
    expect(press(editor, 'Enter')).toBe(false)
    expect(text(editor)).toBe('[[beta]]')
  })

  it('accepts on Tab through the shortcuts', () => {
    const editor = mount()
    type(editor, '[[bet')
    press(editor, 'Tab')
    expect(text(editor)).toBe('[[beta]]')
  })

  it('accepts on Space through the shortcuts', () => {
    const editor = mount()
    type(editor, '[[bet')
    press(editor, ' ', 'Space')
    expect(text(editor)).toBe('[[beta]]')
  })

  it('moves the selection with the arrow keys through the shortcuts', () => {
    const editor = mount()
    type(editor, '[[')
    press(editor, 'ArrowDown')
    expect(richWikilinkMenuSelectedIndex(editor.view)).toBe(1)
    press(editor, 'ArrowUp')
    expect(richWikilinkMenuSelectedIndex(editor.view)).toBe(0)
  })

  it('lets Space through when the menu is closed', () => {
    const editor = mount()
    type(editor, 'word')
    expect(press(editor, ' ', 'Space')).toBe(true)
  })

  it('inserts on a row click', () => {
    const editor = mount()
    type(editor, '[[bet')
    const row = document.querySelector<HTMLElement>('.write-wikilink-row')
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(text(editor)).toBe('[[beta]]')
  })

  it('clicking a later row inserts that row', () => {
    const editor = mount()
    type(editor, '[[')
    const rows = document.querySelectorAll<HTMLElement>('.write-wikilink-row')
    rows[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(text(editor)).toBe('[[beta]]')
  })

  it('hovering a row moves the selection to it', () => {
    const editor = mount()
    type(editor, '[[')
    const rows = document.querySelectorAll<HTMLElement>('.write-wikilink-row')
    rows[2]?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
    expect(richWikilinkMenuSelectedIndex(editor.view)).toBe(2)
  })

  it('excludes the edited file and resolves paths when activePath is absolute', () => {
    const editor = mount({ activePath: '/vault/notes/alpha.md' })
    type(editor, '[[')
    expect(richWikilinkMenuRows(editor.view).map((row) => row.relativePath))
      .not.toContain('notes/alpha.md')
    type(editor, 'ind')
    acceptRichWikilinkMenu(editor.view)
    expect(text(editor)).toBe('[[../index]]')
  })

  it('hides the host once closed', () => {
    const editor = mount()
    type(editor, '[[')
    closeRichWikilinkMenu(editor.view)
    const host = document.querySelector<HTMLElement>('.write-wikilink-menu')
    expect(host?.style.display).toBe('none')
  })

  it('does not treat a bracket in a previous paragraph as open', () => {
    const editor = mount()
    type(editor, '[[open')
    editor.view.dispatch(editor.state.tr.split(editor.state.selection.from))
    type(editor, 'next')
    expect(richWikilinkMenuRows(editor.view)).toEqual([])
  })
})
