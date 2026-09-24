import { z } from 'zod'

/**
 * `<unit>/references.json` (plan §5.5): a rebuildable cache of the paper's
 * bibliography. "Already in library" is computed at render time, never stored.
 */

export const paperReferenceItemSchema = z
  .object({
    /** 1-based order in the bibliography. */
    n: z.number().int().min(1),
    title: z.string().optional(),
    authors: z.array(z.string()).optional(),
    year: z.string().optional(),
    venue: z.string().optional(),
    doi: z.string().optional(),
    arxivId: z.string().optional(),
    /** Raw citation text when structured fields could not be extracted. */
    raw: z.string().optional()
  })
  .strict()
export type PaperReferenceItem = z.infer<typeof paperReferenceItemSchema>

export const paperReferencesFileSchema = z
  .object({
    version: z.literal(1),
    source: z.enum(['bbl', 'bib', 's2', 'crossref']),
    fetchedAt: z.string(),
    items: z.array(paperReferenceItemSchema).max(2000)
  })
  .strict()
export type PaperReferencesFile = z.infer<typeof paperReferencesFileSchema>
