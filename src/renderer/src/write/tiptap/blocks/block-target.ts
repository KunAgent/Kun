import type { Node as PmNode } from '@tiptap/pm/model'
import { NodeSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { isNodeRangeSelection } from '@tiptap/extension-node-range'
import type { JSONContent } from '@tiptap/core'
import { serializeWorkDocument, type WorkDocContext } from '../../markdown/document-codec'
import { workHeadingSlug } from '../../work-link'

/** A draggable/selectable block: position of the node in the document. */
export type BlockTarget = {
  pos: number
  node: PmNode
  depth: number
  parent: PmNode
  index: number
}

const DRAGGABLE_LIST_ITEMS = new Set(['listItem', 'taskItem'])
const NON_BLOCK_NAMES = new Set(['doc', 'text'])

function isEmptyParagraph(node: PmNode): boolean {
  return node.type.name === 'paragraph' && node.content.size === 0
}

/**
 * Resolve the block a top-level position belongs to. List items win over
 * their list parent so the handle can grab individual items; everything
 * else resolves at depth 1 (the document's direct children).
 */
export function blockTargetAtPos(state: EditorState, pos: number): BlockTarget | null {
  let $pos
  try {
    $pos = state.doc.resolve(pos)
  } catch {
    return null
  }
  for (let depth = $pos.depth; depth >= 1; depth -= 1) {
    const node = $pos.node(depth)
    if (DRAGGABLE_LIST_ITEMS.has(node.type.name)) {
      return { pos: $pos.before(depth), node, depth, parent: $pos.node(depth - 1), index: $pos.index(depth - 1) }
    }
  }
  if ($pos.depth < 1) return null
  const node = $pos.node(1)
  if (NON_BLOCK_NAMES.has(node.type.name)) return null
  return { pos: $pos.before(1), node, depth: 1, parent: $pos.node(0), index: $pos.index(0) }
}

/** The top-level (or list-item) block near a client coordinate, used by the
 * hover handle: `posAtCoords` just left of the text column. */
export function blockTargetFromCoords(view: EditorView, clientX: number, clientY: number): BlockTarget | null {
  const pos = view.posAtCoords({ left: clientX, top: clientY })?.pos
  if (pos === undefined) return null
  const direct = blockTargetAtPos(view.state, pos)
  if (direct) return direct
  // A point in the padding beside the centered reading column resolves to
  // the gap between two top-level blocks; take the neighbour whose box
  // spans `clientY` and re-resolve just inside it (so list items still win).
  const $pos = view.state.doc.resolve(pos)
  if ($pos.depth !== 0) return null
  const neighbours = [
    $pos.nodeAfter ? { at: pos, index: $pos.index(0) } : null,
    $pos.nodeBefore ? { at: pos - $pos.nodeBefore.nodeSize, index: $pos.index(0) - 1 } : null
  ]
  for (const neighbour of neighbours) {
    const node = neighbour ? view.state.doc.nodeAt(neighbour.at) : null
    const dom = neighbour ? view.nodeDOM(neighbour.at) : null
    if (!neighbour || !node || !(dom instanceof HTMLElement)) continue
    const rect = dom.getBoundingClientRect()
    if (clientY < rect.top || clientY > rect.bottom) continue
    const inner = view.posAtCoords({ left: rect.left + 8, top: clientY })?.pos
    const nested = inner === undefined ? null : blockTargetAtPos(view.state, inner)
    return nested ?? { pos: neighbour.at, node, depth: 1, parent: view.state.doc, index: neighbour.index }
  }
  return null
}

/** Blocks covered by the current selection — one for NodeSelection, the
 * full range for a node-range selection, or the single block containing a
 * text selection. */
export function selectedBlocks(state: EditorState): BlockTarget[] {
  const selection = state.selection
  if (selection instanceof NodeSelection) {
    return [{
      pos: selection.from, node: selection.node, depth: selection.$from.depth,
      parent: selection.$from.parent, index: selection.$from.index()
    }]
  }
  if (isNodeRangeSelection(selection)) {
    const blocks: BlockTarget[] = []
    for (const range of selection.ranges) {
      const node = range.$from.nodeAfter
      if (!node || NON_BLOCK_NAMES.has(node.type.name)) continue
      blocks.push({
        pos: range.$from.pos, node, depth: range.$from.depth,
        parent: range.$from.parent, index: range.$from.index()
      })
    }
    if (blocks.length > 0) return blocks
  }
  const target = blockTargetAtPos(state, selection.$from.pos)
  return target ? [target] : []
}

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList'])

/**
 * A bare `listItem`/`taskItem` is not a valid top-level doc node, so copying
 * one alone would serialize as plain text and lose its marker. Wrap it in a
 * single-item list of the parent type; an ordered list keeps the item's
 * number via `start`, a task item keeps `checked` on its own attrs.
 */
function blockToJSON(block: BlockTarget): JSONContent {
  const { node, parent } = block
  if (!DRAGGABLE_LIST_ITEMS.has(node.type.name) || !LIST_TYPES.has(parent.type.name)) {
    return node.toJSON()
  }
  const attrs = { ...parent.attrs }
  if (parent.type.name === 'orderedList') {
    attrs.start = Number(attrs.start ?? 1) + block.index
  }
  return { type: parent.type.name, attrs, content: [node.toJSON()] }
}

/** Serialize one block through the work codec; original-registered blocks
 * come back verbatim. */
export function blockToMarkdown(target: BlockTarget, ctx: WorkDocContext): string {
  return serializeWorkDocument({ type: 'doc', content: [blockToJSON(target)] }, ctx).trim()
}

/** Serialize every selected block joined like a document fragment;
 * consecutive items of the same list type merge into one list. */
export function blocksToMarkdown(state: EditorState, ctx: WorkDocContext): string {
  const content: JSONContent[] = []
  for (const block of selectedBlocks(state)) {
    const json = blockToJSON(block)
    const prev = content[content.length - 1]
    if (prev?.type === json.type && LIST_TYPES.has(json.type ?? '') &&
      Array.isArray(prev.content) && Array.isArray(json.content)) {
      prev.content.push(...json.content)
    } else {
      content.push(json)
    }
  }
  return serializeWorkDocument({ type: 'doc', content }, ctx).trim()
}

/** Swap a block with its previous/next sibling. Returns the transaction or
 * null when already at the boundary. */
export function moveBlockTransaction(state: EditorState, target: BlockTarget, direction: -1 | 1): Transaction | null {
  const { pos, node } = target
  const parent = state.doc.resolve(pos).parent
  const index = state.doc.resolve(pos).index()
  const siblingIndex = index + direction
  if (siblingIndex < 0 || siblingIndex >= parent.childCount) return null
  const parentPos = pos - state.doc.resolve(pos).parentOffset - 1
  let cursor = parentPos + 1
  for (let i = 0; i < siblingIndex; i += 1) cursor += parent.child(i).nodeSize
  const sibling = parent.child(siblingIndex)
  const tr = state.tr
  const from = pos
  const to = pos + node.nodeSize
  const slice = state.doc.slice(from, to)
  if (direction === 1) {
    const insertPos = cursor + sibling.nodeSize
    tr.delete(from, to)
    const mapped = tr.mapping.map(insertPos, -1)
    tr.insert(mapped, slice.content)
    tr.setSelection(NodeSelection.create(tr.doc, mapped))
  } else {
    tr.delete(from, to)
    tr.insert(cursor, slice.content)
    tr.setSelection(NodeSelection.create(tr.doc, cursor))
  }
  return tr.scrollIntoView()
}

/** `相对路径#slug` for heading blocks; null for anything else. */
export function blockLinkForNode(node: PmNode, filePath: string, workspaceRoot: string): string | null {
  if (node.type.name !== 'heading') return null
  const text = node.textContent.trim()
  if (!text) return null
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  const path = filePath.replace(/\\/g, '/')
  const relative = root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
  return `${relative}#${workHeadingSlug(text)}`
}
