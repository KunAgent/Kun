import { z } from 'zod'
import { paperUnitMetaV1Schema, type PaperUnitMetaV1 } from './paper-types'

/**
 * `paper.json` v2: everything v1 carries plus library metadata (tags, reading
 * status, rating, cite key, external ids, origin channel, references state).
 * `pdfFile` becomes optional so DOI/BibTeX imports can hold metadata-only
 * units. Reads accept v1 and upgrade it in memory; the file is only rewritten
 * as v2 when the user actually changes v2 fields.
 */

export const PAPER_META_MAX_TAGS = 32
export const PAPER_META_TAG_MAX_CHARS = 40

export const paperReadingStatusSchema = z.enum(['unread', 'reading', 'read'])
export type PaperReadingStatus = z.infer<typeof paperReadingStatusSchema>

export const paperImportSourceSchema = z.enum([
  'arxiv',
  'coolpapers',
  'doi',
  'local-pdf',
  'title-search',
  'feed',
  'bibtex'
])
export type PaperImportSource = z.infer<typeof paperImportSourceSchema>

export const paperUnitMetaV2Schema = paperUnitMetaV1Schema
  .omit({ version: true, pdfFile: true })
  .extend({
    version: z.literal(2),
    /** Main PDF file name relative to the paper directory; absent when the
     * unit holds metadata only (DOI / BibTeX import). */
    pdfFile: z.string().min(1).optional(),
    // ---- v2 library fields -------------------------------------------------
    tags: z.array(z.string().min(1).max(PAPER_META_TAG_MAX_CHARS)).max(PAPER_META_MAX_TAGS).optional(),
    status: paperReadingStatusSchema.optional(),
    readAt: z.string().optional(),
    rating: z.number().int().min(1).max(5).optional(),
    /** BibTeX cite key, unique within the library. */
    citeKey: z.string().max(200).optional(),
    ids: z
      .object({
        s2: z.string().optional(),
        openalex: z.string().optional(),
        pmid: z.string().optional(),
        dblp: z.string().optional()
      })
      .strict()
      .optional(),
    /** BibTeX entry supplied by Crossref or an imported .bib file; preferred
     * over generated output when exporting. */
    bibtex: z.string().max(32_000).optional(),
    source: paperImportSourceSchema.optional(),
    /** Local-PDF identification left the metadata uncertain. */
    needsReview: z.boolean().optional(),
    references: z
      .object({
        status: z.enum(['none', 'ok', 'partial', 'failed']),
        source: z.string().optional(),
        count: z.number().int().nonnegative().optional(),
        updatedAt: z.string().optional()
      })
      .strict()
      .optional()
  })
  .strict()

export type PaperUnitMetaV2 = z.infer<typeof paperUnitMetaV2Schema>

/** On-disk `paper.json` may be v1 or v2; readers accept both. */
export const paperUnitMetaSchema = z.union([paperUnitMetaV1Schema, paperUnitMetaV2Schema])
export type PaperUnitMeta = z.infer<typeof paperUnitMetaSchema>

/** In-memory upgrade: v1 → v2 without touching the file on disk. */
export function upgradePaperMeta(meta: PaperUnitMetaV1 | PaperUnitMetaV2): PaperUnitMetaV2 {
  if (meta.version === 2) return meta
  const { version: _version, ...rest } = meta
  return { ...rest, version: 2 }
}

/** Effective reading status; missing means unread. */
export function paperReadingStatusOf(meta: { status?: PaperReadingStatus }): PaperReadingStatus {
  return meta.status ?? 'unread'
}

/**
 * Patch shape for `paperUpdateMeta`. Every field is optional; `null` clears a
 * nullable field. Tags are deduped and trimmed here so IPC callers can pass
 * raw form values.
 */
export function normalizePaperTags(tags: readonly string[] | undefined): string[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    if (typeof raw !== 'string') continue
    const tag = raw.trim().slice(0, PAPER_META_TAG_MAX_CHARS)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length >= PAPER_META_MAX_TAGS) break
  }
  return out
}
