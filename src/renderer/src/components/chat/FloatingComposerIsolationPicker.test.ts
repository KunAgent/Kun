import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import type { TaskWorkspacePrep } from '../../store/task-workspace-store'
import { FloatingComposerIsolationPicker } from './FloatingComposerIsolationPicker'

function prep(state: TaskWorkspacePrep['state']): TaskWorkspacePrep {
  return {
    workspaceId: 'ws_1',
    ownerThreadId: 'thr_1',
    state,
    ...(state === 'ready' ? { path: '/repo/.kun-worktrees/task-1' } : {}),
    ...(state === 'failed' ? { error: 'git worktree add failed' } : {})
  }
}

async function renderPicker(props: {
  showPicker?: boolean
  value?: 'local' | 'worktree'
  prep?: TaskWorkspacePrep
  boundWorkspaceId?: string
  onSelect?: (value: 'local' | 'worktree') => void
  onRetryPrep?: () => void
}): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(FloatingComposerIsolationPicker, {
      showPicker: props.showPicker ?? true,
      value: props.value ?? 'local',
      prep: props.prep,
      boundWorkspaceId: props.boundWorkspaceId,
      onSelect: props.onSelect ?? vi.fn(),
      onRetryPrep: props.onRetryPrep
    }))
  })
  return renderer
}

beforeEach(() => {
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })
})

describe('FloatingComposerIsolationPicker', () => {
  it('offers local vs worktree for a new ADE session', async () => {
    const onSelect = vi.fn()
    const renderer = await renderPicker({ onSelect })
    await act(async () => {
      renderer.root.findByProps({ 'data-composer-isolation-picker': true }).props.onClick()
    })
    const local = renderer.root.findByProps({ 'data-isolation': 'local' })
    const worktree = renderer.root.findByProps({ 'data-isolation': 'worktree' })
    await act(async () => {
      worktree.props.onClick()
    })
    expect(onSelect).toHaveBeenCalledWith('worktree')
    expect(local).toBeTruthy()
  })

  it('shows a preparing chip while the worktree spins up', async () => {
    const renderer = await renderPicker({
      showPicker: false,
      prep: prep('setting-up')
    })
    expect(renderer.root.findByProps({ 'data-worktree-prep': 'preparing' })).toBeTruthy()
  })

  it('shows a retry affordance when preparation failed', async () => {
    const onRetryPrep = vi.fn()
    const renderer = await renderPicker({
      showPicker: false,
      prep: prep('failed'),
      onRetryPrep
    })
    const retry = renderer.root.findByProps({ 'data-worktree-prep': 'failed' })
    await act(async () => {
      retry.props.onClick()
    })
    expect(onRetryPrep).toHaveBeenCalled()
  })

  it('shows the bound worktree badge once ready', async () => {
    const renderer = await renderPicker({
      showPicker: false,
      prep: prep('ready')
    })
    expect(renderer.root.findByProps({ 'data-worktree-prep': 'ready' })).toBeTruthy()
  })

  it('renders nothing when no picker, prep, or binding applies', async () => {
    const renderer = await renderPicker({ showPicker: false })
    expect(renderer.toJSON()).toBeTruthy()
    expect(renderer.root.findAllByProps({ 'data-composer-isolation-picker': true })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ 'data-worktree-prep': 'preparing' })).toHaveLength(0)
  })
})
