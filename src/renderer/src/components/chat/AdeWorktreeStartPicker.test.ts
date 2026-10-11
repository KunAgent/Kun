// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import { AdeWorktreeStartPicker } from './AdeWorktreeStartPicker'
import type { useAdeWorktreeGit } from './use-ade-worktree-git'

let host: HTMLDivElement
let root: Root
const selectStartFrom = vi.fn()
const retry = vi.fn()

const git = (overrides: Partial<ReturnType<typeof useAdeWorktreeGit>> = {}) => ({
  status: 'ready' as const,
  branches: {
    ok: true as const,
    repositoryRoot: '/repo',
    primaryRepositoryRoot: '/repo',
    currentBranch: 'develop',
    branches: [{ name: 'develop', current: true }, { name: 'feature/ui', current: false }],
    dirtyCount: 0
  },
  error: undefined,
  startFrom: { kind: 'default-branch' as const },
  worktreeGitReady: true,
  selectedBranchValid: true,
  retry,
  selectStartFrom,
  ...overrides
})

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.clearAllMocks()
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

async function renderPicker(overrides: Partial<ReturnType<typeof useAdeWorktreeGit>> = {}): Promise<void> {
  await act(async () => root.render(createElement(AdeWorktreeStartPicker, { git: git(overrides) })))
}

describe('AdeWorktreeStartPicker', () => {
  it('offers default branch, current HEAD and a selected local branch', async () => {
    await renderPicker()
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click())
    const menu = document.body.querySelector<HTMLElement>('[data-ade-worktree-start-menu]')!
    expect(menu.querySelector('[data-ade-worktree-start="default-branch"]')).toBeTruthy()
    expect(menu.querySelector('[data-ade-worktree-start="current-head"]')).toBeTruthy()
    await act(async () => menu.querySelector<HTMLButtonElement>('[data-ade-worktree-start="branch:feature/ui"]')!.click())
    expect(selectStartFrom).toHaveBeenCalledWith({ kind: 'branch', name: 'feature/ui' })
  })

  it('offers retry when Git inspection fails', async () => {
    await renderPicker({ status: 'error', error: 'git unavailable', branches: undefined, worktreeGitReady: false })
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click())
    expect(document.body.querySelector('[data-ade-worktree-start-menu]')?.textContent).toContain('git unavailable')
    const buttons = document.body.querySelectorAll<HTMLButtonElement>('[data-ade-worktree-start-menu] button')
    await act(async () => buttons[buttons.length - 1]!.click())
    expect(retry).toHaveBeenCalled()
  })
})
