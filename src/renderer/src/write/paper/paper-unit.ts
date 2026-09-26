import type { WorkspaceEntry } from '@shared/workspace-file'
import { normalizePath, writeDirnameFromPath } from '../write-workspace-store-helpers'

export const PAPER_META_FILE = 'paper.json'
export const PAPER_NOTES_FILE = 'NOTES.md'
export const PAPER_TEXT_FILE = 'paper.md'
export const PAPER_FIGURES_DIR = 'figures'
export const PAPER_ASSETS_DIR = 'assets'
export const PAPER_INTERPRET_SUFFIX = '-解读'

/**
 * A paper unit is a directory containing a `paper.json` (D1: the file tree is
 * the library). Detection walks ancestors of the file path toward the
 * workspace root using the directory entries the file tree already loaded —
 * no extra IPC for the common case.
 */
export function findPaperUnitDir(
  workspaceRoot: string,
  filePath: string | null | undefined,
  entriesByDir: Record<string, WorkspaceEntry[]>
): string | null {
  const root = normalizePath(workspaceRoot)
  const path = normalizePath(filePath ?? '')
  if (!root || !path || !path.startsWith(`${root}/`)) return null
  let dir = writeDirnameFromPath(path)
  while (dir.startsWith(root)) {
    const entries = entriesByDir[dir]
    if (entries?.some((entry) => entry.type === 'file' && entry.name === PAPER_META_FILE)) {
      return dir
    }
    if (dir === root) break
    const parent = writeDirnameFromPath(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Fallback unit detection that does not need loaded tree entries: checks the
 * file path against known unit dirs (sidebar listing + imported units in the
 * paper store). Returns the longest matching unit dir (absolute or
 * workspace-relative as given in `knownUnitDirs`).
 */
export function paperUnitDirFromKnownUnits(
  workspaceRoot: string,
  filePath: string | null | undefined,
  knownUnitDirs: readonly string[]
): string | null {
  const root = normalizePath(workspaceRoot)
  const path = normalizePath(filePath ?? '')
  if (!root || !path.startsWith(`${root}/`)) return null
  let best: string | null = null
  for (const rawDir of knownUnitDirs) {
    const dir = normalizePath(rawDir)
    const abs = dir.startsWith(`${root}/`) ? dir : `${root}/${dir}`
    if (path === abs || path.startsWith(`${abs}/`)) {
      if (!best || abs.length > best.length) best = abs
    }
  }
  return best
}

/** `papers/1706.03762` → `1706.03762`; the unit's own directory name. */
export function paperUnitSlugFromDir(unitDir: string): string {
  const normalized = normalizePath(unitDir)
  return normalized.split('/').filter(Boolean).at(-1) ?? normalized
}

export function paperUnitChildPath(unitDir: string, child: string): string {
  return `${normalizePath(unitDir)}/${child.replace(/^\/+/, '')}`
}

export function paperUnitDirForFile(unitDir: string, workspaceRoot: string): string {
  const root = normalizePath(workspaceRoot)
  const dir = normalizePath(unitDir)
  return dir.startsWith(`${root}/`) ? dir.slice(root.length + 1) : dir
}

/** `<slug>-解读.md`, `-解读-2.md`, … — never overwrite an existing file. */
export function nextInterpretationFileName(slug: string, existing: readonly string[]): string {
  for (let index = 1; index < 100; index += 1) {
    const suffix = index === 1 ? PAPER_INTERPRET_SUFFIX : `${PAPER_INTERPRET_SUFFIX}-${index}`
    const name = `${slug}${suffix}.md`
    if (!existing.includes(name)) return name
  }
  return `${slug}${PAPER_INTERPRET_SUFFIX}-${Date.now()}.md`
}
