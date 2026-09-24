/**
 * Formatting commands shared by the selection toolbar (via the editor
 * handle) and the fixed format toolbar above the document. Split out of
 * WriteRichEditor.tsx to keep it under the file-size gate.
 */
import type { Editor } from '@tiptap/core'
import type { WriteBlockType } from '../block-type'
import type { WriteInlineFormatKind } from '../inline-format'

function usable(editor: Editor | null, readOnly: boolean): editor is Editor {
  return Boolean(editor && !editor.isDestroyed && !readOnly)
}

export function toggleRichInlineFormat(
  editor: Editor | null,
  readOnly: boolean,
  kind: WriteInlineFormatKind
): boolean {
  if (!usable(editor, readOnly)) return false
  const chain = editor.chain().focus()
  if (kind === 'bold') return chain.toggleBold().run()
  if (kind === 'italic') return chain.toggleItalic().run()
  if (kind === 'strikethrough') return chain.toggleStrike().run()
  return chain.toggleCode().run()
}

export function setRichBlockType(editor: Editor | null, readOnly: boolean, type: WriteBlockType): boolean {
  if (!usable(editor, readOnly)) return false
  const chain = editor.chain().focus()
  switch (type) {
    case 'heading1':
      return chain.toggleHeading({ level: 1 }).run()
    case 'heading2':
      return chain.toggleHeading({ level: 2 }).run()
    case 'heading3':
      return chain.toggleHeading({ level: 3 }).run()
    case 'quote':
      return chain.toggleBlockquote().run()
    case 'bullet':
      return chain.toggleBulletList().run()
    case 'ordered':
      return chain.toggleOrderedList().run()
    case 'code':
      return chain.toggleCodeBlock().run()
    default:
      return chain.setParagraph().run()
  }
}

/** Toggle buttons on the fixed format toolbar, in display order. */
export const WRITE_TOOLBAR_TOGGLES = [
  'heading1',
  'heading2',
  'heading3',
  'quote',
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'bullet',
  'ordered',
  'task'
] as const

export type WriteToolbarToggle = (typeof WRITE_TOOLBAR_TOGGLES)[number]
export type WriteToolbarState = Record<WriteToolbarToggle, boolean>

export function richToolbarState(editor: Editor | null): WriteToolbarState | null {
  if (!editor || editor.isDestroyed) return null
  return {
    heading1: editor.isActive('heading', { level: 1 }),
    heading2: editor.isActive('heading', { level: 2 }),
    heading3: editor.isActive('heading', { level: 3 }),
    quote: editor.isActive('blockquote'),
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    strike: editor.isActive('strike'),
    code: editor.isActive('code'),
    bullet: editor.isActive('bulletList'),
    ordered: editor.isActive('orderedList'),
    task: editor.isActive('taskList')
  }
}

export function runRichToolbarToggle(editor: Editor | null, readOnly: boolean, toggle: WriteToolbarToggle): boolean {
  if (!usable(editor, readOnly)) return false
  switch (toggle) {
    case 'heading1':
    case 'heading2':
    case 'heading3':
    case 'quote':
    case 'bullet':
    case 'ordered':
      return setRichBlockType(editor, readOnly, toggle)
    case 'bold':
    case 'italic':
    case 'code':
      return toggleRichInlineFormat(editor, readOnly, toggle)
    case 'strike':
      return toggleRichInlineFormat(editor, readOnly, 'strikethrough')
    case 'underline':
      return editor.chain().focus().toggleUnderline().run()
    case 'task':
      return editor.chain().focus().toggleTaskList().run()
  }
}
