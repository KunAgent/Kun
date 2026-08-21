import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import { SidebarConversationsSection } from './SidebarConversationsSection'
import { SidebarProjectsSection } from './SidebarProjectsSection'
import { SIDEBAR_COLLAPSE_STORAGE_KEY } from './sidebar-collapse'
import { SIDEBAR_FOLDERS_STORAGE_KEY } from './sidebar-folders'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string) => key
  })
}))

function thread(id: string, workspace: string, status: 'idle' | 'running' = 'idle'): NormalizedThread {
  return {
    id,
    title: id,
    workspace,
    status,
    updatedAt: '2026-08-19T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent'
  }
}

function storage(initial: Record<string, string>): Storage {
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

function projectProps(threads: NormalizedThread[], workspaceRoot = '/Users/zxy/project-a') {
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
    workspaceRoot,
    workspaceRoots: [workspaceRoot],
    conversationRoot: '/Users/zxy/Documents/Kun',
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
    t: (key: string) => key
  }
}

describe('sidebar running awareness', () => {
  it('keeps the project title and collapsed workspace folder neutral while its thread runs', () => {
    vi.stubGlobal('localStorage', storage({
      [SIDEBAR_COLLAPSE_STORAGE_KEY]: JSON.stringify({
        version: 1,
        collapsedWorkspaceScopes: ['/users/zxy/project-a'],
        collapsedFolderIdsByScope: {}
      })
    }))
    const html = renderToStaticMarkup(createElement(
      SidebarProjectsSection,
      projectProps([thread('running-project-thread', '/Users/zxy/project-a', 'running')])
    ))

    expect(html).toContain('aria-label="/Users/zxy/project-a"')
    expect(html).not.toContain('aria-label="/Users/zxy/project-a - sidebarThreadRunning"')
    expect(html).toContain('aria-label="sidebarProjects"')
    expect(html).not.toContain('aria-label="sidebarProjects - sidebarThreadRunning"')
    expect(html).not.toContain('running-project-thread</span>')
    vi.unstubAllGlobals()
  })

  it('propagates nested running activity to a collapsed parent folder', () => {
    vi.stubGlobal('localStorage', storage({
      [SIDEBAR_FOLDERS_STORAGE_KEY]: JSON.stringify({
        version: 1,
        foldersByScope: {
          '/users/zxy/project-a': [
            { id: 'parent', name: 'Parent', parentId: null, threadIds: [] },
            { id: 'child', name: 'Child', parentId: 'parent', threadIds: ['nested-running'] }
          ]
        }
      }),
      [SIDEBAR_COLLAPSE_STORAGE_KEY]: JSON.stringify({
        version: 1,
        collapsedWorkspaceScopes: [],
        collapsedFolderIdsByScope: { '/users/zxy/project-a': ['parent'] }
      })
    }))
    const html = renderToStaticMarkup(createElement(
      SidebarProjectsSection,
      projectProps([thread('nested-running', '/Users/zxy/project-a', 'running')])
    ))

    expect(html).toContain('aria-label="sidebarFolderAriaLabel - sidebarThreadRunning"')
    expect(html).not.toContain('title="Child"')
    vi.unstubAllGlobals()
  })

  it('marks the collapsed conversation group independently of row filtering', () => {
    vi.stubGlobal('localStorage', storage({}))
    const noOp = vi.fn()
    const html = renderToStaticMarkup(createElement(SidebarConversationsSection, {
      threads: [thread('running-conversation', '/Users/zxy/Documents/Kun', 'running')],
      activeThreadId: null,
      runtimeReady: true,
      conversationRoot: '/Users/zxy/Documents/Kun',
      onNewConversation: noOp,
      onSelectThread: noOp,
      onRenameThread: vi.fn(async () => undefined),
      onPinThread: vi.fn(async () => undefined),
      onArchiveThread: vi.fn(async () => undefined),
      onDeleteThread: vi.fn(async () => undefined),
      onRestoreThread: vi.fn(async () => undefined),
      t: (key: string) => key
    }))

    expect(html).toContain('aria-label="sidebarConversations - sidebarThreadRunning"')
    expect(html).not.toContain('running-conversation</span>')
    vi.unstubAllGlobals()
  })
})
