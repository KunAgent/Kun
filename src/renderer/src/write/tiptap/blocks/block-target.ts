import type { Node as PmNode } from '@tiptap/pm/model'
import { NodeSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { isNodeRangeSelection } from '@tiptap/extension-node-range'
import { serializeWorkDocument, type WorkDocContext } from '../../markdown/document-codec'
import { workHeadingSlug } from '../../work-link'

/** A draggable/selectable block: position of the node in the document. */
export type BlockTarget = {
  pos: number
  node: PmNode
  depth: number
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
      return { pos: $pos.before(depth), node, depth }
    }
  }
  if ($pos.depth < 1) return null
  const node = $pos.node(1)
  if (NON_BLOCK_NAMES.has(node.type.name)) return null
  return { pos: $pos.before(1), node, depth: 1 }
}

/** The top-level (or list-item) block near a client coordinate, used by the
 * hover handle: `posAtCoords` just left of the text column. */
export function blockTargetFromCoords(view: EditorView, clientX: number, clientY: number): BlockTarget | null {
  const pos = view.posAtCoords({ left: clientX, top: clientY })?.pos
  if (pos === undefined) return null
  return blockTargetAtPos(view.state, pos)
}

/** Blocks covered by the current selection — one for NodeSelection, the
 * full range for a node-range selection, or the single block containing a
 * text selection. */
export function selectedBlocks(state: EditorState): BlockTarget[] {
  const selection = state.selection
  if (selection instanceof NodeSelection) {
    return [{ pos: selection.from, node: selection.node, depth: selection.$from.depth }]
  }
  if (isNodeRangeSelection(selection)) {
    const blocks: BlockTarget[] = []
    for (const range of selection.ranges) {
      const node = range.$from.nodeAfter
      if (!node || NON_BLOCK_NAMES.has(node.type.name)) continue
      blocks.push({ pos: range.$from.pos, node, depth: range.$from.depth })
    }
    if (blocks.length > 0) return blocks
  }
  const target = blockTargetAtPos(state, selection.$from.pos)
  return target ? [target] : []
}

/** Serialize one node through the work codec; original-registered blocks
 * come back verbatim. */
export function blockToMarkdown(node: PmNode, ctx: WorkDocContext): string {
  return serializeWorkDocument({ type: 'doc', content: [node.toJSON()] }, ctx).trim()
}

/** Serialize every selected block joined like a document fragment. */
export function blocksToMarkdown(state: EditorState, ctx: WorkDocContext): string {
  const content = selectedBlocks(state).map((block) => block.node.toJSON())
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
