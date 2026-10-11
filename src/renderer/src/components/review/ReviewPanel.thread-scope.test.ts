import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskWorkspaceRecord } from '@shared/task-workspace'

const provider = { listTaskWorkspaces: vi.fn() }
vi.mock('../../agent/registry', () => ({ getProvider: () => provider }))
vi.mock('./ReviewFileTree', () => ({ ReviewFileTree: () => null }))
vi.mock('./ReviewDiffBlock', () => ({ ReviewDiffBlock: () => null }))
vi.mock('./ReviewPrimaryAction', () => ({ ReviewPrimaryAction: () => null }))
vi.mock('./ChangeRequestPanel', () => ({ ChangeRequestPanel: () => null }))
vi.mock('./ReviewSendMenu', () => ({ ReviewSendMenu: () => null }))

import { ReviewPanel } from './ReviewPanel'
import { useReviewStore, type WorkspaceReview } from '../../store/review-store'
import { useChatStore } from '../../store/chat-store'

function workspace(workspaceId: string, ownerThreadId: string): TaskWorkspaceRecord {
  return {
    workspaceId,
    ownerThreadId,
    isolation: 'worktree',
    sourceRoot: '/repo',
    path: `/repo/${workspaceId}`,
    state: 'ready',
    changedFiles: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z'
  }
}

function review(): WorkspaceReview {
  return {
    files: [{ path: 'file.ts', status: 'modified', insertions: 1, deletions: 0, binary: false, tooLarge: false }],
    loading: false,
    expandedPaths: {},
    viewMode: 'unified',
    details: {},
    comments: [],
    requests: [],
    commentsLoaded: true,
    dirtyComments: {},
    sending: false
  }
}

async function render(props: { threadId?: string; workspace?: TaskWorkspaceRecord } = {}): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(ReviewPanel, props)) })
  return renderer
}

beforeEach(() => {
  vi.clearAllMocks()
  useChatStore.setState({ activeThreadId: 'manager' } as never)
  useReviewStore.setState({
    bindings: {
      manager: workspace('manager-workspace', 'manager'),
      worker: workspace('worker-workspace', 'worker')
    },
    workspaces: {
      'manager-workspace': review(),
      'worker-workspace': review(),
      'chosen-workspace': review()
    }
  })
})

describe('ReviewPanel explicit scope', () => {
  it('uses an explicit worker thread without changing the active main thread', async () => {
    const renderer = await render({ threadId: 'worker' })
    expect(renderer.root.findAll((node) => node.props['data-review-workspace-id'] === 'worker-workspace')).toHaveLength(1)
    expect(useChatStore.getState().activeThreadId).toBe('manager')
  })

  it('prefers the explicit workspace over both thread bindings', async () => {
    const renderer = await render({
      threadId: 'worker',
      workspace: workspace('chosen-workspace', 'worker')
    })
    expect(renderer.root.findAll((node) => node.props['data-review-workspace-id'] === 'chosen-workspace')).toHaveLength(1)
    expect(provider.listTaskWorkspaces).not.toHaveBeenCalled()
    expect(useChatStore.getState().activeThreadId).toBe('manager')
  })
})
