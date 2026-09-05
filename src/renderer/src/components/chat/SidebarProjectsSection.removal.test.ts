import { createElement, type ComponentProps } from 'react'
import { act, create as createRenderer, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import {
  emptyRemovedCodeWorkspacesRegistry,
  rememberRemovedCodeWorkspace,
  type RemovedCodeWorkspacesRegistry
} from '../../lib/removed-code-workspaces'
import { SidebarProjectsSection } from './SidebarProjectsSection'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string) => key
  })
}))

function thread(overrides: Partial<NormalizedThread> & Pick<NormalizedThread, 'id' | 'workspace'>): NormalizedThread {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    updatedAt: overrides.updatedAt ?? '2026-08-28T00:00:00.000Z',
    model: overrides.model ?? 'deepseek-v4-pro',
    mode: overrides.mode ?? 'agent',
    workspace: overrides.workspace,
    ...(overrides.archived !== undefined ? { archived: overrides.archived } : {})
  }
}

class MemoryStorage {
  private readonly values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

const gitBranchesMock = vi.hoisted(() => ({ getGitBranches: vi.fn(async () => ({ ok: false as const })) }))

vi.stubGlobal('window', {
  localStorage: new MemoryStorage(),
  kunGui: { getGitBranches: gitBranchesMock.getGitBranches }
})

function sidebarProps(overrides: Record<string, unknown> = {}) {
  return {
    threads: [] as NormalizedThread[],
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
    workspaceRoot: '',
    workspaceRoots: [] as string[],
    conversationRoot: '',
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

async function renderSidebar(props: ComponentProps<typeof SidebarProjectsSection>): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = createRenderer(createElement(SidebarProjectsSection, props))
    await Promise.resolve()
  })
  return renderer!
}

function visibleWorkspaceTitles(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAll((node) =>
    node.type === 'div' && typeof node.props.title === 'string' && node.props.title.startsWith('/')
  ).map((node) => node.props.title as string)
}

describe('SidebarProjectsSection removed projects', () => {
  const projectPath = '/Users/zxy/code/A'
  const worktreePath = '/Users/zxy/.kun/worktrees/abcd/A'

  beforeEach(() => {
    useChatStore.setState({ removedCodeWorkspaces: emptyRemovedCodeWorkspacesRegistry() })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('hides the whole project group (main + worktree threads) by identity', async () => {
    useChatStore.setState({
      removedCodeWorkspaces: rememberRemovedCodeWorkspace(
        { projectPath, aliases: [worktreePath] },
        emptyRemovedCodeWorkspacesRegistry()
      ) as RemovedCodeWorkspacesRegistry
    })

    const renderer = await renderSidebar(sidebarProps({
      threads: [
        thread({ id: 'thr-main', workspace: projectPath }),
        thread({ id: 'thr-wt', workspace: worktreePath })
      ],
      workspaceRoot: projectPath,
      workspaceRoots: [projectPath, worktreePath]
    }))

    expect(visibleWorkspaceTitles(renderer)).not.toContain(projectPath)
    const html = JSON.stringify(renderer.toJSON())
    expect(html).not.toContain('thr-main')
    expect(html).not.toContain('thr-wt')
    renderer.unmount()
  })

  it('keeps the project visible while other projects remain untouched', async () => {
    const other = '/Users/zxy/code/B'
    useChatStore.setState({
      removedCodeWorkspaces: rememberRemovedCodeWorkspace(
        { projectPath },
        emptyRemovedCodeWorkspacesRegistry()
      )
    })

    const renderer = await renderSidebar(sidebarProps({
      threads: [
        thread({ id: 'thr-main', workspace: projectPath }),
        thread({ id: 'thr-other', workspace: other })
      ],
      workspaceRoots: [projectPath, other]
    }))

    const titles = visibleWorkspaceTitles(renderer)
    expect(titles).not.toContain(projectPath)
    expect(titles).toContain(other)
    renderer.unmount()
  })

  it('passes a Git-discovered custom worktree alias to onRemoveWorkspace', async () => {
    const customWorktreePath = '/Users/zxy/code/A.worktrees/feature-a'
    const onRemoveWorkspace = vi.fn(async () => undefined)
    const renderer = await renderSidebar(sidebarProps({
      threads: [
        thread({ id: 'thr-main', workspace: projectPath }),
        thread({ id: 'thr-wt', workspace: customWorktreePath })
      ],
      workspaceRoot: projectPath,
      workspaceRoots: [projectPath, customWorktreePath],
      onRemoveWorkspace
    }))

    // The actions module computes aliases inside handleRemoveWorkspace; assert
    // the removal helper through the exported workspace actions contract by
    // invoking it the way WorkspaceContextMenu does after the confirm dialog.
    const { createSidebarProjectWorkspaceActions } = await import('./sidebar-project-workspace-actions')
    const setNoop = () => {}
    const actions = createSidebarProjectWorkspaceActions({
      t: (key: string) => key,
      threads: [
        thread({ id: 'thr-main', workspace: projectPath }),
        thread({ id: 'thr-wt', workspace: customWorktreePath })
      ],
      workspaceRoot: projectPath,
      workspaceRoots: [projectPath, customWorktreePath],
      threadWorktrees: {
        'thr-wt': {
          projectPath,
          worktreePath: customWorktreePath,
          branch: 'feature-a'
        }
      },
      setThreadContextMenu: setNoop,
      setWorkspaceContextMenu: setNoop,
      setFolderContextMenu: setNoop,
      setDeletingThreadIds: setNoop,
      openActionDialog: (dialog) => { void dialog.onConfirm() },
      onRemoveWorkspace,
      onArchiveThread: vi.fn(async () => undefined)
    })
    await actions.handleRemoveWorkspace(projectPath)

    expect(onRemoveWorkspace).toHaveBeenCalledTimes(1)
    const call = onRemoveWorkspace.mock.calls[0] as unknown as
      | [string, string[]]
      | undefined
    const related = call?.[1] ?? []
    expect(related).toContain(projectPath)
    expect(related).toContain(customWorktreePath)
    renderer.unmount()
  })

  it('restores visibility when the removal marker is cleared', async () => {
    useChatStore.setState({
      removedCodeWorkspaces: rememberRemovedCodeWorkspace(
        { projectPath },
        emptyRemovedCodeWorkspacesRegistry()
      )
    })
    const props = sidebarProps({
      threads: [thread({ id: 'thr-main', workspace: projectPath })],
      workspaceRoot: projectPath,
      workspaceRoots: [projectPath]
    })

    const renderer = await renderSidebar(props)
    expect(visibleWorkspaceTitles(renderer)).not.toContain(projectPath)

    useChatStore.setState({ removedCodeWorkspaces: emptyRemovedCodeWorkspacesRegistry() })
    await act(async () => { await Promise.resolve() })
    expect(visibleWorkspaceTitles(renderer)).toContain(projectPath)
    renderer.unmount()
  })
})
