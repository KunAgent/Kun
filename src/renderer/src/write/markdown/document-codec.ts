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

/**
 * Structured-clone-safe snapshot of a context, for handing parsed results
 * back from a Web Worker. `blocks`/`doc` are already plain JSON.
 */
export type SerializedWorkContext = {
  frontmatter: string
  eol: '\n' | '\r\n'
  leading: string
  trailing: string
  firstBlockId?: string
  lastBlockId?: string
  separators: [string, string][]
  sourceMap: ReturnType<WorkSourceMap['toJSON']>
}

export function serializeWorkContext(ctx: WorkDocContext): SerializedWorkContext {
  return {
    frontmatter: ctx.frontmatter,
    eol: ctx.eol,
    leading: ctx.leading,
    trailing: ctx.trailing,
    ...(ctx.firstBlockId ? { firstBlockId: ctx.firstBlockId } : {}),
    ...(ctx.lastBlockId ? { lastBlockId: ctx.lastBlockId } : {}),
    separators: [...ctx.separators],
    sourceMap: ctx.sourceMap.toJSON()
  }
}

export function deserializeWorkContext(data: SerializedWorkContext): WorkDocContext {
  return {
    frontmatter: data.frontmatter,
    eol: data.eol,
    leading: data.leading,
    trailing: data.trailing,
    ...(data.firstBlockId ? { firstBlockId: data.firstBlockId } : {}),
    ...(data.lastBlockId ? { lastBlockId: data.lastBlockId } : {}),
    separators: new Map(data.separators),
    sourceMap: WorkSourceMap.fromJSON(data.sourceMap)
  }
}

function detectEol(source: string): '\n' | '\r\n' {
  const firstLf = source.indexOf('\n')
  return firstLf > 0 && source[firstLf - 1] === '\r' ? '\r\n' : '\n'
}

function toEol(text: string, eol: '\n' | '\r\n'): string {
  return eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text
}

export type ParsedWorkBlock = {
  blockId: string
  /** Verbatim source fragment (no trailing blank lines). */
  raw: string
}

export type ParsedWorkDocument = {
  doc: JSONContent
  ctx: WorkDocContext
  /** Top-level blocks in document order (block identity + source). */
  blocks: ParsedWorkBlock[]
}

