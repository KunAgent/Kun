import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { NodeRangeSelection, isNodeRangeSelection } from '@tiptap/extension-node-range'
import type { EditorView } from '@tiptap/pm/view'
import type { WorkDocContext } from '../../markdown/document-codec'
import { blockTargetAtPos, blocksToMarkdown, selectedBlocks } from './block-target'

export type WriteBlockSelectionOptions = {
  getCtx: () => WorkDocContext
  isReadOnly: () => boolean
}

function deleteSelectedBlocks(view: EditorView): boolean {
  const blocks = selectedBlocks(view.state)
  if (blocks.length === 0) return false
  const tr = view.state.tr
  const sorted = [...blocks].sort((a, b) => b.pos - a.pos)
  for (const block of sorted) tr.delete(block.pos, block.pos + block.node.nodeSize)
  const caret = Math.min(blocks[0].pos, tr.doc.content.size)
  tr.setSelection(TextSelection.near(tr.doc.resolve(caret)))
  view.dispatch(tr.scrollIntoView())
  return true
}

function copySelection(view: EditorView, event: ClipboardEvent, ctx: WorkDocContext, cut: boolean): boolean {
  const { state } = view
  const isBlockSelection =
    state.selection instanceof NodeSelection || isNodeRangeSelection(state.selection)
  if (!isBlockSelection || !event.clipboardData) return false
  const markdown = blocksToMarkdown(state, ctx)
  const slice = state.selection.content()
  const serialized = view.serializeForClipboard(slice)
  event.clipboardData.setData('text/plain', markdown)
  event.clipboardData.setData('text/html', serialized.dom.innerHTML)
  event.preventDefault()
  if (cut) deleteSelectedBlocks(view)
  return true
}

/**
 * Multi-block selection behavior (implementation §9.4) layered on top of
 * `@tiptap/extension-node-range`: Escape selects the current block, Cmd/Ctrl+A
 * selects the block first and the whole document second, Delete/Backspace
 * removes selected blocks, Cmd/Ctrl+C/X write markdown to the clipboard, and
 * dragging from the left gutter box-selects top-level blocks.
 */
export const WriteBlockSelection = Extension.create<WriteBlockSelectionOptions>({
  name: 'writeBlockSelection',

  addKeyboardShortcuts() {
    const selectCurrentBlock = (): boolean => {
      const { state, view } = this.editor
      const target = blockTargetAtPos(state, state.selection.$from.pos)
      if (!target) return false
      view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, target.pos)))
      return true
    }
    return {
      Escape: () => {
        const { state } = this.editor
        if (state.selection instanceof NodeSelection || isNodeRangeSelection(state.selection)) {
          return false
        }
        return selectCurrentBlock()
      },
      'Mod-a': () => {
        const { state } = this.editor
        if (state.selection instanceof NodeSelection || isNodeRangeSelection(state.selection)) {
          // Second press falls through to the NodeRange select-all.
          return false
        }
        return selectCurrentBlock()
      },
      Backspace: () => {
        const { state, view } = this.editor
        if (this.options.isReadOnly()) return false
        if (!isNodeRangeSelection(state.selection)) return false
        return deleteSelectedBlocks(view)
      },
      Delete: () => {
        const { state, view } = this.editor
        if (this.options.isReadOnly()) return false
        if (!isNodeRangeSelection(state.selection)) return false
        return deleteSelectedBlocks(view)
      }
    }
  },

  addProseMirrorPlugins() {
    const options = this.options

    const boxSelect = new Plugin({
      key: new PluginKey('writeBlockBoxSelect'),
      props: {
        handleDOMEvents: {
          mousedown(view, event) {
            if (!(event instanceof MouseEvent) || event.button !== 0) return false
            if (options.isReadOnly()) return false
            const contentRect = view.dom.getBoundingClientRect()
            const inLeftGutter = event.clientX < contentRect.left + 8
            const betweenBlocks = (() => {
              const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
              return pos === null
            })()
            if (!inLeftGutter && !betweenBlocks) return false

            const host = view.dom.parentElement ?? view.dom
            const startY = event.clientY
            const startX = event.clientX
            const rect = document.createElement('div')
            rect.className = 'write-block-box-select'
            host.append(rect)

            const onMove = (move: MouseEvent): void => {
              const hostRect = host.getBoundingClientRect()
              const left = Math.min(startX, move.clientX) - hostRect.left + host.scrollLeft
              const top = Math.min(startY, move.clientY) - hostRect.top + host.scrollTop
              const width = Math.abs(move.clientX - startX)
              const height = Math.abs(move.clientY - startY)
              rect.style.left = `${left}px`
              rect.style.top = `${top}px`
              rect.style.width = `${width}px`
              rect.style.height = `${height}px`
            }

            const onUp = (up: MouseEvent): void => {
              window.removeEventListener('mousemove', onMove)
              window.removeEventListener('mouseup', onUp)
              rect.remove()
              const box = {
                left: Math.min(startX, up.clientX),
                right: Math.max(startX, up.clientX),
                top: Math.min(startY, up.clientY),
                bottom: Math.max(startY, up.clientY)
              }
              if (box.right - box.left < 4 && box.bottom - box.top < 4) return
              let first: number | null = null
              let last: number | null = null
              view.state.doc.forEach((node, pos) => {
                const dom = view.nodeDOM(pos)
                if (!(dom instanceof HTMLElement)) return
                const bounds = dom.getBoundingClientRect()
                const intersects =
                  bounds.bottom > box.top && bounds.top < box.bottom &&
                  bounds.right > box.left && bounds.left < box.right
                if (!intersects) return
                if (first === null) first = pos
                last = pos + node.nodeSize
              })
              if (first === null || last === null) return
              const { state } = view
              // `head` must land inside the last block; `last` is the
              // position just after it, which would resolve into the next
              // sibling and over-select by one block.
              const selection = NodeRangeSelection.create(state.doc, first, last - 1, undefined)
              view.dispatch(state.tr.setSelection(selection))
            }

            window.addEventListener('mousemove', onMove)
            window.addEventListener('mouseup', onUp)
            event.preventDefault()
            return true
          },
          copy(view, event) {
            return copySelection(view, event, options.getCtx(), false)
          },
          cut(view, event) {
            if (options.isReadOnly()) return false
            return copySelection(view, event, options.getCtx(), true)
          }
        }
      }
    })

    return [boxSelect]
  }
})
