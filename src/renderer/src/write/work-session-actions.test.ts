import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../store/chat-store'
import { useWriteWorkspaceStore } from './write-workspace-store'
import { useWorkSidebarStore } from './work-sidebar-store'
import { prepareWorkSessionForSend, startWorkSession } from './work-session-actions'
import { pinnedWriteSessionId } from './work-session-thread-hooks'

const ROOT = '/Users/me/Work'

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
  })

  it('reports a session that could not be created', async () => {
    createWriteThread.mockResolvedValueOnce(null as unknown as string)
    expect(await prepareWorkSessionForSend()).toBe(false)
  })

  it('starts a draft in the sessions view instead of creating a thread up front', async () => {
    await startWorkSession()
    expect(useWorkSidebarStore.getState().pin).toEqual({ workspaceRoot: ROOT, threadId: '' })
    expect(createWriteThread).not.toHaveBeenCalled()
  })

  it('starts a document conversation right away in the files view', async () => {
    useWorkSidebarStore.setState({ view: 'files' })
    useWriteWorkspaceStore.setState({ activeFilePath: `${ROOT}/README.md` })
    await startWorkSession()
    expect(createWriteThread).toHaveBeenCalledWith(ROOT, `${ROOT}/README.md`)
  })

  it('lets a pinned session keep the turn whatever document is open', () => {
    useWriteWorkspaceStore.setState({ activeFilePath: `${ROOT}/README.md` })
    useWorkSidebarStore.getState().pinSession(ROOT, 'thr_pinned')
    expect(pinnedWriteSessionId(ROOT, 'thr_pinned')).toBe('thr_pinned')
    expect(pinnedWriteSessionId(ROOT, 'thr_other')).toBeNull()
    useWorkSidebarStore.setState({ view: 'files' })
    expect(pinnedWriteSessionId(ROOT, 'thr_pinned')).toBeNull()
  })
})
