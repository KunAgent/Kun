import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create as createRenderer, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import type { SddDraftHistoryItem } from '../../sdd/sdd-draft-history'
import { SidebarConversationsSection } from './SidebarConversationsSection'
import {
  buildSidebarDraftWorkspacePaths,
  buildSidebarWorkspaceGroups,
  filterEmptySddAssistantThreadsFromSidebar,
  filterSddDraftHistoryItems,
  mergeSidebarWorkspaceGroupsWithDraftHistory,
  MoveThreadDialog,
  prioritizeSidebarThreadActivity,
  resolveThreadPreviewPosition,
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
    t: (key: string) => key,
    ...overrides
  }
}

describe('SidebarProjectsSection collapse memory', () => {
  it('restores collapsed projects and project-scoped folders from storage', () => {
    const storage = createSidebarTestStorage({
      [SIDEBAR_COLLAPSE_STORAGE_KEY]: JSON.stringify({
        version: 1,
        collapsedWorkspaceScopes: ['/users/zxy/project-a'],
        collapsedFolderIdsByScope: {
          '/users/zxy/project-b': ['folder-research']
        }
      }),
      [SIDEBAR_FOLDERS_STORAGE_KEY]: JSON.stringify({
        version: 1,
        foldersByScope: {
          '/users/zxy/project-b': [{
            id: 'folder-research',
            name: 'Research',
            parentId: null,
            threadIds: ['thread-folder']
          }]
        }
      })
    })
    vi.stubGlobal('localStorage', storage)
    try {
      const html = renderToStaticMarkup(createElement(SidebarProjectsSection, sidebarProjectProps({
        threads: [
          thread({ id: 'thread-collapsed-project', title: 'Hidden project thread', workspace: '/Users/zxy/project-a' }),
          thread({ id: 'thread-folder', title: 'Hidden folder thread', workspace: '/Users/zxy/project-b' }),
          thread({ id: 'thread-root', title: 'Visible root thread', workspace: '/Users/zxy/project-b' })
        ],
        workspaceRoots: ['/Users/zxy/project-a', '/Users/zxy/project-b']
      })))

      expect(html).toContain('title="/Users/zxy/project-a"')
      expect(html).not.toContain('Hidden project thread')
      expect(html).toContain('title="Research"')
      expect(html).not.toContain('Hidden folder thread')
      expect(html).toContain('Visible root thread')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('persists project and folder collapse when their rows are clicked', async () => {
    const storage = createSidebarTestStorage({
      [SIDEBAR_FOLDERS_STORAGE_KEY]: JSON.stringify({
        version: 1,
        foldersByScope: {
          '/users/zxy/project-a': [{
            id: 'folder-research',
            name: 'Research',
            parentId: null,
            threadIds: []
          }]
        }
      })
    })
    vi.stubGlobal('localStorage', storage)
    let renderer: ReactTestRenderer | null = null
    try {
      await act(async () => {
        renderer = createRenderer(createElement(SidebarProjectsSection, sidebarProjectProps()))
      })
      const projectRow = renderer!.root.find((node) =>
        node.type === 'div' && node.props.title === '/Users/zxy/project-a'
      )

      await act(async () => {
        projectRow.findAllByType('button')[0]?.props.onClick()
      })
      await act(async () => {
        const currentProjectRow = renderer!.root.find((node) =>
          node.type === 'div' && node.props.title === '/Users/zxy/project-a'
        )
        currentProjectRow.findAllByType('button')[0]?.props.onClick()
      })
      await act(async () => {
        const currentFolderRow = renderer!.root.find((node) =>
          node.type === 'div' && node.props.title === 'Research'
        )
        currentFolderRow.findAllByType('button')[0]?.props.onClick()
      })

      expect(JSON.parse(storage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) ?? '{}')).toEqual({
        version: 1,
        collapsedWorkspaceScopes: [],
        collapsedFolderIdsByScope: {
          '/users/zxy/project-a': ['folder-research']
        }
      })
    } finally {
      ;(renderer as ReactTestRenderer | null)?.unmount()
      vi.unstubAllGlobals()
    }
  })
})

describe('SidebarProjectsSection project expansion', () => {
  const expansionTranslation = (key: string, options?: Record<string, unknown>): string =>
    key === 'sidebarWorkspaceShowMore'
      ? `sidebarWorkspaceShowMore:${String(options?.count)}`
      : key

  it('does not use a global thread total as a project remaining count', () => {
    const cindyThreads = Array.from({ length: 6 }, (_, index) => thread({
      id: `cindy-${index + 1}`,
      title: `Cindy ${index + 1}`,
      workspace: '/Users/zxy/cindy',
      updatedAt: `2026-06-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`
    }))

    const html = renderToStaticMarkup(createElement(SidebarProjectsSection, sidebarProjectProps({
      threads: cindyThreads,
      workspaceRoot: '/Users/zxy/cindy',
      workspaceRoots: ['/Users/zxy/cindy', '/Users/zxy/other'],
      threadListCursorByWorkspace: {
        '/users/zxy/other': {
          workspaceKey: '/users/zxy/other',
          hasMore: false,
          total: 1040
        }
      },
      t: expansionTranslation
    })))

    expect(html).toContain('sidebarWorkspaceShowMore:1')
    expect(html).not.toContain('sidebarWorkspaceShowMore:1034')
  })

})

describe('SidebarProjectsSection groups', () => {
  it('reconciles linked worktrees into the primary project after Git discovery', async () => {
    const projectPath = '/Users/zxy/codeproject/ds_project/DeepSeek-GUI'
    const worktreePath = '/Users/zxy/codeproject/ds_project/DeepSeek-GUI.worktrees/kun-tui'
    const storage = createSidebarTestStorage()
    const getGitBranches = vi.fn(async (workspacePath: string) => ({
      ok: true as const,
      repositoryRoot: workspacePath,
      primaryRepositoryRoot: projectPath,
      currentBranch: workspacePath === worktreePath ? 'codex/kun-tui' : 'develop',
      branches: [],
      dirtyCount: 0
    }))
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('window', { kunGui: { getGitBranches } })
    let renderer: ReactTestRenderer | null = null
    try {
      await act(async () => {
        renderer = createRenderer(createElement(SidebarProjectsSection, sidebarProjectProps({
          threads: [thread({ id: 'thread-kun-tui', workspace: worktreePath })],
          workspaceRoot: worktreePath,
          workspaceRoots: [projectPath, worktreePath]
        })))
        await Promise.resolve()
      })

      const workspaceTitles = renderer!.root.findAll((node) =>
        node.type === 'div' && (node.props.title === projectPath || node.props.title === worktreePath)
      ).map((node) => node.props.title)
      expect(workspaceTitles).toEqual([projectPath])
      expect(JSON.stringify(renderer!.toJSON())).toContain('codex/kun-tui')
    } finally {
      ;(renderer as ReactTestRenderer | null)?.unmount()
      vi.unstubAllGlobals()
    }
  })

  it('keeps remembered code workspaces visible even when the runtime lists only one workspace', () => {
    const groups = buildSidebarWorkspaceGroups({
      threads: [thread({ id: 'reasonix-current', workspace: '/Users/zxy/project-a' })],
      searchQuery: '',
      showArchived: false,
      workspaceRoot: '/Users/zxy/project-a',
      conversationRoot: '',
      workspaceRoots: [
        '/Users/zxy/project-a',
        '/Users/zxy/project-b',
        '/Users/zxy/project-c'
      ]
    })

    expect(groups.map(([workspace]) => workspace)).toEqual([
      '/Users/zxy/project-a',
      '/Users/zxy/project-b',
      '/Users/zxy/project-c'
    ])
    expect(groups[1]?.[1]).toEqual([])
    expect(groups[2]?.[1]).toEqual([])
  })

  it('does not show registry-only empty workspaces while searching or viewing archives', () => {
    const base = {
      threads: [thread({ id: 'reasonix-current', workspace: '/Users/zxy/project-a' })],
      workspaceRoot: '/Users/zxy/project-a',
      conversationRoot: '',
      workspaceRoots: ['/Users/zxy/project-b']
    }

    expect(
      buildSidebarWorkspaceGroups({
        ...base,
        searchQuery: 'project',
        showArchived: false
      }).map(([workspace]) => workspace)
    ).toEqual(['/Users/zxy/project-a'])

    expect(
      buildSidebarWorkspaceGroups({
        ...base,
        searchQuery: '',
        showArchived: true
      }).map(([workspace]) => workspace)
    ).toEqual(['/Users/zxy/project-a'])
  })

  it('shows the default workspace while filtering write workspaces from code project groups', () => {
    const groups = buildSidebarWorkspaceGroups({
      threads: [
        thread({ id: 'code-current', workspace: '/Users/zxy/project-a' }),
        thread({ id: 'default-code', workspace: '/Users/zxy/.deepseekgui/default_workspace' }),
        thread({ id: 'write-assistant', workspace: '~/.deepseekgui/write_workspace' })
      ],
      searchQuery: '',
      showArchived: false,
      workspaceRoot: '/Users/zxy/project-a',
      conversationRoot: '',
      workspaceRoots: [
        '/Users/zxy/project-a',
        '/Users/zxy/.deepseekgui/default_workspace',
        '~/.deepseekgui/write_workspace'
      ]
    })

    expect(groups.map(([workspace]) => workspace)).toEqual([
      '/Users/zxy/project-a',
      '/Users/zxy/.deepseekgui/default_workspace'
    ])
    expect(groups[1]?.[1].map((item) => item.id)).toEqual(['default-code'])
  })

  it('merges default workspace aliases into one sidebar group', () => {
    const groups = buildSidebarWorkspaceGroups({
      threads: [
        thread({ id: 'default-short', workspace: '~/.deepseekgui/default_workspace' }),
        thread({ id: 'default-absolute', workspace: 'C:\\Users\\zxy\\.deepseekgui\\default_workspace' })
      ],
      searchQuery: '',
      showArchived: false,
      workspaceRoot: 'C:\\Users\\zxy\\.deepseekgui\\default_workspace',
      conversationRoot: '',
      workspaceRoots: [
        '~/.deepseekgui/default_workspace',
        'C:\\Users\\zxy\\.deepseekgui\\default_workspace'
      ]
    })

    expect(groups).toHaveLength(1)
    expect(groups[0]?.[0]).toBe('C:\\Users\\zxy\\.deepseekgui\\default_workspace')
    expect(groups[0]?.[1].map((item) => item.id)).toEqual(['default-short', 'default-absolute'])
  })

  it('maps remembered worktree roots to their source project without a registry entry', () => {
    const projectPath = '/Users/zxy/code/Kook-VoiceShop-Bot'
    const worktreePath = '/Users/zxy/.kun/worktrees/ab12/Kook-VoiceShop-Bot'
    const groups = buildSidebarWorkspaceGroups({
      threads: [thread({ id: 'thread-worktree', workspace: worktreePath })],
      searchQuery: '',
      showArchived: false,
      workspaceRoot: projectPath,
      conversationRoot: '',
      workspaceRoots: [projectPath, worktreePath]
    })

    expect(groups.map(([workspace]) => workspace)).toEqual([projectPath])
    expect(groups[0]?.[1].map((item) => item.id)).toEqual(['thread-worktree'])
  })

  it('uses the source project as the selected group for a UUID plan worktree', () => {
    const projectPath = '/Users/zxy/codeproject/ds_project/DeepSeek-GUI'
    const worktreePath = '/Users/zxy/.kun/worktrees/1b33f677-9bdf-435f-921e-125d029c1064/DeepSeek-GUI'
    const groups = buildSidebarWorkspaceGroups({
      threads: [thread({ id: 'thread-plan-worktree', workspace: worktreePath })],
      searchQuery: '',
      showArchived: false,
      workspaceRoot: worktreePath,
      conversationRoot: '',
      workspaceRoots: [projectPath, worktreePath]
    })

    expect(groups).toEqual([[projectPath, [expect.objectContaining({ id: 'thread-plan-worktree' })]]])
  })

  it('groups a linked worktree outside the Kun directory from discovered Git metadata', () => {
    const projectPath = '/Users/zxy/codeproject/ds_project/DeepSeek-GUI'
    const worktreePath = '/Users/zxy/codeproject/ds_project/DeepSeek-GUI.worktrees/kun-tui'
    const groups = buildSidebarWorkspaceGroups({
      threads: [thread({ id: 'thread-kun-tui', workspace: worktreePath })],
      searchQuery: '',
      showArchived: false,
      workspaceRoot: worktreePath,
      conversationRoot: '',
      workspaceRoots: [projectPath, worktreePath],
      threadWorktrees: {
        [`git:${worktreePath.toLowerCase()}`]: {
          projectPath,
          worktreePath,
          branch: 'codex/kun-tui'
        }
      }
    })

    expect(groups.map(([workspace]) => workspace)).toEqual([projectPath])
    expect(groups[0]?.[1].map((item) => item.id)).toEqual(['thread-kun-tui'])
  })

  it('shows worktree threads under their source project instead of a separate worktree project', () => {
    const projectPath = '/Users/zxy/code/Kook-VoiceShop-Bot'
    const worktreePath = '/Users/zxy/.kun/worktrees/0ff7/Kook-VoiceShop-Bot'
    const threadWorktrees = {
      'thread-worktree': {
        projectPath,
        worktreePath
      }
    }
    const groups = buildSidebarWorkspaceGroups({
      threads: [
        thread({ id: 'thread-main', workspace: projectPath }),
        thread({ id: 'thread-worktree', workspace: worktreePath })
      ],
      searchQuery: '',
      showArchived: false,
      workspaceRoot: projectPath,
      conversationRoot: '',
      workspaceRoots: [
        projectPath,
        worktreePath
      ],
      threadWorktrees
    })

    expect(groups.map(([workspace]) => workspace)).toEqual([projectPath])
    expect(groups[0]?.[1].map((item) => item.id)).toEqual(['thread-main', 'thread-worktree'])

    const workspaces = buildSidebarDraftWorkspacePaths({
      threads: [thread({ id: 'thread-worktree', workspace: worktreePath })],
      workspaceRoot: projectPath,
      workspaceRoots: [projectPath, worktreePath],
      threadWorktrees
    })
    expect(workspaces).toEqual([projectPath])
  })

  it('loads requirement histories from all known project workspaces while searching', () => {
    const workspaces = buildSidebarDraftWorkspacePaths({
      threads: [
        thread({ id: 'code-current', workspace: '/Users/zxy/project-a' }),
        thread({ id: 'write-assistant', workspace: '~/.deepseekgui/write_workspace' })
      ],
      workspaceRoot: '/Users/zxy/project-a',
      workspaceRoots: [
        '/Users/zxy/project-a',
        '/Users/zxy/project-b',
        '~/.deepseekgui/write_workspace'
      ]
    })

    expect(workspaces).toEqual([
      '/Users/zxy/project-a',
      '/Users/zxy/project-b'
    ])
  })

  it('excludes conversation workspaces from project groups', () => {
    // 工作目录落在对话工作目录根下的会话不进「项目」分组。
    const groups = buildSidebarWorkspaceGroups({
      threads: [
        thread({ id: 'project-thread', workspace: '/Users/zxy/project-a' }),
        thread({ id: 'conversation-thread', workspace: '/Users/zxy/Documents/Kun/20260626-153012' })
      ],
      searchQuery: '',
      showArchived: false,
      workspaceRoot: '/Users/zxy/project-a',
      conversationRoot: '/Users/zxy/Documents/Kun',
      workspaceRoots: ['/Users/zxy/project-a']
    })

    expect(groups.map(([workspace]) => workspace)).toEqual(['/Users/zxy/project-a'])
    expect(groups[0]?.[1].map((item) => item.id)).toEqual(['project-thread'])
  })

  it('excludes internal design workspaces from project groups and remembered roots', () => {
    const groups = buildSidebarWorkspaceGroups({
      threads: [
        thread({ id: 'project-thread', workspace: '/Users/zxy/project-a' }),
        thread({
          id: 'design-assistant',
          title: 'Design Assistant',
          workspace: '/Users/zxy/.kun/design-workspace'
        })
      ],
      searchQuery: '',
      showArchived: false,
      workspaceRoot: '/Users/zxy/.kun/design-workspace',
      conversationRoot: '',
      workspaceRoots: [
        '/Users/zxy/project-a',
        '/Users/zxy/.kun/design-workspace'
      ]
    })

    expect(groups.map(([workspace]) => workspace)).toEqual(['/Users/zxy/project-a'])
    expect(groups[0]?.[1].map((item) => item.id)).toEqual(['project-thread'])
  })

  it('merges requirement-only search matches into displayed groups', () => {
    const groups = buildSidebarWorkspaceGroups({
      threads: [thread({ id: 'reasonix-current', workspace: '/Users/zxy/project-a' })],
      searchQuery: 'checkout',
      showArchived: false,
      workspaceRoot: '/Users/zxy/project-a',
      conversationRoot: '',
      workspaceRoots: ['/Users/zxy/project-a', '/Users/zxy/project-b']
    })
    const filteredDraftHistory = {
      '/Users/zxy/project-b': [draft({
        id: 'draft-checkout',
        title: 'Checkout requirement',
        workspaceRoot: '/Users/zxy/project-b'
      })]
    }

    const displayGroups = mergeSidebarWorkspaceGroupsWithDraftHistory({
      groups,
      draftHistoryByWorkspace: filteredDraftHistory,
      workspaceRoot: '/Users/zxy/project-a'
    })

    expect(displayGroups.map(([workspace]) => workspace)).toEqual([
      '/Users/zxy/project-a',
      '/Users/zxy/project-b'
    ])
  })

  it('filters requirement drafts by title, path, workspace, and content', () => {
    const items = [
      draft({ id: 'draft-login', title: 'Login requirement', searchText: 'Support passkey sign-in.' }),
      draft({ id: 'draft-export', title: 'Export requirement', searchText: 'Download reports as CSV.' })
    ]

    expect(filterSddDraftHistoryItems(items, 'passkey', '/tmp/app').map((item) => item.id)).toEqual(['draft-login'])
    expect(filterSddDraftHistoryItems(items, 'export', '/tmp/app').map((item) => item.id)).toEqual(['draft-export'])
    expect(filterSddDraftHistoryItems(items, 'tmp', '/tmp/app')).toHaveLength(2)
  })

  it('filters empty Requirement AI backing threads recorded in draft history', () => {
    const hidden = thread({
      id: 'thread-sdd-empty',
      title: 'Checkout requirement',
      workspace: '/tmp/app'
    })
    const visibleNormal = thread({
      id: 'thread-normal',
      title: 'Checkout requirement',
      workspace: '/tmp/app'
    })
    const visibleWithTurn = thread({
      id: 'thread-sdd-active-build',
      title: 'Checkout requirement',
      workspace: '/tmp/app',
      latestTurnId: 'turn-1'
    })
    const items = [
      draft({
        id: 'draft-checkout',
        title: 'Checkout requirement',
        chatThreadIds: ['thread-sdd-empty', 'thread-sdd-active-build']
      })
    ]

    expect(
      filterEmptySddAssistantThreadsFromSidebar([hidden, visibleNormal, visibleWithTurn], items)
        .map((item) => item.id)
    ).toEqual(['thread-normal', 'thread-sdd-active-build'])
  })

  it('prioritizes running threads, then unread threads, while preserving each bucket order', () => {
    const base = [
      thread({ id: 'read-newer', workspace: '/tmp/app' }),
      thread({ id: 'running-status', workspace: '/tmp/app', status: 'running' }),
      thread({ id: 'unread-first', workspace: '/tmp/app' }),
      thread({ id: 'running-watched', workspace: '/tmp/app' }),
      thread({ id: 'unread-second', workspace: '/tmp/app' }),
      thread({ id: 'read-older', workspace: '/tmp/app' })
    ]
    const context = {
      activeThreadId: null,
      busy: false,
      watchTurnCompletion: { 'running-watched': true },
      unreadThreadIds: { 'unread-first': true, 'unread-second': true }
    }

    expect(prioritizeSidebarThreadActivity(base, context).map((item) => item.id)).toEqual([
      'running-status',
      'running-watched',
      'unread-first',
      'unread-second',
      'read-newer',
      'read-older'
    ])
  })

  it('gives running precedence over unread and treats the active thread as read when settled', () => {
    const running = thread({ id: 'running', workspace: '/tmp/app', status: 'running' })
    const active = thread({ id: 'active', workspace: '/tmp/app' })
    const context = {
      activeThreadId: 'active',
      busy: false,
      watchTurnCompletion: {},
      unreadThreadIds: { running: true, active: true }
    }

    expect(sidebarThreadActivity(running, context)).toBe('running')
    expect(sidebarThreadActivity(active, context)).toBe('read')
  })

  it('recognizes an active busy thread as running and returns a viewed thread below running work', () => {
    const running = thread({ id: 'running', workspace: '/tmp/app' })
    const viewed = thread({ id: 'viewed', workspace: '/tmp/app' })
    const context = {
      activeThreadId: 'running',
      busy: true,
      watchTurnCompletion: {},
      unreadThreadIds: { viewed: true }
    }

    expect(sidebarThreadActivity(running, context)).toBe('running')
    expect(prioritizeSidebarThreadActivity([viewed, running], {
      ...context,
      unreadThreadIds: {}
    }).map((item) => item.id)).toEqual(['running', 'viewed'])
  })

  it('sorts pinned threads before newer unpinned threads', () => {
    const sorted = sortSidebarThreads([
      thread({
        id: 'recent',
        workspace: '/tmp/app',
        updatedAt: '2026-06-03T00:00:00.000Z'
      }),
      thread({
        id: 'pinned-old',
        workspace: '/tmp/app',
        updatedAt: '2026-06-01T00:00:00.000Z',
        pinned: true
      }),
      thread({
        id: 'older',
        workspace: '/tmp/app',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })
    ])

    expect(sorted.map((item) => item.id)).toEqual(['pinned-old', 'recent', 'older'])
  })
})
