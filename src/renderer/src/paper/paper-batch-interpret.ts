import { captureWorkSubmissionIntent, submitExplicitWorkRequest, type WorkSubmissionIntent } from '../product-analytics/work-submission'
import { turnAdmissionOutcomeMayBeUnknown } from '../store/chat-store-thread-actions-support'
import { create } from 'zustand'
import type { PaperUnitMeta } from '@shared/paper/paper-meta-v2'
import { createPaperTurnContext, PAPER_CONTEXT_MAX_CHARS } from '@shared/paper/paper-turn-context'
import { getProvider } from '../agent/registry'
import { useChatStore } from '../store/chat-store'
import { markWriteThread, readWriteThreadRegistry, saveWriteThreadRegistry, writeThreadIdsForFile } from '../write/write-thread-registry'
import { useWriteWorkspaceStore, writeJoinPath } from '../write/write-workspace-store'
import { normalizePath } from '../write/write-workspace-store-helpers'
import { usePaperStore } from '../write/paper/paper-store'
import { paperReadingQuestion, type PaperReadingPurpose } from './paper-reading-request'

/**
 * Batch interpretation: one bounded reading turn per paper, each in its own
 * new session anchored to the paper, run one after another in the
 * background — the visible conversation never changes. The same frozen,
 * scoped material and single-model-request rules as the reading dialog
 * apply; the user confirms provider disclosure once for the batch.
 */
export type PaperBatchPaper = { unitDir: string; meta: PaperUnitMeta }

export type PaperBatchItemStatus = 'waiting' | 'preparing' | 'running' | 'done' | 'skipped' | 'failed' | 'canceled'

export type PaperBatchItem = {
  unitDir: string
  title: string
  status: PaperBatchItemStatus
  /** Why it was skipped or failed (already translated). */
  detail?: string
  threadId?: string
}

export type PaperBatchJob = {
  id: string
  workspaceRoot: string
  purpose: PaperReadingPurpose
  items: PaperBatchItem[]
  running: boolean
  canceled: boolean
}

type Translate = (key: string, options?: Record<string, unknown>) => string

type BatchState = {
  /** Papers waiting in the confirmation dialog. */
  request: { workspaceRoot: string; papers: PaperBatchPaper[] } | null
  job: PaperBatchJob | null
  openDialog: (workspaceRoot: string, papers: PaperBatchPaper[]) => void
  closeDialog: () => void
  dismiss: () => void
}

export const usePaperBatchInterpret = create<BatchState>((set, get) => ({
  request: null,
  job: null,
  openDialog: (workspaceRoot, papers) => {
    if (papers.length === 0) return
    set({ request: { workspaceRoot: normalizePath(workspaceRoot), papers } })
  },
  closeDialog: () => set({ request: null }),
  dismiss: () => {
    if (!get().job?.running) set({ job: null })
  }
}))

const POLL_MS = 1500
const TURN_TIMEOUT_MS = 15 * 60_000
const TITLE_MAX = 60

let activeTurn: { threadId: string; turnId: string } | null = null

function patchItem(jobId: string, unitDir: string, patch: Partial<PaperBatchItem>): void {
  usePaperBatchInterpret.setState((state) => {
    if (state.job?.id !== jobId) return state
    return {
      job: {
        ...state.job,
        items: state.job.items.map((item) => item.unitDir === unitDir ? { ...item, ...patch } : item)
      }
    }
  })
}

function jobCanceled(jobId: string): boolean {
  const job = usePaperBatchInterpret.getState().job
  return !job || job.id !== jobId || job.canceled
}

/** Sessions already anchored to this paper (any earlier reading or batch). */
export function paperSessionIds(workspaceRoot: string, unitDir: string): string[] {
  return writeThreadIdsForFile(workspaceRoot, writeJoinPath(workspaceRoot, unitDir), readWriteThreadRegistry())
}

function shortTitle(title: string): string {
  const trimmed = title.trim()
  return trimmed.length > TITLE_MAX ? `${trimmed.slice(0, TITLE_MAX - 1)}…` : trimmed
}

