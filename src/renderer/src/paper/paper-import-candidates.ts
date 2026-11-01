import { useMemo } from 'react'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import { titleKey, type PaperSearchCardHit, type PaperSearchHit } from '@shared/paper/paper-search'
import { paperCardImportInput, paperCardImportMeta, type RendererPaperListEntry } from '../agent/paper-list-adapter'
import { usePaperSpaceStore } from './paper-space-store'
import { paperIdentityKeys, type ResearchPoolEntry } from './paper-research-pool'
import type { ImportCandidate, ImportOwned } from './paper-import-plan'

/**
 * Builders that turn each view's paper shape (pool entry, recommendation
 * entry, quick-search hit) into one `ImportCandidate`, and a library index
 * that says which papers are already in the library.
 */

export type LibraryIndex = ReadonlyMap<string, PaperLibraryEntry & { workspaceRoot?: string }>

export function buildLibraryIndex(entries: readonly (PaperLibraryEntry & { workspaceRoot?: string })[]): LibraryIndex {
  const index = new Map<string, PaperLibraryEntry & { workspaceRoot?: string }>()
  for (const entry of entries) {
    const meta = entry.meta
    if (meta.arxivId) index.set(`arxiv:${meta.arxivId.replace(/v\d+$/i, '')}`, entry)
    if (meta.doi) index.set(`doi:${meta.doi.toLowerCase()}`, entry)
    if (meta.coolPapers?.id) index.set(`cool:${meta.coolPapers.id}`, entry)
    if (meta.title) index.set(`title:${titleKey(meta.title)}`, entry)
  }
  return index
}

export function findLibraryEntry(index: LibraryIndex, keys: readonly string[]): (PaperLibraryEntry & { workspaceRoot?: string }) | undefined {
  for (const key of keys) {
    const hit = index.get(key)
    if (hit) return hit
  }
  return undefined
}

function ownedOf(index: LibraryIndex, keys: readonly string[]): ImportOwned | undefined {
  const hit = findLibraryEntry(index, keys)
  return hit ? { unitDir: hit.unitDir, group: hit.group, ...(hit.workspaceRoot ? { workspaceRoot: hit.workspaceRoot } : {}) } : undefined
}

/** All registered sources, independent of Work's active folder. */
export function useLibraryIndex(): LibraryIndex {
  const items = usePaperSpaceStore((s) => s.items)
  return useMemo(() => buildLibraryIndex(items.map((item) => ({ ...item.entry, workspaceRoot: item.libraryRoot }))), [items])
}

const ARXIV_ID = /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})(v\d+)?$/i

/** Extra identity keys for a bare id (an arXiv id or DOI the Agent wrote down). */
function keysOfBareId(id: string): string[] {
  const value = id.trim()
  if (!value) return []
  if (ARXIV_ID.test(value)) return [`arxiv:${value.replace(/v\d+$/i, '')}`]
  if (/^10\.\d{4,9}\//.test(value)) return [`doi:${value.toLowerCase()}`]
  return []
}

export function candidateFromPoolEntry(entry: ResearchPoolEntry, index: LibraryIndex): ImportCandidate {
  const keys = paperIdentityKeys(entry)
  return {
    key: entry.key,
    keys,
    title: entry.title,
    input: paperCardImportInput(entry) ?? '',
    meta: paperCardImportMeta(entry),
    ...(entry.recommended?.group ? { group: entry.recommended.group } : {}),
    owned: ownedOf(index, keys)
  }
}

export function candidateFromListEntry(entry: RendererPaperListEntry, index: LibraryIndex): ImportCandidate {
  const card: PaperSearchCardHit = entry.paper ?? { id: entry.id, title: entry.title, authors: [], sources: [] }
  const keys = [...new Set([...paperIdentityKeys(card), ...keysOfBareId(entry.id)])]
  return {
    key: `list:${entry.id}`,
    keys,
    title: entry.title,
    input: (entry.paper ? paperCardImportInput(entry.paper) : undefined) ?? entry.id,
    meta: entry.paper ? paperCardImportMeta(entry.paper) : undefined,
    ...(entry.group?.trim() ? { group: entry.group.trim() } : {}),
    owned: ownedOf(index, keys)
  }
}

export function candidateFromSearchHit(hit: PaperSearchHit, index: LibraryIndex): ImportCandidate {
  const keys = [...new Set([...paperIdentityKeys(hit), `hit:${hit.key}`])]
  return {
    key: `hit:${hit.key}`,
    keys,
    title: hit.title,
    input: hit.arxivId ?? hit.coolId ?? hit.doi ?? '',
    meta: {
      title: hit.title,
      authors: hit.authors,
      abstract: hit.abstract,
      year: hit.year !== undefined ? String(hit.year) : undefined,
      venue: hit.venue,
      doi: hit.doi,
      arxivId: hit.arxivId,
      coolId: hit.coolId,
      pdfUrl: hit.pdfUrl,
      sourceUrl: hit.url
    },
    owned: ownedOf(index, keys)
  }
}
