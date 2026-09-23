import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import i18n from '../../../i18n'

export type WriteTableToolbarOptions = {
  isReadOnly: () => boolean
}

export const WriteTableToolbar = Extension.create<WriteTableToolbarOptions>({
  name: 'writeTableToolbar',

  addOptions() {
    return {
      isReadOnly: () => false
    }
  },

  addProseMirrorPlugins() {
    const options = this.options
    const editor = this.editor

    return [
      new Plugin({
        key: new PluginKey('writeTableToolbar'),
        view(editorView) {
          const host = editorView.dom.parentElement ?? editorView.dom
          if (getComputedStyle(host).position === 'static') {
            host.style.position = 'relative'
          }
          const bar = document.createElement('div')
          bar.className = 'write-table-toolbar'
          bar.style.display = 'none'
          const t = (key: string): string => i18n.t(key, { ns: 'common' })
          const items: Array<{ label: string; title: string; run: () => void }> = [
            { label: 'R↑', title: t('writeTableAddRowBefore'), run: () => void editor.chain().focus().addRowBefore().run() },
            { label: 'R↓', title: t('writeTableAddRowAfter'), run: () => void editor.chain().focus().addRowAfter().run() },
            { label: 'C←', title: t('writeTableAddColumnBefore'), run: () => void editor.chain().focus().addColumnBefore().run() },
            { label: 'C→', title: t('writeTableAddColumnAfter'), run: () => void editor.chain().focus().addColumnAfter().run() },
            { label: 'L', title: t('writeTableAlignLeft'), run: () => void editor.commands.setCellAttribute('align', 'left') },
            { label: 'C', title: t('writeTableAlignCenter'), run: () => void editor.commands.setCellAttribute('align', 'center') },
            { label: 'R', title: t('writeTableAlignRight'), run: () => void editor.commands.setCellAttribute('align', 'right') },
            { label: '-R', title: t('writeTableDeleteRow'), run: () => void editor.chain().focus().deleteRow().run() },
            { label: '-C', title: t('writeTableDeleteColumn'), run: () => void editor.chain().focus().deleteColumn().run() },
            { label: 'Del', title: t('writeTableDelete'), run: () => void editor.chain().focus().deleteTable().run() }
          ]
          for (const item of items) {
            const button = document.createElement('button')
            button.type = 'button'
            button.className = 'write-table-toolbar-button'
            button.textContent = item.label
            button.title = item.title
            button.setAttribute('aria-label', item.title)
            button.addEventListener('mousedown', (event) => event.preventDefault())
            button.addEventListener('click', () => item.run())
            bar.append(button)
          }
          host.append(bar)

          const tableDom = (view: EditorView): HTMLElement | null => {
            const { $from } = view.state.selection
            for (let depth = $from.depth; depth >= 1; depth -= 1) {
              if ($from.node(depth).type.name === 'table') {
                const dom = view.nodeDOM($from.before(depth))
                return dom instanceof HTMLElement ? dom : null
              }
            }
            return null
          }

          const update = (): void => {
            if (options.isReadOnly()) {
              bar.style.display = 'none'
              return
            }
            const dom = tableDom(editorView)
            if (!dom) {
              bar.style.display = 'none'
              return
            }
            const hostRect = host.getBoundingClientRect()
            const rect = dom.getBoundingClientRect()
            bar.style.display = 'flex'
            bar.style.top = `${rect.top - hostRect.top + host.scrollTop - 34}px`
            bar.style.left = `${rect.left - hostRect.left + host.scrollLeft}px`
          }

          update()
          return {
            update: () => update(),
            destroy: () => bar.remove()
          }
        }
      })
    ]
  }
})
