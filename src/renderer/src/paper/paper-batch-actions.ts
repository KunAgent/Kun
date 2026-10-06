import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import { createPaperTurnContext, PAPER_CONTEXT_MAX_CHARS } from '@shared/paper/paper-turn-context'
import { getProvider } from '../agent/registry'
import { useChatStore } from '../store/chat-store'
import { useWriteWorkspaceStore, writeJoinPath } from '../write/write-workspace-store'
import { useWorkAssistantNavigation } from '../write/work-assistant-navigation'
import { normalizePath } from '../write/write-workspace-store-helpers'
import { usePaperStore } from '../write/paper/paper-store'
import { switchPaperLibrary } from './paper-mode-actions'
import { refreshPaperLibrary } from './paper-library-index'
import { focusPaperBatchLibrary, selectPaperBatchConversation } from './paper-batch-navigation'
import { paperReadingQuestion } from './paper-reading-request'
import { PAPER_BATCH_MAX_PAPERS, paperBatchActive, usePaperBatchStore, type PaperBatch, type PaperBatchItem } from './paper-batch-store'

const message = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)
let opening = 0
const current = (id: string): PaperBatch | null => {
  const batch = usePaperBatchStore.getState().batch
  return batch?.id === id ? batch : null
}
const update = (id: string, patch: Partial<PaperBatch>): void => usePaperBatchStore.getState().update(id, patch)
const updateItem = (id: string, item: PaperBatchItem, patch: Partial<PaperBatchItem>): void =>
  usePaperBatchStore.getState().updateItem(id, item.entry.unitDir, patch)
const sameWorkspace = (batch: PaperBatch): boolean =>
  normalizePath(useWriteWorkspaceStore.getState().workspaceRoot) === normalizePath(batch.workspaceRoot)

/** Staging is local-only. No model request, preprocessing or file write. */
export async function openPaperBatchAssistant(input: {
  workspaceRoot: string; entries?: readonly PaperLibraryEntry[]; sourceLabel: string
}): Promise<boolean> {
  const sequence = ++opening
  const revision = usePaperBatchStore.getState().revision
  const { workspaceRoot: originRoot, editorLayout: originLayout, activeFilePath: originFile, workSurface: originSurface } = useWriteWorkspaceStore.getState()
  const originRoute = useChatStore.getState().route
  const originThreadId = useChatStore.getState().activeThreadId
  const originPresentation = useWorkAssistantNavigation.getState()
  const stillCurrent = (): boolean => sequence === opening && usePaperBatchStore.getState().revision === revision
  const stillAtOrigin = (): boolean => {
    const current = useWriteWorkspaceStore.getState()
    return current.workspaceRoot === originRoot && current.editorLayout === originLayout &&
      current.activeFilePath === originFile && current.workSurface === originSurface &&
      useChatStore.getState().route === originRoute && useChatStore.getState().activeThreadId === originThreadId &&
      useWorkAssistantNavigation.getState() === originPresentation
  }
  if (paperBatchActive(usePaperBatchStore.getState().batch)) {
    useWriteWorkspaceStore.getState().setAssistantOpen(true)
    useWorkAssistantNavigation.getState().openAssistant()
    return false
  }
  let entries = input.entries
  if (!entries) {
    try {
      const result = await window.kunGui.paperLibraryList({ workspaceRoot: input.workspaceRoot, papersDir: useWriteWorkspaceStore.getState().paperReading.papersDir })
      if (!stillCurrent() || !stillAtOrigin()) return false
      if (!result.ok) throw new Error(result.message)
      entries = result.entries
    } catch (cause) {
      if (stillCurrent() && stillAtOrigin()) usePaperStore.getState().setNotice({ tone: 'error', message: message(cause) })
      return false
    }
  }
  if (!stillCurrent() || !stillAtOrigin()) return false
  if (normalizePath(useWriteWorkspaceStore.getState().workspaceRoot) !== normalizePath(input.workspaceRoot)) {
    const switched = await switchPaperLibrary(input.workspaceRoot)
    if (!switched.ok) {
      if (switched.message !== 'switch-canceled') usePaperStore.getState().setNotice({ tone: 'error', message: switched.message })
      return false
    }
  }
  if (!stillCurrent() || useChatStore.getState().route !== originRoute ||
    useWorkAssistantNavigation.getState() !== originPresentation ||
    normalizePath(useWriteWorkspaceStore.getState().workspaceRoot) !== normalizePath(input.workspaceRoot)) return false
  const staged = usePaperBatchStore.getState().stage(input.workspaceRoot, entries, input.sourceLabel)
  if (staged) {
    useWriteWorkspaceStore.getState().setAssistantOpen(true)
    useWorkAssistantNavigation.getState().openAssistant()
  }
  return staged
}

