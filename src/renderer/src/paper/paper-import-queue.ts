import type { PaperImportLine } from './paper-import-classify'
import type { PaperTitleSearchCandidate } from '@shared/paper/paper-library-types'
import { newPaperRequestId } from '../write/paper/paper-store'

/**
 * Import queue for the multiline dialog (PM4): max 2 concurrent imports,
 * per-line status callbacks, per-item cancel via `paper:cancel`. Title lines
 * pause in `picking` until the UI resolves a candidate (or skips).
 */
export type PaperImportItemStatus =
  | 'pending'
  | 'resolving'
  | 'picking'
  | 'importing'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'canceled'

export type PaperImportQueueItem = {
  id: string
  line: PaperImportLine
  status: PaperImportItemStatus
  /** Resolved title or error message for the row. */
  detail: string
  requestId: string
  unitDir?: string
  candidates?: PaperTitleSearchCandidate[]
  /** Set while the item waits for the user to pick a title candidate. */
  pick?: (choice: PaperTitleSearchCandidate | null) => void
}

type QueueCallbacks = {
  onItem: (item: PaperImportQueueItem) => void
}

async function runItem(
  item: PaperImportQueueItem,
  input: { workspaceRoot: string; papersDir?: string; downloadPdfs: boolean },
  cb: QueueCallbacks
): Promise<void> {
  const emit = (patch: Partial<PaperImportQueueItem>): void => {
    Object.assign(item, patch)
    cb.onItem({ ...item })
  }
  const gui = window.kunGui
  if (!gui?.paperImport) {
    emit({ status: 'failed', detail: 'import bridge unavailable' })
    return
  }

  try {
    if (item.line.kind === 'bibtex') {
      emit({ status: 'importing', detail: 'BibTeX' })
      const result = await gui.paperImportBibtex({
        workspaceRoot: input.workspaceRoot,
        bibtex: item.line.ref,
        downloadPdfs: input.downloadPdfs,
        requestId: item.requestId
      })
      if (!result.ok) {
        emit({ status: result.message === 'canceled' ? 'canceled' : 'failed', detail: result.message })
        return
      }
      emit({
        status: 'done',
        detail: `imported ${result.imported}, skipped ${result.skipped}`
      })
      return
    }

    let inputText = item.line.ref
    // Local PDFs go straight through `paperImport`; the main-side local branch
    // identifies ids, fills metadata, dedupes, and flags needsReview.
    const localPdfPath = item.line.kind === 'localPdf' ? item.line.ref : undefined
    if (item.line.kind === 'localPdf') {
      inputText = ''
    } else if (item.line.kind === 'title') {
      emit({ status: 'resolving', detail: 'searching title' })
      if (typeof gui.paperSearchByTitle !== 'function') {
        emit({ status: 'failed', detail: 'title search unavailable' })
        return
      }
      const found = await gui.paperSearchByTitle({ query: item.line.ref, limit: 3 })
      if (!found.ok || found.candidates.length === 0) {
        emit({ status: 'failed', detail: found.ok ? 'no match' : found.message })
        return
      }
      const choice = await new Promise<PaperTitleSearchCandidate | null>((resolve) => {
        item.pick = resolve
        emit({ status: 'picking', candidates: found.candidates, detail: item.line.ref })
      })
      item.pick = undefined
      if (item.status === 'canceled') return
      if (!choice) {
        emit({ status: 'skipped', detail: 'skipped' })
        return
      }
      inputText = choice.arxivId ?? choice.doi ?? choice.title
      emit({ status: 'importing', candidates: undefined, detail: choice.title })
    }

    emit({ status: 'importing' })
    const result = await gui.paperImport({
      workspaceRoot: input.workspaceRoot,
      input: inputText,
      localPdfPath,
      parentDir: input.papersDir,
      requestId: item.requestId
    })
    if (!result.ok) {
      emit({
        status: result.code === 'canceled' ? 'canceled' : 'failed',
        detail: result.message
      })
      return
    }
    emit({ status: 'done', detail: result.meta.title, unitDir: result.unitDir })
  } catch (error) {
    emit({ status: 'failed', detail: error instanceof Error ? error.message : String(error) })
  }
}

/** Run the queue; resolves when every item settles (or is canceled). */
export async function runPaperImportQueue(
  items: PaperImportQueueItem[],
  input: { workspaceRoot: string; papersDir?: string; downloadPdfs: boolean },
  cb: QueueCallbacks
): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: 2 }, async () => {
    for (;;) {
      const item = queue.shift()
      if (!item) return
      if (item.status !== 'pending') continue
      await runItem(item, input, cb)
    }
  })
  await Promise.all(workers)
}

export function newPaperImportItem(line: PaperImportLine): PaperImportQueueItem {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    line,
    status: 'pending',
    detail: '',
    requestId: newPaperRequestId()
  }
}

/** Resolve a `picking` title item: import the choice, or skip on null. */
export function pickPaperImportCandidate(
  item: PaperImportQueueItem,
  choice: PaperTitleSearchCandidate | null
): void {
  if (item.status !== 'picking' || !item.pick) return
  const resolve = item.pick
  item.pick = undefined
  resolve(choice)
}

export function cancelPaperImportItem(item: PaperImportQueueItem): void {
  if (item.status === 'pending' || item.status === 'skipped') {
    item.status = 'canceled'
    return
  }
  if (item.status === 'picking' && item.pick) {
    const resolve = item.pick
    item.pick = undefined
    item.status = 'canceled'
    resolve(null)
    return
  }
  void window.kunGui?.paperCancel?.({ requestId: item.requestId })
}
