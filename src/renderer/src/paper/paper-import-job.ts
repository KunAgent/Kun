import { create } from 'zustand'
import { newPaperRequestId, usePaperStore } from '../write/paper/paper-store'
import { normalizePath } from '../write/write-workspace-store-helpers'
import { paperImportParentDir } from './paper-import-target'
import { usePaperModeStore } from './paper-mode-store'
import { openPaperViewTab } from './paper-view'
import { trashPaperUnits } from './paper-unit-ops'
import { usePaperFreshFolders } from './paper-import-fresh'
import { ensurePaperSpace, paperSpaceReadingSettings } from './paper-space'
import { usePaperSpaceStore } from './paper-space-store'
import type { ImportPlan } from './paper-import-plan'

type Translate = (key: string, options?: Record<string, unknown>) => string

export type ImportItemStatus =
  | 'queued'
  | 'importing'
  | 'imported'
  | 'metadata'
  | 'reused'
  | 'kept'
  | 'moved'
  | 'failed'
  | 'canceled'

export type ImportItemState = {
  key: string
  keys: readonly string[]
  title: string
  /** Folder the paper goes to (or already lives in, for kept papers). */
  folder: string
  status: ImportItemStatus
  unitDir?: string
  workspaceRoot?: string
  /** True when this run created the unit (undo trashes exactly these). */
  created?: boolean
  message?: string
}

export type ImportJob = {
  id: string
  /** Research session (or quick-search scope) the job belongs to. */
  scope: string
  root: string
  /** Top-level destination, for messages. */
  folder: string
  items: ImportItemState[]
  running: boolean
  canceled: boolean
  undone: boolean
  finishedAt?: number
}

type JobsState = {
  /** Latest job per scope. */
  jobs: Readonly<Record<string, ImportJob>>
  setJob: (job: ImportJob) => void
  patchJob: (scope: string, patch: (job: ImportJob) => ImportJob) => void
}

export const usePaperImportJobs = create<JobsState>((set) => ({
  jobs: {},
  setJob: (job) => set((state) => ({ jobs: { ...state.jobs, [job.scope]: job } })),
  patchJob: (scope, patch) =>
    set((state) => {
      const job = state.jobs[scope]
      return job ? { jobs: { ...state.jobs, [scope]: patch(job) } } : state
    })
}))

/** The item of the latest job in `scope` that is this paper (any identity key). */
export function findImportItem(job: ImportJob | undefined, keys: readonly string[]): ImportItemState | undefined {
  if (!job) return undefined
  return job.items.find((item) => item.keys.some((key) => keys.includes(key)))
}

const IN_PROGRESS: ReadonlySet<ImportItemStatus> = new Set(['queued', 'importing'])
export function importItemSettled(item: ImportItemState): boolean {
  return !IN_PROGRESS.has(item.status)
}

export function importJobCounts(job: ImportJob): { done: number; total: number; created: number; failed: number } {
  const total = job.items.length
  const done = job.items.filter(importItemSettled).length
  const created = job.items.filter((item) => item.created).length
  const failed = job.items.filter((item) => item.status === 'failed').length
  return { done, total, created, failed }
}

const requests = new Map<string, string>()

function patchItem(scope: string, key: string, patch: Partial<ImportItemState>): void {
  usePaperImportJobs.getState().patchJob(scope, (job) => ({
    ...job,
    items: job.items.map((item) => (item.key === key ? { ...item, ...patch } : item))
  }))
}

function notify(notice: NonNullable<ReturnType<typeof usePaperStore.getState>['notice']>): void {
  usePaperStore.getState().setNotice(notice)
}

export function revealPaperFolder(_root: string, _folder: string): void {
  usePaperModeStore.getState().setFilter({ group: '' })
  openPaperViewTab('library')
}

