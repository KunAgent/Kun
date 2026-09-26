import type { PaperSearchResult, PaperSearchSource } from './paper-search'
import type {
  PaperCoolNotesResult,
  PaperImportBatchResult,
  PaperImportHintMeta,
  PaperImportResult,
  PaperListUnitsResult,
  PaperPreprocessResult,
  PaperProgressEvent,
  PaperRecordInterpretationResult,
  PaperUnitReadResult
} from './paper-types'
import type { PaperUnitMetaV2 } from './paper-meta-v2'
import type { PaperVisualMark } from './paper-marks-types'
import type {
  PaperLibraryEntriesResult,
  PaperLibraryDetectResult,
  PaperLibraryMetaPatch,
  PaperLibraryTrashResult,
  PaperDownloadPdfResult,
  PaperLocalLibraryState,
  PaperBibtexImportResult,
  PaperMoveToGroupResult,
  PaperTitleSearchResult,
  PaperDoiResolveResult,
  PaperUrlMetaResult,
  PaperLocalPdfIdentifyResult,
  PaperFeedFetchResult,
  PaperArxivTodayResult,
  PaperVenueCatalogResult,
  PaperVenueListResult,
  PaperReadingActivityResult,
  PaperReferencesResult,
  PaperTranslateBlocksResult,
  PaperTranslateTextResult,
  PaperTranslateDocumentResult,
  PaperMarksResult
} from './paper-library-types'

/**
 * Paper-unit operations: importing units, reading unit metadata, fetching
 * Cool Papers notes, deterministic preprocessing, and interpretation
 * bookkeeping. Every path is workspace-scoped; main validates that `unitDir`
 * stays inside `workspaceRoot`.
 */
export type PaperUnitApi = {
  /** Import a paper from an arXiv id/URL, papers.cool URL, or local PDF path. */
  paperImport: (payload: {
    workspaceRoot: string
    input: string
    localPdfPath?: string
    /** Search-card metadata that seeds the DOI/OA path (plan P3.2). */
    meta?: PaperImportHintMeta
    /** Parent dir relative to the workspace root; defaults to the setting. */
    parentDir?: string
    requestId: string
  }) => Promise<PaperImportResult>
  /**
   * Batch import (plan P3): each item resolves like `paperImport`; `meta`
   * carries the search-card fields so DOI entries skip Crossref and feed the
   * OA-PDF chain directly.
   */
  paperImportBatch: (payload: {
    workspaceRoot: string
    items: Array<{ input: string; meta?: PaperImportHintMeta }>
    parentDir?: string
    requestId: string
  }) => Promise<PaperImportBatchResult>
  paperReadUnit: (payload: {
    workspaceRoot: string
    unitDir: string
  }) => Promise<PaperUnitReadResult>
  /** Scan `<workspaceRoot>/<parentDir>` children for `paper.json` for the sidebar. */
  paperListUnits: (payload: {
    workspaceRoot: string
    parentDir?: string
  }) => Promise<PaperListUnitsResult>
  paperFetchCoolNotes: (payload: {
    workspaceRoot: string
    unitDir: string
    force?: boolean
    requestId: string
  }) => Promise<PaperCoolNotesResult>
  paperPreprocess: (payload: {
    workspaceRoot: string
    unitDir: string
    force?: boolean
    requestId: string
  }) => Promise<PaperPreprocessResult>
  /** Append an interpretation entry to `paper.json.interpretations`. */
  paperRecordInterpretation: (payload: {
    workspaceRoot: string
    unitDir: string
    path: string
    threadId?: string
  }) => Promise<PaperRecordInterpretationResult>
  paperCancel: (payload: { requestId: string }) => Promise<void>
  onPaperProgress: (handler: (event: PaperProgressEvent) => void) => () => void
}

/**
 * Paper-mode library: recursive index under `<root>/<papersDir>`, `paper.json`
 * v2 metadata patching, grouping, trash, local reading state, and BibTeX.
 */
