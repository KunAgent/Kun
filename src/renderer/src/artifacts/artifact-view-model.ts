import type { LibraryArtifact, LibraryArtifactKind } from './artifact-types'

export type ArtifactKindFilter = 'all' | LibraryArtifactKind
export type ArtifactSort = 'recent' | 'name'

export type ArtifactFilter = {
  kind: ArtifactKindFilter
  project: string
  query: string
  sort: ArtifactSort
}

export const ARTIFACT_KIND_LABEL_KEYS: Record<LibraryArtifactKind, string> = {
  design: 'artifactsKindDesign',
  doc: 'artifactsKindDoc',
  slides: 'artifactsKindSlides',
  report: 'artifactsKindReport',
  sheet: 'artifactsKindSheet',
  board: 'artifactsKindBoard',
  image: 'artifactsKindImage'
}

export function filterArtifacts(items: readonly LibraryArtifact[], filter: ArtifactFilter): LibraryArtifact[] {
  const query = filter.query.trim().toLowerCase()
  const matched = items.filter((item) =>
    (filter.kind === 'all' || item.kind === filter.kind) &&
    (!filter.project || item.workspaceRoot === filter.project) &&
    (!query || item.title.toLowerCase().includes(query) || item.path.toLowerCase().includes(query))
  )
  return filter.sort === 'name'
    ? matched.sort((left, right) => left.title.localeCompare(right.title))
    : matched.sort((left, right) => right.updatedAt - left.updatedAt)
}

export function countByKind(items: readonly LibraryArtifact[]): Record<ArtifactKindFilter, number> {
  const counts: Record<ArtifactKindFilter, number> = {
    all: items.length, design: 0, doc: 0, slides: 0, report: 0, sheet: 0, board: 0, image: 0
  }
  for (const item of items) counts[item.kind] += 1
  return counts
}

export function projectOptions(items: readonly LibraryArtifact[]): Array<{ root: string; name: string }> {
  const seen = new Map<string, string>()
  for (const item of items) if (!seen.has(item.workspaceRoot)) seen.set(item.workspaceRoot, item.projectName)
  return [...seen.entries()]
    .map(([root, name]) => ({ root, name }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

const DAY_MS = 24 * 60 * 60 * 1000

export function formatArtifactTime(updatedAt: number, language: string, now = Date.now()): string {
  if (!updatedAt) return ''
  const diff = updatedAt - now
  const abs = Math.abs(diff)
  const relative = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  if (abs < 60 * 60 * 1000) return relative.format(Math.round(diff / 60000), 'minute')
  if (abs < DAY_MS) return relative.format(Math.round(diff / 3600000), 'hour')
  if (abs < 7 * DAY_MS) return relative.format(Math.round(diff / DAY_MS), 'day')
  return new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' }).format(new Date(updatedAt))
}

export function formatArtifactSize(size: number | undefined): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function fileTypeLabel(item: Pick<LibraryArtifact, 'ext'>): string {
  return item.ext ? item.ext.slice(1).toUpperCase() : ''
}
