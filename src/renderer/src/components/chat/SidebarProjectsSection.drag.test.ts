import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create as createRenderer, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import type { SddDraftHistoryItem } from '../../sdd/sdd-draft-history'
import { SidebarConversationsSection } from './SidebarConversationsSection'
import {
  buildSidebarThreadMoveTargets,
  buildSidebarDraftWorkspacePaths,
  buildSidebarWorkspaceGroups,
  filterEmptySddAssistantThreadsFromSidebar,
  filterSddDraftHistoryItems,
  isSidebarThreadMoveBlocked,
  mergeSidebarWorkspaceGroupsWithDraftHistory,
  MoveThreadDialog,
  prioritizeSidebarThreadActivity,
  resolveThreadPreviewPosition,
  sddDraftHistorySavedRevision,
  sidebarThreadActivity,
  sidebarOverlayPortalHost,
  SidebarProjectsSection,
  sortSidebarThreads,
  SddDraftHistoryRows,
  SidebarActionDialog,
  ThreadRow,
  ThreadRenameDialog
} from './SidebarProjectsSection'
import { SIDEBAR_ORDER_STORAGE_KEY } from './sidebar-order'
import { SIDEBAR_FOLDERS_STORAGE_KEY } from './sidebar-folders'
import { SIDEBAR_COLLAPSE_STORAGE_KEY } from './sidebar-collapse'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, opts?: Record<string, unknown>) =>
      key === 'sidebarThreadWorktree' ? `Worktree ${String(opts?.branch)}` : key
  })
}))

function thread(overrides: Partial<NormalizedThread> & Pick<NormalizedThread, 'id' | 'workspace'>): NormalizedThread {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    updatedAt: overrides.updatedAt ?? '2026-06-01T00:00:00.000Z',
    model: overrides.model ?? 'reasonix',
    mode: overrides.mode ?? 'agent',
    workspace: overrides.workspace,
    ...(overrides.preview ? { preview: overrides.preview } : {}),
    ...(overrides.latestTurnId ? { latestTurnId: overrides.latestTurnId } : {}),
    ...(overrides.status ? { status: overrides.status } : {}),
    ...(overrides.pinned !== undefined ? { pinned: overrides.pinned } : {}),
    ...(overrides.archived !== undefined ? { archived: overrides.archived } : {})
  }
}

function draft(overrides: Partial<SddDraftHistoryItem> & Pick<SddDraftHistoryItem, 'id' | 'title'>): SddDraftHistoryItem {
  const folder = overrides.id.replace(/[^a-z0-9-]/gi, '').slice(0, 36).padEnd(36, '0')
  return {
    id: overrides.id,
    workspaceRoot: overrides.workspaceRoot ?? '/tmp/app',
    relativePath: overrides.relativePath ?? `.kunsdd/draft/${folder}/requirement.md`,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-02T00:00:00.000Z',
    title: overrides.title,
    source: overrides.source ?? 'remembered',
    ...(overrides.chatThreadIds ? { chatThreadIds: overrides.chatThreadIds } : {}),
    ...(overrides.searchText ? { searchText: overrides.searchText } : {})
  }
}

function createSidebarTestStorage(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial))
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => items.delete(key),
    setItem: (key, value) => items.set(key, value)
  }
}

function sidebarProjectProps(overrides: Record<string, unknown> = {}) {
  return {
    threads: [],
    activeView: 'chat' as const,
    activeThreadId: null,
    runtimeReady: true,
    threadListStatus: 'ready' as const,
    threadListError: null,
    onRetryThreads: vi.fn(),
    onLoadMoreThreads: vi.fn(),
    threadListCursorByWorkspace: {},
    searchQuery: '',
    showArchived: false,
    workspaceRoot: '/Users/zxy/project-a',
    workspaceRoots: ['/Users/zxy/project-a'],
    conversationRoot: '/Users/zxy/Documents/Kun',
    busy: false,
    watchTurnCompletion: {},
    unreadThreadIds: {},
    locale: 'en-US',
    onPickWorkspace: vi.fn(),
    onRemoveWorkspace: vi.fn(async () => undefined),
    onCreateThreadInWorkspace: vi.fn(),
    onSelectThread: vi.fn(),
    onRenameThread: vi.fn(async () => undefined),
    onPinThread: vi.fn(async () => undefined),
    onArchiveThread: vi.fn(async () => undefined),
    onDeleteThread: vi.fn(async () => undefined),
    onRestoreThread: vi.fn(async () => undefined),
    onSearchQueryChange: vi.fn(),
    onOpenSchedule: vi.fn(),
    t: (key: string) => key,
    ...overrides
  }
}


