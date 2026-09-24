import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import i18n from '../../../i18n'
import type { WorkDocContext } from '../../markdown/document-codec'
import {
  blockLinkForNode,
  blockToMarkdown,
  blocksToMarkdown,
  moveBlockTransaction,
  selectedBlocks,
  type BlockTarget
} from './block-target'

export type BlockMenuDeps = {
  editor: Editor
  getCtx: () => WorkDocContext
  getFilePath: () => string
  getWorkspaceRoot: () => string
}

type MenuEntry =
  | { kind: 'item'; label: string; hint?: string; run: () => void; disabled?: boolean }
  | { kind: 'separator' }
  | { kind: 'header'; label: string }

function closeMenu(dom: HTMLElement, cleanup: () => void): void {
  cleanup()
  dom.remove()
}

/**
 * Convert the block at `pos` to another block type. List wraps happen per
 * node: converting a paragraph selects it first so list commands behave
 * like they do on a caret selection.
 */
function convertBlock(editor: Editor, target: BlockTarget, to: string): void {
  const { state, view } = editor
  const node = target.node
  const tr = state.tr.setSelection(NodeSelection.create(state.doc, target.pos))
  view.dispatch(tr)
  const chain = editor.chain().focus()
  switch (to) {
    case 'paragraph':
      chain.setParagraph().run()
      return
    case 'heading1':
    case 'heading2':
    case 'heading3':
      chain.setNode('heading', { level: Number(to.slice(-1)) }).run()
      return
    case 'bulletList':
      chain.toggleBulletList().run()
      return
    case 'orderedList':
      chain.toggleOrderedList().run()
      return
    case 'taskList':
      chain.toggleTaskList().run()
      return
    case 'blockquote':
      chain.toggleBlockquote().run()
      return
    case 'codeBlock':
      chain.setNode('codeBlock').run()
      return
    case 'callout': {
      const callout = state.schema.nodes.callout
      if (!callout) return
      if (node.type.name === 'callout') return
      chain.wrapIn(callout, { calloutType: 'note', calloutTypeRaw: 'note' }).run()
      return
    }
  }
}

