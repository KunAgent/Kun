import { useChatStore } from '../store/chat-store'
import { writeConversationResourcePath } from '../paper/paper-mode-actions'
import { usePaperModeStore } from '../paper/paper-mode-store'
import { selectPaperResearchSession } from '../paper/paper-research-actions'
import { openLibraryEntry } from '../paper/paper-library-actions'
import { useWriteWorkspaceStore, writeDirnameFromPath, writeJoinPath } from './write-workspace-store'
import { normalizePath } from './write-workspace-store-helpers'
import type { WritePaperViewId } from './write-workspace-store-types'
import { beginWorkSessionTransition, currentWorkSessionId, useWorkSessionStore } from './work-session-store'
import { readWorkSessionTabs, workSessionTabTarget } from './work-session-tabs'
import type { WorkSessionEntry } from './work-sessions-model'
import { workAssistantThreadRoute } from './work-assistant-agent'

/** Mount a space; every space is a folder with its documents, boards and papers. */
export async function mountWorkSpace(root: string): Promise<boolean> {
  const target = normalizePath(root)
  if (!target) return false
  const state = useWriteWorkspaceStore.getState()
  if (normalizePath(state.workspaceRoot) === target) return true
  await state.selectWriteWorkspace(target)
  return normalizePath(useWriteWorkspaceStore.getState().workspaceRoot) === target
}

/** The current space, mounting the first registered one when none is. */
export async function ensureWorkSpaceMounted(): Promise<boolean> {
  const state = useWriteWorkspaceStore.getState()
  if (state.workspaceRoot.trim()) return true
  const target = state.workspaceRoots[0] || state.defaultWorkspaceRoot
  return target ? mountWorkSpace(target) : false
}

/** Library and discover pages open as tabs of the current space. */
export async function openPaperView(view: WritePaperViewId): Promise<void> {
  if (!(await ensureWorkSpaceMounted())) return
  useWriteWorkspaceStore.getState().openPaperViewTab(view)
}

/** The import dialog files papers into the current space's papers folder. */
export async function openPaperImport(): Promise<void> {
  if (!(await ensureWorkSpaceMounted())) return
  usePaperModeStore.getState().setImportDialogOpen(true)
}

function relativeTo(root: string, path: string): string {
  const base = normalizePath(root)
  const target = normalizePath(path)
  return target.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? target.slice(base.length + 1) : target
}

/** Open the document, board, paper, or research run a session is attached to. */
async function openSessionAnchor(root: string, session: WorkSessionEntry): Promise<void> {
  const write = useWriteWorkspaceStore.getState()
  const anchor = session.anchor
  if (anchor.kind === 'whiteboard') {
    if (write.whiteboards[anchor.boardId]) write.openWhiteboard(anchor.boardId)
  } else if (anchor.kind === 'file') {
    await write.openFile(root, anchor.path)
  } else if (anchor.kind === 'paper') {
    const unitDir = relativeTo(root, anchor.path)
    const entry = usePaperModeStore.getState().entries.find((candidate) => candidate.unitDir === unitDir)
    if (entry) await openLibraryEntry(entry, root)
  } else if (anchor.kind === 'research') {
    write.openPaperViewTab('discover:search')
    selectPaperResearchSession(anchor.sessionId)
  }
}

/** Files that still exist, checked one directory listing at a time. */
async function existingFiles(root: string, paths: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>()
  const listings = new Map<string, Promise<Set<string>>>()
  const list = (dir: string): Promise<Set<string>> => {
    let pending = listings.get(dir)
    if (!pending) {
      pending = (typeof window.kunGui?.listWorkspaceDirectory === 'function'
        ? window.kunGui.listWorkspaceDirectory({ workspaceRoot: root, path: dir })
        : Promise.resolve({ ok: false as const, message: '' }))
        .then((result) => new Set(result.ok ? result.entries.map((entry) => normalizePath(entry.path)) : []))
        .catch(() => new Set<string>())
      listings.set(dir, pending)
    }
    return pending
  }
  await Promise.all(paths.map(async (path) => {
    if ((await list(writeDirnameFromPath(path))).has(normalizePath(path))) found.add(path)
  }))
  return found
}

/**
 * Bring back the tabs a session had open. Tabs that are already open stay;
 * files that no longer exist are skipped. Returns false when nothing was
 * remembered (the caller then opens the session's anchor).
 */
async function restoreSessionTabs(root: string, threadId: string): Promise<boolean> {
  const remembered = readWorkSessionTabs(threadId)
  if (!remembered || normalizePath(remembered.workspaceRoot) !== normalizePath(root)) return false
  const targets = remembered.keys.map((key) => ({ key, target: workSessionTabTarget(key) }))
  const files = targets.flatMap(({ target }) => target?.kind === 'file' ? [target.path] : [])
  const present = await existingFiles(root, files)
  const write = useWriteWorkspaceStore.getState()
  const openKey = async (key: string): Promise<boolean> => {
    const target = workSessionTabTarget(key)
    const latest = useWriteWorkspaceStore.getState()
    if (normalizePath(latest.workspaceRoot) !== normalizePath(root)) return false
    if (target?.kind === 'whiteboard') {
      if (!latest.whiteboards[target.boardId]) return false
      latest.openWhiteboard(target.boardId)
    } else if (target?.kind === 'paper-view') {
      latest.openPaperViewTab(target.view)
    } else if (target?.kind === 'file') {
      if (!present.has(target.path)) return false
      await latest.openFile(root, target.path)
    } else {
      return false
    }
    return true
  }
  let opened = false
  // Open the others first so the remembered focus ends up in front.
  for (const { key } of targets) {
    if (key === remembered.focused) continue
    if (await openKey(key)) opened = true
  }
  if (remembered.focused && (await openKey(remembered.focused))) opened = true
  if (!opened) return false
  write.setAssistantOpen(true)
  return true
}