describe('SidebarProjectsSection drag ordering', () => {
  it('renders requirement drafts as ordinary sessions without a draft folder', () => {
    const html = renderToStaticMarkup(
      createElement(SidebarProjectsSection, sidebarProjectProps({
        threads: [
          thread({
            id: 'thread-requirement',
            title: 'Checkout requirement',
            workspace: '/Users/zxy/project-a'
          })
        ]
      }))
    )

    expect(html).toContain('Checkout requirement')
    expect(html).not.toContain('sddDraftHistoryTitle')
    expect(html).not.toContain('sddDraftHistoryExpand')
  })

  it('restores saved workspace order and renders workspace headers as draggable', () => {
    const storageValue = JSON.stringify({
      version: 1,
      workspacePaths: ['/Users/zxy/project-b', '/Users/zxy/project-a'],
      threadIdsByScope: {}
    })
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key === SIDEBAR_ORDER_STORAGE_KEY ? storageValue : null,
      setItem: vi.fn()
    })
    try {
      const html = renderToStaticMarkup(
        createElement(SidebarProjectsSection, {
          threads: [],
          activeView: 'chat',
          activeThreadId: null,
          runtimeReady: true,
          threadListStatus: 'ready',
          threadListError: null,
          onRetryThreads: vi.fn(),
          onLoadMoreThreads: vi.fn(),
          threadListCursorByWorkspace: {},
          searchQuery: '',
          showArchived: false,
          workspaceRoot: '/Users/zxy/project-a',
          workspaceRoots: ['/Users/zxy/project-a', '/Users/zxy/project-b'],
          conversationRoot: '/Users/zxy/Documents/Kun',
          busy: false,
          watchTurnCompletion: {},
          unreadThreadIds: {},
          locale: 'en-US',
          onPickWorkspace: vi.fn(),
          onRemoveWorkspace: vi.fn(async () => undefined),
          onCreateThreadInWorkspace: vi.fn(),
          onSelectThread: vi.fn(),
          onRenameThread: vi.fn(async () => undefined),
          onPinThread: vi.fn(async () => undefined),
          onArchiveThread: vi.fn(async () => undefined),
          onDeleteThread: vi.fn(async () => undefined),
          onRestoreThread: vi.fn(async () => undefined),
          onSearchQueryChange: vi.fn(),
          onOpenSchedule: vi.fn(),
          t: (key: string) => key
        })
      )

      expect(html.indexOf('title="/Users/zxy/project-b"')).toBeLessThan(
        html.indexOf('title="/Users/zxy/project-a"')
      )
      expect(html.match(/draggable="true"/g)).toHaveLength(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('renders project-local virtual folders without changing thread workspaces', () => {
    const folderStorageValue = JSON.stringify({
      version: 1,
      foldersByScope: {
        '/users/zxy/project-a': [
          {
            id: 'folder-research',
            name: 'Research',
            threadIds: ['thread-a']
          },
          {
            id: 'folder-notes',
            name: 'Notes',
            parentId: 'folder-research',
            threadIds: ['thread-c']
          }
        ]
      }
    })
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key === SIDEBAR_FOLDERS_STORAGE_KEY ? folderStorageValue : null,
      setItem: vi.fn()
    })
    try {
      const html = renderToStaticMarkup(
        createElement(SidebarProjectsSection, {
          threads: [
            thread({
              id: 'thread-a',
              title: 'Folder thread',
              workspace: '/Users/zxy/project-a'
            }),
            thread({
              id: 'thread-b',
              title: 'Root thread',
              workspace: '/Users/zxy/project-a'
            }),
            thread({
              id: 'thread-c',
              title: 'Nested thread',
              workspace: '/Users/zxy/project-a'
            })
          ],
          activeView: 'chat',
          activeThreadId: null,
          runtimeReady: true,
          threadListStatus: 'ready',
          threadListError: null,
          onRetryThreads: vi.fn(),
          onLoadMoreThreads: vi.fn(),
          threadListCursorByWorkspace: {},
          searchQuery: '',
          showArchived: false,
          workspaceRoot: '/Users/zxy/project-a',
          workspaceRoots: ['/Users/zxy/project-a'],
          conversationRoot: '/Users/zxy/Documents/Kun',
          busy: false,
          watchTurnCompletion: {},
          unreadThreadIds: {},
          locale: 'en-US',
          onPickWorkspace: vi.fn(),
          onRemoveWorkspace: vi.fn(async () => undefined),
          onCreateThreadInWorkspace: vi.fn(),
          onSelectThread: vi.fn(),
          onRenameThread: vi.fn(async () => undefined),
          onPinThread: vi.fn(async () => undefined),
          onArchiveThread: vi.fn(async () => undefined),
          onDeleteThread: vi.fn(async () => undefined),
          onRestoreThread: vi.fn(async () => undefined),
          onSearchQueryChange: vi.fn(),
          onOpenSchedule: vi.fn(),
          t: (key: string) => key
        })
      )

      expect(html).toContain('title="Research"')
      expect(html).toContain('title="Notes"')
      expect(html.indexOf('title="Notes"')).toBeGreaterThan(html.indexOf('title="Research"'))
      expect(html.indexOf('Nested thread')).toBeGreaterThan(html.indexOf('title="Notes"'))
      expect(html.indexOf('Folder thread')).toBeGreaterThan(html.indexOf('Nested thread'))
      expect(html.indexOf('Root thread')).toBeGreaterThan(html.indexOf('Folder thread'))
      expect(html).toContain('sidebarFolderCreateChild')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('assigns a newly created thread directly to the selected folder', async () => {
    const folderStorageValue = JSON.stringify({
      version: 1,
      foldersByScope: {
        '/users/zxy/project-a': [{
          id: 'folder-research',
          name: 'Research',
          threadIds: []
        }]
      }
    })
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key === SIDEBAR_FOLDERS_STORAGE_KEY ? folderStorageValue : null,
      setItem
    })
    const onCreateThreadInWorkspace = vi.fn(async () => 'thread-new')
    let renderer: ReactTestRenderer | null = null
    try {
      await act(async () => {
        renderer = createRenderer(createElement(SidebarProjectsSection, {
          threads: [],
          activeView: 'chat',
          activeThreadId: null,
          runtimeReady: true,
          threadListStatus: 'ready',
          threadListError: null,
          onRetryThreads: vi.fn(),
          onLoadMoreThreads: vi.fn(),
          threadListCursorByWorkspace: {},
          searchQuery: '',
          showArchived: false,
          workspaceRoot: '/Users/zxy/project-a',
          workspaceRoots: ['/Users/zxy/project-a'],
          conversationRoot: '/Users/zxy/Documents/Kun',
          busy: false,
          watchTurnCompletion: {},
          unreadThreadIds: {},
          locale: 'en-US',
          onPickWorkspace: vi.fn(),
          onRemoveWorkspace: vi.fn(async () => undefined),
          onCreateThreadInWorkspace,
          onSelectThread: vi.fn(),
          onRenameThread: vi.fn(async () => undefined),
          onPinThread: vi.fn(async () => undefined),
          onArchiveThread: vi.fn(async () => undefined),
          onDeleteThread: vi.fn(async () => undefined),
          onRestoreThread: vi.fn(async () => undefined),
          onSearchQueryChange: vi.fn(),
          onOpenSchedule: vi.fn(),
          t: (key: string) => key
        }))
      })

      const newThreadButtons = renderer!.root.findAll((node) =>
        node.type === 'button' && node.props.title === 'sidebarWorkspaceNewThread'
      )
      expect(newThreadButtons).toHaveLength(2)
      await act(async () => {
        newThreadButtons[1]?.props.onClick({ stopPropagation: vi.fn() })
        await Promise.resolve()
      })

      expect(onCreateThreadInWorkspace).toHaveBeenCalledWith(
        '/Users/zxy/project-a',
        { forceNew: true }
      )
      const saved = setItem.mock.calls
        .filter(([key]) => key === SIDEBAR_FOLDERS_STORAGE_KEY)
        .at(-1)?.[1]
      expect(JSON.parse(String(saved)).foldersByScope['/users/zxy/project-a'][0].threadIds)
        .toEqual(['thread-new'])
    } finally {
      ;(renderer as ReactTestRenderer | null)?.unmount()
      vi.unstubAllGlobals()
    }
  })
})

describe('SidebarConversationsSection drag ordering', () => {
  it('starts collapsed, then restores saved conversation order and renders conversations as draggable', async () => {
    const storageValue = JSON.stringify({
      version: 1,
      workspacePaths: [],
      threadIdsByScope: {
        '/users/zxy/documents/kun': ['conversation-b', 'conversation-a']
      }
    })
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key === SIDEBAR_ORDER_STORAGE_KEY ? storageValue : null,
      setItem: vi.fn()
    })
    let renderer: ReactTestRenderer | null = null
    try {
      await act(async () => {
        renderer = createRenderer(
          createElement(SidebarConversationsSection, {
          threads: [
            thread({
              id: 'conversation-a',
              title: 'Conversation A',
              workspace: '/Users/zxy/Documents/Kun/conversation-a'
            }),
            thread({
              id: 'conversation-b',
              title: 'Conversation B',
              workspace: '/Users/zxy/Documents/Kun/conversation-b'
            })
          ],
          activeThreadId: null,
          runtimeReady: true,
          conversationRoot: '/Users/zxy/Documents/Kun',
          onNewConversation: vi.fn(),
          onSelectThread: vi.fn(),
          onRenameThread: vi.fn(async () => undefined),
          onPinThread: vi.fn(async () => undefined),
          onArchiveThread: vi.fn(async () => undefined),
          onDeleteThread: vi.fn(async () => undefined),
          onRestoreThread: vi.fn(async () => undefined),
          t: (key: string) => key
          })
        )
      })

      expect(renderer!.root.findAll((node) => node.props.title === 'Conversation A')).toHaveLength(0)
      expect(renderer!.root.findAll((node) => node.props.title === 'Conversation B')).toHaveLength(0)

      const sectionToggle = renderer!.root.find((node) =>
        node.type === 'button' && node.props.title === 'sidebarConversations'
      )
      await act(async () => {
        sectionToggle.props.onClick()
      })

      const conversationRows = renderer!.root.findAll((node) =>
        node.type === 'div' && node.props.draggable === true
      )
      expect(conversationRows.map((node) => node.props.title)).toEqual([
        'Conversation B',
        'Conversation A'
      ])
    } finally {
      ;(renderer as ReactTestRenderer | null)?.unmount()
      vi.unstubAllGlobals()
    }
  })
})

