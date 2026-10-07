import type { WorkspaceEntry } from '@shared/workspace-file'
import {
  findPaperUnitDir,
  paperUnitDirFromKnownUnits
} from '../write/paper/paper-unit'
import { normalizePath } from '../write/write-workspace-store-helpers'
import { researchResourcePath } from './paper-research-sessions'

export type PaperModeView = 'library' | 'reader' | 'discover' | 'research'

/**
 * The resource a new Work session is anchored to. A file inside a paper unit
 * anchors to the whole unit (PDF and NOTES belong together); the library and
 * discover views anchor to the space itself, and each Agent research session
 * to its own virtual path. Returns the absolute unit dir, the file path
 * itself, or undefined for a space-level session.
 */
export function paperConversationResourcePath(input: {
  workspaceRoot: string
  activeFilePath: string | null | undefined
  unitDirs: readonly string[]
  entriesByDir?: Record<string, WorkspaceEntry[]>
  view?: PaperModeView
  /** Selected Agent research session when `view === 'research'`. */
  researchSessionId?: string | null
}): string | undefined {
  const { workspaceRoot, activeFilePath, unitDirs, entriesByDir, view } = input
  // Each research session is its own conversation, bound to a virtual path.
  if (view === 'research') return researchResourcePath(workspaceRoot, input.researchSessionId)
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
