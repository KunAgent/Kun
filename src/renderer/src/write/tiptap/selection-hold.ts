import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { buildWriteRichMarkdownProjection, posForProjectedOffset } from './markdown-projection'

type Range = { from: number; to: number }
const holdKey = new PluginKey<DecorationSet>('writeSelectionHold')
export const WriteSelectionHold = Extension.create({
  name: 'writeSelectionHold',
  addProseMirrorPlugins: () => [new Plugin({
    key: holdKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, previous) {
        const range = tr.getMeta(holdKey) as Range | null | undefined
        if (range === null) return DecorationSet.empty
        if (range) return DecorationSet.create(tr.doc, [Decoration.inline(range.from, range.to, { class: 'write-selection-hold' })])
        return previous.map(tr.mapping, tr.doc)
      }
    },
    props: { decorations: (state) => holdKey.getState(state) }
  })]
})

function resolveRange(editor: Editor, range: Range): Range | null {
  const doc = editor.state.doc, projection = buildWriteRichMarkdownProjection(doc)
  const from = posForProjectedOffset(doc, projection, range.from)
  const to = posForProjectedOffset(doc, projection, range.to)
  return from !== null && to !== null && from < to ? { from, to } : null
}
export function setRichSelectionHold(editor: Editor | null, range: Range | null): void {
  if (!editor || editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(holdKey, range ? resolveRange(editor, range) : null).setMeta('addToHistory', false))
}
export function restoreRichSelection(editor: Editor | null, range: Range): void {
  if (!editor || editor.isDestroyed) return
  const resolved = resolveRange(editor, range)
  if (!resolved) return
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, resolved.from, resolved.to)))
  editor.view.focus()
}

export function richSelectionHoldRange(editor: Editor): Range | null {
  const held = holdKey.getState(editor.state)?.find()[0]
  return held ? { from: held.from, to: held.to } : null
}
