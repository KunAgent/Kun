import type {
  PaperCoolNotesResult,
  PaperImportResult,
  PaperListUnitsResult,
  PaperPreprocessResult,
  PaperProgressEvent,
  PaperRecordInterpretationResult,
  PaperUnitReadResult
} from './paper-types'

/**
 * Bridge surface for Work paper-reading: importing paper units, fetching Cool
 * Papers notes, deterministic preprocessing, and interpretation bookkeeping.
 * Every path is workspace-scoped; main validates that `unitDir` stays inside
 * `workspaceRoot`.
 */
export type KunGuiPaperApi = {
  /** Import a paper from an arXiv id/URL, papers.cool URL, or local PDF path. */
  paperImport: (payload: {
    workspaceRoot: string
    input: string
    localPdfPath?: string
    /** Parent dir relative to the workspace root; defaults to the setting. */
    parentDir?: string
    requestId: string
  }) => Promise<PaperImportResult>
  paperReadUnit: (payload: {
    workspaceRoot: string
    unitDir: string
  }) => Promise<PaperUnitReadResult>
  /** Scan `<workspaceRoot>/<parentDir>/​*​/paper.json` for the sidebar. */
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
