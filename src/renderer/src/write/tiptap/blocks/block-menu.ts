import { NodeSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { isNodeRangeSelection } from '@tiptap/extension-node-range'
import type { Editor } from '@tiptap/core'
import i18n from '../../../i18n'
import type { WorkDocContext } from '../../markdown/document-codec'
import { deleteSelectedBlocks } from './block-selection'
import { renderMenuPanel } from './block-menu-render'
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
  isReadOnly: () => boolean
}

export type MenuIconName = 'copy' | 'cut' | 'duplicate' | 'delete' | 'convert' | 'more'

export type MenuItem = {
  kind: 'item'
  id: string
  label: string
  icon?: MenuIconName
  hint?: string
  danger?: boolean
  disabled?: boolean
  run: () => void
}

export type MenuEntry =
  | MenuItem
  | { kind: 'separator' }
  | { kind: 'header'; label: string }
  | { kind: 'submenu'; id: string; label: string; icon?: MenuIconName; entries: () => MenuEntry[] }

export type BlockMenuLayoutItem = {
  id: string
  danger?: boolean
  disabled?: boolean
  submenu?: string[]
}

const CONVERSIONS: Array<[string, string]> = [
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

/**
 * What the menu shows, separated from how items execute so the ordering can
 * be tested without a DOM or an editor.
 */
export function blockMenuLayout(input: {
  readOnly: boolean
  multiple: boolean
  hasLink: boolean
}): Array<BlockMenuLayoutItem | 'separator'> {
  const more = ['copyMarkdown', 'aiEdit', 'moveUp', 'moveDown']
  if (input.hasLink) more.push('copyLink')
  return [
    { id: 'copy' },
    { id: 'cut', disabled: input.readOnly },
    { id: 'duplicate' },
    'separator',
    { id: 'convert', submenu: CONVERSIONS.map(([to]) => to) },
    { id: 'more', submenu: more },
    'separator',
    { id: 'delete', danger: true }
  ]
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
    case 'paragraph': chain.setParagraph().run(); return
    case 'heading1': case 'heading2': case 'heading3':
      chain.setNode('heading', { level: Number(to.slice(-1)) }).run()
      return
    case 'bulletList': chain.toggleBulletList().run(); return
    case 'orderedList': chain.toggleOrderedList().run(); return
    case 'taskList': chain.toggleTaskList().run(); return
    case 'blockquote': chain.toggleBlockquote().run(); return
    case 'codeBlock': chain.setNode('codeBlock').run(); return
    case 'callout': {
      const callout = state.schema.nodes.callout
      if (!callout || node.type.name === 'callout') return
      chain.wrapIn(callout, { calloutType: 'note', calloutTypeRaw: 'note' }).run()
    }
  }
}

/** Select `target` as a block selection unless it is already inside the
 * current block selection (a multi-block drag selection stays untouched). */
function ensureBlockSelection(view: EditorView, target: BlockTarget): void {
  const { selection } = view.state
  const isBlock = selection instanceof NodeSelection || isNodeRangeSelection(selection)
  if (isBlock && selectedBlocks(view.state).some((block) => block.pos === target.pos)) return
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, target.pos)))
}

/**
 * Copy/cut by selecting the block and letting the browser fire the event so
 * `block-selection.ts` writes both text/plain (Markdown) and text/html.
 * Falls back to plain Markdown when execCommand is unavailable.
 */
export function runClipboard(deps: BlockMenuDeps, target: BlockTarget, kind: 'copy' | 'cut'): void {
  const { view } = deps.editor
  ensureBlockSelection(view, target)
  view.focus()
  if (document.execCommand(kind)) return
  void navigator.clipboard?.writeText(blocksToMarkdown(view.state, deps.getCtx()))
  if (kind === 'cut') deleteSelectedBlocks(view)
}

function convertEntries(deps: BlockMenuDeps, target: BlockTarget, multiple: boolean): MenuEntry[] {
  const { editor } = deps
  const t = (key: string): string => i18n.t(key, { ns: 'common' })
  const blocks = selectedBlocks(editor.state)
  return CONVERSIONS.map(([to, label]) => ({
    kind: 'item',
    id: `convert:${to}`,
    label: t(label),
    disabled: multiple && to !== 'callout' && to !== 'blockquote',
    run: () => {
      for (const block of blocks) convertBlock(editor, block, to)
    }
  }))
}

