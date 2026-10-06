import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** Presentation only: the persisted group path is always the identity. */
export function paperGroupLabel(group: string, entries: readonly PaperLibraryEntry[], t: Translate): {
  label: string; identifier: string | null
} {
  const leaf = group.split('/').at(-1) || group
  if (!/^\d{4}(?:\.\d{4,5}(?:v\d+)?|[.-][a-z][\w.-]*|[.-]\d+)$/i.test(leaf) && !/^\d+$/.test(leaf)) {
    return { label: leaf, identifier: null }
  }
  const normalize = (value: string): string => value.trim().replace(/^arxiv:/i, '').replace(/v\d+$/i, '').toLowerCase()
  const matches = paperEntriesInGroup(entries, group).filter(({ meta }) => !meta.needsReview && meta.title.trim() &&
    [meta.arxivId, meta.citeKey, meta.doi].some((id) => id && normalize(id) === normalize(leaf)))
  const titles = [...new Set(matches.map(({ meta }) => meta.title.trim()))]
  return { label: titles.length === 1 ? titles[0] : t('paperBatchGroupFallback'), identifier: leaf }
}

export function paperEntriesInGroup(entries: readonly PaperLibraryEntry[], group: string): PaperLibraryEntry[] {
  return entries.filter((entry) => entry.group === group || entry.group.startsWith(`${group}/`))
}
