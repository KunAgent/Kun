import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import type {
  TaskWorkspaceIntegratePreview,
  TaskWorkspaceRecord
} from '@shared/task-workspace'

const provider = {
  getTaskWorkspaceIntegratePreview: vi.fn(),
  integrateTaskWorkspace: vi.fn(),
  previewTaskWorkspaceDiscard: vi.fn(),
  discardTaskWorkspace: vi.fn(),
  cleanupTaskWorkspace: vi.fn()
}

vi.mock('../../agent/registry', () => ({
  getProvider: () => provider
}))

import { reviewPrimaryMode, ReviewPrimaryAction } from './ReviewPrimaryAction'
import { useReviewStore } from '../../store/review-store'

function binding(state: TaskWorkspaceRecord['state'] = 'captured'): TaskWorkspaceRecord {
  return {
    workspaceId: 'tws_1',
    ownerThreadId: 'thr_mgr',
    unitId: 'wrk_1',
    isolation: 'worktree',
    sourceRoot: '/repo',
    repositoryRoot: '/repo',
    path: '/repo/.worktrees/fix',
    branch: 'kun/fix-tws_1',
    targetBranch: 'main',
    state,
    changedFiles: ['a.ts'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function preview(overrides: Partial<TaskWorkspaceIntegratePreview> = {}): TaskWorkspaceIntegratePreview {
  return {
    canApplyPatch: true,
    canMergeBranch: true,
    hasUncommitted: false,
    hasRemote: true,
    ...overrides
  }
}

function seed(pv: TaskWorkspaceIntegratePreview): void {
  useReviewStore.setState({
    bindings: { thr_mgr: binding() },
    workspaces: {
      tws_1: {
        files: [],
        loading: false,
        expandedPaths: {},
        viewMode: 'unified',
        details: {},
        comments: [],
        requests: [],
        commentsLoaded: false,
        dirtyComments: {},
        sending: false,
        integratePreview: pv,
        integratePreviewLoaded: true
      }
    }
  })
}

async function renderAction(state: TaskWorkspaceRecord['state'] = 'captured') {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(ReviewPrimaryAction, { binding: binding(state) }))
  })
  return renderer
}

beforeEach(() => {
  vi.clearAllMocks()
  provider.getTaskWorkspaceIntegratePreview.mockResolvedValue({ preview: preview() })
  provider.integrateTaskWorkspace.mockResolvedValue({
    record: { ...binding(), state: 'integrated' },
    outcome: 'applied'
  })
  provider.discardTaskWorkspace.mockResolvedValue({
    record: { ...binding(), state: 'removed' }
  })
  provider.previewTaskWorkspaceDiscard.mockResolvedValue({
    uncommittedFiles: 2,
    unpushedCommits: 1
  })
  useReviewStore.setState({ bindings: {}, workspaces: {} })
})

describe('reviewPrimaryMode', () => {
  it('picks merge-branch when both modes are available', () => {
    expect(reviewPrimaryMode(preview())).toBe('merge-branch')
  })
  it('falls back to apply-patch when merge is blocked', () => {
    expect(reviewPrimaryMode(preview({ canMergeBranch: false }))).toBe('apply-patch')
  })
  it('is null when neither mode is available', () => {
    expect(reviewPrimaryMode(preview({ canApplyPatch: false, canMergeBranch: false }))).toBeNull()
    expect(reviewPrimaryMode(undefined)).toBeNull()
  })
})

describe('ReviewPrimaryAction', () => {
  it('highlights exactly one primary action and keeps discard outlined', async () => {
    seed(preview())
    const renderer = await renderAction()
    const buttons = renderer.root.findAllByType('button' as never)
    const primary = buttons.filter((b) => b.props['data-primary'])
    expect(primary).toHaveLength(1)
    expect(primary[0]!.children.join('')).toContain('Merge branch')
    const discard = buttons.find((b) => b.children.join('').includes('Discard'))
    expect(discard).toBeTruthy()
    expect(discard!.props['data-primary']).toBeUndefined()
    expect(discard!.props.className).toContain('border')
  })

  it('disables a blocked mode and keeps the reason as the tooltip', async () => {
    seed(preview({
      canApplyPatch: false,
      applyBlockReason: 'repository HEAD changed since worktree allocation'
    }))
    const renderer = await renderAction()
    const apply = renderer.root.findAllByType('button' as never)
      .find((b) => b.children.join('').includes('Apply to current branch'))
    expect(apply!.props.disabled).toBe(true)
    expect(apply!.props.title).toMatch(/HEAD changed/)
    const merge = renderer.root.findAllByType('button' as never)
      .find((b) => b.children.join('').includes('Merge branch'))
    expect(merge!.props.disabled).toBe(false)
    expect(merge!.props['data-primary']).toBe(true)
  })

  it('hides the row for terminal workspace states', async () => {
    seed(preview())
    const renderer = await renderAction('integrated')
    expect(renderer.root.findAllByType('button' as never)).toHaveLength(0)
  })

  it('integrates through the provider and updates the bound record', async () => {
    seed(preview())
    const renderer = await renderAction()
    const merge = renderer.root.findAllByType('button' as never)
      .find((b) => b.props['data-primary'])
    await act(async () => merge!.props.onClick())
    expect(provider.integrateTaskWorkspace).toHaveBeenCalledWith('tws_1', 'merge-branch')
    expect(useReviewStore.getState().bindings['thr_mgr']?.state).toBe('integrated')
    // A fresh preview is fetched after the integrate.
    expect(provider.getTaskWorkspaceIntegratePreview).toHaveBeenCalledWith('tws_1')
  })

  it('fetches the discard damage preview when the confirm opens', async () => {
    seed(preview())
    const renderer = await renderAction()
    const discard = renderer.root.findAllByType('button' as never)
      .find((b) => b.children.join('').includes('Discard'))
    await act(async () => discard!.props.onClick())
    expect(provider.previewTaskWorkspaceDiscard).toHaveBeenCalledWith('tws_1')
  })
})