/**
 * Open a session: it becomes the current session of its space, and its
 * workbench comes back — the remembered tabs, or what it is attached to.
 */
export async function openWorkSession(session: WorkSessionEntry, root?: string): Promise<void> {
  const end = beginWorkSessionTransition()
  try {
    if (root && !(await mountWorkSpace(root))) return
    const spaceRoot = useWriteWorkspaceStore.getState().workspaceRoot
    if (!spaceRoot) return
    useWorkSessionStore.getState().select(spaceRoot, session.id)
    await useChatStore.getState().selectWriteThread(session.id, spaceRoot)
    const restored = await restoreSessionTabs(spaceRoot, session.id)
    // Restoring the discover tab does not carry the research run. Apply it
    // anyway, or the page stays on the empty "new research" composer.
    if (!restored || session.anchor.kind === 'research') await openSessionAnchor(spaceRoot, session)
  } finally {
    end()
  }
}

/** New session: an empty draft; the first send creates it and anchors it to what is open. */
export async function startWorkSession(root?: string): Promise<void> {
  if (root && !(await mountWorkSpace(root))) return
  const write = useWriteWorkspaceStore.getState()
  if (!write.workspaceRoot) return
  useWorkSessionStore.getState().startDraft(write.workspaceRoot)
  write.setAssistantOpen(true)
}

/**
 * Before a Work send: a draft becomes a session anchored to what is open,
 * and an ordinary whiteboard joins the current session so the canvas follows
 * its turns. PPT review boards keep the task session that owns them.
 * Returns false when the session could not be prepared.
 */
export async function prepareWorkSessionForSend(): Promise<boolean> {
  const write = useWriteWorkspaceStore.getState()
  const chat = useChatStore.getState()
  const root = write.workspaceRoot
  if (!root || chat.route !== 'write') return true
  const board = write.activeWhiteboardId ? write.whiteboards[write.activeWhiteboardId] ?? null : null
  if (board?.workflowId) return true
  let sessionId = currentWorkSessionId(root)
  if (sessionId && sessionId !== chat.activeThreadId) {
    await chat.selectWriteThread(sessionId, root)
    if (useChatStore.getState().activeThreadId !== sessionId) sessionId = ''
  }
  if (!sessionId) {
    const resource = board ? '' : writeConversationResourcePath(root, write.activeFilePath)
    const draft = useChatStore.getState()
    sessionId = await chat.createWriteThread(root, resource || undefined, { route: workAssistantThreadRoute(draft) }) ?? ''
    if (!sessionId) return false
    // The new session keeps the reasoning level picked on the draft as well.
    if (useChatStore.getState().activeThreadId === sessionId) {
      useChatStore.setState({ composerReasoningEffort: draft.composerReasoningEffort })
    }
    // The space changed while the session was created: the draft stays in
    // the composer instead of landing in, or binding a board of, another space.
    if (useWriteWorkspaceStore.getState().workspaceRoot !== root) return false
  }
  if (board && board.threadId !== sessionId) {
    return useWriteWorkspaceStore.getState().bindWhiteboardThread(board.id, sessionId)
  }
  return true
}

/**
 * Paper, reader and editor shortcuts ask the Work assistant straight away:
 * the same session preparation and send as the composer, never a dialog.
 */
export async function submitWorkAssistantPrompt(
  value: string,
  submit: (value: string) => void
): Promise<boolean> {
  const text = value.trim()
  if (!text) return false
  useWriteWorkspaceStore.getState().setAssistantOpen(true)
  if (!(await prepareWorkSessionForSend())) return false
  submit(text)
  return true
}

/** First free `untitled.md`, `untitled-2.md`, ... in `directory`. */
export function nextUntitledDocumentName(taken: Iterable<string>): string {
  const names = new Set([...taken].map((name) => name.toLowerCase()))
  let candidate = 'untitled.md'
  for (let index = 2; names.has(candidate); index += 1) candidate = `untitled-${index}.md`
  return candidate
}

/** A fresh Markdown document in the current space; opening it docks the assistant. */
export async function createWorkDraftDocument(untitledHeading: string): Promise<void> {
  if (!(await ensureWorkSpaceMounted())) return
  const state = useWriteWorkspaceStore.getState()
  const root = state.rootDirectory || state.workspaceRoot
  const name = nextUntitledDocumentName((state.entriesByDir[root] ?? []).map((entry) => entry.name))
  await state.createFile(state.workspaceRoot, writeJoinPath(root, name), `# ${untitledHeading}\n\n`)
}