function itemsOfPlan(plan: ImportPlan): ImportItemState[] {
  const items: ImportItemState[] = []
  for (const batch of plan.batches) {
    for (const item of batch.items) {
      items.push({ key: item.key, keys: item.keys, title: item.title, folder: '', status: 'queued' })
    }
  }
  for (const move of plan.moves) {
    const { candidate } = move
    items.push({
      key: candidate.key,
      keys: candidate.keys,
      title: candidate.title,
      folder: '',
      status: 'queued',
      unitDir: candidate.owned?.unitDir,
      workspaceRoot: candidate.owned?.workspaceRoot
    })
  }
  for (const candidate of plan.kept) {
    items.push({
      key: candidate.key,
      keys: candidate.keys,
      title: candidate.title,
      folder: '',
      status: 'kept',
      unitDir: candidate.owned?.unitDir,
      workspaceRoot: candidate.owned?.workspaceRoot
    })
  }
  for (const candidate of plan.unresolved) {
    items.push({
      key: candidate.key,
      keys: candidate.keys,
      title: candidate.title,
      folder: '',
      status: 'failed',
      message: 'unresolved'
    })
  }
  return items
}

/**
 * Run an import plan: create the folders, import one paper at a time (so each
 * row has its own state and Stop takes effect between papers), move
 * already-owned papers when asked, then report where everything went.
 */
export async function runPaperImport(input: {
  scope: string
  plan: ImportPlan
  /** Top-level destination used in messages. */
  folder: string
  t: Translate
}): Promise<void> {
  const { scope, plan, t } = input
  const jobs = usePaperImportJobs.getState()
  if (jobs.jobs[scope]?.running) return
  const root = await ensurePaperSpace().catch((error: unknown) => {
    notify({ tone: 'error', message: error instanceof Error ? error.message : String(error) }); return ''
  })
  if (!root || typeof window.kunGui?.paperImportBatch !== 'function') {
    notify({ tone: 'error', message: t('paperImportNoLibrary') })
    return
  }
  const papersDir = paperSpaceReadingSettings().papersDir
  jobs.setJob({
    id: newPaperRequestId(),
    scope,
    root,
    folder: '',
    items: itemsOfPlan(plan),
    running: true,
    canceled: false,
    undone: false
  })
  const canceled = (): boolean => usePaperImportJobs.getState().jobs[scope]?.canceled === true

  for (const batch of plan.batches) {
    for (const candidate of batch.items) {
      if (canceled()) {
        patchItem(scope, candidate.key, { status: 'canceled' })
        continue
      }
      patchItem(scope, candidate.key, { status: 'importing' })
      const requestId = newPaperRequestId()
      requests.set(scope, requestId)
      const result = await window.kunGui
        .paperImportBatch({
          workspaceRoot: root,
          items: [{ input: candidate.input, meta: candidate.meta }],
          parentDir: paperImportParentDir(papersDir, ''),
          requestId
        })
        .catch((error: unknown) => ({ ok: false as const, message: String(error) }))
      requests.delete(scope)
      const row = result.ok ? result.results[0] : undefined
      if (row?.ok) {
        patchItem(scope, candidate.key, {
          status: row.reused ? 'reused' : 'imported',
          unitDir: row.unitDir,
          workspaceRoot: row.workspaceRoot ?? root,
          created: !row.reused
        })
      } else if (canceled()) {
        patchItem(scope, candidate.key, { status: 'canceled' })
      } else {
        patchItem(scope, candidate.key, {
          status: 'failed',
          message: row?.message ?? (result.ok ? 'unknown' : result.message)
        })
      }
    }
  }

  for (const move of plan.moves) {
    patchItem(scope, move.candidate.key, { status: canceled() ? 'canceled' : 'kept' })
  }

  await settleImportedItems(scope, root, papersDir)
  finishPaperImport(scope, root, t)
}

/** Mark imported units that have no PDF so the row says "metadata only". */
async function settleImportedItems(scope: string, root: string, papersDir: string): Promise<void> {
  usePaperModeStore.getState().refreshEntries()
  if (typeof window.kunGui?.paperLibraryList !== 'function') return
  const listing = await window.kunGui.paperLibraryList({ workspaceRoot: root, papersDir }).catch(() => null)
  if (!listing?.ok) return
  const withPdf = new Map(listing.entries.map((entry) => [entry.unitDir, entry.hasPdf]))
  usePaperImportJobs.getState().patchJob(scope, (job) => ({
    ...job,
    items: job.items.map((item) =>
      item.status === 'imported' && item.unitDir && withPdf.get(item.unitDir) === false
        ? { ...item, status: 'metadata' }
        : item
    )
  }))
}