export async function preparePaperBatch(id: string): Promise<void> {
  const batch = current(id)
  if (!batch || batch.phase !== 'setup' || batch.items.length > PAPER_BATCH_MAX_PAPERS) return
  for (const item of batch.items) {
    const latest = current(id)
    const selected = latest?.items.find((row) => row.entry.unitDir === item.entry.unitDir)
    if (!latest || latest.phase !== 'setup') return
    if (!selected || selected.materialState !== 'waiting') continue
    updateItem(id, item, { materialState: 'loading', error: undefined })
    try {
      const material = await window.kunGui.paperEvidenceMaterial({ workspaceRoot: batch.workspaceRoot, unitDir: item.entry.unitDir })
      if (!material.ok) throw new Error(material.message)
      if (!material.sourceText.trim()) throw new Error('No readable source material. Import or preprocess this paper first.')
      updateItem(id, item, { materialState: 'ready', material })
    } catch (cause) { updateItem(id, item, { materialState: 'error', error: message(cause) }) }
  }
}

export function paperBatchLimited(item: PaperBatchItem): boolean {
  return !item.material || item.material.abstractOnly || item.material.textPartial || item.material.sourceText.length > PAPER_CONTEXT_MAX_CHARS
}

function frozenItem(batch: PaperBatch, item: PaperBatchItem): Pick<PaperBatchItem, 'context' | 'prompt' | 'clientRequestId'> {
  if (item.context && item.prompt && item.clientRequestId) return item
  const material = item.material!
  return {
    clientRequestId: crypto.randomUUID(),
    context: createPaperTurnContext({
      version: 1, scope: 'current-paper', privacy: 'model-provider', purpose: batch.purpose,
      providerId: batch.providerId!, model: batch.model!, maxModelRequests: 1,
      sources: [{
        paperId: material.paperVersion?.canonicalId ?? item.entry.meta.arxivId ?? item.entry.meta.doi ?? item.entry.unitDir,
        title: item.entry.meta.title,
        locator: material.abstractOnly ? 'abstract / metadata only' : 'PDF extraction with page markers',
        sourceVersion: material.paperVersion?.pdfSha256,
        text: material.sourceText.slice(0, PAPER_CONTEXT_MAX_CHARS)
      }]
    }),
    prompt: `${paperReadingQuestion(batch.purpose, { background: '', goal: '', question: batch.question, limited: paperBatchLimited(item) })}\n\nWrite a self-contained explanation article for this one paper, with its title, key ideas, supporting evidence and limitations. This is a read-only response in the conversation. Do not modify files. Interface language: ${batch.language}`
  }
}

