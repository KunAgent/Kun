/**
 * mdast → Markdown serialization (implementation §3.4).
 *
 * Wraps `mdast-util-to-markdown` with the GFM/math/frontmatter extensions and
 * handlers for the Work custom nodes (`workRaw`, `wikiLink`). `callout`
 * nodes are expanded back to `> [!type]` blockquotes before serialization so
 * the standard blockquote writer applies.
 */
import { toMarkdown, type Options as ToMarkdownOptions, type Handle } from 'mdast-util-to-markdown'
import { gfmToMarkdown } from 'mdast-util-gfm'
import { mathToMarkdown } from 'mdast-util-math'
import { frontmatterToMarkdown } from 'mdast-util-frontmatter'
import type { Node } from 'unist'
import type { PhrasingContent } from 'mdast'

type LooseNode = Node & {
  type: string
  value?: string
  raw?: string
  children?: LooseNode[]
  calloutType?: string
  calloutTypeRaw?: string
  title?: string
}

const workHandlers: Record<string, Handle> = {
  workRaw(node) {
    return String((node as LooseNode).raw ?? '')
  },
  wikiLink(node) {
    return String((node as LooseNode).raw ?? '')
  }
}

/** Rebuild a `callout` node as a `> [!type] title` blockquote. */
function calloutToBlockquote(node: LooseNode): LooseNode {
  const marker = `[!${node.calloutTypeRaw ?? node.calloutType ?? 'note'}]${node.title ? ` ${node.title}` : ''}`
  const markerParagraph: LooseNode = {
    type: 'paragraph',
    children: [{ type: 'text', value: marker } as unknown as LooseNode]
  }
  return {
    type: 'blockquote',
    children: [markerParagraph, ...(node.children ?? [])]
  }
}

function expand(node: LooseNode): LooseNode {
  const expandedChildren = node.children?.map((child) => expand(child))
  const current: LooseNode = expandedChildren ? { ...node, children: expandedChildren } : node
  return current.type === 'callout' ? calloutToBlockquote(current) : current
}

/**
 * Deep-expand work-only nodes (`callout`) into portable mdast. The result is
 * safe to feed to `toMarkdown` or to signature-compare against reparsed
 * trees.
 */
export function expandWorkNodes<T extends Node>(node: T): T {
  return expand(node as LooseNode) as unknown as T
}

export type WorkMarkdownSerializeOptions = {
  /** Bullet marker for lists: `-`, `*`, or `+`. Default `-`. */
  bullet?: '-' | '*' | '+'
  /** Fence marker for code blocks. Default backtick. */
  fence?: '`' | '~'
  /** Extra mdast-util-to-markdown option overrides. */
  overrides?: Partial<ToMarkdownOptions>
}

const baseOptions = (opts: WorkMarkdownSerializeOptions): ToMarkdownOptions => ({
  bullet: opts.bullet ?? '-',
  fence: opts.fence ?? '`',
  fences: true,
  listItemIndent: 'one',
  handlers: workHandlers,
  extensions: [
    gfmToMarkdown(),
    mathToMarkdown(),
    frontmatterToMarkdown(['yaml'])
  ],
  ...opts.overrides
})

/** Serialize a fragment (one or more mdast blocks) to Markdown. */
export function mdastBlocksToMarkdown(
  nodes: Node[],
  options: WorkMarkdownSerializeOptions = {}
): string {
  const expanded = nodes.map((node) => expandWorkNodes(node))
  return toMarkdown(
    { type: 'root', children: expanded } as unknown as Parameters<typeof toMarkdown>[0],
    baseOptions(options)
  )
}
