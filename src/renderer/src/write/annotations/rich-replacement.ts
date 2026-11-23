import { EditorState } from '@tiptap/pm/state'
import { parseWorkDocument, serializeWorkDocument } from '../markdown/document-codec'
import { sanitizeWorkDocContent } from '../markdown/schema-check'
import { workCodecSchema } from '../tiptap/markdown-manager'
import { replaceRangeWithMarkdown } from '../tiptap/markdown-insert'
import { richAnnotationPositions } from './rich-anchor'

/** Prepare a review without mutating either the editor or the source file. */
export function replaceRichAnnotation(source: string, target: { from: number; to: number }, replacement: string): string | null {
  const parsed = parseWorkDocument(source), schema = workCodecSchema()
  const doc = schema.nodeFromJSON(sanitizeWorkDocContent(parsed.doc, parsed.ctx, schema))
  const positions = richAnnotationPositions(doc, source, target)
  if (!positions || serializeWorkDocument(doc.toJSON(), parsed.ctx) !== source) return null
  const state = EditorState.create({ schema, doc })
  let next: string | null = null
  replaceRangeWithMarkdown(state, (transaction) => {
    next = serializeWorkDocument(transaction.doc.toJSON(), parsed.ctx)
  }, positions.from, positions.to, replacement)
  return next === source ? null : next
}
