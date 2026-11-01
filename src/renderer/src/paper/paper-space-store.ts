import { create } from 'zustand'
import type { AppSettingsV1 } from '@shared/app-settings'
import type { PaperLibraryEntry, PaperLibraryFilter, PaperLibrarySort } from '@shared/paper/paper-library-types'
import { emptyPaperLibraryFilter, PAPER_DEFAULT_SORT } from './paper-mode-store'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'

export type PaperSpaceView = 'library' | 'discover:search' | 'discover:arxiv' | 'discover:venue' | 'discover:feeds'

/** The path of a legacy unit is relative to its own source, not to the import space. */
export type PaperSpaceItem = {
  key: string
  libraryRoot: string
  entry: PaperLibraryEntry
}

export function paperSpaceItemKey(libraryRoot: string, unitDir: string): string {
  return `${normalizeWorkspaceRoot(libraryRoot)}\0${unitDir.replace(/\\/g, '/').replace(/\/$/, '')}`
}

type PaperSpaceState = {
  workspaceRoot: string
  sourceRoots: string[]
  libraryRoots: string[]
  paperReading: AppSettingsV1['write']['paperReading'] | null
  autoMarkReading: boolean | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  entriesByRoot: Record<string, PaperLibraryEntry[]>
  errorsByRoot: Record<string, string>
  items: PaperSpaceItem[]
  loading: boolean
  loaded: boolean
  view: PaperSpaceView
  readerKey: string | null
  libraryScrollTop: number
  filter: PaperLibraryFilter
  sort: PaperLibrarySort
  selection: ReadonlySet<string>
  setView: (view: PaperSpaceView) => void
  setFilter: (patch: Partial<PaperLibraryFilter>) => void
  setSort: (sort: PaperLibrarySort) => void
  setSelection: (selection: ReadonlySet<string>) => void
  toggleSelected: (key: string) => void
  clearSelection: () => void
}

export const usePaperSpaceStore = create<PaperSpaceState>((set) => ({
  workspaceRoot: '',
  sourceRoots: [],
  libraryRoots: [],
  paperReading: null,
  autoMarkReading: null,
  status: 'idle',
  error: null,
  entriesByRoot: {},
  errorsByRoot: {},
  items: [],
  loading: false,
  loaded: false,
  view: 'library',
  readerKey: null,
  libraryScrollTop: 0,
  filter: emptyPaperLibraryFilter(),
  sort: PAPER_DEFAULT_SORT,
  selection: new Set(),
  setView: (view) => set({ view, readerKey: null }),
  setFilter: (patch) => set((state) => ({ filter: { ...state.filter, ...patch } })),
  setSort: (sort) => set({ sort }),
  setSelection: (selection) => set({ selection: new Set(selection) }),
  toggleSelected: (key) => set((state) => {
    const selection = new Set(state.selection)
    if (selection.has(key)) selection.delete(key)
    else selection.add(key)
    return { selection }
  }),
  clearSelection: () => set({ selection: new Set() })
}))

export function paperSpaceItems(entriesByRoot: Record<string, PaperLibraryEntry[]>): PaperSpaceItem[] {
  return Object.entries(entriesByRoot).flatMap(([libraryRoot, entries]) => entries.map((entry) => ({
    key: paperSpaceItemKey(libraryRoot, entry.unitDir), libraryRoot, entry
  })))
}

export function patchPaperSpaceItem(
  libraryRoot: string,
  unitDir: string,
  patch: Partial<PaperLibraryEntry>
): void {
  const root = normalizeWorkspaceRoot(libraryRoot)
  usePaperSpaceStore.setState((state) => {
    const entries = state.entriesByRoot[root]
    if (!entries) return state
    const entriesByRoot = {
      ...state.entriesByRoot,
      [root]: entries.map((entry) => entry.unitDir === unitDir ? { ...entry, ...patch } : entry)
    }
    return { entriesByRoot, items: paperSpaceItems(entriesByRoot) }
  })
}