/** Parse a full Markdown document (frontmatter preserved verbatim). */
export function parseWorkDocument(markdown: string): ParsedWorkDocument {
  const ctx = createWorkDocContext()
  const { frontmatter, body } = splitFrontmatter(markdown)
  ctx.frontmatter = frontmatter
  ctx.eol = detectEol(body)

  const root = parseMarkdownToMdast(body)
  const order: { blockId: string; start?: number; end?: number }[] = []
  const blocks: ParsedWorkBlock[] = []
  const doc = mdastToPm(root, {
    body,
    sourceMap: ctx.sourceMap,
    onTopBlock: (node, mdast) => {
      const blockId = String(node.attrs?.blockId ?? '')
      order.push({
        blockId,
        start: mdast.position?.start?.offset,
        end: mdast.position?.end?.offset
      })
      const start = mdast.position?.start?.offset
      const end = mdast.position?.end?.offset
      blocks.push({
        blockId,
        raw: typeof start === 'number' && typeof end === 'number'
          ? body.slice(start, end)
          : ''
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
  } else if (order.length === 0) {
    // No top-level blocks at all: the whole (whitespace-only) body is
    // leading context so an empty document serializes back byte-exactly.
    ctx.leading = body
  }

  if (!doc.content || doc.content.length === 0) {
    doc.content = [{ type: 'paragraph' }]
  }
  return { doc, ctx, blocks }
}

function blockStyleOptions(ctx: WorkDocContext, blockId: string | undefined): WorkMarkdownSerializeOptions {
  const style = ctx.sourceMap.styleOf(blockId)
  return {
    bullet: style.bulletMarker === '*' || style.bulletMarker === '+' ? style.bulletMarker : '-',
    fence: style.fence ?? '`'
  }
}

type EmittedBlock = {
  text: string
  blockId?: string
  unchanged: boolean
  /** Contentless paragraph — one blank line's worth of Markdown. */
  blank: boolean
}

function isEmptyParagraphJson(node: JSONContent): boolean {
  return node.type === 'paragraph' && (node.content ?? []).length === 0
}

function emitBlock(node: JSONContent, ctx: WorkDocContext): EmittedBlock {
  const blockId = typeof node.attrs?.blockId === 'string' ? node.attrs.blockId : undefined
  const blank = isEmptyParagraphJson(node)

  if (node.type === 'rawMarkdownBlock') {
    const raw = String(node.attrs?.raw ?? '')
    const original = ctx.sourceMap.sourceFor(blockId, `raw:${raw}`)
    return { text: original ?? raw, blockId, unchanged: original !== undefined, blank: false }
  }

  const mdast = pmBlockToMdast(node)
  const signature = semanticSignature(mdast)
  const original = ctx.sourceMap.sourceFor(blockId, signature)
  if (original !== undefined) {
    return { text: original, blockId, unchanged: true, blank }
  }

  if (blank) {
    // An empty paragraph contributes exactly one newline: with the
    // separator rules below it materializes as one blank line.
    return { text: toEol('\n', ctx.eol), blockId, unchanged: false, blank }
  }

  const cached = ctx.sourceMap.cachedSerialize(blockId, signature)
  if (cached !== undefined) {
    return { text: cached, blockId, unchanged: false, blank }
  }

  const serialized = mdastBlocksToMarkdown([mdast], blockStyleOptions(ctx, blockId))
    .replace(/\n+$/, '')
  const text = toEol(serialized, ctx.eol)
  ctx.sourceMap.cacheSerialize(blockId, signature, text)
  return { text, blockId, unchanged: false, blank }
}

/**
 * Separator before a non-blank emitted block that was never adjacent to
 * its predecessor in the source. A blank predecessor carries its own
 * newline, so nothing more is needed; between two real blocks we
 * guarantee at least one blank line even when the previous verbatim
 * fragment already ends with a newline, so a freshly inserted block can
 * never glue itself onto the previous Markdown block (`b` + `c` must not
 * become `b\nc`).
 */
function defaultSeparator(prev: EmittedBlock, ctx: WorkDocContext): string {
  if (prev.blank) return ''
  const trailingNewlines = prev.text.match(/\n*$/)?.[0].length ?? 0
  return toEol('\n'.repeat(Math.max(0, 2 - trailingNewlines)), ctx.eol)
}

/** Serialize a PM doc, reusing original fragments for unchanged blocks. */
export function serializeWorkDocument(doc: JSONContent, ctx: WorkDocContext): string {
  const content = doc.content ?? []
  // Leading/trailing empty paragraphs are editor artifacts (the user or PM
  // may leave them behind); Markdown cannot express them anyway — real
  // leading/trailing whitespace lives in ctx.leading / ctx.trailing.
  let start = 0
  let end = content.length
  while (start < end && isEmptyParagraphJson(content[start])) start += 1
  while (end > start && isEmptyParagraphJson(content[end - 1])) end -= 1

  const emitted = content
    .slice(start, end)
    .map((node) => emitBlock(node, ctx))
    .filter((block) => block.text !== '')

  let out = ''
  let prev: EmittedBlock | undefined
  for (const current of emitted) {
    if (prev) {
      const originalSep = prev.unchanged && current.unchanged && prev.blockId && current.blockId
        ? ctx.separators.get(`${prev.blockId}${current.blockId}`)
        : undefined
      out += originalSep ?? (current.blank ? toEol('\n', ctx.eol) : defaultSeparator(prev, ctx))
    }
    out += current.text
    prev = current
  }

  if (emitted.length === 0) {
    out = ctx.leading + ctx.trailing
    return joinFrontmatter(ctx.frontmatter, out)
  }

  // File-start whitespace (comments/blank lines before the first block) is
  // not part of any block — always keep it, even when the first block was
  // edited or replaced. Fresh contexts have empty leading anyway.
  out = ctx.leading + out
  // Same for the file's ending: `ctx.trailing` records it verbatim (which
  // may be '' — a file without a trailing newline must stay that way).
  // Only a never-parsed context (brand-new document) gets the conventional
  // single trailing newline.
  out += ctx.lastBlockId !== undefined ? ctx.trailing : toEol('\n', ctx.eol)
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
