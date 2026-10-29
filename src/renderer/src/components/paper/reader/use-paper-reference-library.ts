import { useContext, useMemo } from 'react'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import type { PaperReferenceItem } from '@shared/paper/paper-references-types'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { usePaperSpaceStore } from '../../../paper/paper-space-store'
import { openPaperSpaceItem, refreshPaperSpace } from '../../../paper/paper-space'
import { openLibraryEntry } from '../../../paper/paper-library-actions'
import { PaperReaderHostContext } from './paper-reader-host'

export function findPaperReferenceEntry(entries: readonly PaperLibraryEntry[], ref: PaperReferenceItem): PaperLibraryEntry | undefined {
  const arxiv = (id: string): string => id.replace(/v\d+$/i, '').toLowerCase()
  return entries.find((entry) =>
    (ref.arxivId && entry.meta.arxivId && arxiv(entry.meta.arxivId) === arxiv(ref.arxivId))
    || (ref.doi && entry.meta.doi?.toLowerCase() === ref.doi.toLowerCase())
  )
}

/** A reference opens its real source, preferring the current reader's source when copies exist. */
export function usePaperReferenceLibrary(workspaceRoot: string): {
  entries: readonly PaperLibraryEntry[]
  openEntry: (entry: PaperLibraryEntry) => Promise<void>
  refresh: () => Promise<void>
} {
  const host = useContext(PaperReaderHostContext)
  const workEntries = usePaperModeStore((state) => state.entries)
  const items = usePaperSpaceStore((state) => state.items)
  const entries = useMemo(() => host
    ? [...items.filter((item) => item.libraryRoot === workspaceRoot), ...items.filter((item) => item.libraryRoot !== workspaceRoot)].map((item) => item.entry)
    : workEntries, [host, items, workspaceRoot, workEntries])
  return {
    entries,
    openEntry: async (entry) => {
      if (host) {
        const item = items.find((item) => item.entry === entry)
        if (item) await openPaperSpaceItem(item)
      } else await openLibraryEntry(entry, workspaceRoot)
    },
    refresh: async () => {
      if (host) await refreshPaperSpace()
      else usePaperModeStore.getState().refreshEntries()
    }
  }
}
