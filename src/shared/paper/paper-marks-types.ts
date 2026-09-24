import { z } from 'zod'

/**
 * `marks/` per paper unit (plan §5.4):
 *   <unit>/marks/annotations.json  { version: 1, items: Highlight[] }
 *   <unit>/marks/<id>.json         translate / ask cards
 *   <unit>/marks/assets/           reserved for PM6 clip images
 */

export const PAPER_MARKS_DIR_NAME = 'marks'
export const PAPER_MARKS_ANNOTATIONS_FILE = 'annotations.json'

export const paperHighlightColorSchema = z.enum(['yellow', 'green', 'blue', 'pink'])
export type PaperHighlightColor = z.infer<typeof paperHighlightColorSchema>

/** [x, y, w, h] normalized to the page (0..1). */
export const paperRectSchema = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1)
])
export type PaperRect = z.infer<typeof paperRectSchema>

export const paperHighlightSchema = z
  .object({
    id: z.string().min(1).max(80),
    kind: z.literal('highlight'),
    color: paperHighlightColorSchema,
    page: z.number().int().min(1),
    rects: z.array(paperRectSchema).min(1).max(64),
    quote: z.string().max(8000),
    comment: z.string().max(8000).optional(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
  .strict()
export type PaperHighlight = z.infer<typeof paperHighlightSchema>

export const paperAnnotationsFileSchema = z
  .object({
    version: z.literal(1),
    items: z.array(paperHighlightSchema).max(2000)
  })
  .strict()
export type PaperAnnotationsFile = z.infer<typeof paperAnnotationsFileSchema>

export const paperTranslateMarkSchema = z
  .object({
    id: z.string().min(1).max(80),
    kind: z.literal('translate'),
    page: z.number().int().min(1),
    rects: z.array(paperRectSchema).max(64),
    quote: z.string().max(8000),
    translation: z.string().max(16000),
    targetLanguage: z.enum(['zh', 'en']),
    model: z.string(),
    createdAt: z.string()
  })
  .strict()
export type PaperTranslateMark = z.infer<typeof paperTranslateMarkSchema>

export const paperAskMarkSchema = z
  .object({
    id: z.string().min(1).max(80),
    kind: z.literal('ask'),
    page: z.number().int().min(1),
    rects: z.array(paperRectSchema).max(64),
    quote: z.string().max(8000),
    question: z.string().max(4000),
    threadId: z.string().optional(),
    createdAt: z.string()
  })
  .strict()
export type PaperAskMark = z.infer<typeof paperAskMarkSchema>

/** Merge by id: incoming items win; local items not in `incoming` are kept. */
export function mergePaperHighlights(
  local: readonly PaperHighlight[],
  incoming: readonly PaperHighlight[]
): PaperHighlight[] {
  const incomingIds = new Set(incoming.map((item) => item.id))
  const kept = local.filter((item) => !incomingIds.has(item.id))
  return [...incoming, ...kept]
}
