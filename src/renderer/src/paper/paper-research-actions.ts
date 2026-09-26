import type { PaperSearchSource } from '@shared/paper/paper-search'
import type { PaperTranslate } from '../write/paper/paper-actions'
import { useChatStore } from '../store/chat-store'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { usePaperStore } from '../write/paper/paper-store'
import { normalizePath } from '../write/write-workspace-store-helpers'
import { usePaperModeStore } from './paper-mode-store'
import { PAPER_MODE_SWITCH_CANCELED, switchPaperLibrary } from './paper-mode-actions'
import { openPaperViewTab } from './paper-view'
import {
  newResearchSessionId,
  researchResourcePath,
  writeLastResearchSession
} from './paper-research-sessions'

export type PaperResearchDepth = 'quick' | 'standard' | 'deep'

export type PaperResearchRequest = {
  query: string
  sources: readonly PaperSearchSource[]
  yearFrom?: number
  yearTo?: number
  depth: PaperResearchDepth
}

const ACTIVE_THREAD_TIMEOUT_MS = 3000
const MAX_TITLE_CHARS = 80

/**
 * The research brief is the user's question plus one structured scope line.
 * Kun's Work-mode guidance explains the `[paper-research]` line (depth,
 * sources, years); the method itself is not repeated in every message.
 */
export function buildPaperResearchBrief(request: PaperResearchRequest): string {
  const years = request.yearFrom || request.yearTo
    ? `${request.yearFrom ?? ''}-${request.yearTo ?? ''}`
    : 'any'
  const sources = request.sources.length ? request.sources.join(',') : 'default'
  return `${request.query.trim()}\n\n[paper-research] depth=${request.depth}; sources=${sources}; years=${years}`
}

/** Resolve once `activeThreadId` equals `threadId`, or false after the timeout. */
export function awaitActiveThread(threadId: string, timeoutMs = ACTIVE_THREAD_TIMEOUT_MS): Promise<boolean> {
  if (useChatStore.getState().activeThreadId === threadId) return Promise.resolve(true)
  return new Promise((resolve) => {
    let done = false
    const finish = (value: boolean): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      unsubscribe()
      resolve(value)
    }
    const unsubscribe = useChatStore.subscribe((state) => {
      if (state.activeThreadId === threadId) finish(true)
    })
    const timer = setTimeout(() => finish(false), timeoutMs)
  })
}

export type StartPaperResearchResult =
  | { ok: true; sessionId: string; threadId: string }
  | { ok: false; reason: 'empty' | 'no-library' | 'create-failed' | 'not-selected' | 'no-composer' }

/**
 * Start one Agent research session: bind a fresh Work thread to the
 * session's virtual resource, wait until it is the active conversation, then
 * send the brief through the normal Work send path.
 */
export async function startPaperResearch(request: PaperResearchRequest): Promise<StartPaperResearchResult> {
  const query = request.query.trim()
  if (!query) return { ok: false, reason: 'empty' }
  const writeState = useWriteWorkspaceStore.getState()
  const libraryRoot = writeState.workspaceRoot
  if (!libraryRoot.trim()) return { ok: false, reason: 'no-library' }
  const previous = writeState.paperResearch.sessionId
  const sessionId = newResearchSessionId()
  // Select the session first so the resource → thread effect resolves to the
  // new (still unbound) resource instead of re-selecting the library thread.
  writeState.setPaperResearch({ agentTab: true, sessionId })
  const threadId = await useChatStore.getState().createWriteThread(
    libraryRoot,
    researchResourcePath(libraryRoot, sessionId),
    { title: query.slice(0, MAX_TITLE_CHARS), titleAuto: false }
  )
  if (!threadId) {
    useWriteWorkspaceStore.getState().setPaperResearch({ sessionId: previous })
    return { ok: false, reason: 'create-failed' }
  }
  writeLastResearchSession(libraryRoot, sessionId)
  if (!(await awaitActiveThread(threadId))) return { ok: false, reason: 'not-selected' }
  const submit = usePaperModeStore.getState().composerBridge?.submit
  if (!submit) return { ok: false, reason: 'no-composer' }
  submit(buildPaperResearchBrief({ ...request, query }))
  return { ok: true, sessionId, threadId }
}

/** Switch the stage to an existing session (or the "new research" state with null). */
export function selectPaperResearchSession(sessionId: string | null): void {
  const state = useWriteWorkspaceStore.getState()
  state.setPaperResearch({ agentTab: true, sessionId })
  writeLastResearchSession(state.workspaceRoot, sessionId)
}

/**
 * Open a research session from the aggregated history list. When the session
 * belongs to another library the editor root is switched first — saving any
 * dirty documents; a failed or cancelled save leaves everything untouched.
 */
export async function openPaperResearchSession(
  input: { libraryRoot: string; sessionId: string | null },
  t?: PaperTranslate
): Promise<boolean> {
  const target = normalizePath(input.libraryRoot)
  const current = normalizePath(useWriteWorkspaceStore.getState().workspaceRoot)
  if (target && target !== current) {
    const result = await switchPaperLibrary(target)
    if (!result.ok) {
      if (result.message !== PAPER_MODE_SWITCH_CANCELED) {
        usePaperStore.getState().setNotice({
          tone: 'error',
          message: result.message === 'save-failed' && t
            ? t('writePaperSaveFailed')
            : result.message
        })
      }
      return false
    }
  }
  openPaperViewTab('discover:search')
  selectPaperResearchSession(input.sessionId)
  return true
}
