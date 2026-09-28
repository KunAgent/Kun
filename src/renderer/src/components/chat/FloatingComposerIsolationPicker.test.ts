// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

async function renderPicker(props: {
  showPicker?: boolean
  value?: 'local' | 'worktree'
  prep?: TaskWorkspacePrep
  boundWorkspaceId?: string
  onSelect?: (value: 'local' | 'worktree') => void
  onRetryPrep?: () => void
}): Promise<void> {
  await act(async () => {
    root.render(createElement(FloatingComposerIsolationPicker, {
      showPicker: props.showPicker ?? true,
      value: props.value ?? 'local',
      prep: props.prep,
      boundWorkspaceId: props.boundWorkspaceId,
      onSelect: props.onSelect ?? vi.fn(),
      onRetryPrep: props.onRetryPrep
    }))
  })
}

describe('FloatingComposerIsolationPicker', () => {
  it('offers local vs worktree for a new ADE session', async () => {
    const onSelect = vi.fn()
    await renderPicker({ onSelect })
    const trigger = host.querySelector<HTMLButtonElement>('[data-composer-isolation-picker]')
    await act(async () => trigger!.click())
    const menu = document.body.querySelector('[data-isolation-picker-menu]')
    expect(menu).toBeTruthy()
    const local = menu!.querySelector<HTMLButtonElement>('[data-isolation="local"]')
    const worktree = menu!.querySelector<HTMLButtonElement>('[data-isolation="worktree"]')
    expect(local).toBeTruthy()
    await act(async () => worktree!.click())
    expect(onSelect).toHaveBeenCalledWith('worktree')
  })

  it('shows a preparing chip while the worktree spins up', async () => {
    await renderPicker({
      showPicker: false,
      prep: prep('setting-up')
    })
    expect(host.querySelector('[data-worktree-prep="preparing"]')).toBeTruthy()
  })

  it('shows a retry affordance when preparation failed', async () => {
    const onRetryPrep = vi.fn()
    await renderPicker({
      showPicker: false,
      prep: prep('failed'),
      onRetryPrep
    })
    const retry = host.querySelector<HTMLButtonElement>('[data-worktree-prep="failed"]')
    await act(async () => retry!.click())
    expect(onRetryPrep).toHaveBeenCalled()
  })

  it('shows the bound worktree badge once ready', async () => {
    await renderPicker({
      showPicker: false,
      prep: prep('ready')
    })
    expect(host.querySelector('[data-worktree-prep="ready"]')).toBeTruthy()
  })

  it('renders nothing when no picker, prep, or binding applies', async () => {
    await renderPicker({ showPicker: false })
    expect(host.querySelector('[data-composer-isolation-picker]')).toBeNull()
    expect(host.querySelector('[data-worktree-prep="preparing"]')).toBeNull()
  })
})
