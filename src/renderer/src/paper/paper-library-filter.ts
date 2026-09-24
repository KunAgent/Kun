import type {
  PaperLibraryEntry,
  PaperLibraryFilter,
  PaperLibrarySort
} from '@shared/paper/paper-library-types'
import type { PaperReadingStatus } from '@shared/paper/paper-meta-v2'

/** 「最近阅读」 window: entries opened within this many days count as recent. */
export const PAPER_RECENT_WINDOW_DAYS = 30

const STATUS_RANK: Record<PaperReadingStatus, number> = {
  reading: 0,
  unread: 1,
  read: 2
}

function entryStatus(entry: PaperLibraryEntry): PaperReadingStatus {
  return entry.meta.status ?? 'unread'
}

function matchesQuery(entry: PaperLibraryEntry, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const meta = entry.meta
  const haystacks = [
    meta.title,
    meta.venue ?? '',
    meta.year ?? '',
    meta.arxivId ?? '',
    meta.doi ?? '',
    meta.citeKey ?? '',
    entry.unitDir,
    ...meta.authors,
    ...(meta.tags ?? [])
  ]
  return haystacks.some((value) => value.toLowerCase().includes(needle))
}

function isRecent(entry: PaperLibraryEntry, now: number): boolean {
  if (!entry.lastOpenedAt) return false
  const opened = Date.parse(entry.lastOpenedAt)
  if (Number.isNaN(opened)) return false
  return now - opened <= PAPER_RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000
}

/** Apply the sidebar/table filter to a scanned entry list (§3.3 chips). */
export function filterPaperEntries(
  entries: readonly PaperLibraryEntry[],
  filter: PaperLibraryFilter,
  now: number = Date.now()
): PaperLibraryEntry[] {
  return entries.filter((entry) => {
    if (!matchesQuery(entry, filter.query)) return false
    if (filter.recent && !isRecent(entry, now)) return false
    if (filter.status && entryStatus(entry) !== filter.status) return false
    if (filter.tag && !(entry.meta.tags ?? []).includes(filter.tag)) return false
    if (filter.group && entry.group !== filter.group) return false
    if (filter.year && (entry.meta.year ?? '') !== filter.year) return false
    if (filter.source && (entry.meta.source ?? '') !== filter.source) return false
    return true
  })
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
}

function compareTimestamps(a: string | undefined, b: string | undefined): number {
  const at = a ? Date.parse(a) : Number.NaN
  const bt = b ? Date.parse(b) : Number.NaN
  if (Number.isNaN(at) && Number.isNaN(bt)) return 0
  if (Number.isNaN(at)) return 1
  if (Number.isNaN(bt)) return -1
  return at - bt
}

/**
 * Missing-value guard for timestamp sorts: absent values stay last in BOTH
 * directions, so it must not be multiplied by `dir`.
 */
function missingLast(a: string | undefined, b: string | undefined): number | null {
  const aMissing = !a || Number.isNaN(Date.parse(a))
  const bMissing = !b || Number.isNaN(Date.parse(b))
  if (aMissing && bMissing) return 0
  if (aMissing) return 1
  if (bMissing) return -1
  return null
}

/** Sort entries; ties fall back to title so the table order stays stable. */
export function sortPaperEntries(
  entries: readonly PaperLibraryEntry[],
  sort: PaperLibrarySort
): PaperLibraryEntry[] {
  const dir = sort.dir === 'asc' ? 1 : -1
  const sorted = [...entries]
  sorted.sort((a, b) => {
    if (sort.key === 'lastOpenedAt' || sort.key === 'importedAt') {
      const aTs = sort.key === 'lastOpenedAt' ? a.lastOpenedAt : a.meta.importedAt
      const bTs = sort.key === 'lastOpenedAt' ? b.lastOpenedAt : b.meta.importedAt
      const missing = missingLast(aTs, bTs)
      if (missing !== null && missing !== 0) return missing
      const cmp = compareTimestamps(aTs, bTs) * dir
      if (cmp !== 0) return cmp
      return compareStrings(a.meta.title, b.meta.title)
    }
    let cmp = 0
    switch (sort.key) {
      case 'title':
        cmp = compareStrings(a.meta.title, b.meta.title)
        break
      case 'authors':
        cmp = compareStrings(a.meta.authors[0] ?? '', b.meta.authors[0] ?? '')
        break
      case 'year':
        cmp = compareStrings(a.meta.year ?? '', b.meta.year ?? '')
        break
      case 'venue':
        cmp = compareStrings(a.meta.venue ?? '', b.meta.venue ?? '')
        break
      case 'status':
        cmp = STATUS_RANK[entryStatus(a)] - STATUS_RANK[entryStatus(b)]
        break
    }
    if (cmp === 0) cmp = compareStrings(a.meta.title, b.meta.title)
    return cmp * dir
  })
  return sorted
}