describe('SddDraftHistoryRows', () => {
  it('renders requirement draft history fully collapsed by default', () => {
    const html = renderToStaticMarkup(
      createElement(SddDraftHistoryRows, {
        items: [
          draft({ id: 'draft-1', title: 'Requirement 1' }),
          draft({ id: 'draft-2', title: 'Requirement 2' }),
          draft({ id: 'draft-3', title: 'Requirement 3' }),
          draft({ id: 'draft-4', title: 'Requirement 4' })
        ],
        activeDraftId: '',
        onOpen: vi.fn(),
        t: (key: string, opts?: Record<string, unknown>) =>
          key === 'sddDraftHistoryOpen'
            ? `Open ${String(opts?.title)}`
            : key === 'sddDraftHistoryShowMore'
              ? `Show ${String(opts?.count)} more`
              : key
      })
    )

    expect(html).toContain('sddDraftHistoryTitle')
    expect(html).toContain('sddDraftHistoryExpand')
    expect(html).toContain('>4<')
    expect(html).not.toContain('Requirement 1')
    expect(html).not.toContain('Requirement 2')
    expect(html).not.toContain('Requirement 3')
    expect(html).not.toContain('Requirement 4')
    expect(html).not.toContain('Open Requirement 1')
    expect(html).not.toContain('Show 1 more')
  })
})