export type PaperLibraryApi = {
  /** Scan `<workspaceRoot>/<papersDir>` recursively (depth ≤3). */
  paperLibraryList: (payload: {
    workspaceRoot: string
    papersDir?: string
  }) => Promise<PaperLibraryEntriesResult>
  /** Find workspace roots that contain paper units (onboarding helper). */
  paperDetectLibraries: (payload: {
    workspaceRoots: string[]
    papersDir?: string
  }) => Promise<PaperLibraryDetectResult>
  /** Patch `paper.json` (tags, status, rating, title, …). Atomic write. */
  paperUpdateMeta: (payload: {
    workspaceRoot: string
    unitDir: string
    patch: PaperLibraryMetaPatch
  }) => Promise<
    | { ok: true; meta: PaperUnitMetaV2 }
    | { ok: false; code: 'invalid-unit' | 'io' | 'invalid-patch'; message: string }
  >
  /** Move a unit into a `<papersDir>/<group>` subdirectory ('' = root). */
  paperMoveToGroup: (payload: {
    workspaceRoot: string
    unitDir: string
    group: string
  }) => Promise<PaperMoveToGroupResult>
  /** Fetch a missing main PDF from the unit's arXiv id or recorded pdfUrl. */
  paperDownloadPdf: (payload: {
    workspaceRoot: string
    unitDir: string
  }) => Promise<PaperDownloadPdfResult>
  /** Move a unit directory to the OS trash. */
  paperTrashUnit: (payload: {
    workspaceRoot: string
    unitDir: string
  }) => Promise<PaperLibraryTrashResult>
  /**
   * R3.1 heat bar data: per-unit mark counts per page, merged with local
   * last-page/page-count state. Read-only; results are mtime-cached in main.
   */
  paperReadingActivity: (payload: {
    workspaceRoot: string
    papersDir?: string
  }) => Promise<PaperReadingActivityResult>
  /** Read the per-library local reading state (last page, recent opens). */
  paperLocalStateRead: (payload: {
    libraryRoot: string
  }) => Promise<PaperLocalLibraryState>
  /** Merge a unit's local reading state (lastPage/pageCount/lastOpenedAt). */
  paperLocalStateWrite: (payload: {
    libraryRoot: string
    unitRelDir: string
    patch: Partial<{
      lastOpenedAt: string
      lastPage: number
      pageCount: number
    }>
  }) => Promise<void>
  /** BibTeX for one unit ('unitDir') or the whole library ('all'). */
  paperExportBibtex: (payload: {
    workspaceRoot: string
    papersDir?: string
    unitDir?: string
  }) => Promise<{ ok: true; bibtex: string } | { ok: false; message: string }>
  /** Import a BibTeX file's entries as metadata-only units. */
  paperImportBibtex: (payload: {
    workspaceRoot: string
    bibtex: string
    /** Also fetch PDFs for entries that carry arXiv/DOI ids. */
    downloadPdfs: boolean
    requestId: string
  }) => Promise<PaperBibtexImportResult>
}

/**
 * Reader-facing calls: marks (highlights/notes/translations), references,
 * and translation through the user's own model.
 */
export type PaperReaderApi = {
  paperMarksRead: (payload: {
    workspaceRoot: string
    unitDir: string
  }) => Promise<PaperMarksResult>
  /** Merge `marks/annotations.json` items by id; `removedIds` are deleted. */
  paperMarksWrite: (payload: {
    workspaceRoot: string
    unitDir: string
    items: unknown[]
    removedIds?: string[]
  }) => Promise<PaperMarksResult>
  paperTranslateSelection: (payload: {
    text: string
    targetLanguage: 'zh' | 'en'
    providerId?: string
    model?: string
  }) => Promise<PaperTranslateTextResult>
  /** Whole-paper translation into `<slug>-译文.md` (chunked, cached). */
  paperTranslateDocument: (payload: {
    workspaceRoot: string
    unitDir: string
    targetLanguage: 'zh' | 'en'
    providerId?: string
    model?: string
    requestId: string
  }) => Promise<PaperTranslateDocumentResult>
  /**
   * R2.2 overlay translation: masked text blocks → `[[n]]`-batched model
   * calls, per-block cache under `.cache/translate-blocks-<lang>-<hash>.json`.
   */
  paperTranslateBlocks: (payload: {
    workspaceRoot: string
    unitDir: string
    blocks: { id: string; text: string }[]
    targetLanguage: 'zh' | 'en'
    providerId?: string
    model?: string
  }) => Promise<PaperTranslateBlocksResult>
  /**
   * R2.4 region capture: persist a cropped page PNG to `marks/assets/` and
   * its visual-mark card to `marks/<id>.json`.
   */
  paperSaveVisualMark: (payload: {
    workspaceRoot: string
    unitDir: string
    mark: {
      id: string
      page: number
      rect: [number, number, number, number]
      comment?: string
    }
    pngBase64: string
  }) => Promise<
    | { ok: true; mark: PaperVisualMark }
    | { ok: false; code: string; message: string }
  >
  /** Read or refresh `<unit>/references.json` (local bbl/bib → S2 → Crossref). */
  paperFetchReferences: (payload: {
    workspaceRoot: string
    unitDir: string
    force?: boolean
    /** `citations` lists S2 cited-by papers into `citations.json` instead. */
    kind?: 'references' | 'citations'
  }) => Promise<PaperReferencesResult>
}

