import type { PaperImportHintMeta } from '@shared/paper/paper-types'
import { expandFolderPaths } from './paper-folder-tree'
import { joinPaperFolder, normalizePaperFolderInput } from './paper-import-target'
import type { ImportSheetPrefs } from './paper-import-sheet-prefs'

/**
 * Pure planning for "import these papers": which folder each paper goes to,
 * which ones are already in the library, and the suggested topic folder.
 * The runner (`paper-import-job.ts`) executes a plan; the sheet builds one.
 */

export type ImportOwned = { unitDir: string; group: string; workspaceRoot?: string }

export type ImportCandidate = {
  /** Selection / status identity, unique inside one candidate list. */
  key: string
  /** Every identity key of the paper (DOI, arXiv, venue id, title). */
  keys: readonly string[]
  title: string
  /** Import handle: arXiv id, venue id or DOI. */
  input: string
  meta?: PaperImportHintMeta
  /** Recommended group label from the Agent's report, if any. */
  group?: string
  /** Set when the paper already lives in the library. */
  owned?: ImportOwned
}

export type ImportTarget = {
  /** Destination folder relative to the papers dir ('' = top level). */
  folder: string
  /** File each paper under `<folder>/<its group>` when it has a group. */
  byGroup: boolean
  /** Papers already in the library: leave them or move them into the folder. */
  owned: 'keep' | 'move'
}

export type ImportBatch = { folder: string; items: ImportCandidate[] }

export type ImportPlan = {
  batches: ImportBatch[]
  /** Already-owned papers to move (only when `owned: 'move'`). */
  moves: Array<{ candidate: ImportCandidate; folder: string }>
  /** Already-owned papers left where they are. */
  kept: ImportCandidate[]
  /** Candidates with no import handle (cannot be imported). */
  unresolved: ImportCandidate[]
  total: number
}

const MAX_SEGMENT_CHARS = 40

/** One folder-name segment from free text (group labels, topics). */
export function sanitizeFolderSegment(value: string): string {
  const cleaned = value
    .replace(/[<>:"|?*\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .trim()
  const clipped = cleaned.length > MAX_SEGMENT_CHARS ? cleaned.slice(0, MAX_SEGMENT_CHARS).trim() : cleaned
  return clipped
}

/** `<parent>/<segment>`, falling back to `parent` when it would be too deep or invalid. */
export function childFolder(parent: string, label: string): string {
  const segment = sanitizeFolderSegment(label)
  if (!segment) return parent
  const joined = parent ? `${parent}/${segment}` : segment
  return normalizePaperFolderInput(joined) ?? parent
}

/**
 * A topic folder name that does not collide with `existing` folders. Empty
 * input yields '' (the caller falls back to the top level).
 */
export function suggestTopicFolder(topic: string, existing: readonly string[]): string {
  const base = sanitizeFolderSegment(topic.split(/\r?\n/)[0] ?? '')
  if (!base) return ''
  const taken = new Set(existing.map((folder) => folder.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let index = 2; index < 50; index += 1) {
    const candidate = `${base} ${index}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return base
}

/** Names of the folders directly inside `parent` ('' = the papers dir). */
export function childFolderNames(groups: readonly string[], parent: string): string[] {
  const prefix = parent ? `${parent}/` : ''
  return expandFolderPaths(groups)
    .filter((folder) => folder.startsWith(prefix) && !folder.slice(prefix.length).includes('/'))
    .map((folder) => folder.slice(prefix.length))
}

/**
 * The folder the import sheet proposes: the remembered parent (if it still
 * exists), plus a topic-named subfolder when the user asked for one.
 */
export function proposedImportFolder(
  prefs: Pick<ImportSheetPrefs, 'parent' | 'topicFolder'>,
  topic: string,
  groups: readonly string[]
): string {
  const parent = expandFolderPaths(groups).includes(prefs.parent) ? prefs.parent : ''
  if (!prefs.topicFolder) return parent
  const name = suggestTopicFolder(topic, childFolderNames(groups, parent))
  return (name && joinPaperFolder(parent, name)) || parent
}

/** Distinct, non-empty group labels in first-seen order. */
export function importGroupLabels(candidates: readonly ImportCandidate[]): string[] {
  const seen: string[] = []
  for (const candidate of candidates) {
    const label = candidate.group?.trim()
    if (label && !seen.includes(label)) seen.push(label)
  }
  return seen
}

export function planPaperImport(candidates: readonly ImportCandidate[], target: ImportTarget): ImportPlan {
  const folderOf = (candidate: ImportCandidate): string =>
    target.byGroup && candidate.group?.trim() ? childFolder(target.folder, candidate.group) : target.folder
  const byFolder = new Map<string, ImportCandidate[]>()
  const moves: ImportPlan['moves'] = []
  const kept: ImportCandidate[] = []
  const unresolved: ImportCandidate[] = []
  for (const candidate of candidates) {
    const folder = folderOf(candidate)
    if (candidate.owned) {
      if (target.owned === 'move' && candidate.owned.group !== folder) moves.push({ candidate, folder })
      else kept.push(candidate)
      continue
    }
    if (!candidate.input) {
      unresolved.push(candidate)
      continue
    }
    const list = byFolder.get(folder)
    if (list) list.push(candidate)
    else byFolder.set(folder, [candidate])
  }
  return {
    batches: [...byFolder.entries()].map(([folder, items]) => ({ folder, items })),
    moves,
    kept,
    unresolved,
    total: candidates.length
  }
}

/** Number of papers a plan will newly import. */
export function plannedImportCount(plan: ImportPlan): number {
  return plan.batches.reduce((sum, batch) => sum + batch.items.length, 0)
}

/** Folder tree preview rows: `[folder, count]` ordered parent-first. */
export function plannedFolderRows(plan: ImportPlan, root: string): Array<{ folder: string; count: number }> {
  const counts = new Map<string, number>()
  const add = (folder: string, count: number): void => {
    let current = folder
    while (current) {
      counts.set(current, (counts.get(current) ?? 0) + count)
      const cut = current.lastIndexOf('/')
      current = cut < 0 ? '' : current.slice(0, cut)
    }
  }
  for (const batch of plan.batches) add(batch.folder, batch.items.length)
  for (const move of plan.moves) add(move.folder, 1)
  if (root && !counts.has(root)) counts.set(root, 0)
  return [...counts.entries()]
    .map(([folder, count]) => ({ folder, count }))
    .sort((a, b) => a.folder.localeCompare(b.folder))
}
