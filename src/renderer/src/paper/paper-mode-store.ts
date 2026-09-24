import { create } from 'zustand'
import type {
  PaperArxivTodayItem,
  PaperFeedItem,
  PaperLibraryEntry,
  PaperLibraryFilter,
  PaperLibrarySort,
  PaperVenueItem
} from '@shared/paper/paper-library-types'
import type { PaperModeView } from './paper-conversation-scope'

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
  venueItems: PaperVenueItem[]
  venueLoading: boolean
  venueError: string | null
}

export type PaperModeState = {
  view: PaperModeView
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
  setView: (view: PaperModeView) => void
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
  venueItems: [],
  venueLoading: false,
  venueError: null
})

export const usePaperModeStore = create<PaperModeState>((set) => ({
  view: 'library',
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
  setView: (view) => set({ view }),
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
  setEntriesResult: ({ entries, counts, tags, groups }) =>
    set({ entries, counts, tags, groups, entriesLoading: false, entriesError: null }),
  setEntriesLoading: (entriesLoading) => set({ entriesLoading }),
  setEntriesError: (entriesError) => set({ entriesError, entriesLoading: false }),
  setImportDialogOpen: (importDialogOpen) => set({ importDialogOpen }),
  refreshEntries: () => set((state) => ({ entriesRefreshToken: state.entriesRefreshToken + 1 })),
  patchDiscover: (patch) => set((state) => ({ discover: { ...state.discover, ...patch } }))
}))
