import { useChatStore } from '../store/chat-store'
import { workspaceRootScopeKey } from '../lib/workspace-path'
import {
  enterPaperMode,
  PAPER_MODE_SWITCH_CANCELED,
  switchPaperLibrary,
  writeConversationResourcePath
} from '../paper/paper-mode-actions'
import { usePaperModeStore } from '../paper/paper-mode-store'
import { openLibraryEntry } from '../paper/paper-library-actions'
import { usePaperStore } from './paper/paper-store'
import { useWriteWorkspaceStore, writeJoinPath } from './write-workspace-store'
import { normalizePath } from './write-workspace-store-helpers'
import type { WorkWhiteboard, WritePaperViewId } from './write-workspace-store-types'
import {
  beginWorkSessionTransition,
  currentWorkSessionPin,
  useWorkSidebarStore,
  workDocumentKey,
  writeHasDocumentContext
} from './work-sidebar-store'
import type { WorkSessionEntry, WorkSessionGroupKind } from './work-sessions-model'

function reportSwitchFailure(message: string): void {
  if (message === PAPER_MODE_SWITCH_CANCELED) return
  usePaperStore.getState().setNotice({ tone: 'error', message })
}

/** Mount a work space on the documents surface, leaving a library if needed. */
export async function mountWorkSpace(root: string): Promise<boolean> {
  const target = normalizePath(root)
  const state = useWriteWorkspaceStore.getState()
  if (state.workSurface === 'docs' && normalizePath(state.workspaceRoot) === target) return true
  await state.selectWriteWorkspace(target)
  const next = useWriteWorkspaceStore.getState()
  return next.workSurface === 'docs' && normalizePath(next.workspaceRoot) === target
}

/** Mount a paper library; papers live inside Work, so this needs no mode switch. */
export async function mountPaperLibrary(root?: string): Promise<boolean> {
  const state = useWriteWorkspaceStore.getState()
  const target = normalizePath(root ?? '')
  if (state.workSurface === 'papers' && (!target || normalizePath(state.workspaceRoot) === target)) return true
  const result = target ? await switchPaperLibrary(target) : await enterPaperMode()
  if (!result.ok) reportSwitchFailure(result.message)
  return result.ok && useWriteWorkspaceStore.getState().workSurface === 'papers'
}

export function mountWorkRoot(root: string, kind: WorkSessionGroupKind): Promise<boolean> {
  return kind === 'library' ? mountPaperLibrary(root) : mountWorkSpace(root)
}

/** Library and discover pages open as tabs of the mounted library. */
export async function openPaperView(view: WritePaperViewId): Promise<void> {
  if (!(await mountPaperLibrary())) return
  useWriteWorkspaceStore.getState().openPaperViewTab(view)
}

export async function openPaperImport(): Promise<void> {
  if (!(await mountPaperLibrary())) return
  if (useWriteWorkspaceStore.getState().paperMode.activeLibrary) {
    usePaperModeStore.getState().setImportDialogOpen(true)
  }
}

function relativeTo(root: string, path: string): string {
  const base = normalizePath(root)
  const target = normalizePath(path)
  return target.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? target.slice(base.length + 1) : target
}

async function openSessionAnchor(root: string, session: WorkSessionEntry): Promise<void> {
  const write = useWriteWorkspaceStore.getState()
  const anchor = session.anchor
  if (anchor.kind === 'whiteboard') {
    if (write.whiteboards[anchor.boardId]) write.openWhiteboard(anchor.boardId)
    return
  }
  if (anchor.kind === 'file') {
    await write.openFile(root, anchor.path)
    return
  }
  if (anchor.kind === 'paper') {
    const unitDir = relativeTo(root, anchor.path)
    const entry = usePaperModeStore.getState().entries.find((candidate) => candidate.unitDir === unitDir)
    if (entry) await openLibraryEntry(entry, root)
  }
}

/**
 * Open a session from the sidebar: mount its space or library, bring back the
 * document it belongs to, then make it the pinned conversation.
 */
