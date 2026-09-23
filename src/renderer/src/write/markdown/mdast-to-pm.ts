/**
 * mdast → ProseMirror JSON conversion (implementation §3.2).
 *
 * Every top-level block gets a fresh `blockId` attribute; its verbatim
 * source fragment and semantic signature are registered in the provided
 * {@link WorkSourceMap} so unchanged blocks serialize back byte-identically.
 * Blocks the rich schema cannot represent become `rawMarkdownBlock` atoms
 * carrying their original source.
 */
import type { JSONContent } from '@tiptap/core'
import type { List, ListItem, PhrasingContent, Root, RootContent, Table, TableCell } from 'mdast'
import { classifyBlock, nodeSource, rawBlockReason, semanticSignature } from './block-fidelity'
import type { WorkSourceMap } from './source-map'

type PmMark = { type: string; attrs?: Record<string, unknown> }

type InlineCtx = { body: string }

type BlockCtx = InlineCtx & { sourceMap: WorkSourceMap }

const TASK_CHECK_RE = /^\[([ xX])\]\s+/

/** mdast `align` column value → PM cell `align` attr (null stays null). */
function cellAlign(align: Table['align'], index: number): string | null {
  const value = align?.[index]
  return value === 'left' || value === 'center' || value === 'right' ? value : null
}

function phrasing(nodes: PhrasingContent[] | undefined, marks: PmMark[], ctx: InlineCtx): JSONContent[] {
  const out: JSONContent[] = []
  for (const node of nodes ?? []) {
    // Custom construct — outside the mdast PhrasingContent union.
    if ((node.type as string) === 'wikiLink') {
      const w = node as unknown as { raw: string; target: string; heading?: string; alias?: string; embed: boolean }
      out.push({
        type: 'wikiLink',
        attrs: {
          target: w.target,
          heading: w.heading ?? null,
          alias: w.alias ?? null,
          embed: w.embed,
          raw: w.raw
        }
      })
      continue
    }
    switch (node.type) {
      case 'text':
        out.push({ type: 'text', text: node.value, ...(marks.length ? { marks } : {}) })
        break
      case 'emphasis':
        out.push(...phrasing(node.children, [...marks, { type: 'italic' }], ctx))
        break
      case 'strong':
        out.push(...phrasing(node.children, [...marks, { type: 'bold' }], ctx))
        break
      case 'delete':
        out.push(...phrasing(node.children, [...marks, { type: 'strike' }], ctx))
        break
      case 'inlineCode':
        out.push({ type: 'text', text: node.value, marks: [...marks, { type: 'code' }] })
        break
      case 'break':
        out.push({ type: 'hardBreak' })
        break
      case 'link':
        out.push(...phrasing(node.children, [...marks, {
          type: 'link',
          attrs: { href: node.url ?? '', title: node.title ?? null }
        }], ctx))
        break
      case 'linkReference':
        out.push(...phrasing(node.children, [...marks, {
          type: 'link',
          attrs: {
            href: '',
            title: null,
            identifier: node.identifier,
            label: node.label ?? null,
            reference: node.referenceType
          }
        }], ctx))
        break
      case 'image':
        out.push({
          type: 'image',
          attrs: { src: node.url ?? '', alt: node.alt ?? '', title: node.title ?? null }
        })
        break
      case 'imageReference':
        out.push({
          type: 'image',
          attrs: {
            src: '',
            alt: node.alt ?? '',
            title: null,
            identifier: node.identifier,
            label: node.label ?? null,
            reference: node.referenceType
          }
        })
        break
      case 'inlineMath':
        out.push({ type: 'inlineMath', attrs: { latex: node.value } })
        break
      case 'footnoteReference':
        out.push({
          type: 'footnoteReference',
          attrs: { identifier: node.identifier, label: node.label ?? null }
        })
        break
      case 'html': {
        const raw = nodeSource(ctx.body, node) ?? node.value
        out.push({ type: 'inlineHtml', attrs: { raw } })
        break
      }
      default: {
        // Unknown inline construct: keep its source verbatim in an atom so
        // nothing is dropped or silently re-flowed.
        const raw = nodeSource(ctx.body, node)
        if (raw) {
          out.push({ type: 'inlineHtml', attrs: { raw } })
        } else {
          const text = (node as { value?: string }).value
          if (text) out.push({ type: 'text', text, ...(marks.length ? { marks } : {}) })
        }
      }
    }
  }
  return out
}

function listItemToPm(item: ListItem, asTask: boolean, ctx: BlockCtx): JSONContent {
  if (asTask) {
    return {
      type: 'taskItem',
      attrs: { checked: item.checked === true },
      content: blocks(item.children, ctx)
    }
  }
  const content = blocks(item.children, ctx)
  // A checked item inside a plain bullet list keeps `[x]`/`[ ]` as literal
  // text so editing the list never loses the marker characters.
  if (item.checked !== null && item.checked !== undefined) {
    const marker = `[${item.checked ? 'x' : ' '}] `
    const first = content[0]
    if (first?.type === 'paragraph' && Array.isArray(first.content)) {
      first.content.unshift({ type: 'text', text: marker })
    } else {
      content.unshift({ type: 'paragraph', content: [{ type: 'text', text: marker }] })
    }
  }
  return { type: 'listItem', content }
}