function moreEntries(deps: BlockMenuDeps, target: BlockTarget, multiple: boolean, link: string | null): MenuEntry[] {
  const { editor } = deps
  const t = (key: string): string => i18n.t(key, { ns: 'common' })
  const blocks = selectedBlocks(editor.state)
  const sub: MenuEntry[] = []
  sub.push({
    kind: 'item', id: 'copyMarkdown', label: t('writeBlockMenuCopyMarkdown'),
    run: () => {
      const markdown = multiple
        ? blocksToMarkdown(editor.state, deps.getCtx())
        : blockToMarkdown(target.node, deps.getCtx())
      void navigator.clipboard?.writeText(markdown)
    }
  })
  sub.push({
    kind: 'item', id: 'aiEdit', label: t('writeBlockMenuAiEdit'),
    run: () => {
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, target.pos))
      )
      editor.commands.focus()
    }
  })
  for (const [id, key, dir] of [['moveUp', 'writeBlockMenuMoveUp', -1], ['moveDown', 'writeBlockMenuMoveDown', 1]] as const) {
    sub.push({
      kind: 'item', id, label: t(key), disabled: multiple,
      run: () => {
        const tr = moveBlockTransaction(editor.state, target, dir)
        if (tr) editor.view.dispatch(tr)
      }
    })
  }
  if (link) {
    sub.push({
      kind: 'item', id: 'copyLink', label: t('writeBlockMenuCopyLink'),
      run: () => {
        void navigator.clipboard?.writeText(link)
      }
    })
  }
  return sub
}

function menuEntries(deps: BlockMenuDeps, target: BlockTarget): MenuEntry[] {
  const { editor } = deps
  const t = (key: string): string => i18n.t(key, { ns: 'common' })
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'
  const blocks = selectedBlocks(editor.state)
  const multiple = blocks.length > 1
  const link = blockLinkForNode(target.node, deps.getFilePath(), deps.getWorkspaceRoot())
  const layout = blockMenuLayout({ readOnly: deps.isReadOnly(), multiple, hasLink: link !== null })

  const items: Record<string, () => MenuEntry> = {
    copy: () => ({
      kind: 'item', id: 'copy', label: t('writeBlockMenuCopy'), icon: 'copy',
      hint: `${mod}C`, run: () => runClipboard(deps, target, 'copy')
    }),
    cut: () => ({
      kind: 'item', id: 'cut', label: t('writeBlockMenuCut'), icon: 'cut',
      hint: `${mod}X`, disabled: deps.isReadOnly(), run: () => runClipboard(deps, target, 'cut')
    }),
    duplicate: () => ({
      kind: 'item', id: 'duplicate', label: t('writeBlockMenuDuplicate'), icon: 'duplicate',
      run: () => {
        const tr = editor.state.tr
        let insertPos = target.pos + target.node.nodeSize
        for (const block of blocks) {
          tr.insert(insertPos, block.node.copy(block.node.content))
          insertPos += block.node.nodeSize
        }
        editor.view.dispatch(tr.scrollIntoView())
      }
    }),
    convert: () => ({
      kind: 'submenu', id: 'convert', label: t('writeBlockMenuConvertTo'), icon: 'convert',
      entries: () => convertEntries(deps, target, multiple)
    }),
    more: () => ({
      kind: 'submenu', id: 'more', label: t('writeBlockMenuMore'), icon: 'more',
      entries: () => moreEntries(deps, target, multiple, link)
    }),
    delete: () => ({
      kind: 'item', id: 'delete', label: t('writeBlockMenuDelete'), icon: 'delete', danger: true,
      run: () => {
        ensureBlockSelection(editor.view, target)
        deleteSelectedBlocks(editor.view)
      }
    })
  }

  const entries: MenuEntry[] = []
  for (const item of layout) {
    entries.push(item === 'separator' ? { kind: 'separator' } : items[item.id]?.() ?? { kind: 'separator' })
  }
  return entries
}

export type BlockMenuHandle = {
  close: () => void
  dom: HTMLElement
}

/** Open the grip context menu for `target` anchored at `anchor`. `onClosed`
 * fires on every close path — item run, Esc, outside pointer, scroll — so the
 * caller can reset its own bookkeeping. */
export function openBlockMenu(deps: BlockMenuDeps, target: BlockTarget, anchor: HTMLElement,
  onClosed?: () => void): BlockMenuHandle {
  const openDoms: HTMLElement[] = []
  let closed = false
  let panel: { dom: HTMLElement; dispose: () => void }

  const onPointerDown = (event: PointerEvent): void => {
    const hit = event.target as globalThis.Node
    if (!openDoms.some((menu) => menu.contains(hit))) close()
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
      deps.editor.commands.focus()
    }
  }
  const onScroll = (): void => close()
  const close = (): void => {
    if (closed) return
    closed = true
    panel.dispose()
    panel.dom.remove()
    onClosed?.()
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('resize', onScroll, true)
    document.removeEventListener('scroll', onScroll, true)
  }

  panel = renderMenuPanel({
    entries: menuEntries(deps, target),
    anchor,
    placement: 'left-start',
    requestCloseAll: close,
    openDoms
  })
  openDoms.push(panel.dom)

  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('resize', onScroll, true)
  document.addEventListener('scroll', onScroll, true)

  return { close, dom: panel.dom }
}
