/**
 * Schema validation for codec output (implementation §3.2 fallback path).
 *
 * `mdastToPm` converts mdast to PM JSON without a live schema, so edge
 * cases can produce nodes that violate content expressions — a listItem
 * whose first child is not a paragraph, phrasing nodes that ended up
 * where blocks belong, etc. Each converted top-level block is checked
 * with `node.check()`; failures degrade to a `rawMarkdownBlock` carrying
 * the registered verbatim source instead of throwing inside the editor.
 */
import type { JSONContent } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import type { WorkDocContext } from './document-codec'

export function sanitizeWorkDocContent(
  doc: JSONContent,
  ctx: WorkDocContext,
  schema: Schema
): JSONContent {
  const content = (doc.content ?? []).map((node) => {
    try {
      schema.nodeFromJSON(node).check()
      return node
    } catch {
      const blockId = typeof node.attrs?.blockId === 'string' ? node.attrs.blockId : undefined
      const raw = ctx.sourceMap.rawFor(blockId) ?? ''
      return {
        type: 'rawMarkdownBlock',
        attrs: { ...(blockId ? { blockId } : {}), raw, reason: 'schema' }
      }
    }
  })
  return { ...doc, content }
}
