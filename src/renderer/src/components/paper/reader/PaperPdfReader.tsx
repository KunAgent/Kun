import { useMemo, type ReactElement } from 'react'
import type { WritePdfRendererProps } from '../../write/write-pdf-renderer-context'
import { WritePdfViewer } from '../../write/WritePdfViewer'
import type { WorkspaceEntry } from '@shared/workspace-file'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { usePaperStore } from '../../../write/paper/paper-store'
import {
  findPaperUnitDir,
  paperUnitDirFromKnownUnits
} from '../../../write/paper/paper-unit'
import { PaperUnitPdfReader } from './PaperUnitPdfReader'

/**
 * Paper-mode PDF reader entry: resolves the paper unit directory for the
 * opened file and hands off to PaperUnitPdfReader, falling back to the
 * generic WritePdfViewer for loose PDFs outside any paper unit.
 */
export function PaperPdfReader(props: WritePdfRendererProps): ReactElement {
  const { filePath, workspaceRoot } = props
  const entriesByDir = useWriteWorkspaceStore((s) => s.entriesByDir)
  const entries = usePaperModeStore((s) => s.entries)
  const knownUnits = usePaperStore((s) => s.unitsByDir)
  const unitDirAbs = useMemo(() => {
    return (
      findUnitDir(
        filePath,
        workspaceRoot,
        entriesByDir,
        entries.map((e) => e.unitDir),
        Object.keys(knownUnits)
      )
    )
  }, [filePath, workspaceRoot, entriesByDir, entries, knownUnits])
  if (!unitDirAbs) {
    return <WritePdfViewer {...props} />
  }
  return <PaperUnitPdfReader {...props} unitDirAbs={unitDirAbs} />
}

function findUnitDir(
  filePath: string,
  workspaceRoot: string,
  entriesByDir: Record<string, WorkspaceEntry[]>,
  libraryUnitDirs: readonly string[],
  knownUnitDirs: readonly string[]
): string | null {
  return (
    findPaperUnitDir(workspaceRoot, filePath, entriesByDir)
    ?? paperUnitDirFromKnownUnits(workspaceRoot, filePath, libraryUnitDirs)
    ?? paperUnitDirFromKnownUnits(workspaceRoot, filePath, knownUnitDirs)
  )
}