async function waitForTurn(threadId: string, turnId: string, jobId: string): Promise<'done' | 'failed' | 'input' | 'timeout' | 'canceled'> {
  const provider = getProvider()
  const deadline = Date.now() + TURN_TIMEOUT_MS
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    if (jobCanceled(jobId)) return 'canceled'
    if (Date.now() > deadline) return 'timeout'
    const state = await provider.getThreadState(threadId).catch(() => null)
    if (!state) continue
    if (state.pendingUserInputIds?.length) return 'input'
    const running = Boolean(state.activeTurn) || state.status === 'running'
    if (running) continue
    if (state.latestTurnId && state.latestTurnId !== turnId) continue
    return state.latestTurnStatus === 'failed' || state.latestTurnStatus === 'aborted' ? 'failed' : 'done'
  }
}

async function interpretOne(input: {
  job: PaperBatchJob
  analyticsIntent: WorkSubmissionIntent
  paper: PaperBatchPaper
  providerId: string
  model: string
  language: string
  t: Translate
}): Promise<void> {
  const { job, paper, t } = input
  const root = job.workspaceRoot
  patchItem(job.id, paper.unitDir, { status: 'preparing' })
  const material = await window.kunGui.paperEvidenceMaterial({ workspaceRoot: root, unitDir: paper.unitDir })
    .catch((error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : String(error) }))
  if (jobCanceled(job.id)) return
  if (!material.ok) {
    patchItem(job.id, paper.unitDir, { status: 'failed', detail: material.message })
    return
  }
  const fullText = material.sourceText
  const sourceText = fullText.slice(0, PAPER_CONTEXT_MAX_CHARS)
  const limited = material.abstractOnly || material.textPartial || fullText.length > PAPER_CONTEXT_MAX_CHARS
  if (!sourceText.trim()) {
    patchItem(job.id, paper.unitDir, { status: 'skipped', detail: t('paperBatchNoText') })
    return
  }
  // Deeper purposes need the full text; screening works on what there is.
  if (limited && job.purpose !== 'quick-screen') {
    patchItem(job.id, paper.unitDir, { status: 'skipped', detail: t('paperBatchInsufficient') })
    return
  }
  const context = createPaperTurnContext({
    version: 1,
    scope: 'current-paper',
    privacy: 'model-provider',
    purpose: job.purpose,
    providerId: input.providerId,
    model: input.model,
    maxModelRequests: 1,
    sources: [{
      paperId: material.paperVersion ? material.paperVersion.canonicalId : paper.meta.arxivId || paper.meta.doi || paper.unitDir,
      title: paper.meta.title,
      locator: material.abstractOnly ? 'abstract / metadata only' : 'PDF extraction with page markers',
      sourceVersion: material.paperVersion?.pdfSha256,
      text: sourceText
    }]
  })
  const provider = getProvider()
  const thread = await provider.createThread({
    workspace: root,
    title: `${shortTitle(paper.meta.title)} · ${t(`paperReading_${job.purpose}`)}`,
    titleAuto: false,
    mode: 'agent',
    agentSurface: 'write'
  })
  saveWriteThreadRegistry(markWriteThread(root, thread.id, readWriteThreadRegistry(), writeJoinPath(root, paper.unitDir)))
  useChatStore.setState((state) => ({
    threads: state.threads.some((item) => item.id === thread.id) ? state.threads : [thread, ...state.threads]
  }))
  patchItem(job.id, paper.unitDir, { status: 'running', threadId: thread.id })
  if (jobCanceled(job.id)) {
    patchItem(job.id, paper.unitDir, { status: 'canceled' })
    return
  }
  const question = paperReadingQuestion(job.purpose, { background: '', goal: '', question: '', limited })
  const accepted = await submitExplicitWorkRequest(thread.id, clientRequestId => provider.sendUserMessage(thread.id, `${question}\n\nInterface language: ${input.language}`, {
    mode: 'agent',
    agentSurface: 'write',
    ...(clientRequestId ? { clientRequestId } : {}),
    paperContext: context,
    providerId: input.providerId,
    model: input.model,
    displayText: t('paperBatchDisplay', { purpose: t(`paperReading_${job.purpose}`) })
  }), turnAdmissionOutcomeMayBeUnknown, input.analyticsIntent)
  activeTurn = { threadId: thread.id, turnId: accepted.turnId }
  const outcome = await waitForTurn(thread.id, accepted.turnId, job.id)
  activeTurn = null
  const detail = outcome === 'input' ? t('paperBatchNeedsInput') : outcome === 'timeout' ? t('paperBatchTimeout') : undefined
  patchItem(job.id, paper.unitDir, {
    status: outcome === 'done' ? 'done' : outcome === 'canceled' ? 'canceled' : 'failed',
    ...(detail ? { detail } : {})
  })
}