export function paperBatchOutputPath(batchId: string, item: PaperBatchItem): string {
  const title = Array.from(item.entry.meta.title).map((char) => char.charCodeAt(0) < 32 ? '-' : char).join('')
    .replace(/[\\/<>:"|?*]/g, '-').trim().replace(/^\.+/, '').slice(0, 70).replace(/[. ]+$/, '') || 'paper'
  return `${item.entry.unitDir}/${title}-explanation-${batchId.slice(0, 8)}.md`
}

async function savePaperBatchResult(batch: PaperBatch, item: PaperBatchItem): Promise<void> {
  if (batch.destination !== 'paper-files' || !item.result || item.outputRecorded) return
  // Existing create API is exclusive (wx), never overwrites prior notes/articles.
  const path = item.outputPath ?? paperBatchOutputPath(batch.id, item)
  if (!item.outputPath) {
    const paper = await window.kunGui.paperReadUnit({ workspaceRoot: batch.workspaceRoot, unitDir: item.entry.unitDir })
    if (!paper.ok) throw new Error(paper.message)
    if (paper.meta.slug !== item.entry.meta.slug || paper.meta.arxivId !== item.entry.meta.arxivId || paper.meta.doi !== item.entry.meta.doi) {
      throw new Error('The paper directory identity changed. The explanation remains in the conversation.')
    }
    const created = await window.kunGui.createWorkspaceFile({ workspaceRoot: batch.workspaceRoot, path, content: item.result })
    if (!created.ok) throw new Error(created.message)
    updateItem(batch.id, item, { outputPath: path })
  }
  const recorded = await window.kunGui.paperRecordInterpretation({ workspaceRoot: batch.workspaceRoot, unitDir: item.entry.unitDir, path, threadId: batch.threadId })
  if (!recorded.ok) throw new Error(recorded.message)
  updateItem(batch.id, item, { outputRecorded: true, error: undefined })
}

const delay = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1000))

/** Observe only the exact receipt's turn. Ambiguous/newer turns never imply success. */
async function waitForPaperTurn(batch: PaperBatch, item: PaperBatchItem): Promise<'completed' | 'failed' | 'canceled'> {
  const provider = getProvider()
  let interruptSent = false
  for (;;) {
    if (!current(batch.id)) throw new Error('The batch is no longer available.')
    const state = await provider.getThreadState(batch.threadId!)
    if (state.latestTurnId === item.turnId) {
      if (state.latestTurnStatus === 'completed') return 'completed'
      if (state.latestTurnStatus === 'failed') return 'failed'
      if (state.latestTurnStatus === 'aborted') return 'canceled'
    } else if (state.activeTurn?.id !== item.turnId) {
      throw new Error('The conversation changed before this result was verified. Open the conversation to inspect it; no further papers were started.')
    }
    if (current(batch.id)?.cancelRequested && !interruptSent) {
      try { await provider.interruptTurn(batch.threadId!, item.turnId!) }
      catch (cause) {
        // Completion may win the race with Cancel. Verify before reporting a cancellation failure.
        const after = await provider.getThreadState(batch.threadId!)
        if (after.latestTurnId === item.turnId) {
          if (after.latestTurnStatus === 'completed') return 'completed'
          if (after.latestTurnStatus === 'failed') return 'failed'
          if (after.latestTurnStatus === 'aborted') return 'canceled'
        }
        throw cause
      }
      interruptSent = true
      continue
    }
    await delay()
  }
}

