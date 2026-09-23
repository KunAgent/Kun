/**
 * Block-level fidelity machinery (implementation §3.6).
 *
 * `semanticSignature` gives a stable identity for a block's *content*:
 * positions, `data` metadata, and null-valued fields are ignored so an
 * unchanged block compares equal no matter where it sits in the document.
 * `classifyBlock` decides whether a parsed mdast block can live in the rich
 * schema or must become a `rawMarkdownBlock`.
 */
import type { Node as UnistNode } from 'unist'

/** mdast block types that have a native rich representation. */
const RICH_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'list',
  'code',
  'math',
  'thematicBreak',
  'table',
  'callout'
])

/** Everything else keeps its source verbatim inside a raw block. */
export function classifyBlock(node: UnistNode): 'rich' | 'raw' {
  return RICH_BLOCK_TYPES.has(node.type) ? 'rich' : 'raw'
}

/** Human-facing reason stored on a raw block (also used by the NodeView). */
export function rawBlockReason(node: UnistNode): string {
  switch (node.type) {
    case 'html': return 'html'
    case 'definition': return 'link-definition'
    case 'footnoteDefinition': return 'footnote-definition'
    case 'yaml': return 'frontmatter'
    default:
      if (node.type.startsWith('mdx') || node.type.startsWith('mdxJsx')) return 'mdx'
      if (node.type.endsWith('Directive')) return 'directive'
      return node.type
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (key === 'position' || key === 'data') continue
      const item = canonicalize((value as Record<string, unknown>)[key])
      if (item === null || item === undefined) continue
      out[key] = item
    }
    return out
  }
  return value
}

/** Stable signature for change detection; ignores position/data/nulls. */
export function semanticSignature(node: UnistNode): string {
  return JSON.stringify(canonicalize(node))
}

/**
 * Slice a node's verbatim source fragment from the document body using its
 * mdast position offsets. Returns `undefined` when offsets are missing.
 */
export function nodeSource(body: string, node: UnistNode): string | undefined {
  const position = (node as { position?: { start?: { offset?: number }; end?: { offset?: number } } }).position
  const start = position?.start?.offset
  const end = position?.end?.offset
  if (typeof start !== 'number' || typeof end !== 'number' || end < start) return undefined
  return body.slice(start, end)
}
