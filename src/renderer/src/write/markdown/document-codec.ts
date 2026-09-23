/**
 * Public Work-document codec (implementation §3.5).
 *
 * `parseWorkDocument` returns a ProseMirror doc plus a {@link WorkDocContext}
 * the caller keeps for the life of the document. `serializeWorkDocument`
 * re-emits unchanged blocks from their registered source fragments, so:
 *   - an unedited document serializes byte-identically, and
 *   - editing one block only changes that block's output.
 */
import type { JSONContent } from '@tiptap/core'
import { splitFrontmatter, joinFrontmatter } from '@shared/markdown/frontmatter'
import { parseMarkdownToMdast } from './remark-pipeline'
import { mdastToPm } from './mdast-to-pm'
import { pmBlockToMdast } from './pm-to-mdast'
import { mdastBlocksToMarkdown, type WorkMarkdownSerializeOptions } from './to-markdown'
import { semanticSignature } from './block-fidelity'
import { WorkSourceMap } from './source-map'

export type WorkDocContext = {
  /** Verbatim leading frontmatter block (`---\n…\n---\n`), empty when absent. */
  frontmatter: string
  /** Dominant line ending of the parsed source. */
  eol: '\n' | '\r\n'
  /** Source before the first top-level block. */
  leading: string
  /** Source after the last top-level block. */
  trailing: string
  /** blockId of the original first/last top-level block. */
  firstBlockId?: string
  lastBlockId?: string
  /** Separators between originally-adjacent blocks: `${idA}\0${idB}` → text. */
  separators: Map<string, string>
  sourceMap: WorkSourceMap
}

export function createWorkDocContext(): WorkDocContext {
  return {
    frontmatter: '',
    eol: '\n',
    leading: '',
    trailing: '',
    separators: new Map(),
    sourceMap: new WorkSourceMap()
  }
}

function detectEol(source: string): '\n' | '\r\n' {
  const firstLf = source.indexOf('\n')
  return firstLf > 0 && source[firstLf - 1] === '\r' ? '\r\n' : '\n'
}

function toEol(text: string, eol: '\n' | '\r\n'): string {
  return eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text
}

export type ParsedWorkDocument = {
  doc: JSONContent
  ctx: WorkDocContext
}

/** Parse a full Markdown document (frontmatter preserved verbatim). */
export function parseWorkDocument(markdown: string): ParsedWorkDocument {
  const ctx = createWorkDocContext()
  const { frontmatter, body } = splitFrontmatter(markdown)
  ctx.frontmatter = frontmatter
  ctx.eol = detectEol(body)

  const root = parseMarkdownToMdast(body)
  const order: { blockId: string; start?: number; end?: number }[] = []
  const doc = mdastToPm(root, {
    body,
    sourceMap: ctx.sourceMap,
    onTopBlock: (node, mdast) => {
      order.push({
        blockId: String(node.attrs?.blockId ?? ''),
        start: mdast.position?.start?.offset,
        end: mdast.position?.end?.offset
      })
    }
  })

  const allPositioned = order.length > 0 &&
    order.every((o) => o.start !== undefined && o.end !== undefined)
  if (allPositioned) {
    ctx.leading = body.slice(0, order[0].start!)
    ctx.trailing = body.slice(order[order.length - 1].end!)
    ctx.firstBlockId = order[0].blockId
    ctx.lastBlockId = order[order.length - 1].blockId
    for (let i = 0; i + 1 < order.length; i++) {
      const sep = body.slice(order[i].end!, order[i + 1].start!)
      ctx.separators.set(`${order[i].blockId}${order[i + 1].blockId}`, sep)
    }
  }

  if (!doc.content || doc.content.length === 0) {
    doc.content = [{ type: 'paragraph' }]
  }
  return { doc, ctx }
}

function blockStyleOptions(ctx: WorkDocContext, blockId: string | undefined): WorkMarkdownSerializeOptions {
  const style = ctx.sourceMap.styleOf(blockId)
  return {
    bullet: style.bulletMarker === '*' || style.bulletMarker === '+' ? style.bulletMarker : '-',
    fence: style.fence ?? '`'
  }
}

type EmittedBlock = { text: string; blockId?: string; unchanged: boolean }

function emitBlock(node: JSONContent, ctx: WorkDocContext): EmittedBlock {
  const blockId = typeof node.attrs?.blockId === 'string' ? node.attrs.blockId : undefined

  if (node.type === 'rawMarkdownBlock') {
    const raw = String(node.attrs?.raw ?? '')
    const original = ctx.sourceMap.sourceFor(blockId, `raw:${raw}`)
    return { text: original ?? raw, blockId, unchanged: original !== undefined }
  }

  const mdast = pmBlockToMdast(node)
  const signature = semanticSignature(mdast)
  const original = ctx.sourceMap.sourceFor(blockId, signature)
  if (original !== undefined) {
    return { text: original, blockId, unchanged: true }
  }

  const cached = ctx.sourceMap.cachedSerialize(blockId, signature)
  if (cached !== undefined) {
    return { text: cached, blockId, unchanged: false }
  }

  const serialized = mdastBlocksToMarkdown([mdast], blockStyleOptions(ctx, blockId))
    .replace(/\n+$/, '')
  const text = toEol(serialized, ctx.eol)
  ctx.sourceMap.cacheSerialize(blockId, signature, text)
  return { text, blockId, unchanged: false }
}

/** Serialize a PM doc, reusing original fragments for unchanged blocks. */
export function serializeWorkDocument(doc: JSONContent, ctx: WorkDocContext): string {
  const emitted = (doc.content ?? [])
    .map((node) => emitBlock(node, ctx))
    // Empty paragraphs carry no Markdown meaning; skip their emission so a
    // PM-internal blank block never adds stray blank lines to the file.
    .filter((block, index, all) => block.text !== '' || all.length === 1)

  let out = ''
  let prev: EmittedBlock | undefined
  for (const current of emitted) {
    if (prev) {
      const originalSep = prev.unchanged && current.unchanged && prev.blockId && current.blockId
        ? ctx.separators.get(`${prev.blockId}${current.blockId}`)
        : undefined
      out += originalSep ?? toEol('\n\n', ctx.eol)
    }
    out += current.text
    prev = current
  }

  const first = emitted[0]
  const last = emitted[emitted.length - 1]
  if (first?.unchanged && first.blockId && first.blockId === ctx.firstBlockId) {
    out = ctx.leading + out
  }
  if (last?.unchanged && last.blockId && last.blockId === ctx.lastBlockId) {
    out += ctx.trailing
  } else if (emitted.length) {
    out += toEol('\n', ctx.eol)
  }
  return joinFrontmatter(ctx.frontmatter, out)
}

/** Compat: parse without keeping context (full normalize on serialize). */
export function parseWorkMarkdown(markdown: string): JSONContent {
  return parseWorkDocument(markdown).doc
}

/** Compat: serialize a standalone doc with no preserved context. */
export function serializeWorkDocumentStandalone(doc: JSONContent): string {
  return serializeWorkDocument(doc, createWorkDocContext())
}
