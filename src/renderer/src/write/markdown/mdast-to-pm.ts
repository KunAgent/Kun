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

/**
 * PM requires a listItem's first child to be a paragraph. When mdast gives
 * the item a different leading block (e.g. `- ```code````), synthesize an
 * empty leading paragraph flagged `workAuto` so serialization can drop it
 * again and the block keeps its original signature.
 */
function ensureLeadingParagraph(content: JSONContent[]): JSONContent[] {
  if (content.length === 0) return content
  const first = content[0]
  if (first.type === 'paragraph') return content
  return [{ type: 'paragraph', attrs: { workAuto: true }, content: [] }, ...content]
}

function listItemToPm(item: ListItem, asTask: boolean, ctx: BlockCtx): JSONContent {
  if (asTask) {
    return {
      type: 'taskItem',
      attrs: { checked: item.checked === true },
      content: ensureLeadingParagraph(blocks(item.children, ctx))
    }
  }
  const content = ensureLeadingParagraph(blocks(item.children, ctx))
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
      return {
        type: 'paragraph',
        // Continuation line of a split source paragraph (soft-line-split.ts).
        ...(node.data && (node.data as { workSoftLine?: boolean }).workSoftLine ? { attrs: { softLine: true } } : {}),
        content: phrasing(node.children, [], ctx)
      }
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

const HTML_OPEN_TAG_RE = /^<([A-Za-z][A-Za-z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>$/
const HTML_VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr'
])

/**
 * Merge `<div align="center"> … </div>`-style wrappers into one mdast html
 * node spanning open tag → matching close tag. micromark splits such
 * wrappers at blank lines ("open tag / inner blocks / close tag"), which
 * would otherwise produce three stray blocks and lose the wrapping effect.
 */
function mergeHtmlWrappers(children: RootContent[] | undefined, ctx: InlineCtx): RootContent[] {
  const list = children ?? []
  const out: RootContent[] = []
  for (let index = 0; index < list.length; index += 1) {
    const child = list[index]
    let merged = false
    if (child.type === 'html') {
      const open = child.value.trim().match(HTML_OPEN_TAG_RE)
      const tag = open?.[1]?.toLowerCase()
      if (open && tag && !HTML_VOID_TAGS.has(tag) && !open[2].trimEnd().endsWith('/')) {
        const closeTag = `</${tag}>`
        for (let scan = index + 1; scan < list.length; scan += 1) {
          const sibling = list[scan]
          if (sibling.type === 'html' && sibling.value.trim() === closeTag) {
            const start = child.position?.start?.offset
            const end = sibling.position?.end?.offset
            const value = typeof start === 'number' && typeof end === 'number'
              ? ctx.body.slice(start, end)
              : `${child.value}${closeTag}`
            out.push({
              type: 'html',
              value,
              ...(child.position && sibling.position
                ? { position: { start: child.position.start, end: sibling.position.end } }
                : {})
            } as RootContent)
            index = scan
            merged = true
            break
          }
        }
      }
    }
    if (!merged) out.push(child)
  }
  return out
}

function blocks(children: RootContent[] | undefined, ctx: BlockCtx): JSONContent[] {
  const out: JSONContent[] = []
  for (const child of mergeHtmlWrappers(children, ctx)) {
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
/** Fake mdast paragraph covering a single `\n`, used for blank-line blocks. */
function blankLineMdast(offset: number): RootContent {
  return {
    type: 'paragraph',
    children: [],
    position: {
      start: { offset, line: 0, column: 0 },
      end: { offset: offset + 1, line: 0, column: 0 }
    }
  } as RootContent
}

export function mdastToPm(root: Root, options: MdastToPmOptions): JSONContent {
  const ctx: BlockCtx = { body: options.body, sourceMap: options.sourceMap }
  const content: JSONContent[] = []
  const children = mergeHtmlWrappers(root.children, ctx)
  let prevEnd: number | undefined
  for (const child of children) {
    // Blank-line fidelity: every blank line beyond the two newlines that
    // separate adjacent blocks becomes its own empty paragraph (registered
    // as a `\n` source fragment), so `a\n\n\n\nb` surfaces the two extra
    // blank lines as editable empty blocks instead of hiding them inside
    // `a`'s verbatim source.
    const start = child.position?.start?.offset
    if (typeof prevEnd === 'number' && typeof start === 'number' && start > prevEnd) {
      const gap = options.body.slice(prevEnd, start)
      const newlineOffsets: number[] = []
      for (let i = 0; i < gap.length; i += 1) {
        if (gap.charCodeAt(i) === 10) newlineOffsets.push(prevEnd + i)
      }
      for (let k = 0; k + 2 < newlineOffsets.length; k += 1) {
        const offset = newlineOffsets[k + 1]
        const mdast = blankLineMdast(offset)
        const blockId = options.sourceMap.nextBlockId()
        options.sourceMap.register(
          blockId,
          '\n',
          semanticSignature({ type: 'paragraph', children: [] } as unknown as RootContent)
        )
        const emptyNode: JSONContent = { type: 'paragraph', attrs: { blockId } }
        content.push(emptyNode)
        options.onTopBlock?.(emptyNode, mdast)
      }
    }
    if (typeof start === 'number' && child.position?.end?.offset !== undefined) {
      prevEnd = child.position.end.offset
    }

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
