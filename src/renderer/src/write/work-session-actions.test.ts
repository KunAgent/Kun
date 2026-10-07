import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../store/chat-store'
import { useWriteWorkspaceStore } from './write-workspace-store'
import { currentWorkSessionId, useWorkSessionStore } from './work-session-store'
import {
  nextUntitledDocumentName,
  openWorkSession,
  prepareWorkSessionForSend,
  startWorkSession
} from './work-session-actions'

const ROOT = '/Users/me/Work'
const now = '2026-08-13T00:00:00.000Z'

describe('Work session actions', () => {
  const createWriteThread = vi.fn(async () => 'thr_new')
  const selectWriteThread = vi.fn(async (threadId: string) => {
    useChatStore.setState({ activeThreadId: threadId })
  })
  const openFile = vi.fn(async () => undefined)
  const initialChat = useChatStore.getState()
  const initialWrite = useWriteWorkspaceStore.getState()

  beforeEach(() => {
    createWriteThread.mockClear()
    selectWriteThread.mockClear()
    openFile.mockClear()
    useChatStore.setState({ route: 'write', activeThreadId: null, createWriteThread, selectWriteThread })
    useWriteWorkspaceStore.setState({
      workSurface: 'docs',
      workspaceRoot: ROOT,
      activeFilePath: null,
      activeWhiteboardId: null,
      whiteboards: {},
      openFile,
      setAssistantOpen: vi.fn()
    })
    useWorkSessionStore.setState({ current: {}, transitions: 0 })
  })

  afterEach(() => {
    useChatStore.setState(initialChat, true)
    useWriteWorkspaceStore.setState(initialWrite, true)
  })

  it('turns a draft into a new session anchored to the open document on the first send', async () => {
    useWriteWorkspaceStore.setState({ activeFilePath: `${ROOT}/README.md` })
    expect(await prepareWorkSessionForSend()).toBe(true)
    expect(createWriteThread).toHaveBeenCalledWith(ROOT, `${ROOT}/README.md`)
  })

  it('anchors a session started with nothing open to the space', async () => {
    expect(await prepareWorkSessionForSend()).toBe(true)
    expect(createWriteThread).toHaveBeenCalledWith(ROOT, undefined)
  })

  it('keeps the current session whatever document is open', async () => {
    useWorkSessionStore.getState().select(ROOT, 'thr_current')
    useChatStore.setState({ activeThreadId: 'thr_current' })
    useWriteWorkspaceStore.setState({ activeFilePath: `${ROOT}/other.md` })
    expect(await prepareWorkSessionForSend()).toBe(true)
    expect(createWriteThread).not.toHaveBeenCalled()
    expect(selectWriteThread).not.toHaveBeenCalled()
  })

  it('selects the current session when it is not the active thread yet', async () => {
    useWorkSessionStore.getState().select(ROOT, 'thr_current')
    expect(await prepareWorkSessionForSend()).toBe(true)
    expect(selectWriteThread).toHaveBeenCalledWith('thr_current', ROOT)
    expect(createWriteThread).not.toHaveBeenCalled()
  })

  it('reports a session that could not be created', async () => {
    createWriteThread.mockResolvedValueOnce(null as unknown as string)
    expect(await prepareWorkSessionForSend()).toBe(false)
  })

  it('starts a draft instead of creating a thread up front', async () => {
    useWorkSessionStore.getState().select(ROOT, 'thr_current')
    await startWorkSession()
    expect(currentWorkSessionId(ROOT)).toBe('')
    expect(Object.values(useWorkSessionStore.getState().current)).toEqual([''])
    expect(createWriteThread).not.toHaveBeenCalled()
  })

  it('binds an ordinary whiteboard to the session its first send creates', async () => {
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
    expect(await prepareWorkSessionForSend()).toBe(true)
    expect(createWriteThread).toHaveBeenCalledWith(ROOT, undefined)
    expect(bindWhiteboardThread).toHaveBeenCalledWith('board-1', 'thr_new')
  })

  it('neither sends nor binds a board when the space changes while the session is created', async () => {
    const bindWhiteboardThread = vi.fn(async () => true)
    let finish: (id: string) => void = () => undefined
    createWriteThread.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve }))
    useWriteWorkspaceStore.setState({
      activeWhiteboardId: 'board-1',
      bindWhiteboardThread,
      whiteboards: {
        'board-1': {
          id: 'board-1', title: 'Notes', workspaceRoot: ROOT, threadId: null,
          phase: 'blank', revision: 0, createdAt: now, updatedAt: now
        }
      }
    })
    const ready = prepareWorkSessionForSend()
    useWriteWorkspaceStore.setState({ workspaceRoot: '/Users/me/Other' })
    finish('thr_new')
    expect(await ready).toBe(false)
    expect(bindWhiteboardThread).not.toHaveBeenCalled()
  })

  it('leaves a PPT review board with the task session that owns it', async () => {
    useWriteWorkspaceStore.setState({
      activeWhiteboardId: 'board-ppt',
      whiteboards: {
        'board-ppt': {
          id: 'board-ppt', title: 'Deck', workspaceRoot: ROOT, threadId: 'thr_task', workflowId: 'wf-1',
          phase: 'review', revision: 1, createdAt: now, updatedAt: now
        }
      }
    })
    expect(await prepareWorkSessionForSend()).toBe(true)
    expect(createWriteThread).not.toHaveBeenCalled()
  })

  it('opens a session as the current one and brings back what it is attached to', async () => {
    await openWorkSession({ id: 'thr_doc', title: 'Plan', updatedAt: now, anchor: { kind: 'file', path: `${ROOT}/plan.md` } })
    expect(currentWorkSessionId(ROOT)).toBe('thr_doc')
    expect(selectWriteThread).toHaveBeenCalledWith('thr_doc', ROOT)
    expect(openFile).toHaveBeenCalledWith(ROOT, `${ROOT}/plan.md`)
  })

  it('names new documents untitled, then untitled-2 and so on', () => {
    expect(nextUntitledDocumentName([])).toBe('untitled.md')
    expect(nextUntitledDocumentName(['Untitled.md', 'notes.md'])).toBe('untitled-2.md')
    expect(nextUntitledDocumentName(['untitled.md', 'untitled-2.md'])).toBe('untitled-3.md')
  })
})
