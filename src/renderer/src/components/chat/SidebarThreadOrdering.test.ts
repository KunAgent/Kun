import { createElement } from 'react'
import { act, create as createRenderer, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { SidebarConversationsSection } from './SidebarConversationsSection'
import { SidebarProjectsSection } from './SidebarProjectsSection'
import { SIDEBAR_FOLDERS_STORAGE_KEY } from './sidebar-folders'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ i18n: { language: 'en-US' }, t: (key: string) => key })
}))

function thread(id: string, workspace: string, updatedAt: string): NormalizedThread {
  return { id, title: id, workspace, updatedAt, model: 'model', mode: 'agent' }
}

function storage(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial))
  return {
    get length() { return items.size },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => items.delete(key),
    setItem: (key, value) => items.set(key, value)
  }
}

function projectProps(threads: NormalizedThread[], activity: Record<string, unknown> = {}) {
  const noOp = vi.fn()
  return {
    threads,
    activeView: 'chat' as const,
    activeThreadId: null,
    runtimeReady: true,
    threadListStatus: 'ready' as const,
    threadListError: null,
    onRetryThreads: noOp,
    onLoadMoreThreads: noOp,
    threadListCursorByWorkspace: {},
    searchQuery: '',
    showArchived: false,
    workspaceRoot: '/project',
    workspaceRoots: ['/project'],
    conversationRoot: '/conversations',
    busy: false,
    watchTurnCompletion: {},
    unreadThreadIds: {},
    locale: 'en-US',
    onPickWorkspace: noOp,
    onRemoveWorkspace: vi.fn(async () => undefined),
    onCreateThreadInWorkspace: vi.fn(async () => null),
    onSelectThread: noOp,
    onRenameThread: vi.fn(async () => undefined),
    onPinThread: vi.fn(async () => undefined),
    onArchiveThread: vi.fn(async () => undefined),
    onDeleteThread: vi.fn(async () => undefined),
    onRestoreThread: vi.fn(async () => undefined),
    onSearchQueryChange: noOp,
    t: (key: string) => key,
    ...activity
  }
}

function visibleThreadTitles(renderer: ReactTestRenderer, ids: string[]): string[] {
  const expected = new Set(ids)
  return renderer.root.findAll((node) =>
    node.type === 'div' && node.props.draggable === true && expected.has(node.props.title)
  ).map((node) => node.props.title as string)
}