/**
 * Run the batch. Papers that already have a session are skipped when
 * `skipExisting` is set. Resolves when every paper settled or the batch was
 * canceled; a summary notice offers to open the first finished session.
 */
export async function startPaperBatchInterpret(input: {
  workspaceRoot: string
  papers: PaperBatchPaper[]
  purpose: PaperReadingPurpose
  skipExisting: boolean
  providerId: string
  model: string
  language: string
  t: Translate
  onOpenSession?: (threadId: string, unitDir: string) => void
}): Promise<void> {
  const analyticsIntent = captureWorkSubmissionIntent()
  if (usePaperBatchInterpret.getState().job?.running) return
  const root = normalizePath(input.workspaceRoot)
  const items: PaperBatchItem[] = input.papers.map((paper) => {
    const existing = input.skipExisting && paperSessionIds(root, paper.unitDir).length > 0
    return {
      unitDir: paper.unitDir,
      title: paper.meta.title,
      status: existing ? 'skipped' : 'waiting',
      ...(existing ? { detail: input.t('paperBatchAlreadyRead') } : {})
    }
  })
  const job: PaperBatchJob = {
    id: `batch-${Date.now().toString(36)}`,
    workspaceRoot: root,
    purpose: input.purpose,
    items,
    running: true,
    canceled: false
  }
  usePaperBatchInterpret.setState({ job, request: null })
  for (const paper of input.papers) {
    if (jobCanceled(job.id)) break
    const item = usePaperBatchInterpret.getState().job?.items.find((candidate) => candidate.unitDir === paper.unitDir)
    if (item?.status !== 'waiting') continue
    try {
      await interpretOne({ job, analyticsIntent, paper, providerId: input.providerId, model: input.model, language: input.language, t: input.t })
    } catch (error) {
      patchItem(job.id, paper.unitDir, { status: 'failed', detail: error instanceof Error ? error.message : String(error) })
    }
  }
  const final = usePaperBatchInterpret.getState().job
  if (!final || final.id !== job.id) return
  const settled = final.items.map((item) => item.status === 'waiting' ? { ...item, status: 'canceled' as const } : item)
  usePaperBatchInterpret.setState({ job: { ...final, items: settled, running: false } })
  void useChatStore.getState().refreshThreads()
  const done = settled.filter((item) => item.status === 'done')
  if (normalizePath(useWriteWorkspaceStore.getState().workspaceRoot) !== root) return
  const first = done[0]
  usePaperStore.getState().setNotice({
    tone: done.length > 0 ? 'success' : 'info',
    message: input.t('paperBatchFinished', {
      done: done.length,
      skipped: settled.filter((item) => item.status === 'skipped').length,
      failed: settled.filter((item) => item.status === 'failed').length
    }),
    ...(first?.threadId && input.onOpenSession ? {
      action: { label: input.t('paperBatchOpenFirst'), run: () => input.onOpenSession?.(first.threadId!, first.unitDir) }
    } : {})
  })
}

/** Stop after the current paper; its running turn is interrupted. */
export function cancelPaperBatchInterpret(): void {
  usePaperBatchInterpret.setState((state) => state.job ? { job: { ...state.job, canceled: true } } : state)
  const turn = activeTurn
  if (turn) void getProvider().interruptTurn(turn.threadId, turn.turnId).catch(() => undefined)
}
