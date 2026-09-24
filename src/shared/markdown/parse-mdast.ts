/**
 * Shared remark parse pipeline used by the renderer editor codec and the
 * export renderer (implementation §3.1, §10.1). Single source of truth for
 * plugin order and options.
 */
import { unified, type Processor } from 'unified'
import remarkParse from 'remark-parse'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMath from 'remark-math'
import { VFile } from 'vfile'
import type { Root } from 'mdast'
import { gfmAutolinkLiteral } from 'micromark-extension-gfm-autolink-literal'
import { gfmFootnote } from 'micromark-extension-gfm-footnote'
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough'
import { gfmTable } from 'micromark-extension-gfm-table'
import { gfmTaskListItem } from 'micromark-extension-gfm-task-list-item'
import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal'
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote'
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough'
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table'
import { gfmTaskListItemFromMarkdown } from 'mdast-util-gfm-task-list-item'
import { remarkCallout, remarkDemoteFalseMath, remarkWorkInline } from './remark-work-plugins'

/**
 * GFM syntax registered as individual extensions instead of the
 * `remark-gfm`/`micromark-extension-gfm` bundle. Same constructs (autolink
 * literals, footnotes, strikethrough, tables, task list items) but the
 * separate registration measurably beats `combineExtensions` on large
 * documents (~20% faster parse at 300k chars).
 */
function remarkGfmWork(this: Processor) {
  const data = this.data()
  const add = (field: 'micromarkExtensions' | 'fromMarkdownExtensions', ext: unknown) => {
    const list = (data[field] ?? (data[field] = [])) as unknown[]
    list.push(ext)
  }
  add('micromarkExtensions', gfmAutolinkLiteral())
  add('fromMarkdownExtensions', gfmAutolinkLiteralFromMarkdown())
  add('micromarkExtensions', gfmFootnote())
  add('fromMarkdownExtensions', gfmFootnoteFromMarkdown())
  add('micromarkExtensions', gfmStrikethrough())
  add('fromMarkdownExtensions', gfmStrikethroughFromMarkdown())
  add('micromarkExtensions', gfmTable())
  add('fromMarkdownExtensions', gfmTableFromMarkdown())
  add('micromarkExtensions', gfmTaskListItem())
  add('fromMarkdownExtensions', gfmTaskListItemFromMarkdown())
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfmWork)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkMath, { singleDollarTextMath: true })
  .use(remarkDemoteFalseMath)
  .use(remarkCallout)
  .use(remarkWorkInline)
  .freeze()

/**
 * An odd count of `$$` fences would swallow everything after the last one
 * into a math block (the fence never closes). Escape that dangling fence
 * with `\$\$` before parsing — micromark then leaves it as literal text.
 * Returns the modified text plus the offsets of the inserted `\` chars.
 */
const BLOCK_MATH_FENCE_RE = /^[^\S\n]*\$\$/gm

function escapeUnclosedBlockMath(body: string): { text: string; inserts: number[] } {
  const fences = [...body.matchAll(BLOCK_MATH_FENCE_RE)]
  if (fences.length % 2 === 0) return { text: body, inserts: [] }
  const last = fences[fences.length - 1]
  const at = last.index + last[0].length - 2
  return {
    text: `${body.slice(0, at)}\\$\\$${body.slice(at + 2)}`,
    inserts: [at, at + 2]
  }
}

/**
 * Rewrites every position offset in the tree from the *modified* source's
 * coordinate space back to the original body's: each inserted character
 * shifts subsequent offsets by one, so subtract the count of insertions
 * before each offset. Downstream slicing (`nodeSource`, separators,
 * leading/trailing) then works on the untouched source — verbatim.
 */
function remapPositions(node: unknown, inserts: number[]): void {
  const n = node as {
    position?: { start?: { offset?: number }; end?: { offset?: number } }
    children?: unknown[]
  }
  const shift = (offset: number): number =>
    offset - inserts.filter((i) => i < offset).length
  if (n.position) {
    const start = n.position.start?.offset
    const end = n.position.end?.offset
    if (typeof start === 'number') n.position.start!.offset = shift(start)
    if (typeof end === 'number') n.position.end!.offset = shift(end)
  }
  for (const child of n.children ?? []) remapPositions(child, inserts)
}

/**
 * Parse a Markdown body (frontmatter already split away) into an mdast tree.
 * `position.start/end.offset` refers to the *original* `body` even when an
 * unclosed `$$` had to be escaped internally.
 */
export function parseWorkMdast(body: string): Root {
  const { text, inserts } = escapeUnclosedBlockMath(body)
  const file = new VFile(text)
  const tree = processor.runSync(processor.parse(file), file) as Root
  if (inserts.length > 0) remapPositions(tree, inserts)
  return tree
}