function menuEntries(deps: BlockMenuDeps, target: BlockTarget): MenuEntry[] {
  const { editor } = deps
  const t = (key: string): string => i18n.t(key, { ns: 'common' })
  const blocks = selectedBlocks(editor.state)
  const multiple = blocks.length > 1
  const entries: MenuEntry[] = []

  entries.push({ kind: 'header', label: t('writeBlockMenuConvertTo') })
  const conversions: Array<[string, string]> = [
    ['paragraph', 'writeBlockTypeParagraph'],
    ['heading1', 'writeBlockTypeHeading1'],
    ['heading2', 'writeBlockTypeHeading2'],
    ['heading3', 'writeBlockTypeHeading3'],
    ['bulletList', 'writeBlockTypeBullet'],
    ['orderedList', 'writeBlockTypeOrdered'],
    ['taskList', 'writeBlockTypeTaskList'],
    ['blockquote', 'writeBlockTypeQuote'],
    ['codeBlock', 'writeBlockTypeCode'],
    ['callout', 'writeBlockTypeCallout']
  ]
  for (const [to, label] of conversions) {
    entries.push({
      kind: 'item',
      label: t(label),
      disabled: multiple && to !== 'callout' && to !== 'blockquote',
      run: () => {
        for (const block of blocks) convertBlock(editor, block, to)
      }
    })
  }

  entries.push({ kind: 'separator' })
  entries.push({
    kind: 'item',
    label: t('writeBlockMenuCopyMarkdown'),
    run: () => {
      const markdown = multiple
        ? blocksToMarkdown(editor.state, deps.getCtx())
        : blockToMarkdown(target.node, deps.getCtx())
      void navigator.clipboard?.writeText(markdown)
    }
  })
  entries.push({
    kind: 'item',
    label: t('writeBlockMenuDuplicate'),
    run: () => {
      const tr = editor.state.tr
      let insertPos = target.pos + target.node.nodeSize
      for (const block of blocks) {
        tr.insert(insertPos, block.node.copy(block.node.content))
        insertPos += block.node.nodeSize
      }
      editor.view.dispatch(tr.scrollIntoView())
    }
  })
  entries.push({
    kind: 'item',
    label: t('writeBlockMenuDelete'),
    run: () => {
      const tr = editor.state.tr
      const sorted = [...blocks].sort((a, b) => b.pos - a.pos)
      for (const block of sorted) tr.delete(block.pos, block.pos + block.node.nodeSize)
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(blocks[0].pos, tr.doc.content.size))))
      editor.view.dispatch(tr.scrollIntoView())
    }
  })

  entries.push({ kind: 'separator' })
  entries.push({
    kind: 'item',
    label: t('writeBlockMenuAiEdit'),
    run: () => {
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, target.pos))
      )
      editor.commands.focus()
    }
  })
  entries.push({
    kind: 'item',
    label: t('writeBlockMenuMoveUp'),
    disabled: multiple,
    run: () => {
      const tr = moveBlockTransaction(editor.state, target, -1)
      if (tr) editor.view.dispatch(tr)
    }
  })
  entries.push({
    kind: 'item',
    label: t('writeBlockMenuMoveDown'),
    disabled: multiple,
    run: () => {
      const tr = moveBlockTransaction(editor.state, target, 1)
      if (tr) editor.view.dispatch(tr)
    }
  })

  const link = blockLinkForNode(target.node, deps.getFilePath(), deps.getWorkspaceRoot())
  if (link) {
    entries.push({ kind: 'separator' })
    entries.push({
      kind: 'item',
      label: t('writeBlockMenuCopyLink'),
      run: () => {
        void navigator.clipboard?.writeText(link)
      }
    })
  }
  return entries
}

/** Open the ⋮⋮ context menu for `target` anchored at `anchor`. */
export function openBlockMenu(deps: BlockMenuDeps, target: BlockTarget, anchor: HTMLElement): () => void {
  const dom = document.createElement('div')
  dom.className = 'write-block-menu'
  dom.setAttribute('role', 'menu')

  let cleanup: () => void = () => undefined
  const close = (): void => closeMenu(dom, cleanup)

  for (const entry of menuEntries(deps, target)) {
    if (entry.kind === 'separator') {
      const sep = document.createElement('div')
      sep.className = 'write-block-menu-separator'
      dom.append(sep)
      continue
    }
    if (entry.kind === 'header') {
      const header = document.createElement('div')
      header.className = 'write-block-menu-header'
      header.textContent = entry.label
      dom.append(header)
      continue
    }
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'write-block-menu-item'
    button.setAttribute('role', 'menuitem')
    button.textContent = entry.label
    if (entry.disabled) button.disabled = true
    button.addEventListener('click', () => {
      close()
      entry.run()
    })
    dom.append(button)
  }

  document.body.append(dom)
  const virtualAnchor = {
    getBoundingClientRect: () => anchor.getBoundingClientRect()
  }
  const stopAutoUpdate = autoUpdate(virtualAnchor, dom, () => {
    void computePosition(virtualAnchor, dom, {
      placement: 'bottom-start',
      strategy: 'fixed',
      middleware: [offset(4), flip(), shift({ padding: 8 })]
    }).then(({ x, y }) => {
      dom.style.left = `${x}px`
      dom.style.top = `${y}px`
    })
  })

  const onPointerDown = (event: PointerEvent): void => {
    if (!dom.contains(event.target as globalThis.Node)) close()
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
      deps.editor.commands.focus()
    }
  }
  const onScroll = (): void => close()
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('resize', onScroll, true)
  document.addEventListener('scroll', onScroll, true)

  cleanup = () => {
    stopAutoUpdate()
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('resize', onScroll, true)
    document.removeEventListener('scroll', onScroll, true)
  }
  return close
}