function listToPm(node: List, ctx: BlockCtx): JSONContent {
  const allTasks = node.children.length > 0 &&
    node.children.every((item) => item.checked !== null && item.checked !== undefined)
  const tight = !node.spread
  if (allTasks) {
    return {
      type: 'taskList',
      attrs: { tight },
      content: node.children.map((item) => listItemToPm(item, true, ctx))
    }
  }
  if (node.ordered) {
    return {
      type: 'orderedList',
      attrs: { start: node.start ?? 1, tight },
      content: node.children.map((item) => listItemToPm(item, false, ctx))
    }
  }
  return {
    type: 'bulletList',
    attrs: { tight },
    content: node.children.map((item) => listItemToPm(item, false, ctx))
  }
}

function tableToPm(node: Table, ctx: BlockCtx): JSONContent {
  const rows = node.children.map((row, rowIndex) => ({
    type: 'tableRow',
    content: row.children.map((cell: TableCell, cellIndex) => ({
      type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
      attrs: { align: cellAlign(node.align, cellIndex) },
      content: [{ type: 'paragraph', content: phrasing(cell.children, [], ctx) }]
    }))
  }))
  return { type: 'table', content: rows }
}

/** Detect the bullet/ordered marker + fence style from the raw fragment. */
function detectBlockStyle(node: RootContent, raw: string | undefined): { bulletMarker?: string; orderedMarker?: string; fence?: '`' | '~' } {
  if (!raw) return {}
  if (node.type === 'list' && !node.ordered) {
    const match = raw.match(/^\s*([-+*])/)
    return match ? { bulletMarker: match[1] } : {}
  }
  if (node.type === 'list' && node.ordered) {
    const match = raw.match(/^\s*\d+([.)])/)
    return match ? { orderedMarker: match[1] } : {}
  }
  if (node.type === 'code') {
    const ch = raw.trimStart().charAt(0)
    if (ch === '`' || ch === '~') return { fence: ch }
  }
  return {}
}

function richBlock(node: RootContent, ctx: BlockCtx): JSONContent {
  // Custom construct — outside the mdast RootContent union.
  if ((node.type as string) === 'callout') {
    const c = node as unknown as { calloutType: string; calloutTypeRaw: string; title?: string; children: RootContent[] }
    return {
      type: 'callout',
      attrs: {
        calloutType: c.calloutType,
        calloutTypeRaw: c.calloutTypeRaw ?? c.calloutType,
        title: c.title ?? null
      },
      content: blocks(c.children, ctx)
    }
  }
  switch (node.type) {
    case 'paragraph':
      return { type: 'paragraph', content: phrasing(node.children, [], ctx) }
    case 'heading':
      return { type: 'heading', attrs: { level: node.depth }, content: phrasing(node.children, [], ctx) }
    case 'blockquote':
      return { type: 'blockquote', content: blocks(node.children, ctx) }
    case 'list':
      return listToPm(node, ctx)
    case 'code':
      return {
        type: 'codeBlock',
        attrs: {
          language: node.lang ?? null,
          meta: node.meta ?? null
        },
        content: node.value ? [{ type: 'text', text: node.value }] : []
      }
    case 'math':
      return {
        type: 'blockMath',
        attrs: { latex: node.value, meta: (node as { meta?: string | null }).meta ?? null }
      }
    case 'thematicBreak':
      return { type: 'horizontalRule' }
    case 'table':
      return tableToPm(node, ctx)
    default:
      return { type: 'paragraph', content: [] }
  }
}

function blocks(children: RootContent[] | undefined, ctx: BlockCtx): JSONContent[] {
  const out: JSONContent[] = []
  for (const child of children ?? []) {
    if (classifyBlock(child) === 'raw') {
      const raw = nodeSource(ctx.body, child) ?? ''
      out.push({ type: 'rawMarkdownBlock', attrs: { raw, reason: rawBlockReason(child) } })
      continue
    }
    const converted = richBlock(child, ctx)
    if (converted.type === 'paragraph' && child.type !== 'paragraph') {
      // richBlock fell through to the empty-paragraph default: keep source.
      const raw = nodeSource(ctx.body, child) ?? ''
      out.push({ type: 'rawMarkdownBlock', attrs: { raw, reason: rawBlockReason(child) } })
      continue
    }
    out.push(converted)
  }
  return out
}

export type MdastToPmOptions = {
  body: string
  sourceMap: WorkSourceMap
  /** Called for every emitted top-level node in document order. */
  onTopBlock?: (node: JSONContent, mdast: RootContent) => void
}

/**
 * Convert a parsed mdast root to a PM `doc` JSON. Top-level blocks receive a
 * `blockId` attr and are registered (source + signature + style) in
 * `sourceMap`.
 */
export function mdastToPm(root: Root, options: MdastToPmOptions): JSONContent {
  const ctx: BlockCtx = { body: options.body, sourceMap: options.sourceMap }
  const content: JSONContent[] = []
  for (const child of root.children) {
    const blockId = options.sourceMap.nextBlockId()
    const raw = nodeSource(options.body, child) ?? ''
    const isRaw = classifyBlock(child) === 'raw'
    const signature = isRaw
      ? `raw:${raw}`
      : semanticSignature(child)
    options.sourceMap.register(blockId, raw, signature)
    options.sourceMap.setStyle(blockId, detectBlockStyle(child, raw))

    const node: JSONContent = isRaw
      ? { type: 'rawMarkdownBlock', attrs: { blockId, raw, reason: rawBlockReason(child) } }
      : { ...richBlock(child, ctx) }
    if (!isRaw) node.attrs = { ...(node.attrs ?? {}), blockId }
    content.push(node)
    options.onTopBlock?.(node, child)
  }
  return { type: 'doc', content }
}