describe('sidebar thread ordering integration', () => {
  it('moves a late-discovered running project row above viewed rows and into the first five', async () => {
    vi.stubGlobal('localStorage', storage())
    const times = ['07', '06', '05', '04', '03', '02', '01']
    const threads = times.map((suffix, index) =>
      thread(index === 5 ? 'background' : `thread-${index + 1}`, '/project', `2026-08-20T00:00:${suffix}.000Z`)
    )
    const ids = threads.map((item) => item.id)
    let renderer: ReactTestRenderer | null = null
    try {
      await act(async () => {
        renderer = createRenderer(createElement(SidebarProjectsSection, projectProps(threads)))
      })
      expect(visibleThreadTitles(renderer!, ids)).toEqual([
        'thread-1', 'thread-2', 'thread-3', 'thread-4', 'thread-5'
      ])

      const refreshed = threads.map((item) => item.id === 'background'
        ? { ...item, updatedAt: '2026-08-20T00:00:09.000Z' }
        : item)
      await act(async () => {
        renderer!.update(createElement(SidebarProjectsSection, projectProps(refreshed, {
          watchTurnCompletion: { background: true }
        })))
      })
      expect(visibleThreadTitles(renderer!, ids)).toEqual([
        'background', 'thread-1', 'thread-2', 'thread-3', 'thread-4'
      ])

      await act(async () => {
        renderer!.update(createElement(SidebarProjectsSection, projectProps(refreshed, {
          watchTurnCompletion: { background: true },
          awaitingUserInputThreadIds: { background: true }
        })))
      })
      expect(visibleThreadTitles(renderer!, ids)).toEqual([
        'background', 'thread-1', 'thread-2', 'thread-3', 'thread-4'
      ])
    } finally {
      // The renderer is assigned inside the act() closure; keep the union
      // explicit so control-flow analysis cannot narrow it to `never`.
      ;(renderer as ReactTestRenderer | null)?.unmount()
      vi.unstubAllGlobals()
    }
  })

  it('promotes awaiting input inside a virtual folder without moving the thread out', async () => {
    vi.stubGlobal('localStorage', storage({
      [SIDEBAR_FOLDERS_STORAGE_KEY]: JSON.stringify({
        version: 1,
        foldersByScope: {
          '/project': [{ id: 'folder', name: 'Folder', parentId: null, threadIds: ['newer', 'waiting'] }]
        }
      })
    }))
    const items = [
      thread('newer', '/project', '2026-08-20T00:00:05.000Z'),
      thread('waiting', '/project', '2026-08-20T00:00:01.000Z')
    ]
    let renderer: ReactTestRenderer | null = null
    try {
      await act(async () => {
        renderer = createRenderer(createElement(SidebarProjectsSection, projectProps(items, {
          watchTurnCompletion: { waiting: true }
        })))
      })
      expect(visibleThreadTitles(renderer!, ['newer', 'waiting'])).toEqual(['waiting', 'newer'])
      await act(async () => {
        renderer!.update(createElement(SidebarProjectsSection, projectProps(items, {
          watchTurnCompletion: { waiting: true },
          awaitingUserInputThreadIds: { waiting: true }
        })))
      })
      expect(visibleThreadTitles(renderer!, ['newer', 'waiting'])).toEqual(['waiting', 'newer'])
      expect(renderer!.root.findAll((node) => node.props.title === 'Folder').length).toBeGreaterThan(0)
    } finally {
      ;(renderer as ReactTestRenderer | null)?.unmount()
      vi.unstubAllGlobals()
    }
  })

  it('promotes and then freezes an awaiting conversation row after the answer resumes running', async () => {
    vi.stubGlobal('localStorage', storage())
    const originalState = useChatStore.getState()
    const items = [
      thread('newer-conversation', '/conversations/newer', '2026-08-20T00:00:05.000Z'),
      thread('waiting-conversation', '/conversations/waiting', '2026-08-20T00:00:01.000Z')
    ]
    const noOp = vi.fn()
    let renderer: ReactTestRenderer | null = null
    try {
      useChatStore.setState({
        activeThreadId: null,
        busy: false,
        watchTurnCompletion: { 'waiting-conversation': true },
        unreadThreadIds: {},
        scheduledThreadActivities: {},
        awaitingUserInputThreadIds: {}
      })
      await act(async () => {
        renderer = createRenderer(createElement(SidebarConversationsSection, {
          threads: items,
          activeThreadId: null,
          runtimeReady: true,
          conversationRoot: '/conversations',
          onNewConversation: noOp,
          onSelectThread: noOp,
          onRenameThread: vi.fn(async () => undefined),
          onPinThread: vi.fn(async () => undefined),
          onArchiveThread: vi.fn(async () => undefined),
          onDeleteThread: vi.fn(async () => undefined),
          onRestoreThread: vi.fn(async () => undefined),
          t: (key: string) => key
        }))
      })
      const toggle = renderer!.root.find((node) => node.type === 'button' && node.props.title === 'sidebarConversations')
      await act(async () => toggle.props.onClick())
      expect(visibleThreadTitles(renderer!, items.map((item) => item.id))).toEqual([
        'waiting-conversation', 'newer-conversation'
      ])

      await act(async () => useChatStore.setState({
        awaitingUserInputThreadIds: { 'waiting-conversation': true }
      }))
      expect(visibleThreadTitles(renderer!, items.map((item) => item.id))).toEqual([
        'waiting-conversation', 'newer-conversation'
      ])
      await act(async () => useChatStore.setState({ awaitingUserInputThreadIds: {} }))
      expect(visibleThreadTitles(renderer!, items.map((item) => item.id))).toEqual([
        'waiting-conversation', 'newer-conversation'
      ])
    } finally {
      ;(renderer as ReactTestRenderer | null)?.unmount()
      useChatStore.setState(originalState, true)
      vi.unstubAllGlobals()
    }
  })

  it('demotes a viewed completed project row behind loading rows and keeps it visible past the first batch', async () => {
    vi.stubGlobal('localStorage', storage())
    const threads = [
      thread('load-a', '/project', '2026-08-20T00:00:09.000Z'),
      thread('load-b', '/project', '2026-08-20T00:00:08.000Z'),
      thread('load-c', '/project', '2026-08-20T00:00:07.000Z'),
      thread('load-d', '/project', '2026-08-20T00:00:06.000Z'),
      thread('load-e', '/project', '2026-08-20T00:00:05.000Z'),
      thread('done', '/project', '2026-08-20T00:00:01.000Z')
    ]
    const ids = threads.map((item) => item.id)
    const runningWatches = { 'load-a': true, 'load-b': true, 'load-c': true, 'load-d': true, 'load-e': true }
    let renderer: ReactTestRenderer | null = null
    try {
      await act(async () => {
        renderer = createRenderer(createElement(SidebarProjectsSection, projectProps(threads, {
          watchTurnCompletion: { ...runningWatches, done: true }
        })))
      })
      await act(async () => {
        renderer!.update(createElement(SidebarProjectsSection, projectProps(threads, {
          unreadThreadIds: { done: 'completed' },
          watchTurnCompletion: runningWatches
        })))
      })
      expect(visibleThreadTitles(renderer!, ids)).toEqual([
        'done', 'load-a', 'load-b', 'load-c', 'load-d', 'load-e'
      ])

      await act(async () => {
        renderer!.update(createElement(SidebarProjectsSection, projectProps(threads, {
          activeThreadId: 'done',
          unreadThreadIds: {},
          watchTurnCompletion: runningWatches
        })))
      })
      expect(visibleThreadTitles(renderer!, ids)).toEqual([
        'load-a', 'load-b', 'load-c', 'load-d', 'load-e', 'done'
      ])
    } finally {
      ;(renderer as ReactTestRenderer | null)?.unmount()
      vi.unstubAllGlobals()
    }
  })

  it('demotes a viewed completed conversation row behind a still-running conversation', async () => {
    vi.stubGlobal('localStorage', storage())
    const originalState = useChatStore.getState()
    const items = [
      thread('conv-load', '/conversations/load', '2026-08-20T00:00:09.000Z'),
      thread('conv-done', '/conversations/done', '2026-08-20T00:00:01.000Z')
    ]
    const noOp = vi.fn()
    let renderer: ReactTestRenderer | null = null
    try {
      useChatStore.setState({
        activeThreadId: null,
        busy: false,
        watchTurnCompletion: { 'conv-load': true, 'conv-done': true },
        unreadThreadIds: {},
        scheduledThreadActivities: {},
        awaitingUserInputThreadIds: {}
      })
      await act(async () => {
        renderer = createRenderer(createElement(SidebarConversationsSection, {
          threads: items,
          activeThreadId: null,
          runtimeReady: true,
          conversationRoot: '/conversations',
          onNewConversation: noOp,
          onSelectThread: noOp,
          onRenameThread: vi.fn(async () => undefined),
          onPinThread: vi.fn(async () => undefined),
          onArchiveThread: vi.fn(async () => undefined),
          onDeleteThread: vi.fn(async () => undefined),
          onRestoreThread: vi.fn(async () => undefined),
          t: (key: string) => key
        }))
      })
      const toggle = renderer!.root.find((node) => node.type === 'button' && node.props.title === 'sidebarConversations')
      await act(async () => toggle.props.onClick())
      await act(async () => useChatStore.setState({
        watchTurnCompletion: { 'conv-load': true },
        unreadThreadIds: { 'conv-done': 'completed' }
      }))
      expect(visibleThreadTitles(renderer!, items.map((item) => item.id))).toEqual([
        'conv-done', 'conv-load'
      ])
      await act(async () => {
        useChatStore.setState({
          activeThreadId: 'conv-done',
          unreadThreadIds: {}
        })
        renderer!.update(createElement(SidebarConversationsSection, {
          threads: items,
          activeThreadId: 'conv-done',
          runtimeReady: true,
          conversationRoot: '/conversations',
          onNewConversation: noOp,
          onSelectThread: noOp,
          onRenameThread: vi.fn(async () => undefined),
          onPinThread: vi.fn(async () => undefined),
          onArchiveThread: vi.fn(async () => undefined),
          onDeleteThread: vi.fn(async () => undefined),
          onRestoreThread: vi.fn(async () => undefined),
          t: (key: string) => key
        }))
      })
      expect(visibleThreadTitles(renderer!, items.map((item) => item.id))).toEqual([
        'conv-load', 'conv-done'
      ])
    } finally {
      ;(renderer as ReactTestRenderer | null)?.unmount()
      useChatStore.setState(originalState, true)
      vi.unstubAllGlobals()
    }
  })
})
