import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../store/chat-store'
import { useWriteWorkspaceStore } from './write-workspace-store'
import { useWorkSidebarStore, workDocumentKey } from './work-sidebar-store'
import { nextUntitledDocumentName, prepareWorkSessionForSend, startWorkSession } from './work-session-actions'
import { pinnedWriteSessionId, workSessionDraftPending } from './work-session-thread-hooks'

const ROOT = '/Users/me/Work'
const now = '2026-08-13T00:00:00.000Z'

describe('Work session actions', () => {
  const createWriteThread = vi.fn(async () => 'thr_new')
  const initialChat = useChatStore.getState()
  const initialWrite = useWriteWorkspaceStore.getState()

  beforeEach(() => {
    createWriteThread.mockClear()
    useChatStore.setState({ route: 'write', activeThreadId: null, createWriteThread })
    useWriteWorkspaceStore.setState({
      workSurface: 'docs',
      workspaceRoot: ROOT,
      activeFilePath: null,
      activeWhiteboardId: null,
      whiteboards: {},
      setAssistantOpen: vi.fn()
    })
    useWorkSidebarStore.setState({ view: 'sessions', pin: null, transitions: 0 })
  })

  afterEach(() => {
    useChatStore.setState(initialChat, true)
    useWriteWorkspaceStore.setState(initialWrite, true)
  })

  it('turns the empty center into a new space session on the first send', async () => {
    expect(await prepareWorkSessionForSend()).toBe(true)
    expect(createWriteThread).toHaveBeenCalledWith(ROOT, undefined)
  })

  it('creates the drafted session bound to the open document', async () => {
    useWriteWorkspaceStore.setState({ activeFilePath: `${ROOT}/README.md` })
    useChatStore.setState({ activeThreadId: 'thr_doc' })
    useWorkSidebarStore.getState().startDraft(ROOT)
    expect(workSessionDraftPending(ROOT)).toBe(true)
    expect(await prepareWorkSessionForSend()).toBe(true)
    expect(createWriteThread).toHaveBeenCalledWith(ROOT, `${ROOT}/README.md`)
  })

  it('leaves an existing conversation alone', async () => {
    useChatStore.setState({ activeThreadId: 'thr_existing' })
    expect(await prepareWorkSessionForSend()).toBe(true)
    useWriteWorkspaceStore.setState({ activeFilePath: `${ROOT}/README.md` })
    useChatStore.setState({ activeThreadId: null })
    expect(await prepareWorkSessionForSend()).toBe(true)
    expect(createWriteThread).not.toHaveBeenCalled()
    expect(workSessionDraftPending(ROOT)).toBe(false)
  })

  it('reports a session that could not be created', async () => {
    createWriteThread.mockResolvedValueOnce(null as unknown as string)
    expect(await prepareWorkSessionForSend()).toBe(false)
  })

  it('starts a draft in either view instead of creating a thread up front', async () => {
    await startWorkSession()
    expect(useWorkSidebarStore.getState().pin).toEqual({
      workspaceRoot: ROOT, threadId: '', documentKey: workDocumentKey(useWriteWorkspaceStore.getState())
    })
    useWorkSidebarStore.setState({ view: 'files', pin: null })
    useWriteWorkspaceStore.setState({ activeFilePath: `${ROOT}/README.md` })
    await startWorkSession()
    expect(useWorkSidebarStore.getState().pin?.threadId).toBe('')
    expect(useWorkSidebarStore.getState().pin?.documentKey).toBe(workDocumentKey(useWriteWorkspaceStore.getState()))
    expect(createWriteThread).not.toHaveBeenCalled()
  })

  it('creates and binds a whiteboard session right away', async () => {
    const bindWhiteboardThread = vi.fn(async () => true)
    useWriteWorkspaceStore.setState({
      activeWhiteboardId: 'board-1',
      bindWhiteboardThread,
      whiteboards: {
        'board-1': {
          id: 'board-1', title: 'Pitch', workspaceRoot: ROOT, threadId: null,
          phase: 'blank', revision: 0, createdAt: now, updatedAt: now
        }
      }
    })
    await startWorkSession()
    expect(createWriteThread).toHaveBeenCalledWith(ROOT, undefined, { title: 'Pitch', titleAuto: false })
    expect(bindWhiteboardThread).toHaveBeenCalledWith('board-1', 'thr_new')
  })

  it('lets a pinned session keep the turn whatever document is open in the sessions view', () => {
    useWriteWorkspaceStore.setState({ activeFilePath: `${ROOT}/README.md` })
    useWorkSidebarStore.getState().pinSession(ROOT, 'thr_pinned')
    expect(pinnedWriteSessionId(ROOT, 'thr_pinned')).toBe('thr_pinned')
    expect(pinnedWriteSessionId(ROOT, 'thr_other')).toBeNull()
  })

  it('keeps a pinned session in the files view until another document opens', () => {
    useWriteWorkspaceStore.setState({ activeFilePath: `${ROOT}/README.md` })
    useWorkSidebarStore.setState({ view: 'files' })
    useWorkSidebarStore.getState().pinSession(ROOT, 'thr_pinned', workDocumentKey(useWriteWorkspaceStore.getState()))
    expect(pinnedWriteSessionId(ROOT, 'thr_pinned')).toBe('thr_pinned')
    useWriteWorkspaceStore.setState({ activeFilePath: `${ROOT}/notes.md` })
    expect(pinnedWriteSessionId(ROOT, 'thr_pinned')).toBeNull()
    useWriteWorkspaceStore.setState({ activeFilePath: null })
    expect(pinnedWriteSessionId(ROOT, 'thr_pinned')).toBe('thr_pinned')
  })

  it('names new documents untitled, then untitled-2 and so on', () => {
    expect(nextUntitledDocumentName([])).toBe('untitled.md')
    expect(nextUntitledDocumentName(['Untitled.md', 'notes.md'])).toBe('untitled-2.md')
    expect(nextUntitledDocumentName(['untitled.md', 'untitled-2.md'])).toBe('untitled-3.md')
  })
})
