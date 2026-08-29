import { createElement, type ReactElement } from 'react'
import { act, create as createRenderer, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import { SidebarProjectsSection } from './SidebarProjectsSection'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, opts?: Record<string, unknown>) =>
      key === 'sidebarWorkspaceShowMore' ? `sidebarWorkspaceShowMore:${String(opts?.count)}` : key
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
    ...(overrides.status ? { status: overrides.status } : {})
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
    t: (key: string, opts?: Record<string, unknown>) =>
      key === 'sidebarWorkspaceShowMore' ? `sidebarWorkspaceShowMore:${String(opts?.count)}` : key,
    ...overrides
  }
}

type TestRenderer = { root: ReactTestRenderer['root']; unmount: () => void; toJSON: () => unknown; update: (node: ReactElement) => void }

let activeRenderer: TestRenderer | null = null

async function renderSidebar(props: Record<string, unknown>): Promise<void> {
  activeRenderer?.unmount()
  await act(async () => {
    activeRenderer = createRenderer(createElement(
      SidebarProjectsSection,
      sidebarProjectProps(props)
    )) as unknown as TestRenderer
  })
}

async function rerenderSidebar(props: Record<string, unknown>): Promise<void> {
  if (!activeRenderer) throw new Error('sidebar not rendered')
  await act(async () => {
    activeRenderer?.update(createElement(SidebarProjectsSection, sidebarProjectProps(props)))
  })
}

function projectThreads(count: number, workspace = '/Users/zxy/cindy'): NormalizedThread[] {
  return Array.from({ length: count }, (_, index) => thread({
    id: `cindy-${index + 1}`,
    title: `Cindy ${index + 1}`,
    workspace,
    // Newest first: "Cindy 1" is the most recent thread and stays in the
    // initial visible batch, while higher numbers hide until expanded.
    updatedAt: `2026-06-${String(28 - index).padStart(2, '0')}T00:00:00.000Z`
  }))
}

function flattenLabel(node: { props: Record<string, unknown> }): string {
  const ariaLabel = node.props['aria-label']
  if (typeof ariaLabel === 'string' && ariaLabel) return ariaLabel
  const children = node.props.children
  if (typeof children === 'string') return children
  if (Array.isArray(children)) {
    return children.map((child) => {
      if (typeof child === 'string') return child
      const text = (child as { props?: Record<string, unknown> } | null)?.props?.children
      return typeof text === 'string' ? text : ''
    }).join('')
  }
  return ''
}

function findButtonsByLabel(label: string): Array<{ props: Record<string, unknown> }> {
  if (!activeRenderer) throw new Error('sidebar not rendered')
  return activeRenderer.root.findAll((node) => node.type === 'button')
    .filter((node) => flattenLabel(node) === label)
    .map((node) => ({ props: node.props }))
}

async function clickButton(label: string): Promise<void> {
  const buttons = findButtonsByLabel(label)
  expect(buttons.length, `button not found: ${label}`).toBeGreaterThan(0)
  await act(async () => { (buttons[0] as { props: { onClick: () => void } }).props.onClick() })
}

function outputJson(): string {
  if (!activeRenderer) throw new Error('sidebar not rendered')
  return JSON.stringify(activeRenderer.toJSON())
}