function finishPaperImport(scope: string, root: string, t: Translate): void {
  usePaperImportJobs.getState().patchJob(scope, (job) => ({ ...job, running: false, finishedAt: Date.now() }))
  const job = usePaperImportJobs.getState().jobs[scope]
  if (!job) return
  const { created, failed } = importJobCounts(job)
  const moved = job.items.filter((item) => item.status === 'moved').length
  const label = job.folder || t('paperImportFolderRoot')
  if (created + moved === 0) {
    notify(failed
      ? { tone: 'error', message: t('paperImportFailedAll', { message: job.items.find((i) => i.message)?.message ?? '' }) }
      : { tone: 'info', message: job.canceled ? t('paperImportCanceled') : t('paperImportNothingNew') })
    return
  }
  notify({
    tone: failed ? 'error' : 'success',
    message: failed
      ? t('paperImportDonePartial', { count: created + moved, folder: label, failed })
      : t('paperImportDoneToFolder', { count: created + moved, folder: label }),
    action: created > 0 ? { label: t('paperImportUndo'), run: () => void undoPaperImport(scope, t) } : undefined,
    secondaryAction: { label: t('paperImportOpenFolder'), run: () => revealPaperFolder(root, job.folder) }
  })
}

/** Stop after the paper being imported; the rest of the queue is canceled. */
export function cancelPaperImport(scope: string): void {
  usePaperImportJobs.getState().patchJob(scope, (job) => (job.running ? { ...job, canceled: true } : job))
  const requestId = requests.get(scope)
  if (requestId) void window.kunGui?.paperCancel?.({ requestId })
}

/** Trash exactly the units this job created. */
export async function undoPaperImport(scope: string, t: Translate): Promise<void> {
  const job = usePaperImportJobs.getState().jobs[scope]
  if (!job || job.running || job.undone) return
  const unitDirs = job.items.flatMap((item) => (item.created && item.unitDir ? [item.unitDir] : []))
  if (!unitDirs.length) return
  const outcome = await trashPaperUnits(unitDirs, job.root)
  usePaperFreshFolders.getState().clear(job.root, job.folder)
  usePaperImportJobs.getState().patchJob(scope, (current) => ({
    ...current,
    undone: outcome.failed.length === 0,
    items: current.items.map((item) =>
      item.created && item.unitDir && outcome.done.includes(item.unitDir)
        ? { ...item, status: 'canceled', created: false, message: undefined }
        : item
    )
  }))
  notify(outcome.failed.length
    ? { tone: 'error', message: t('paperImportUndoFailed', { count: outcome.failed.length }) }
    : { tone: 'info', message: t('paperImportUndone', { count: outcome.done.length }) })
}

/** Fetch the PDF for a metadata-only paper (the row's "add PDF" action). */
export async function backfillPaperPdf(scope: string, key: string, t: Translate): Promise<void> {
  const job = usePaperImportJobs.getState().jobs[scope]
  const item = job?.items.find((candidate) => candidate.key === key)
  if (!job || !item?.unitDir || typeof window.kunGui?.paperDownloadPdf !== 'function') return
  patchItem(scope, key, { status: 'importing' })
  const result = await window.kunGui
    .paperDownloadPdf({ workspaceRoot: item.workspaceRoot ?? job.root, unitDir: item.unitDir })
    .catch((error: unknown) => ({ ok: false as const, message: String(error) }))
  if (result.ok) {
    patchItem(scope, key, { status: 'imported' })
    usePaperModeStore.getState().refreshEntries()
  } else {
    patchItem(scope, key, { status: 'metadata' })
    notify({ tone: 'error', message: t('paperImportPdfFailed', { message: result.message }) })
  }
}

export function importScopeRoot(): string {
  return normalizePath(usePaperSpaceStore.getState().workspaceRoot)
}