export async function openWorkSession(
  group: { root: string; kind: WorkSessionGroupKind },
  session: WorkSessionEntry
): Promise<void> {
  const end = beginWorkSessionTransition()
  try {
    if (!(await mountWorkRoot(group.root, group.kind))) return
    const root = useWriteWorkspaceStore.getState().workspaceRoot
    await openSessionAnchor(root, session)
    useWriteWorkspaceStore.getState().setAssistantOpen(true)
    await useChatStore.getState().selectWriteThread(session.id, root)
  } finally {
    end()
  }
}

/**
 * Whiteboards keep a bound conversation that their workflows depend on, so a
 * new session there is created and bound right away. PPT review boards stay
 * tied to the task that owns their workflow and get no new conversation.
 */
async function startWhiteboardSession(root: string, board: WorkWhiteboard): Promise<void> {
  if (board.workflowId) return
  const scope = workspaceRootScopeKey(root)
  const threadId = await useChatStore.getState().createWriteThread(root, undefined, {
    title: board.title,
    titleAuto: false
  })
  if (!threadId) return
  const latest = useWriteWorkspaceStore.getState()
  const latestBoard = latest.whiteboards[board.id]
  if (
    latest.activeWhiteboardId !== board.id ||
    workspaceRootScopeKey(latest.workspaceRoot) !== scope ||
    !latestBoard ||
    workspaceRootScopeKey(latestBoard.workspaceRoot) !== scope ||
    latestBoard.workflowId
  ) return
  await latest.bindWhiteboardThread(board.id, threadId)
}

/**
 * New session: a draft that the first send turns into a session bound to
 * whatever is open then, so no empty conversations pile up. Only whiteboards
 * create (and bind) their session immediately.
 */
export async function startWorkSession(target?: { root: string; kind: WorkSessionGroupKind }): Promise<void> {
  if (target && !(await mountWorkRoot(target.root, target.kind))) return
  const write = useWriteWorkspaceStore.getState()
  const root = write.workspaceRoot
  if (!root) return
  write.setAssistantOpen(true)
  const board = write.activeWhiteboardId ? write.whiteboards[write.activeWhiteboardId] ?? null : null
  if (board) {
    await startWhiteboardSession(root, board)
    return
  }
  useWorkSidebarStore.getState().startDraft(root, workDocumentKey(write))
}

/**
 * Before a Work send: a draft pin, or the empty center with no session yet,
 * becomes a new session bound to whatever is open. Returns false when the
 * session could not be created.
 */
export async function prepareWorkSessionForSend(): Promise<boolean> {
  const write = useWriteWorkspaceStore.getState()
  const chat = useChatStore.getState()
  const root = write.workspaceRoot
  if (!root || chat.route !== 'write' || write.activeWhiteboardId) return true
  const pin = currentWorkSessionPin(root, write)
  const draft = Boolean(pin && !pin.threadId)
  if (!draft && (writeHasDocumentContext(write) || chat.activeThreadId)) return true
  const resource = writeConversationResourcePath(root, write.activeFilePath)
  return Boolean(await chat.createWriteThread(root, resource || undefined))
}

/** The documents surface with a mounted space, mounting the first one if needed. */
export async function ensureWorkSpaceMounted(): Promise<boolean> {
  const state = useWriteWorkspaceStore.getState()
  if (state.workSurface === 'docs' && state.workspaceRoot.trim()) return true
  const target = state.workspaceRoots[0] || state.defaultWorkspaceRoot
  return target ? mountWorkSpace(target) : false
}

/** First free `untitled.md`, `untitled-2.md`, ... in `directory`. */
export function nextUntitledDocumentName(taken: Iterable<string>): string {
  const names = new Set([...taken].map((name) => name.toLowerCase()))
  let candidate = 'untitled.md'
  for (let index = 2; names.has(candidate); index += 1) candidate = `untitled-${index}.md`
  return candidate
}

/** A fresh Markdown document in the mounted space; opening it docks the assistant. */
export async function createWorkDraftDocument(untitledHeading: string): Promise<void> {
  if (!(await ensureWorkSpaceMounted())) return
  const state = useWriteWorkspaceStore.getState()
  const root = state.rootDirectory || state.workspaceRoot
  const name = nextUntitledDocumentName((state.entriesByDir[root] ?? []).map((entry) => entry.name))
  await state.createFile(state.workspaceRoot, writeJoinPath(root, name), `# ${untitledHeading}\n\n`)
}
