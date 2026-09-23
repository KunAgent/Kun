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
import { remarkCallout, remarkWorkInline } from './remark-work-plugins'

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
  .use(remarkMath, { singleDollarTextMath: false })
  .use(remarkCallout)
  .use(remarkWorkInline)
  .freeze()

/**
 * Parse a Markdown body (frontmatter already split away) into an mdast tree.
 * `position.start/end.offset` is preserved for source slicing.
 */
export function parseWorkMdast(body: string): Root {
  const file = new VFile(body)
  const tree = processor.parse(file)
  return processor.runSync(tree, file) as Root
}
