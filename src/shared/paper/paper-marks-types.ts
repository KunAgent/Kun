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

export const PAPER_MARKS_ASSETS_DIR = 'assets'

/**
 * R2.4 visual mark: a page region captured to `marks/assets/<id>.png`. Unlike
 * translate/ask cards it also lives in the gutter stream, so it keeps a
 * `comment` field and a normalized page `rect` (single rect, not spans).
 */
export const paperVisualMarkSchema = z
  .object({
    id: z.string().min(1).max(80),
    kind: z.literal('visual'),
    page: z.number().int().min(1),
    rect: paperRectSchema,
    comment: z.string().max(8000).optional(),
    image: z.object({ path: z.string().min(1).max(200) }).strict(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
  .strict()
export type PaperVisualMark = z.infer<typeof paperVisualMarkSchema>

/** Merge by id: incoming items win; local items not in `incoming` are kept. */
export function mergePaperHighlights(
  local: readonly PaperHighlight[],
  incoming: readonly PaperHighlight[]
): PaperHighlight[] {
  const incomingIds = new Set(incoming.map((item) => item.id))
  const kept = local.filter((item) => !incomingIds.has(item.id))
  return [...incoming, ...kept]
}