describe('SidebarProjectsSection project page auto-load', () => {
  const unknownCursor = {
    '/users/zxy/cindy': {
      workspaceKey: '/users/zxy/cindy', mode: 'active' as const, status: 'unknown' as const, hasMore: true
    }
  }

  it('loads an expanded empty project once', async () => {
    const onLoadMoreThreads = vi.fn()
    await renderSidebar({ workspaceRoot: '/Users/zxy/cindy', workspaceRoots: ['/Users/zxy/cindy'], threadListCursorByWorkspace: unknownCursor, onLoadMoreThreads })
    expect(onLoadMoreThreads).toHaveBeenCalledTimes(1)
    expect(onLoadMoreThreads).toHaveBeenCalledWith('/Users/zxy/cindy')
    await rerenderSidebar({ workspaceRoot: '/Users/zxy/cindy', workspaceRoots: ['/Users/zxy/cindy'], threadListCursorByWorkspace: { ...unknownCursor }, onLoadMoreThreads })
    expect(onLoadMoreThreads).toHaveBeenCalledTimes(1)
  })

  it('does not load projects with local threads, complete pages, searches, or an unsettled list', async () => {
    const onLoadMoreThreads = vi.fn()
    await renderSidebar({ threads: projectThreads(3), workspaceRoot: '/Users/zxy/cindy', workspaceRoots: ['/Users/zxy/cindy'], threadListCursorByWorkspace: unknownCursor, onLoadMoreThreads })
    expect(onLoadMoreThreads).not.toHaveBeenCalled()
    await renderSidebar({ workspaceRoot: '/Users/zxy/cindy', workspaceRoots: ['/Users/zxy/cindy'], threadListCursorByWorkspace: { '/users/zxy/cindy': { ...unknownCursor['/users/zxy/cindy'], status: 'complete', hasMore: false } }, onLoadMoreThreads })
    expect(onLoadMoreThreads).not.toHaveBeenCalled()
    await renderSidebar({ workspaceRoot: '/Users/zxy/cindy', workspaceRoots: ['/Users/zxy/cindy'], searchQuery: 'cindy', threadListCursorByWorkspace: unknownCursor, onLoadMoreThreads })
    expect(onLoadMoreThreads).not.toHaveBeenCalled()
    await renderSidebar({ workspaceRoot: '/Users/zxy/cindy', workspaceRoots: ['/Users/zxy/cindy'], threadListStatus: 'loading', threadListCursorByWorkspace: unknownCursor, onLoadMoreThreads })
    expect(onLoadMoreThreads).not.toHaveBeenCalled()
  })

  it('retries after the project is collapsed and expanded again', async () => {
    const onLoadMoreThreads = vi.fn()
    await renderSidebar({ workspaceRoot: '/Users/zxy/cindy', workspaceRoots: ['/Users/zxy/cindy'], threadListCursorByWorkspace: unknownCursor, onLoadMoreThreads })
    const projectButton = findButtonsByLabel('/Users/zxy/cindy')[0]
    await act(async () => { (projectButton as { props: { onClick: () => void } }).props.onClick() })
    await act(async () => { (findButtonsByLabel('/Users/zxy/cindy')[0] as { props: { onClick: () => void } }).props.onClick() })
    expect(onLoadMoreThreads).toHaveBeenCalledTimes(2)
  })
})