/**
 * Discovery/import enrichment: title search, DOI resolution, publisher-page
 * metadata, local-PDF identification, feeds, arXiv today, venue listings.
 */
export type PaperDiscoverApi = {
  /** Parallel S2 + arXiv title search; returns up to `limit` candidates. */
  paperSearchByTitle: (payload: {
    query: string
    limit?: number
  }) => Promise<PaperTitleSearchResult>
  paperResolveDoi: (payload: { doi: string }) => Promise<PaperDoiResolveResult>
  /** Fetch a publisher page and parse `citation_*` meta tags. */
  paperFetchUrlMeta: (payload: { url: string }) => Promise<PaperUrlMetaResult>
  /** Extract DOI/arXiv id/title candidate from a local PDF's first pages. */
  paperIdentifyLocalPdf: (payload: {
    path: string
  }) => Promise<PaperLocalPdfIdentifyResult>
  /** RSS 2.0 / Atom / JSON Feed fetch (arbitrary https, GET only). */
  paperFetchFeed: (payload: { url: string }) => Promise<PaperFeedFetchResult>
  /** arXiv category RSS for a UTC date (per-day cache). */
  paperArxivToday: (payload: {
    categories: string[]
    date?: string
    force?: boolean
  }) => Promise<PaperArxivTodayResult>
  /** papers.cool venue listing page, e.g. `ICLR.2025`, optionally one track. */
  paperListVenue: (payload: { venue: string; group?: string; skip?: number }) => Promise<PaperVenueListResult>
  /** Conference editions and tracks available on papers.cool. */
  paperVenueCatalog: (payload: { force?: boolean }) => Promise<PaperVenueCatalogResult>
  /** Merged multi-source scholarly search (same engine as the `paper_search` tool). */
  paperSearch: (payload: {
    query: string
    sources?: PaperSearchSource[]
    limit?: number
    yearFrom?: number
    yearTo?: number
  }) => Promise<PaperSearchResult>
  /** Probe one source with a tiny query; used by the settings "Test connection" button. */
  paperTestSource: (payload: {
    source: PaperSearchSource
  }) => Promise<{ ok: true; ms: number; count: number } | { ok: false; ms: number; error: string }>
  /**
   * Detail-pane lookup (plan P5): resolves a DOI/arXiv/PMID/S2 id to full
   * metadata (tldr, fields, OA pdf) plus the OpenAlex citation trend.
   */
  paperDetail: (payload: { id: string }) => Promise<
    | {
        ok: true
        paper: {
          title: string
          authors: string[]
          abstract?: string
          year?: number
          venue?: string
          doi?: string
          arxivId?: string
          url?: string
          pdfUrl?: string
          citations?: number
          tldr?: string
          fieldsOfStudy?: string[]
        }
        countsByYear?: Array<{ year: number; citations: number }>
      }
    | { ok: false; message: string }
  >
}

/**
 * Bridge surface for Work paper mode. Composed so `kun-gui-api-surface.ts`
 * keeps a single intersection member while each area evolves independently.
 */
export type KunGuiPaperApi =
  & PaperUnitApi
  & PaperLibraryApi
  & PaperReaderApi
  & PaperDiscoverApi
