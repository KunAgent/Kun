import { useMemo } from 'react'
import { useWriteWorkspaceStore, writeBasenameFromPath } from '../write/write-workspace-store'
import { usePaperStore } from '../write/paper/paper-store'
import { usePaperModeStore } from './paper-mode-store'
import {
  findPaperUnitDir,
  paperUnitDirForFile,
  paperUnitDirFromKnownUnits,
  paperUnitSlugFromDir,
  PAPER_INTERPRET_SUFFIX,
  PAPER_NOTES_FILE
} from '../write/paper/paper-unit'

export type PaperTabLabel = {
  title: string
  kind: 'pdf' | 'notes' | 'interpretation' | 'other'
}

/**
 * Resolve a file tab to its owning paper's display title (U1): PDF tabs and
 * NOTES/interpretation tabs inside a paper unit show `meta.title` (with a
 * small suffix) instead of `2506.11060.pdf`. Returns null outside the papers
 * surface or for files that are not inside a known unit.
 */
export function usePaperTabLabel(path: string | null): PaperTabLabel | null {
  const surface = useWriteWorkspaceStore((s) => s.workSurface)
  const workspaceRoot = useWriteWorkspaceStore((s) => s.workspaceRoot)
  const entriesByDir = useWriteWorkspaceStore((s) => s.entriesByDir)
  const unitsByDir = usePaperStore((s) => s.unitsByDir)
  const entries = usePaperModeStore((s) => s.entries)

  return useMemo(() => {
    if (surface !== 'papers' || !path || !workspaceRoot) return null
    const unitAbs =
      findPaperUnitDir(workspaceRoot, path, entriesByDir) ??
      paperUnitDirFromKnownUnits(workspaceRoot, path, entries.map((e) => e.unitDir)) ??
      paperUnitDirFromKnownUnits(workspaceRoot, path, Object.keys(unitsByDir))
    if (!unitAbs) return null
    const relDir = paperUnitDirForFile(unitAbs, workspaceRoot)
    const meta = entries.find((entry) => entry.unitDir === relDir)?.meta ?? unitsByDir[relDir]
    const title = meta?.title || paperUnitSlugFromDir(relDir)
    const name = writeBasenameFromPath(path)
    const kind: PaperTabLabel['kind'] =
      name === PAPER_NOTES_FILE
        ? 'notes'
        : name.includes(PAPER_INTERPRET_SUFFIX)
          ? 'interpretation'
          : /\.pdf$/i.test(name)
            ? 'pdf'
            : 'other'
    return { title, kind }
  }, [surface, path, workspaceRoot, entriesByDir, unitsByDir, entries])
}
