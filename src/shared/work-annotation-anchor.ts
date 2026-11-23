import { z } from 'zod'

const point = z.object({
  nodeId: z.string().min(1).max(2048),
  offset: z.number().int().nonnegative(),
  page: z.number().int().positive()
})
const base = z.object({
  quote: z.string().min(1).max(32768),
  before: z.string().max(256),
  after: z.string().max(256)
})
const fraction = z.number().min(0).max(1)
export const workAnnotationAnchorSchema = z.discriminatedUnion('kind', [
  base.extend({
    kind: z.literal('markdown'),
    source: z.string().min(1).max(65536),
    from: z.number().int().nonnegative(),
    unique: z.boolean(),
    richText: z.literal(true).optional(),
    version: z.string().min(1).max(160)
  }),
  base.extend({
    kind: z.literal('word'),
    unique: z.boolean().optional(),
    version: z.string().min(1).max(160),
    start: point,
    end: point
  }),
  base.extend({
    kind: z.literal('pdf'),
    version: z.string().min(1).max(160),
    rects: z.array(z.object({ page: z.number().int().positive(), x: fraction, y: fraction,
      width: fraction.positive(), height: fraction.positive() })).min(1).max(2048)
  })
])

export type WorkAnnotationAnchor = z.infer<typeof workAnnotationAnchorSchema>
export type MarkdownAnnotationAnchor = Extract<WorkAnnotationAnchor, { kind: 'markdown' }>
export type WordAnnotationAnchor = Extract<WorkAnnotationAnchor, { kind: 'word' }>
export type PdfAnnotationAnchor = Extract<WorkAnnotationAnchor, { kind: 'pdf' }>
