import type { PaperUnitMetaV1 } from '@shared/paper/paper-types'
import type { WritePaperReadingSettingsV1 } from '@shared/app-settings-types-product'
import { useWriteWorkspaceStore } from '../write-workspace-store'
import { normalizePath } from '../write-workspace-store-helpers'
import { newPaperRequestId, usePaperStore } from './paper-store'
import { openPaperInterpretation, openPaperUnit } from './paper-open-layout'
import { buildPaperInterpretPrompt } from './paper-interpret-prompt'
import {
  nextInterpretationFileName,
  PAPER_INTERPRET_SUFFIX,
  PAPER_TEXT_FILE,
  paperUnitSlugFromDir
} from './paper-unit'

export type PaperTranslate = (key: string, options?: Record<string, unknown>) => string

export type PaperActionDeps = {
  workspaceRoot: string
  settings: WritePaperReadingSettingsV1
  t: PaperTranslate
}

function paperNotice(notice: { tone: 'success' | 'error' | 'info'; message: string }): void {
  usePaperStore.getState().setNotice(notice)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorNotice(t: PaperTranslate, code: string, message: string): void {
  if (code === 'canceled') {
    paperNotice({ tone: 'info', message: t('writePaperCanceled') })
  } else if (code === 'timeout') {
    paperNotice({ tone: 'error', message: t('writePaperErrorTimeout') })
  } else if (code === 'network') {
    paperNotice({ tone: 'error', message: t('writePaperErrorNetwork', { message }) })
  } else {
    paperNotice({ tone: 'error', message: t('writePaperErrorGeneric', { message }) })
  }
}

function refreshWorkspace(workspaceRoot: string): Promise<void> {
  return useWriteWorkspaceStore.getState().refreshWorkspace(workspaceRoot)
}

/**
 * Import a paper unit (arXiv/papers.cool input string, or a local PDF path).
 * On success the unit opens in the split reading layout and auto-preprocess
 * kicks off when the setting allows it.
 */
export async function importPaper(
  deps: PaperActionDeps & {
    input?: string
    localPdfPath?: string
    onImported?: (unitDir: string, meta: PaperUnitMetaV1) => void
  }
): Promise<boolean> {
  const { t, workspaceRoot } = deps
  const requestId = newPaperRequestId()
  usePaperStore.getState().beginJob('import', requestId)
  try {
    const result = await window.kunGui.paperImport({
      workspaceRoot,
      input: deps.input ?? '',
      ...(deps.localPdfPath ? { localPdfPath: deps.localPdfPath } : {}),
      parentDir: deps.settings.papersDir,
      requestId
    })
    if (!result.ok) {
      errorNotice(t, result.code, result.message)
      return false
    }
    usePaperStore.getState().rememberUnit(result.unitDir, result.meta)
    paperNotice({
      tone: 'success',
      message: t('writePaperImportDone', { title: result.meta.title })
    })
    await refreshWorkspace(workspaceRoot)
    await openPaperUnit({ workspaceRoot, unitDir: result.unitDir, meta: result.meta })
    deps.onImported?.(result.unitDir, result.meta)
    if (deps.settings.autoPreprocess) {
      void preprocessPaper({ ...deps, unitDir: result.unitDir })
    }
    return true
  } catch (error) {
    paperNotice({ tone: 'error', message: t('writePaperErrorGeneric', { message: errorMessage(error) }) })
    return false
  } finally {
    usePaperStore.getState().endJob(requestId)
  }
}

/** Open an existing ordinary workspace PDF as a paper unit (copies, never moves). */
export async function openPdfAsPaper(
  deps: PaperActionDeps & { pdfPath: string }
): Promise<boolean> {
  const root = normalizePath(deps.workspaceRoot)
  const absolute = deps.pdfPath.startsWith(`${root}/`)
    ? normalizePath(deps.pdfPath)
    : `${root}/${deps.pdfPath.replace(/^\/+/, '')}`
  return importPaper({ ...deps, localPdfPath: absolute })
}

/**
 * Fetch papers.cool/Kimi notes and append them to NOTES.md (§6.2). Flushes the
 * open document first; the NOTES.md reload comes from the file watcher.
 */
export async function fetchCoolNotes(
  deps: PaperActionDeps & { unitDir: string; force?: boolean }
): Promise<void> {
  const { t, workspaceRoot, unitDir } = deps
  if (deps.settings.coolNotesEnabled === false) {
    paperNotice({ tone: 'info', message: t('writePaperCoolDisabled') })
    return
  }
  await useWriteWorkspaceStore.getState().flushSave(workspaceRoot)
  const requestId = newPaperRequestId()
  usePaperStore.getState().beginJob('cool-notes', requestId)
  try {
    const result = await window.kunGui.paperFetchCoolNotes({
      workspaceRoot,
      unitDir,
      force: deps.force === true,
      requestId
    })
    if (!result.ok) {
      if (result.code === 'no-notes-file') {
        paperNotice({ tone: 'info', message: t('writePaperCoolNotFound') })
      } else {
        errorNotice(t, result.code, result.message)
      }
      return
    }
    if (!result.found) {
      paperNotice({ tone: 'info', message: t('writePaperCoolNotFound') })
      return
    }
    paperNotice({
      tone: 'success',
      message: result.appended ? t('writePaperCoolAppended') : t('writePaperCoolExists')
    })
    await refreshWorkspace(workspaceRoot)
  } catch (error) {
    paperNotice({ tone: 'error', message: t('writePaperErrorGeneric', { message: errorMessage(error) }) })
  } finally {
    usePaperStore.getState().endJob(requestId)
  }
}

/** Cancel a running job by request id (Cool notes / import / preprocess). */
export function cancelPaperJob(kind: 'import' | 'cool-notes' | 'preprocess'): void {
  const job = usePaperStore.getState().busy[kind]
  if (job) void window.kunGui.paperCancel({ requestId: job.requestId })
}

/** Deterministic preprocessing: paper.md text + figures/index.json (§6.3). */
export async function preprocessPaper(
  deps: PaperActionDeps & { unitDir: string; force?: boolean }
): Promise<boolean> {
  const { t, workspaceRoot, unitDir } = deps
  const requestId = newPaperRequestId()
  usePaperStore.getState().beginJob('preprocess', requestId)
  try {
    const result = await window.kunGui.paperPreprocess({
      workspaceRoot,
      unitDir,
      force: deps.force === true,
      requestId
    })
    if (!result.ok) {
      errorNotice(t, result.code, result.message)
      return false
    }
    paperNotice({
      tone: 'success',
      message: t('writePaperPreprocessDone', { count: result.figureCount })
    })
    await refreshWorkspace(workspaceRoot)
    const read = await window.kunGui.paperReadUnit({ workspaceRoot, unitDir })
    if (read.ok) usePaperStore.getState().rememberUnit(read.unitDir, read.meta)
    return true
  } catch (error) {
    paperNotice({ tone: 'error', message: t('writePaperErrorGeneric', { message: errorMessage(error) }) })
    return false
  } finally {
    usePaperStore.getState().endJob(requestId)
  }
}

export type InterpretDeps = PaperActionDeps & {
  unitDir: string
  meta: PaperUnitMetaV1
  onSubmitPrompt?: (value: string) => void
  setInput: (value: string) => void
  input: string
  visionCapable?: boolean
}

/**
 * One-click interpretation (§6.5/§7): flush, ensure paper.md exists, build the
 * prompt, open the assistant, submit. The host watches the workspace for the
 * generated `-解读*.md` after the turn ends (see `checkPendingInterpretation`).
 */
export async function interpretPaper(deps: InterpretDeps): Promise<void> {
  const { t, workspaceRoot, unitDir, meta } = deps

  if (!await useWriteWorkspaceStore.getState().flushSave(workspaceRoot)) {
    paperNotice({ tone: 'error', message: t('writePaperSaveFailed') })
    return
  }

  const listing = await window.kunGui.listWorkspaceDirectory({ workspaceRoot, path: unitDir })
  const entries = listing.ok ? listing.entries : []
  const hasPaperText = entries.some(
    (entry) => entry.type === 'file' && entry.name === PAPER_TEXT_FILE
  )
  if (!hasPaperText && deps.settings.autoPreprocess) {
    const ok = await preprocessPaper(deps)
    if (!ok) return
  }

  const slug = meta.slug || paperUnitSlugFromDir(unitDir)
  const outputName = nextInterpretationFileName(
    slug,
    entries.filter((entry) => entry.type === 'file').map((entry) => entry.name)
  )
  const outputPath = `${unitDir}/${outputName}`
  const figuresFailed = meta.preprocess?.figuresStatus === 'failed'

  const prompt = buildPaperInterpretPrompt({
    unitDir,
    meta,
    outputPath,
    template: deps.settings.interpretTemplate,
    language: deps.settings.outputLanguage,
    visionCapable: deps.visionCapable,
    figuresFailed
  })

  usePaperStore.getState().setPendingInterpretation({
    workspaceRoot,
    unitDir,
    outputDir: unitDir,
    fileStem: outputName.replace(/\.md$/i, ''),
    plannedPath: outputPath,
    startedAt: Date.now()
  })
  useWriteWorkspaceStore.getState().setAssistantOpen(true)
  if (deps.onSubmitPrompt) deps.onSubmitPrompt(prompt)
  else deps.setInput(deps.input.trim() ? `${deps.input.trim()}\n\n${prompt}` : prompt)
}

/**
 * After an assistant turn ends, look for the interpretation file the agent was
 * asked to write. Accepts the planned name or any `<stem>-N.md` variant touched
 * during the turn; records it in `paper.json` and opens it in the right group.
 */
export async function checkPendingInterpretation(workspaceRoot: string): Promise<void> {
  const pending = usePaperStore.getState().pendingInterpretation
  if (!pending || normalizePath(pending.workspaceRoot) !== normalizePath(workspaceRoot)) return

  const listing = await window.kunGui.listWorkspaceDirectory({
    workspaceRoot,
    path: pending.outputDir
  })
  if (!listing.ok) return
  const candidates = listing.entries.filter(
    (entry) =>
      entry.type === 'file' &&
      entry.name.startsWith(pending.fileStem) &&
      entry.name.endsWith('.md') &&
      (entry.mtimeMs === undefined || entry.mtimeMs >= pending.startedAt - 5000)
  )
  if (candidates.length === 0) return

  const plannedName = pending.plannedPath.slice(pending.plannedPath.lastIndexOf('/') + 1)
  const chosen = candidates.some((entry) => entry.name === plannedName)
    ? plannedName
    : candidates.sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))[0].name
  const path = `${pending.outputDir}/${chosen}`

  usePaperStore.getState().setPendingInterpretation(null)
  await window.kunGui.paperRecordInterpretation({
    workspaceRoot,
    unitDir: pending.unitDir,
    path
  })
  await refreshWorkspace(workspaceRoot)
  await openPaperInterpretation({ workspaceRoot, unitDir: pending.unitDir, path })
}

/** Reload meta for the given unit into the paper store. */
export async function refreshPaperUnit(workspaceRoot: string, unitDir: string): Promise<void> {
  const read = await window.kunGui.paperReadUnit({ workspaceRoot, unitDir })
  if (read.ok) usePaperStore.getState().rememberUnit(read.unitDir, read.meta)
}

/** List paper units under the configured papers dir for the sidebar. */
export async function listPaperUnits(workspaceRoot: string, parentDir: string): Promise<void> {
  const result = await window.kunGui.paperListUnits({ workspaceRoot, parentDir })
  if (result.ok) usePaperStore.getState().setUnitsFromResult(result)
  else usePaperStore.getState().setUnitsError(result.message)
}

export { PAPER_INTERPRET_SUFFIX }
