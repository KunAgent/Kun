import type {
  PaperImportSource,
  PaperReadingStatus,
  PaperUnitMetaV2
} from './paper-meta-v2'

/**
 * Paper-mode library contracts: indexed entries, filter/sort shapes, and the
 * IPC payloads shared by main services, preload, and renderer.
 */

/** One row in the library table: unit meta merged with local reading state. */
export type PaperLibraryEntry = {
  /** Unit dir relative to the library root (forward slashes). */
  unitDir: string
  meta: PaperUnitMetaV2
  hasPdf: boolean
  hasNotes: boolean
  interpretationCount: number
  /** Subgroup inside `<papersDir>/` ('' = top level). */
  group: string
  /** Local-only state (never written into the library). */
  lastOpenedAt?: string
  lastPage?: number
  pageCount?: number
}

export type PaperLibraryFilter = {
  query: string
  status: '' | PaperReadingStatus
  tag: string
  group: string
  year: string
  source: '' | PaperImportSource
  /** Restrict to entries opened recently (sidebar「最近阅读」). */
  recent: boolean
}

export type PaperLibrarySortKey =
  | 'title'
  | 'authors'
  | 'year'
  | 'venue'
  | 'status'
  | 'importedAt'
  | 'lastOpenedAt'

export type PaperLibrarySort = {
  key: PaperLibrarySortKey
  dir: 'asc' | 'desc'
}

export type PaperLibraryCounts = {
  total: number
  unread: number
  reading: number
  read: number
  missingPdf: number
}

export type PaperLibraryEntriesResult =
  | {
      ok: true
      entries: PaperLibraryEntry[]
      counts: PaperLibraryCounts
      tags: string[]
      groups: string[]
    }
  | { ok: false; code: 'io' | 'invalid-root'; message: string }

/** A workspace root that already contains paper units. */
export type PaperLibraryCandidate = {
  workspaceRoot: string
  unitCount: number
}

export type PaperLibraryDetectResult = {
  ok: boolean
  candidates: PaperLibraryCandidate[]
}

/** Patch semantics for `paperUpdateMeta`: absent = keep, null = clear. */
export type PaperLibraryMetaPatch = {
  title?: string
  authors?: string[]
  abstract?: string | null
  year?: string | null
  venue?: string | null
  arxivId?: string | null
  doi?: string | null
  tags?: string[]
  status?: PaperReadingStatus
  rating?: number | null
  pdfFile?: string | null
  needsReview?: boolean
}

export type PaperMoveToGroupResult =
  | { ok: true; unitDir: string; previousUnitDir: string }
  | { ok: false; code: 'invalid-unit' | 'invalid-group' | 'exists' | 'io'; message: string }

export type PaperLibraryTrashResult =
  | { ok: true }
  | { ok: false; code: 'invalid-unit' | 'io'; message: string }

/** `<userData>/paper-library/<sha1(libraryRoot)>.json` content. */
export type PaperLocalLibraryState = {
  version: 1
  units: Record<
    string,
    {
      lastOpenedAt?: string
      lastPage?: number
      pageCount?: number
    }
  >
}

// ---- title search / DOI / URL meta / local-PDF identify ---------------------

export type PaperTitleSearchCandidate = {
  title: string
  authors: string[]
  year?: string
  venue?: string
  arxivId?: string
  doi?: string
  source: 's2' | 'arxiv'
  citationCount?: number
}

export type PaperTitleSearchResult =
  | { ok: true; candidates: PaperTitleSearchCandidate[] }
  | { ok: false; code: 'network' | 'timeout' | 'invalid-input'; message: string }

export type PaperDoiResolveResult =
  | {
      ok: true
      meta: {
        doi: string
        title: string
        authors: string[]
        year?: string
        venue?: string
        abstract?: string
        arxivId?: string
        pdfUrl?: string
        bibtex?: string
      }
    }
  | { ok: false; code: 'not-found' | 'network' | 'timeout' | 'invalid-input'; message: string }

