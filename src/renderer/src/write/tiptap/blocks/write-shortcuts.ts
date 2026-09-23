import { Extension } from '@tiptap/core'
import { moveBlockTransaction, selectedBlocks } from './block-target'

export type WriteBlockShortcutsOptions = {
  isReadOnly: () => boolean
}

/**
 * Notion-style block keyboard map (implementation §9.11). StarterKit already
 * covers Mod-Shift-7/8 lists, Mod-e inline code, and Mod-k opens the link
 * bubble via WriteWorkLinks — this map adds what is missing.
 */
export const WriteBlockShortcuts = Extension.create<WriteBlockShortcutsOptions>({
  name: 'writeBlockShortcuts',

  addOptions() {
    return { isReadOnly: () => false }
  },

  addKeyboardShortcuts() {
    const editable = (): boolean => !this.options.isReadOnly() && this.editor.isEditable

    const moveSelectionBlock = (direction: -1 | 1): boolean => {
      const { state, view } = this.editor
      const blocks = selectedBlocks(state)
      if (blocks.length !== 1) return false
      const tr = moveBlockTransaction(state, blocks[0], direction)
      if (!tr) return false
      view.dispatch(tr)
      return true
    }

    const duplicateBlock = (): boolean => {
      const { state, view } = this.editor
      const blocks = selectedBlocks(state)
      if (blocks.length === 0) return false
      const tr = state.tr
      let insertPos = blocks[blocks.length - 1].pos + blocks[blocks.length - 1].node.nodeSize
      for (const block of blocks) {
        tr.insert(insertPos, block.node.copy(block.node.content))
        insertPos += block.node.nodeSize
      }
      view.dispatch(tr.scrollIntoView())
      return true
    }

    return {
      'Mod-Alt-1': () => editable() && this.editor.chain().focus().toggleHeading({ level: 1 }).run(),
      'Mod-Alt-2': () => editable() && this.editor.chain().focus().toggleHeading({ level: 2 }).run(),
      'Mod-Alt-3': () => editable() && this.editor.chain().focus().toggleHeading({ level: 3 }).run(),
      'Mod-Alt-0': () => editable() && this.editor.chain().focus().setParagraph().run(),
      'Mod-Shift-9': () => editable() && this.editor.chain().focus().toggleTaskList().run(),
      'Mod-Alt-c': () => editable() && this.editor.chain().focus().toggleCodeBlock().run(),
      'Mod-d': () => editable() && duplicateBlock(),
      'Alt-Shift-ArrowUp': () => editable() && moveSelectionBlock(-1),
      'Alt-Shift-ArrowDown': () => editable() && moveSelectionBlock(1)
    }
  }
})
