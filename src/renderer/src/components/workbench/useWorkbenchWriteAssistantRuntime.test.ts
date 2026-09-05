import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
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

describe('useWorkbenchWriteAssistantRuntime whiteboard binding', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
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
    vi.unstubAllGlobals()
  })

  it('selects the exact board thread instead of clearing an empty file context', async () => {
    const selectWriteThread = vi.fn(async () => undefined)
    const clearActiveThreadSelection = vi.fn()
    useChatStore.setState({
      route: 'write',
      runtimeConnection: 'ready',
      activeThreadId: 'thread-file',
      threads: [{
        id: 'thread-board', title: 'Pitch', updatedAt: now, model: 'deepseek-v4', mode: 'agent',
        workspace: '/work', agentSurface: 'write'
      }],
      selectWriteThread,
      clearActiveThreadSelection
    })
    const renderer = await mount()

    await vi.waitFor(() => expect(selectWriteThread).toHaveBeenCalledWith('thread-board', '/work'))
    expect(clearActiveThreadSelection).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
  })

  it('creates and persists a missing board thread with a locked title', async () => {
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

    await vi.waitFor(() => expect(bindWhiteboardThread).toHaveBeenCalledWith('board-1', 'thread-new'))
    expect(createWriteThread).toHaveBeenCalledWith('/work', undefined, {
      title: 'Pitch',
      titleAuto: false
    })
    await act(async () => renderer.unmount())
  })

  it('promotes the next available whiteboard conversation when the active one is archived', async () => {
    const bindWhiteboardThread = vi.fn(async () => true)
    const selectWriteThread = vi.fn(async () => undefined)
    useWriteWorkspaceStore.setState({
      bindWhiteboardThread,
      whiteboards: {
        'board-1': {
          id: 'board-1', title: 'Pitch', workspaceRoot: '/work',
          threadId: 'thread-archived', threadIds: ['thread-archived', 'thread-history'],
          phase: 'blank', revision: 0, createdAt: now, updatedAt: now
        }
      }
    })
    useChatStore.setState({
      route: 'write',
      runtimeConnection: 'ready',
      activeThreadId: null,
      threads: [
        {
          id: 'thread-archived', title: 'Archived', updatedAt: now, model: 'deepseek-v4',
          mode: 'agent', workspace: '/work', agentSurface: 'write', archived: true
        },
        {
          id: 'thread-history', title: 'Earlier idea', updatedAt: now, model: 'deepseek-v4',
          mode: 'agent', workspace: '/work', agentSurface: 'write'
        }
      ],
      selectWriteThread
    })
    const renderer = await mount()

    await vi.waitFor(() => expect(bindWhiteboardThread)
      .toHaveBeenCalledWith('board-1', 'thread-history'))
    expect(selectWriteThread).toHaveBeenCalledWith('thread-history', '/work')
    await act(async () => renderer.unmount())
  })

  it('never mirrors a generated session title back into the whiteboard registry', async () => {
    const renameWhiteboard = vi.fn(async () => true)
    useWriteWorkspaceStore.setState({ renameWhiteboard })
    const thread = {
      id: 'thread-board', title: 'FastAPI architecture', updatedAt: now,
      model: 'deepseek-v4', mode: 'agent' as const, workspace: '/work', agentSurface: 'write' as const
    }
    useChatStore.setState({
      route: 'write', runtimeConnection: 'ready', activeThreadId: 'thread-board', threads: [thread]
    })
    const renderer = await mount()

    await act(async () => {
      useChatStore.setState({ threads: [{ ...thread, title: 'FastAPI deployment' }] })
      await Promise.resolve()
    })
    await act(async () => {
      useChatStore.setState({ threads: [{ ...thread, title: 'Yet another generated title' }] })
      await Promise.resolve()
    })

    expect(renameWhiteboard).not.toHaveBeenCalled()
    expect(useWriteWorkspaceStore.getState().whiteboards['board-1']?.title).toBe('Pitch')
    await act(async () => renderer.unmount())
  })
})