describe('SidebarProjectsSection expansion collapse integration', () => {
  it('collapses mid-expansion without loading the remote page', async () => {
    const onLoadMoreThreads = vi.fn()
    await renderSidebar({
      threads: projectThreads(6),
      workspaceRoot: '/Users/zxy/cindy',
      workspaceRoots: ['/Users/zxy/cindy'],
      threadListCursorByWorkspace: {
        '/users/zxy/cindy': {
          workspaceKey: '/users/zxy/cindy',
          mode: 'active',
          status: 'unknown',
          hasMore: true
        }
      },
      onLoadMoreThreads
    })

    await clickButton('sidebarWorkspaceShowMore:1')
    expect(outputJson()).toContain('Cindy 6')
    expect(findButtonsByLabel('sidebarWorkspaceLoadMore').length).toBe(1)
    expect(findButtonsByLabel('sidebarWorkspaceShowLess').length).toBe(1)

    await clickButton('sidebarWorkspaceShowLess')
    expect(outputJson()).not.toContain('Cindy 6')
    expect(findButtonsByLabel('sidebarWorkspaceShowMore:1').length).toBe(1)
    expect(onLoadMoreThreads).not.toHaveBeenCalled()
  })

  it('re-expands directly from already loaded threads without a remote request', async () => {
    const onLoadMoreThreads = vi.fn()
    await renderSidebar({
      threads: projectThreads(7),
      workspaceRoot: '/Users/zxy/cindy',
      workspaceRoots: ['/Users/zxy/cindy'],
      onLoadMoreThreads
    })

    await clickButton('sidebarWorkspaceShowMore:2')
    expect(outputJson()).toContain('Cindy 6')
    expect(outputJson()).toContain('Cindy 7')
    await clickButton('sidebarWorkspaceShowLess')
    expect(outputJson()).not.toContain('Cindy 6')
    await clickButton('sidebarWorkspaceShowMore:2')
    expect(outputJson()).toContain('Cindy 6')
    expect(outputJson()).toContain('Cindy 7')
    expect(onLoadMoreThreads).not.toHaveBeenCalled()
  })

  it('resets to the newest five threads after collapsing and reopening a project', async () => {
    await renderSidebar({
      threads: projectThreads(11),
      workspaceRoot: '/Users/zxy/cindy',
      workspaceRoots: ['/Users/zxy/cindy']
    })

    await clickButton('sidebarWorkspaceShowMore:6')
    expect(outputJson()).toContain('Cindy 10')
    await clickButton('/Users/zxy/cindy')
    await clickButton('/Users/zxy/cindy')

    expect(outputJson()).toContain('Cindy 5')
    expect(outputJson()).not.toContain('Cindy 6')
    expect(outputJson()).not.toContain('Cindy 10')
  })

  it('collapses only the clicked project in a multi-project sidebar', async () => {
    await renderSidebar({
      threads: [
        ...projectThreads(6, '/Users/zxy/cindy'),
        ...Array.from({ length: 6 }, (_, index) => thread({
          id: `other-${index + 1}`,
          title: `Other ${index + 1}`,
          workspace: '/Users/zxy/other',
          updatedAt: `2026-06-${String(28 - index).padStart(2, '0')}T00:00:00.000Z`
        }))
      ],
      workspaceRoot: '/Users/zxy/cindy',
      workspaceRoots: ['/Users/zxy/cindy', '/Users/zxy/other'],
      onLoadMoreThreads: vi.fn()
    })

    await clickButton('sidebarWorkspaceShowMore:1')
    expect(outputJson()).toContain('Cindy 6')
    await clickButton('sidebarWorkspaceShowMore:1')
    expect(outputJson()).toContain('Other 6')

    const collapseButtons = findButtonsByLabel('sidebarWorkspaceShowLess')
    expect(collapseButtons.length).toBe(2)
    await act(async () => {
      (collapseButtons[0] as { props: { onClick: () => void } }).props.onClick()
    })
    expect(outputJson()).not.toContain('Cindy 6')
    expect(outputJson()).toContain('Other 6')
  })

  it('keeps the project collapsed while its page request finishes', async () => {
    const onLoadMoreThreads = vi.fn()
    await renderSidebar({
      threads: projectThreads(6),
      workspaceRoot: '/Users/zxy/cindy',
      workspaceRoots: ['/Users/zxy/cindy'],
      threadListCursorByWorkspace: {
        '/users/zxy/cindy': {
          workspaceKey: '/users/zxy/cindy',
          mode: 'active',
          status: 'unknown',
          hasMore: true
        }
      },
      onLoadMoreThreads
    })

    await clickButton('sidebarWorkspaceShowMore:1')
    await clickButton('sidebarWorkspaceShowLess')
    expect(outputJson()).not.toContain('Cindy 6')

    await renderSidebar({
      threads: [...projectThreads(6), thread({
        id: 'cindy-7',
        title: 'Cindy 7',
        workspace: '/Users/zxy/cindy',
        updatedAt: '2026-06-01T12:00:00.000Z'
      })],
      workspaceRoot: '/Users/zxy/cindy',
      workspaceRoots: ['/Users/zxy/cindy'],
      threadListCursorByWorkspace: {
        '/users/zxy/cindy': {
          workspaceKey: '/users/zxy/cindy',
          mode: 'active',
          status: 'ready',
          hasMore: true
        }
      },
      onLoadMoreThreads
    })
    expect(outputJson()).not.toContain('Cindy 6')
    expect(outputJson()).not.toContain('Cindy 7')
    expect(findButtonsByLabel('sidebarWorkspaceShowMore:2').length).toBe(1)
    expect(onLoadMoreThreads).not.toHaveBeenCalled()
  })

  it('keeps forced running threads visible after collapse', async () => {
    const onLoadMoreThreads = vi.fn()
    await renderSidebar({
      threads: [
        ...projectThreads(6),
        thread({
          id: 'cindy-running',
          title: 'Cindy Running',
          workspace: '/Users/zxy/cindy',
          // Older than the first five threads so the running item is part of
          // the local overflow instead of the initial visible batch.
          updatedAt: '2026-06-01T00:00:00.000Z',
          status: 'running'
        })
      ],
      workspaceRoot: '/Users/zxy/cindy',
      workspaceRoots: ['/Users/zxy/cindy'],
      onLoadMoreThreads
    })

    expect(outputJson()).toContain('Cindy Running')
    // The running thread is forced visible in addition to the base batch, so
    // the remaining hidden count still includes Cindy 6 plus itself until expanded.
    expect(findButtonsByLabel('sidebarWorkspaceShowMore:2').length).toBe(1)
    await clickButton('sidebarWorkspaceShowMore:2')
    expect(outputJson()).toContain('Cindy 6')
    await clickButton('sidebarWorkspaceShowLess')
    expect(outputJson()).toContain('Cindy Running')
    expect(outputJson()).not.toContain('Cindy 6')
    expect(findButtonsByLabel('sidebarWorkspaceShowMore:2').length).toBe(1)
    expect(onLoadMoreThreads).not.toHaveBeenCalled()
  })

  it('does not show the collapse action at the initial stage', async () => {
    await renderSidebar({
      threads: projectThreads(20),
      workspaceRoot: '/Users/zxy/cindy',
      workspaceRoots: ['/Users/zxy/cindy']
    })
    expect(findButtonsByLabel('sidebarWorkspaceShowLess').length).toBe(0)
    expect(findButtonsByLabel('sidebarWorkspaceShowMore:15').length).toBe(1)
  })
})
