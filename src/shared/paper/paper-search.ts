/**
 * GUI-facing view of the multi-source paper search. The connectors and the
 * `paper_search` agent tool live in the Kun runtime package; the GUI search
 * page calls the same implementation through the main process.
 */
export {
  DEFAULT_PAPER_SEARCH_SOURCES,
  PAPER_SEARCH_KEY_GATED_SOURCES,
  PAPER_SEARCH_SOURCES,
  PAPER_SEARCH_SOURCE_LABELS
} from '../../../kun/src/services/paper-search/paper-search-types.js'
export type {
  PaperListEntryMeta,
  PaperListMeta,
  PaperReportPriority,
  PaperSearchCardHit,
  PaperSearchHit,
  PaperSearchResponse,
  PaperSearchResultMeta,
  PaperSearchSource,
  PaperSearchSourceReport
} from '../../../kun/src/services/paper-search/paper-search-types.js'

import type { PaperSearchResponse } from '../../../kun/src/services/paper-search/paper-search-types.js'

export type PaperSearchResult =
  | ({ ok: true } & PaperSearchResponse)
  | { ok: false; code: 'invalid-input' | 'network'; message: string }
