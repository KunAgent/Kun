import type { PaperUnitMeta } from '@shared/paper/paper-meta-v2'
import type { WorkspaceEntry } from '@shared/workspace-file'
import { usePaperModeStore } from '../paper/paper-mode-store'
import { usePaperStore } from './paper/paper-store'
import {
  findPaperUnitDir,
  paperUnitDirForFile,
  paperUnitDirFromKnownUnits,
  PAPER_NOTES_FILE,
  PAPER_TEXT_FILE
} from './paper/paper-unit'
import { normalizePath } from './write-workspace-store-helpers'

/**
 * The paper behind the open Work document: what it is and where its text
 * lives, so whichever Agent answers can read `paper.md` itself. Locators are
 * workspace-relative; the Agent's working directory is the space.
 */
export type WritePaperReference = {
  title: string
  authors: string[]
  year?: string
  venue?: string
  arxivId?: string
  doi?: string
  /** The paper unit folder, e.g. `papers/2609.01481`. */
  unitLocator: string
  /** `paper.md` when it has been extracted. */
  textLocator?: string
  notesLocator?: string
  pdfLocator?: string
  /** The page the reader shows. */
  page?: number
  pageCount?: number
}

type PaperReferenceState = {
  workspaceRoot: string
  activeFilePath: string | null
  entriesByDir: Record<string, WorkspaceEntry[]>
}

function unitHasFile(entries: WorkspaceEntry[] | undefined, name: string): boolean {
  return entries?.some((entry) => entry.type === 'file' && entry.name === name) === true
}

export function writePaperReference(
  state: PaperReferenceState,
  known: {
    entries: ReadonlyArray<{ unitDir: string; meta: PaperUnitMeta; hasNotes?: boolean }>
    unitsByDir: Record<string, PaperUnitMeta>
    readerPage: { unitDir: string; page: number; pageCount: number } | null
  }
): WritePaperReference | undefined {
  const root = normalizePath(state.workspaceRoot)
  const filePath = state.activeFilePath
  if (!root || !filePath) return undefined
  const unitAbs = findPaperUnitDir(root, filePath, state.entriesByDir) ??
    paperUnitDirFromKnownUnits(root, filePath, [
      ...known.entries.map((entry) => entry.unitDir),
      ...Object.keys(known.unitsByDir)
    ])
  if (!unitAbs) return undefined
  const unitLocator = paperUnitDirForFile(unitAbs, root)
  const entry = known.entries.find((candidate) => normalizePath(candidate.unitDir) === unitLocator)
  const meta = entry?.meta ?? known.unitsByDir[unitLocator] ?? known.unitsByDir[normalizePath(unitAbs)]
  if (!meta) return undefined
  // The tree may not have listed the unit yet; preprocessing records paper.md.
  const files = state.entriesByDir[normalizePath(unitAbs)]
  const hasText = unitHasFile(files, PAPER_TEXT_FILE) || meta.preprocess?.textStatus === 'ok'
  const hasNotes = unitHasFile(files, PAPER_NOTES_FILE) || entry?.hasNotes === true
  const page = known.readerPage?.unitDir === unitLocator ? known.readerPage : null
  return {
    title: meta.title,
    authors: meta.authors,
    ...(meta.year ? { year: meta.year } : {}),
    ...(meta.venue ? { venue: meta.venue } : {}),
    ...(meta.arxivId ? { arxivId: meta.arxivId } : {}),
    ...(meta.doi ? { doi: meta.doi } : {}),
    unitLocator,
    ...(hasText ? { textLocator: `${unitLocator}/${PAPER_TEXT_FILE}` } : {}),
    ...(hasNotes ? { notesLocator: `${unitLocator}/${PAPER_NOTES_FILE}` } : {}),
    ...(meta.pdfFile ? { pdfLocator: `${unitLocator}/${meta.pdfFile}` } : {}),
    ...(page ? { page: page.page, ...(page.pageCount ? { pageCount: page.pageCount } : {}) } : {})
  }
}

/** The open paper of the current Work space, from the live paper stores. */
export function activeWritePaperReference(state: PaperReferenceState): WritePaperReference | undefined {
  const paperMode = usePaperModeStore.getState()
  return writePaperReference(state, {
    entries: paperMode.entries,
    unitsByDir: usePaperStore.getState().unitsByDir,
    readerPage: paperMode.readerPage
  })
}
