// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { WriteWikilink } from './wikilink-mark'

let editors: Editor[] = []

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
  document.body.innerHTML = ''
})

function mount(): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: [Document, Paragraph, Text, WriteWikilink],
    content: ''
  })
  editors.push(editor)
  return editor
}

/** Routes text through handleTextInput so input rules run, as real typing does. */
function typeCharacter(editor: Editor, character: string): void {
  const { from, to } = editor.state.selection
  const handled = editor.view.someProp('handleTextInput', (handler) =>
    handler(editor.view, from, to, character, () =>
      editor.state.tr.insertText(character, from, to)
    )
  )
  if (!handled) {
    editor.view.dispatch(editor.state.tr.insertText(character, from, to))
  }
}

function typeText(editor: Editor, text: string): void {
  for (const character of text) typeCharacter(editor, character)
}

describe('WriteWikilink input rule', () => {
  it('marks a hand-typed wikilink as its closing bracket lands', () => {
    const editor = mount()
    typeText(editor, 'see [[notes/alpha]]')
    const paragraph = editor.state.doc.child(0)
    const marked: string[] = []
    paragraph.forEach((node) => {
      if (node.marks.some((mark) => mark.type.name === 'wikilink')) {
        marked.push(node.text ?? '')
      }
    })
    expect(marked).toEqual(['[[notes/alpha]]'])
    // The text itself is untouched — the rule marks, never rewrites.
    expect(paragraph.textContent).toBe('see [[notes/alpha]]')
  })

  it('leaves unclosed or empty brackets unmarked', () => {
    const editor = mount()
    typeText(editor, 'see [[notes/alpha')
    const paragraph = editor.state.doc.child(0)
    paragraph.forEach((node) => {
      expect(node.marks).toEqual([])
    })
  })
})
