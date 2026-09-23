import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { parseWorkDocument } from '../../markdown/document-codec'

export type WritePasteMarkdownOptions = {
  isReadOnly: () => boolean
}

export const MARKDOWN_LIKE_RE = /^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|^```|^\s*>|^\|.*\|\s*$|^\s*\$\$|\[\[[^\]]+\]\]/m

/**
 * HTML copied from a rich surface carries real markup; plain-text copies
 * (terminals, VS Code's `editor.copyWithSyntaxHighlighting` off, chat UIs)
 * either have no html payload or a trivially-wrapped one.
 */
export function hasRichHtml(html: string): boolean {
  if (!html) return false
  return /<(h[1-6]|ul|ol|table|blockquote|pre|img|p[ >])/i.test(html)
}

export function insertParsedMarkdown(editor: Editor, markdown: string): boolean {
  let content
  try {
    content = parseWorkDocument(markdown).doc.content ?? []
  } catch {
    return false
  }
  if (content.length === 0) return false
  const chain = editor.chain().focus()
  if (content.length === 1 && content[0].type === 'paragraph') {
    // Inline paste keeps the current block (pasting a line into a heading
    // must not demote it to a paragraph).
    return chain.insertContent(content[0].content ?? []).run()
  }
  return chain.insertContent(content).run()
}

/**
 * Markdown-aware paste (implementation §9.9): plain-text payloads that look
 * like markdown parse through the work codec so headings/lists/tables land
 * as real blocks; Shift-held paste always inserts raw text.
 */
export const WritePasteMarkdown = Extension.create<WritePasteMarkdownOptions>({
  name: 'writePasteMarkdown',

  addOptions() {
    return { isReadOnly: () => false }
  },

  addProseMirrorPlugins() {
    const options = this.options
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('writePasteMarkdown'),
        props: {
          handlePaste(view, event) {
            if (options.isReadOnly()) return false
            const data = event.clipboardData
            if (!data) return false
            const text = data.getData('text/plain')
            if (!text) return false
            const html = data.getData('text/html')
            if (hasRichHtml(html)) return false
            if (!MARKDOWN_LIKE_RE.test(text)) return false
            return insertParsedMarkdown(editor, text)
          }
        }
      })
    ]
  }
})
