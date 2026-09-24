import { z } from 'zod'

/**
 * Paper unit contracts shared by main services, IPC, preload, and renderer.
 *
 * A paper unit is a plain directory `<workspace>/<papersDir>/<slug>/` that
 * contains a `paper.json` matching `paperUnitMetaV1Schema`. No database: the
 * file tree is the paper library.
 */

export const PAPER_META_FILE_NAME = 'paper.json'
export const PAPER_NOTES_FILE_NAME = 'NOTES.md'
export const PAPER_TEXT_FILE_NAME = 'paper.md'
export const PAPER_FIGURES_DIR_NAME = 'figures'
export const PAPER_FIGURE_INDEX_FILE_NAME = 'index.json'
export const PAPER_ASSETS_DIR_NAME = 'assets'
export const PAPER_CACHE_DIR_NAME = '.cache'
export const PAPER_COOL_NOTES_CACHE_FILE_NAME = 'coolpapers-kimi.md'
export const PAPER_INTERPRET_SUFFIX = '-解读'

export const paperFigureSourceSchema = z.enum(['arxiv-html', 'tex', 'pdf-caption', 'pdf-page'])
export type PaperFigureSource = z.infer<typeof paperFigureSourceSchema>

export const paperUnitMetaV1Schema = z
  .object({
    version: z.literal(1),
    slug: z.string().min(1).max(200),
    title: z.string().min(1),
    authors: z.array(z.string()),
    abstract: z.string().optional(),
    year: z.string().optional(),
    venue: z.string().optional(),
    /** Canonical arXiv id without the `vN` version suffix. */
    arxivId: z.string().optional(),
    doi: z.string().optional(),
    coolPapers: z
      .object({
        branch: z.enum(['arxiv', 'venue']),
        id: z.string().min(1)
      })
      .strict()
      .optional(),
    sourceUrl: z.string().optional(),
    pdfUrl: z.string().optional(),
    /** Main PDF file name relative to the paper directory. */
    pdfFile: z.string().min(1),
    /** Absolute path of the source file for local-PDF imports. */
    originalPath: z.string().optional(),
    importedAt: z.string(),
    preprocess: z
      .object({
        textStatus: z.enum(['none', 'ok', 'failed']),
        figuresStatus: z.enum(['none', 'ok', 'partial', 'failed']),
        figuresSource: paperFigureSourceSchema.optional(),
        updatedAt: z.string().optional()
      })
      .strict()
      .optional(),
    coolNotes: z
      .object({
        fetchedAt: z.string(),
        matchedBy: z.enum(['sourceUrl', 'coolId', 'arxivId', 'title']),
        url: z.string()
      })
      .strict()
      .optional(),
    interpretations: z
      .array(
        z
          .object({
            path: z.string().min(1),
            createdAt: z.string(),
            threadId: z.string().optional()
          })
          .strict()
      )
      .optional()
  })
  .strict()

export type PaperUnitMetaV1 = z.infer<typeof paperUnitMetaV1Schema>

export const paperFigureIndexV1Schema = z
  .object({
    version: z.literal(1),
    source: paperFigureSourceSchema,
    items: z.array(
      z
        .object({
          id: z.string().min(1),
          kind: z.enum(['figure', 'table']),
          /** Display label such as "Figure 1". */
          label: z.string(),
          caption: z.string(),
          page: z.number().int().positive().optional(),
          /** Image path relative to the paper directory. */
          path: z.string().min(1),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
          confidence: z.enum(['high', 'medium', 'low'])
        })
        .strict()
    )
  })
  .strict()

export type PaperFigureIndexV1 = z.infer<typeof paperFigureIndexV1Schema>
export type PaperFigureItemV1 = PaperFigureIndexV1['items'][number]

// ---- IPC payloads and results ----

export type PaperJobKind = 'import' | 'cool-notes' | 'preprocess'

export type PaperProgressEvent = {
  requestId: string
  kind: PaperJobKind
  /** Free-form stage id such as "metadata", "pdf", "resolve", "figures". */
  stage: string
  status: 'running' | 'done' | 'error' | 'canceled'
  message?: string
  elapsedMs?: number
}

export type PaperErrorCode =
  | 'invalid-input'
  | 'invalid-unit'
  | 'not-found'
  | 'network'
  | 'timeout'
  | 'canceled'
  | 'io'

export type PaperImportResult =
  | { ok: true; unitDir: string; meta: PaperUnitMetaV1; reused: boolean }
  | { ok: false; code: PaperErrorCode; message: string }

export type PaperUnitListEntry = {
  /** Paper directory path relative to the workspace root (forward slashes). */
  unitDir: string
  meta: PaperUnitMetaV1
}

export type PaperListUnitsResult =
  | { ok: true; units: PaperUnitListEntry[] }
  | { ok: false; code: PaperErrorCode; message: string }

export type PaperUnitReadResult =
  | {
      ok: true
      unitDir: string
      meta: PaperUnitMetaV1
      figures: PaperFigureIndexV1 | null
    }
  | { ok: false; code: 'not-paper-unit' | 'invalid-unit' | 'io'; message: string }

export type PaperCoolNotesMatchedBy = 'sourceUrl' | 'coolId' | 'arxivId' | 'title'

export type PaperCoolNotesResult =
  | { ok: true; found: false }
  | {
      ok: true
      found: true
      appended: boolean
      fromCache: boolean
      url: string
      matchedBy: PaperCoolNotesMatchedBy
    }
  | {
      ok: false
      code: 'network' | 'timeout' | 'canceled' | 'no-notes-file' | 'invalid-unit' | 'io'
      message: string
    }

export type PaperPreprocessResult =
  | {
      ok: true
      textStatus: 'ok' | 'failed'
      figuresStatus: 'ok' | 'partial' | 'failed'
      figuresSource?: PaperFigureSource
      figureCount: number
    }
  | { ok: false; code: 'canceled' | 'invalid-unit' | 'io'; message: string }

export type PaperRecordInterpretationResult =
  | { ok: true; meta: PaperUnitMetaV1 }
  | { ok: false; code: 'invalid-unit' | 'io'; message: string }
