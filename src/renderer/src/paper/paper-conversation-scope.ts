import type { WorkspaceEntry } from '@shared/workspace-file'
import type { WriteWorkSurface } from '../write/write-surface'
import {
  findPaperUnitDir,
  paperUnitDirFromKnownUnits
} from '../write/paper/paper-unit'
import { normalizePath } from '../write/write-workspace-store-helpers'

export type PaperModeView = 'library' | 'reader' | 'discover'

/**
 * Map the active editor file to the conversation resource for the assistant
 * panel. On the papers surface a file inside a paper unit binds the
 * conversation to the whole unit (PDF and NOTES share one thread); the
 * library and discover views use the library-level (workspace) thread.
 * Returns the absolute unit dir, the file path itself, or undefined for the
 * library-level thread.
 */
export function paperConversationResourcePath(input: {
  surface: WriteWorkSurface
  workspaceRoot: string
  activeFilePath: string | null | undefined
  unitDirs: readonly string[]
  entriesByDir?: Record<string, WorkspaceEntry[]>
  view?: PaperModeView
}): string | undefined {
  const { surface, workspaceRoot, activeFilePath, unitDirs, entriesByDir, view } = input
  if (surface !== 'papers') return activeFilePath ?? undefined
  if (view === 'library' || view === 'discover') return undefined
  const root = normalizePath(workspaceRoot)
  const path = normalizePath(activeFilePath ?? '')
  if (!root || !path) return undefined
  const unitAbs =
    (entriesByDir ? findPaperUnitDir(root, path, entriesByDir) : null) ??
    paperUnitDirFromKnownUnits(root, path, unitDirs)
  return unitAbs ?? path
}

/** Relative paths a paper-mode turn may reference as context. */
export function paperContextReferencePaths(unitRelDir: string): string[] {
  const dir = unitRelDir.replace(/\/+$/, '')
  return [
    `${dir}/paper.json`,
    `${dir}/paper.md`,
    `${dir}/NOTES.md`,
    `${dir}/marks/annotations.json`
  ]
}
