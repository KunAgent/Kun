import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { currentWorkSessionId, useWorkSessionStore } from '../../write/work-session-store'
import { markWriteThread, readWriteThreadRegistry, saveWriteThreadRegistry } from '../../write/write-thread-registry'
import { useWorkbenchWriteAssistantRuntime } from './useWorkbenchWriteAssistantRuntime'

function Harness(): null {
  useWorkbenchWriteAssistantRuntime({ composerPickList: [], composerModelGroups: [] })
  return null
}

const now = '2026-08-13T00:00:00.000Z'

async function mount(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(Harness))
    await Promise.resolve()
  })
  return renderer
}

describe('useWorkbenchWriteAssistantRuntime session law', () => {
  const thread = (id: string, extra: Record<string, unknown> = {}) => ({
    id, title: id, updatedAt: now, model: 'deepseek-v4', mode: 'agent' as const,
    workspace: '/work', agentSurface: 'write' as const, ...extra
  })

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    useWorkSessionStore.setState({ current: {}, transitions: 0 })
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/work',
      activeFilePath: null,
      activeWhiteboardId: 'board-1',
      whiteboards: {
        'board-1': {
          id: 'board-1', title: 'Pitch', workspaceRoot: '/work', threadId: 'thread-board',
          phase: 'blank', revision: 0, createdAt: now, updatedAt: now
        }
      }
    })
  })

  afterEach(() => {
    useWriteWorkspaceStore.getState().resetWorkspace()
    useWorkSessionStore.setState({ current: {}, transitions: 0 })
    vi.unstubAllGlobals()
  })

  it('keeps the current session when an ordinary whiteboard is in front', async () => {
    const selectThread = vi.fn(async () => undefined)
    const clearActiveThreadSelection = vi.fn()
    useWorkSessionStore.getState().select('/work', 'thread-file')
    useChatStore.setState({
      route: 'write',
      runtimeConnection: 'ready',
      activeThreadId: 'thread-file',
      threads: [thread('thread-file'), thread('thread-board')],
      selectThread,
      clearActiveThreadSelection
    })
    const renderer = await mount()

    expect(currentWorkSessionId('/work')).toBe('thread-file')
    expect(selectThread).not.toHaveBeenCalled()
    expect(clearActiveThreadSelection).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
  })

  it('does not create a session for a whiteboard that has none', async () => {
    const createWriteThread = vi.fn(async () => 'thread-new')
    const bindWhiteboardThread = vi.fn(async () => true)
    useWriteWorkspaceStore.setState({
      bindWhiteboardThread,
      whiteboards: {
        'board-1': {
          id: 'board-1', title: 'Pitch', workspaceRoot: '/work', threadId: null,
          phase: 'blank', revision: 0, createdAt: now, updatedAt: now
        }
      }
    })
    useChatStore.setState({
      route: 'write', runtimeConnection: 'ready', activeThreadId: null, threads: [], createWriteThread
    })
    const renderer = await mount()

    expect(createWriteThread).not.toHaveBeenCalled()
    expect(bindWhiteboardThread).not.toHaveBeenCalled()
    expect(currentWorkSessionId('/work')).toBe('')
    await act(async () => renderer.unmount())
  })

  it('makes a PPT review board\'s task session current when it comes to the front', async () => {
    const selectThread = vi.fn(async () => undefined)
    useWorkSessionStore.getState().select('/work', 'thread-file')
    useWriteWorkspaceStore.setState({
      whiteboards: {
        'board-1': {
          id: 'board-1', title: 'Deck', workspaceRoot: '/work', threadId: 'thread-task', workflowId: 'wf-1',
          phase: 'review', revision: 1, createdAt: now, updatedAt: now
        }
      }
    })
    useChatStore.setState({
      route: 'write',
      runtimeConnection: 'ready',
      activeThreadId: 'thread-file',
      threads: [thread('thread-file'), thread('thread-task')],
      selectThread
    })
    const renderer = await mount()

    await vi.waitFor(() => expect(selectThread).toHaveBeenCalledWith('thread-task'))
    expect(currentWorkSessionId('/work')).toBe('thread-task')
    await act(async () => renderer.unmount())
  })

  it('turns an archived current session back into a draft', async () => {
    useWorkSessionStore.getState().select('/work', 'thread-archived')
    useChatStore.setState({
      route: 'write',
      runtimeConnection: 'ready',
      activeThreadId: null,
      threads: [thread('thread-archived', { archived: true })]
    })
    const renderer = await mount()

    await vi.waitFor(() => expect(currentWorkSessionId('/work')).toBe(''))
    await act(async () => renderer.unmount())
  })

  it('adopts a Work session of the space selected from elsewhere', async () => {
    const stored = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value) },
      removeItem: (key: string) => { stored.delete(key) }
    })
    saveWriteThreadRegistry(markWriteThread('/work', 'thread-elsewhere', readWriteThreadRegistry(), '/work/notes.md'))
    useChatStore.setState({
      route: 'write',
      runtimeConnection: 'ready',
      activeThreadId: null,
      threads: [thread('thread-elsewhere')]
    })
    const renderer = await mount()

    await act(async () => {
      useChatStore.setState({ activeThreadId: 'thread-elsewhere' })
      await Promise.resolve()
    })
    expect(currentWorkSessionId('/work')).toBe('thread-elsewhere')
    await act(async () => renderer.unmount())
  })

  it('never mirrors a generated session title back into the whiteboard registry', async () => {
    const renameWhiteboard = vi.fn(async () => true)
    useWriteWorkspaceStore.setState({ renameWhiteboard })
    useWorkSessionStore.getState().select('/work', 'thread-board')
    const board = { ...thread('thread-board'), title: 'FastAPI architecture' }
    useChatStore.setState({
      route: 'write', runtimeConnection: 'ready', activeThreadId: 'thread-board', threads: [board]
    })
    const renderer = await mount()

    await act(async () => {
      useChatStore.setState({ threads: [{ ...board, title: 'FastAPI deployment' }] })
      await Promise.resolve()
    })
    await act(async () => {
      useChatStore.setState({ threads: [{ ...board, title: 'Yet another generated title' }] })
      await Promise.resolve()
    })

    expect(renameWhiteboard).not.toHaveBeenCalled()
    expect(useWriteWorkspaceStore.getState().whiteboards['board-1']?.title).toBe('Pitch')
    await act(async () => renderer.unmount())
  })
})
