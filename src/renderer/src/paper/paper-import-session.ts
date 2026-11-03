import { create } from 'zustand'
import { localPdfImportLine, parsePaperImportInput, type PaperImportLine } from './paper-import-classify'
import { cancelPaperImportItem, newPaperImportItem, runPaperImportQueue, type PaperImportQueueItem } from './paper-import-queue'
import { ensurePaperSpace, paperSpaceReadingSettings } from './paper-space'
import { usePaperModeStore } from './paper-mode-store'
import { rememberPaperSpace } from './paper-mode-actions'

type ImportSession = {
  value: string
  downloadPdfs: boolean
  items: PaperImportQueueItem[]
  workspaceRoot: string | null
  running: boolean
  finished: boolean
  error: string | null
}

/** App-owned task state, not dialog-owned: route changes and closing cannot cancel a run. */
export const usePaperImportSession = create<ImportSession>(() => ({
  value: '', downloadPdfs: true, items: [], workspaceRoot: null,
  running: false, finished: false, error: null
}))

export function appendPaperImportLines(lines: readonly PaperImportLine[]): void {
  if (!lines.length) return
  usePaperImportSession.setState((state) => ({ items: [...state.items, ...lines.map(newPaperImportItem)] }))
}

export async function appendPaperImportFiles(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    if (/\.pdf$/i.test(path)) appendPaperImportLines([localPdfImportLine(path)])
    else if (/\.bib$/i.test(path)) {
      try {
        const result = await window.kunGui.readWorkspaceFile({ path })
        if (!result.ok) throw new Error(result.message)
        const lines = parsePaperImportInput(result.content)
        if (!lines.length) throw new Error('No BibTeX entries found.')
        appendPaperImportLines(lines)
      } catch (error) {
        // A failed file read remains visible and retryable, not a silent empty import.
        const item = newPaperImportItem({ kind: 'bibtex', raw: path.split(/[\\/]/).pop() ?? path, ref: '' })
        usePaperImportSession.setState((state) => ({ items: [...state.items, {
          ...item, sourceFile: path, status: 'failed', detail: error instanceof Error ? error.message : String(error)
        }] }))
      }
    }
  }
}

function patchItem(next: PaperImportQueueItem): void {
  usePaperImportSession.setState((state) => ({ items: state.items.map((item) => item.id === next.id ? next : item) }))
}

/** Failed rows can be corrected without re-running or duplicating successful imports. */
export function editFailedPaperImportInput(id: string, value: string): void {
  usePaperImportSession.setState((state) => state.running ? state : {
    items: state.items.map((item) => item.id === id && item.status === 'failed' ? { ...item, retryInput: value } : item)
  })
}

/** Only pending rows run normally; retries explicitly select failed rows, never successes. */
export async function startPaperImportSession(retryFailed = false): Promise<void> {
  const state = usePaperImportSession.getState()
  if (state.running) return
  const failedFiles = retryFailed ? state.items.filter((item) => item.status === 'failed' && item.sourceFile).map((item) => item.sourceFile!) : []
  const parsed = retryFailed ? [] : parsePaperImportInput(state.value).map(newPaperImportItem)
  const items = retryFailed
    ? state.items.filter((item) => !(item.status === 'failed' && item.sourceFile)).flatMap((item) => {
      if (item.status !== 'failed') return [item]
      const lines = item.retryInput === undefined ? [item.line] : parsePaperImportInput(item.retryInput)
      if (!lines.length) return [item]
      return lines.map((line, index) => ({ ...newPaperImportItem(line), ...(index === 0 ? { id: item.id } : {}) }))
    })
    : [...state.items, ...parsed]
  if (!failedFiles.length && !items.some((item) => item.status === 'pending')) return
  usePaperImportSession.setState({ items, value: retryFailed ? state.value : '', running: true, finished: false, error: null })
  try {
    if (failedFiles.length) await appendPaperImportFiles(failedFiles)
    const workspaceRoot = await ensurePaperSpace()
    usePaperImportSession.setState({ workspaceRoot })
    // A drop may append rows during a run. Drain those through the same bounded queue.
    for (;;) {
      const pending = usePaperImportSession.getState().items.filter((item) => item.status === 'pending')
      if (!pending.length) break
      await runPaperImportQueue(pending, { workspaceRoot, papersDir: paperSpaceReadingSettings().papersDir || 'papers', downloadPdfs: state.downloadPdfs }, { onItem: patchItem })
    }
    if (usePaperImportSession.getState().items.some((item) => item.status === 'done' && !item.reused)) {
      await rememberPaperSpace(workspaceRoot)
    }
  } catch (error) {
    usePaperImportSession.setState({ error: error instanceof Error ? error.message : String(error) })
  } finally {
    usePaperImportSession.setState({ running: false, finished: true })
    usePaperModeStore.getState().refreshEntries()
  }
}

export function cancelPaperImportSessionItem(item: PaperImportQueueItem): void {
  cancelPaperImportItem(item)
  if (item.status === 'canceled') patchItem({ ...item })
}