export type PaperUrlMetaResult =
  | {
      ok: true
      meta: {
        title: string
        authors: string[]
        year?: string
        venue?: string
        doi?: string
        arxivId?: string
        pdfUrl?: string
        abstract?: string
      }
    }
  | { ok: false; code: 'network' | 'timeout' | 'invalid-input' | 'not-found'; message: string }

export type PaperLocalPdfIdentifyResult =
  | {
      ok: true
      doi?: string
      arxivId?: string
      titleGuess?: string
    }
  | { ok: false; code: 'invalid-input' | 'io'; message: string }

export type PaperBibtexImportEntryResult = {
  citeKey: string
  ok: boolean
  unitDir?: string
  message?: string
}

export type PaperBibtexImportResult =
  | { ok: true; imported: number; skipped: number; entries: PaperBibtexImportEntryResult[] }
  | { ok: false; code: 'invalid-input' | 'io' | 'canceled'; message: string }

// ---- feeds / arXiv today / venue --------------------------------------------

export type PaperFeedItem = {
  title: string
  url: string
  publishedAt?: string
  summary?: string
  arxivId?: string
  doi?: string
}

export type PaperFeedFetchResult =
  | {
      ok: true
      title: string
      items: PaperFeedItem[]
    }
  | { ok: false; code: 'network' | 'timeout' | 'invalid-feed' | 'invalid-input'; message: string }

export type PaperArxivTodayItem = {
  arxivId: string
  title: string
  authors: string[]
  abstract?: string
  categories: string[]
  publishedAt?: string
  /** Local lexical relevance vs the library corpus (0 when ranking is off). */
  relevance: number
}

export type PaperArxivTodayResult =
  | {
      ok: true
      date: string
      items: PaperArxivTodayItem[]
      /** True when the list came from the per-day disk cache. */
      fromCache: boolean
    }
  | { ok: false; code: 'network' | 'timeout' | 'invalid-input'; message: string }

export type PaperVenueItem = {
  /** Venue-catalog id on papers.cool (e.g. `ICLR.2025-<n>` style keys). */
  coolId: string
  title: string
  authors: string[]
}

export type PaperVenueListResult =
  | { ok: true; venue: string; items: PaperVenueItem[] }
  | { ok: false; code: 'network' | 'timeout' | 'invalid-input'; message: string }

// ---- references ---------------------------------------------------------------

export const paperReferenceItemSchemaFields = {
  n: true
} as const

export type PaperReferenceItem = {
  /** 1-based order in the bibliography. */
  n: number
  title?: string
  authors?: string[]
  year?: string
  venue?: string
  doi?: string
  arxivId?: string
  /** Raw citation text when structured fields could not be extracted. */
  raw?: string
}

export type PaperReferencesResult =
  | {
      ok: true
      source: 'bbl' | 'bib' | 's2' | 'crossref'
      items: PaperReferenceItem[]
      fromCache: boolean
    }
  | { ok: false; code: 'invalid-unit' | 'network' | 'timeout' | 'io' | 'not-found'; message: string }

// ---- translation --------------------------------------------------------------

export type PaperTranslateTextResult =
  | { ok: true; translation: string; model: string; providerId: string }
  | { ok: false; code: 'network' | 'timeout' | 'config' | 'io' | 'invalid-input'; message: string }

export type PaperTranslateDocumentResult =
  | {
      ok: true
      /** Unit-relative output markdown path (`<slug>-译文.md`). */
      outputPath: string
      cachedChunks: number
      translatedChunks: number
    }
  | { ok: false; code: 'network' | 'timeout' | 'config' | 'io' | 'canceled' | 'invalid-unit' | 'invalid-input'; message: string }

// ---- marks --------------------------------------------------------------------

export type PaperMarksResult =
  | { ok: true; items: unknown[] }
  | { ok: false; code: 'invalid-unit' | 'io'; message: string }
