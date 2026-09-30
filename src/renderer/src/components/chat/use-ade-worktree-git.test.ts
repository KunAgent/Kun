// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitBranchesResult } from '@shared/git-branches'
import { useChatStore } from '../../store/chat-store'
import { useAdeWorktreeGit } from './use-ade-worktree-git'

let host: HTMLDivElement
let root: Root
const original = useChatStore.getState()
const originalApi = window.kunGui

function Probe({ path }: { path: string }) {
  const state = useAdeWorktreeGit({ enabled: true, activeThreadId: null, workspaceRoot: path })
  return createElement('span', {
    'data-status': state.status,
    'data-ready': state.worktreeGitReady,
    'data-branch-valid': state.selectedBranchValid
  })
}

function readyResult(path: string): GitBranchesResult {
  return {
    ok: true,
    repositoryRoot: path,
    primaryRepositoryRoot: path,
    currentBranch: 'main',
    branches: [{ name: 'main', current: true }, { name: 'feature', current: false }],
    dirtyCount: 0
  }
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  useChatStore.setState({ composerIsolation: 'worktree', composerWorktreeStartFrom: { kind: 'default-branch' } })
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  useChatStore.setState(original)
  Object.defineProperty(window, 'kunGui', { configurable: true, value: originalApi })
})

describe('useAdeWorktreeGit', () => {
  it('ignores a previous project response after switching roots', async () => {
    const resolveByPath = new Map<string, (result: GitBranchesResult) => void>()
    const getGitBranches = vi.fn((path: string) => new Promise<GitBranchesResult>((resolve) => {
      resolveByPath.set(path, resolve)
    }))
    Object.defineProperty(window, 'kunGui', { configurable: true, value: { getGitBranches } })
    await act(async () => root.render(createElement(Probe, { path: '/repo/one' })))
    await act(async () => root.render(createElement(Probe, { path: '/repo/two' })))
    await act(async () => resolveByPath.get('/repo/two')!(readyResult('/repo/two')))
    expect(host.querySelector('span')?.getAttribute('data-status')).toBe('ready')
    await act(async () => resolveByPath.get('/repo/one')!({
      ok: false, reason: 'not_git_repo', message: 'not git'
    }))
    expect(host.querySelector('span')?.getAttribute('data-status')).toBe('ready')
    expect(host.querySelector('span')?.getAttribute('data-ready')).toBe('true')
  })

  it('keeps the requested isolation visible and blocked for a non-Git project', async () => {
    const setLocal = vi.fn()
    useChatStore.setState({ setComposerIsolationForWorkspace: setLocal })
    Object.defineProperty(window, 'kunGui', {
      configurable: true,
      value: { getGitBranches: vi.fn(async (): Promise<GitBranchesResult> => ({
        ok: false, reason: 'not_git_repo', message: 'not git'
      })) }
    })
    await act(async () => root.render(createElement(Probe, { path: '/plain' })))
    expect(host.querySelector('span')?.getAttribute('data-status')).toBe('not-git')
    expect(setLocal).not.toHaveBeenCalled()
  })

  it('blocks a branch that has disappeared from the selected project', async () => {
    useChatStore.setState({ composerWorktreeStartFrom: { kind: 'branch', name: 'deleted' } })
    Object.defineProperty(window, 'kunGui', {
      configurable: true,
      value: { getGitBranches: vi.fn(async () => readyResult('/repo')) }
    })
    await act(async () => root.render(createElement(Probe, { path: '/repo' })))
    expect(host.querySelector('span')?.getAttribute('data-status')).toBe('ready')
    expect(host.querySelector('span')?.getAttribute('data-branch-valid')).toBe('false')
    expect(host.querySelector('span')?.getAttribute('data-ready')).toBe('false')
  })
})