/** Explicit Start/Retry only. The admission lock is state-owned, so remounts cannot duplicate sends. */
export async function startPaperBatch(input: { providerId: string; model: string; language: string }): Promise<void> {
  const draft = usePaperBatchStore.getState().batch
  if (!draft || paperBatchActive(draft) || !draft.consent || !sameWorkspace(draft)) return
  if (!draft.items.length || draft.items.length > PAPER_BATCH_MAX_PAPERS || !input.providerId || !input.model || input.model.toLowerCase() === 'auto') return
  if (draft.items.some((item) => item.materialState !== 'ready' || !item.material || (draft.purpose !== 'quick-screen' && paperBatchLimited(item)))) return
  const chat = useChatStore.getState()
  const resumesOwnedTurn = draft.threadId === chat.activeThreadId && draft.items.some((item) => item.turnId && item.turnId === chat.currentTurnId)
  if (chat.runtimeConnection !== 'ready' || (chat.busy && !resumesOwnedTurn)) return
  const id = draft.id
  update(id, { phase: 'running', cancelRequested: false, error: undefined,
    providerId: draft.providerId ?? input.providerId, model: draft.model ?? input.model, language: draft.language ?? input.language })
  try {
    let batch = current(id)!
    const activationGuard = focusPaperBatchLibrary(batch)
    if (!batch.threadId) {
      const threadId = await useChatStore.getState().createWriteThread(batch.workspaceRoot, '', {
        title: `${batch.sourceLabel} · ${batch.items.length}`, activationGuard
      })
      if (!threadId) throw new Error(useChatStore.getState().error || 'Could not create the batch conversation.')
      update(id, { threadId, resourcePath: '' })
      batch = current(id)!
    } else {
      await selectPaperBatchConversation(batch, activationGuard)
    }
    if (!activationGuard(batch.threadId)) throw new Error('Navigation changed. Return to the source library and continue this batch when ready.')
    for (const original of batch.items) {
      batch = current(id)!
      if (batch.cancelRequested) break
      if (!sameWorkspace(batch)) throw new Error('The active library changed. Return to the source library before continuing.')
      let item = batch.items.find((row) => row.entry.unitDir === original.entry.unitDir)!
      if (item.status === 'completed') {
        try { await savePaperBatchResult(batch, item) } catch (cause) { updateItem(id, item, { error: message(cause) }) }
        continue
      }
      const frozen = frozenItem(batch, item)
      updateItem(id, item, { ...frozen, status: 'running', error: undefined })
      item = { ...item, ...frozen }
      try {
        if (!item.turnId) {
          const receipt = await getProvider().sendUserMessage(batch.threadId!, item.prompt!, {
            clientRequestId: item.clientRequestId, mode: 'agent', orchestration: 'direct',
            agentSurface: 'write', providerId: batch.providerId, model: batch.model,
            paperContext: item.context
          })
          if (receipt.threadId !== batch.threadId || !receipt.turnId) throw new Error('The runtime returned an unverified batch receipt.')
          item = { ...item, turnId: receipt.turnId }
          updateItem(id, item, { turnId: receipt.turnId })
          if (useChatStore.getState().activeThreadId === batch.threadId) void useChatStore.getState().recoverActiveTurn().catch(() => undefined)
        }
        const status = await waitForPaperTurn(batch, item)
        if (status === 'completed') {
          const detail = await getProvider().getThreadDetail(batch.threadId!, { turnId: item.turnId })
          const result = detail.blocks.filter((block) => block.kind === 'assistant' && block.turnId === item.turnId)
            .map((block) => block.kind === 'assistant' ? block.text : '').join('\n\n').trim()
          if (!result) throw new Error('The completed turn has no verified explanation text. Inspect the conversation before retrying.')
          updateItem(id, item, { status, result })
          try { await savePaperBatchResult(batch, { ...item, result }) } catch (cause) { updateItem(id, item, { error: message(cause) }) }
        } else {
          updateItem(id, item, { status, turnId: undefined, clientRequestId: undefined, error: status === 'failed' ? 'The reading request failed. Retry is optional and may incur another model charge.' : undefined })
        }
      } catch (cause) {
        // Keep the idempotency key and exact turn identity. Retry reconciles this request, never creates a duplicate.
        updateItem(id, item, { status: 'uncertain', error: message(cause) })
        throw cause
      }
    }
    const finished = current(id)!
    if (finished.cancelRequested) {
      for (const item of finished.items) if (item.status === 'pending') updateItem(id, item, { status: 'canceled' })
    }
    update(id, { phase: 'settled', consent: false })
    refreshPaperLibrary(batch.workspaceRoot)
  } catch (cause) { update(id, { phase: 'paused', error: message(cause), consent: false }) }
}

export function cancelPaperBatch(): void {
  const batch = usePaperBatchStore.getState().batch
  if (paperBatchActive(batch)) update(batch!.id, { cancelRequested: true, phase: 'canceling' })
}

export async function openPaperBatchConversation(): Promise<void> {
  const batch = usePaperBatchStore.getState().batch
  if (!batch?.threadId || !sameWorkspace(batch)) return
  try {
    const activationGuard = focusPaperBatchLibrary(batch)
    await selectPaperBatchConversation(batch, activationGuard)
  } catch (cause) { update(batch.id, { error: message(cause) }) }
}

export async function openPaperBatchArticle(unitDir: string): Promise<void> {
  const batch = usePaperBatchStore.getState().batch
  const item = batch?.items.find((row) => row.entry.unitDir === unitDir)
  if (!batch || !sameWorkspace(batch) || !item?.outputPath) return
  await useWriteWorkspaceStore.getState().openFile(batch.workspaceRoot, writeJoinPath(batch.workspaceRoot, item.outputPath), { viewMode: 'rich' })
}
