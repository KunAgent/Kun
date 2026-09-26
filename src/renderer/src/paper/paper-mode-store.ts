import { create } from 'zustand'
import type {
  PaperArxivTodayItem,
  PaperFeedItem,
  PaperLibraryEntry,
  PaperLibraryFilter,
  PaperLibrarySort,
  PaperVenueCatalogEntry,
  PaperVenueItem
} from '@shared/paper/paper-library-types'
import type { PaperModeView } from './paper-conversation-scope'
import { usePaperStore } from '../write/paper/paper-store'

export type { PaperModeView }

export const PAPER_DEFAULT_SORT: PaperLibrarySort = { key: 'importedAt', dir: 'desc' }

export function emptyPaperLibraryFilter(): PaperLibraryFilter {
  return { query: '', status: '', tag: '', group: '', year: '', source: '', recent: false }
}

export type PaperDiscoverState = {
  arxivItems: PaperArxivTodayItem[]
  arxivLoading: boolean
  arxivError: string | null
  arxivDate: string
  arxivSort: 'relevance' | 'announcement'
  feedItems: Record<string, PaperFeedItem[]>
  feedLoading: boolean
  feedError: string | null
  activeFeedId: string
  venue: string
  /** Track within the venue (`Oral`, `Poster`, ...); '' lists every paper. */
  venueGroup: string
  venueItems: PaperVenueItem[]
  venueTotal: number
  venueLoading: boolean
  venueError: string | null
  venueCatalog: PaperVenueCatalogEntry[]
  venueCatalogLoading: boolean
  venueCatalogError: string | null
}

/**
 * Bridge registered by the paper workspace so deep UI (sidebar rows, reader
 * cards, info panel) can reach the assistant composer without prop drilling.
 */
export type PaperComposerBridge = {
  input: string
  setInput: (value: string) => void
  submit?: (value: string) => void
  /**
   * R2.4: attach an image to the current composer via the existing runtime
   * attachment channel; resolves false when uploads/vision are unavailable
   * so callers can fall back to text-only prompts.
   */
  attachImage?: (input: { dataBase64: string; name: string }) => Promise<boolean>
}

export type PaperModeState = {
  filter: PaperLibraryFilter
  sort: PaperLibrarySort
  /** Selected unit dirs (relative) for bulk operations. */
  selection: ReadonlySet<string>
  entries: PaperLibraryEntry[]
  entriesLoading: boolean
  entriesError: string | null
  counts: { total: number; unread: number; reading: number; read: number; missingPdf: number }
  tags: string[]
  groups: string[]
  importDialogOpen: boolean
  /** Bumped to re-run the library scan (imports, external edits). */
  entriesRefreshToken: number
  discover: PaperDiscoverState
  /**
   * Unit dir (relative) whose meta is pinned in the sidebar info panel —
   * tracks the active reader unit and the last library row the user opened.
   */
  infoUnitDir: string | null
  /** Live reader position for the focused paper, used by assistant context. */
  readerPage: { unitDir: string; page: number; pageCount: number } | null
  composerBridge: PaperComposerBridge | null
  setInfoUnitDir: (unitDir: string | null) => void
  setReaderPage: (page: PaperModeState['readerPage']) => void
  setComposerBridge: (bridge: PaperComposerBridge | null) => void
  setFilter: (patch: Partial<PaperLibraryFilter>) => void
  setSort: (sort: PaperLibrarySort) => void
  setSelection: (selection: ReadonlySet<string>) => void
  toggleSelected: (unitDir: string) => void
  clearSelection: () => void
  setEntriesResult: (result: {
    entries: PaperLibraryEntry[]
    counts: PaperModeState['counts']
    tags: string[]
    groups: string[]
  }) => void
  setEntriesLoading: (loading: boolean) => void
  setEntriesError: (message: string | null) => void
  setImportDialogOpen: (open: boolean) => void
  refreshEntries: () => void
  patchDiscover: (patch: Partial<PaperDiscoverState>) => void
}

const emptyDiscover = (): PaperDiscoverState => ({
  arxivItems: [],
  arxivLoading: false,
  arxivError: null,
  arxivDate: '',
  arxivSort: 'relevance',
  feedItems: {},
  feedLoading: false,
  feedError: null,
  activeFeedId: '',
  venue: '',
  venueGroup: '',
  venueItems: [],
  venueTotal: 0,
  venueLoading: false,
  venueError: null,
  venueCatalog: [],
  venueCatalogLoading: false,
  venueCatalogError: null
})

export const usePaperModeStore = create<PaperModeState>((set) => ({
  filter: emptyPaperLibraryFilter(),
  sort: PAPER_DEFAULT_SORT,
  selection: new Set<string>(),
  entries: [],
  entriesLoading: false,
  entriesError: null,
  counts: { total: 0, unread: 0, reading: 0, read: 0, missingPdf: 0 },
  tags: [],
  groups: [],
  importDialogOpen: false,
  entriesRefreshToken: 0,
  discover: emptyDiscover(),
  infoUnitDir: null,
  readerPage: null,
  composerBridge: null,
  setInfoUnitDir: (infoUnitDir) => set({ infoUnitDir }),
  setReaderPage: (readerPage) => set({ readerPage }),
  setComposerBridge: (composerBridge) => set({ composerBridge }),
  setFilter: (patch) => set((state) => ({ filter: { ...state.filter, ...patch } })),
  setSort: (sort) => set({ sort }),
  setSelection: (selection) => set({ selection: new Set(selection) }),
  toggleSelected: (unitDir) =>
    set((state) => {
      const next = new Set(state.selection)
      if (next.has(unitDir)) next.delete(unitDir)
      else next.add(unitDir)
      return { selection: next }
    }),
  clearSelection: () => set({ selection: new Set<string>() }),
  setEntriesResult: ({ entries, counts, tags, groups }) => {
    // The recursive library index is the only listing that sees grouped
    // units (papers/<group>/<id>); feed it to the unit map the paper bar and
    // conversation scope resolve against.
    usePaperStore.getState().rememberUnits(entries)
    set({ entries, counts, tags, groups, entriesLoading: false, entriesError: null })
  },
  setEntriesLoading: (entriesLoading) => set({ entriesLoading }),
  setEntriesError: (entriesError) => set({ entriesError, entriesLoading: false }),
  setImportDialogOpen: (importDialogOpen) => set({ importDialogOpen }),
  refreshEntries: () => set((state) => ({ entriesRefreshToken: state.entriesRefreshToken + 1 })),
  patchDiscover: (patch) => set((state) => ({ discover: { ...state.discover, ...patch } }))
}))
