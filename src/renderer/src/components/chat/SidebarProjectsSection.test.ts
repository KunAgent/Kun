import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import type { SddDraftHistoryItem } from '../../sdd/sdd-draft-history'
import {
  buildSidebarThreadMoveTargets,
  buildSidebarDraftWorkspacePaths,
  buildSidebarWorkspaceGroups,
  filterEmptySddAssistantThreadsFromSidebar,
  filterSddDraftHistoryItems,
  isSidebarThreadMoveBlocked,
  mergeSidebarWorkspaceGroupsWithDraftHistory,
  MoveThreadDialog,
  resolveThreadPreviewPosition,
  sortSidebarThreads,
  SddDraftHistoryRows,
  SidebarActionDialog,
  ThreadRow,
  ThreadRenameDialog
} from './SidebarProjectsSection'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
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

describe('SidebarProjectsSection groups', () => {
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

describe('sidebar thread move helpers', () => {
  it('excludes the current workspace from move targets', () => {
    const groups = buildSidebarWorkspaceGroups({
      threads: [thread({ id: 'thread-a', workspace: '/Users/zxy/project-a' })],
      searchQuery: '',
      showArchived: false,
      workspaceRoot: '/Users/zxy/project-a',
      conversationRoot: '',
      workspaceRoots: ['/Users/zxy/project-a', '/Users/zxy/project-b']
    })

    expect(
      buildSidebarThreadMoveTargets({
        thread: thread({ id: 'thread-a', workspace: '/Users/zxy/project-a' }),
        groups
      })
    ).toEqual(['/Users/zxy/project-b'])
  })

  it('includes remembered empty project workspaces as move targets', () => {
    const groups = buildSidebarWorkspaceGroups({
      threads: [thread({ id: 'thread-a', workspace: '/Users/zxy/project-a' })],
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

    expect(
      buildSidebarThreadMoveTargets({
        thread: thread({ id: 'thread-a', workspace: '/Users/zxy/project-a' }),
        groups
      })
    ).toEqual(['/Users/zxy/project-b', '/Users/zxy/project-c'])
  })

  it('blocks moving a running thread', () => {
    expect(
      isSidebarThreadMoveBlocked({
        thread: thread({ id: 'thread-running', workspace: '/Users/zxy/project-a', status: 'running' })
      })
    ).toBe(true)
  })

  it('blocks moving a watched thread', () => {
    expect(
      isSidebarThreadMoveBlocked({
        thread: thread({ id: 'thread-watch', workspace: '/Users/zxy/project-a' }),
        watchTurnCompletion: { 'thread-watch': true }
      })
    ).toBe(true)
  })

  it('blocks moving the active thread while globally busy', () => {
    expect(
      isSidebarThreadMoveBlocked({
        thread: thread({ id: 'thread-active', workspace: '/Users/zxy/project-a' }),
        activeThreadId: 'thread-active',
        busy: true
      })
    ).toBe(true)
  })

  it('blocks moving a worktree-linked thread', () => {
    expect(
      isSidebarThreadMoveBlocked({
        thread: thread({ id: 'thread-worktree', workspace: '/Users/zxy/.kun/worktrees/abcd/project-a' }),
        worktreeRecord: {
          projectPath: '/Users/zxy/project-a',
          worktreePath: '/Users/zxy/.kun/worktrees/abcd/project-a'
        }
      })
    ).toBe(true)
  })
})

describe('ThreadRenameDialog', () => {
  it('renders an in-app rename form with the current thread title prefilled', () => {
    const html = renderToStaticMarkup(
      createElement(ThreadRenameDialog, {
        state: {
          thread: thread({
            id: 'thr_rename',
            title: 'Build rename dialog',
            workspace: '/Users/zxy/project-a'
          }),
          value: 'Build rename dialog',
          submitting: false
        },
        onClose: vi.fn(),
        onValueChange: vi.fn(),
        onSubmit: vi.fn(),
        t: (key: string) => key
      })
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('sidebarThreadRename')
    expect(html).toContain('value="Build rename dialog"')
    expect(html).toContain('type="submit" disabled=""')
  })
})

describe('SidebarActionDialog', () => {
  it('uses an opaque card and stronger backdrop so sidebar controls cannot bleed through', () => {
    const html = renderToStaticMarkup(
      createElement(SidebarActionDialog, {
        state: {
          title: 'Remove AI training?',
          description: 'This removes the project from Kun.',
          detail: 'Files on disk will not be deleted.',
          confirmLabel: 'Remove',
          danger: true,
          submitting: false,
          onConfirm: async () => undefined
        },
        onClose: vi.fn(),
        onConfirm: vi.fn(),
        t: (key: string) => key
      })
    )

    expect(html).toContain('bg-slate-950/28')
    expect(html).toContain('dark:bg-black/45')
    expect(html).toContain('bg-[var(--surface-3)]')
    expect(html).not.toContain('bg-ds-elevated')
    expect(html).not.toContain('bg-ds-card/96')
  })
})

describe('MoveThreadDialog', () => {
  it('renders the target project picker', () => {
    const html = renderToStaticMarkup(
      createElement(MoveThreadDialog, {
        state: {
          thread: thread({
            id: 'thr_move',
            title: 'Move me',
            workspace: '/Users/zxy/project-a'
          }),
          targets: ['/Users/zxy/project-b'],
          targetWorkspace: null,
          submitting: false
        },
        onClose: vi.fn(),
        onPickTarget: vi.fn(),
        onConfirm: vi.fn(async () => undefined),
        t: (key: string) => key
      })
    )

    expect(html).toContain('sidebarThreadMovePickerTitle')
    expect(html).toContain('/Users/zxy/project-b')
    expect(html).toContain('project-b')
  })

  it('renders the empty state when no targets are available', () => {
    const html = renderToStaticMarkup(
      createElement(MoveThreadDialog, {
        state: {
          thread: thread({
            id: 'thr_move_empty',
            title: 'Move me',
            workspace: '/Users/zxy/project-a'
          }),
          targets: [],
          targetWorkspace: null,
          submitting: false
        },
        onClose: vi.fn(),
        onPickTarget: vi.fn(),
        onConfirm: vi.fn(async () => undefined),
        t: (key: string) => key
      })
    )

    expect(html).toContain('sidebarThreadMoveNoTargets')
  })

  it('shows the metadata-only scope before confirming a move', () => {
    const html = renderToStaticMarkup(
      createElement(MoveThreadDialog, {
        state: {
          thread: thread({
            id: 'thr_move_confirm',
            title: 'Move me',
            workspace: '/Users/zxy/project-a'
          }),
          targets: ['/Users/zxy/project-b'],
          targetWorkspace: '/Users/zxy/project-b',
          submitting: false
        },
        onClose: vi.fn(),
        onPickTarget: vi.fn(),
        onConfirm: vi.fn(async () => undefined),
        t: (key: string) => key
      })
    )

    expect(html).toContain('sidebarThreadMoveDialogDetail')
    expect(html).toContain('sidebarThreadMoveMetadataOnlyDetail')
    expect(html).toContain('sidebarThreadMoveConfirmButton')
  })
})

describe('ThreadRow', () => {
  it('anchors the preview beside the row instead of following the pointer', () => {
    expect(
      resolveThreadPreviewPosition(
        { left: 20, right: 300, top: 80, height: 34 } as DOMRect,
        { width: 900, height: 600 }
      )
    ).toEqual({ x: 310, y: 69 })
  })

  it('flips the preview left when the row is close to the right edge', () => {
    expect(
      resolveThreadPreviewPosition(
        { left: 700, right: 780, top: 80, height: 34 } as DOMRect,
        { width: 900, height: 600 }
      )
    ).toEqual({ x: 370, y: 69 })
  })

  it('renders the worktree badge before the truncated title and outside the action buttons', () => {
    const html = renderToStaticMarkup(
      createElement(ThreadRow, {
        thread: thread({
          id: 'thr_worktree',
          title: 'Very long archived worktree thread title',
          workspace: '/Users/zxy/project-a',
          archived: true
        }),
        worktreeRecord: {
          projectPath: '/Users/zxy/project-a',
          worktreePath: '/Users/zxy/.kun/worktrees/abcd/project-a',
          branch: 'feature/layout-fix'
        },
        active: false,
        deleting: false,
        locale: 'zh-CN',
        showRunning: false,
        showUnread: false,
        onSelect: vi.fn(),
        onContextMenu: vi.fn(),
        onPreviewOpen: vi.fn(),
        onPreviewClose: vi.fn(),
        onPin: vi.fn(),
        onRename: vi.fn(),
        onArchive: vi.fn(),
        onDelete: vi.fn(),
        onRestore: vi.fn()
      })
    )

    const rowButtonStart = html.indexOf('<button')
    const rowButtonEnd = html.indexOf('</button>', rowButtonStart)
    const rowButtonHtml = html.slice(rowButtonStart, rowButtonEnd)
    const actionsHtml = html.slice(rowButtonEnd)

    expect(rowButtonHtml.indexOf('aria-label="Worktree feature/layout-fix"')).toBeGreaterThan(-1)
    expect(rowButtonHtml.lastIndexOf('Very long archived worktree thread title')).toBeGreaterThan(-1)
    expect(rowButtonHtml.indexOf('aria-label="Worktree feature/layout-fix"')).toBeLessThan(
      rowButtonHtml.lastIndexOf('Very long archived worktree thread title')
    )
    expect(rowButtonHtml).toContain('min-w-[3.75rem]')
    expect(actionsHtml).toContain('sidebarThreadRestore')
    expect(actionsHtml).toContain('sidebarThreadDelete')
    expect(actionsHtml).not.toContain('Worktree feature/layout-fix')
  })

  it('renders pinned state and an unpin action for pinned threads', () => {
    const html = renderToStaticMarkup(
      createElement(ThreadRow, {
        thread: thread({
          id: 'thr_pinned',
          title: 'Pinned thread',
          workspace: '/Users/zxy/project-a',
          pinned: true
        }),
        active: false,
        deleting: false,
        locale: 'en-US',
        showRunning: false,
        showUnread: false,
        onSelect: vi.fn(),
        onContextMenu: vi.fn(),
        onPreviewOpen: vi.fn(),
        onPreviewClose: vi.fn(),
        onPin: vi.fn(),
        onRename: vi.fn(),
        onArchive: vi.fn(),
        onDelete: vi.fn(),
        onRestore: vi.fn()
      })
    )

    expect(html).toContain('sidebarThreadPinned')
    expect(html).toContain('sidebarThreadUnpin')
    expect(html).toContain('bg-[color-mix(in_srgb,var(--ds-sidebar-row-active)_72%,var(--ds-accent)_28%)]')
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
