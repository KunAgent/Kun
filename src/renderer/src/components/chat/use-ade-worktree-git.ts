import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitBranchesResult } from '@shared/git-branches'
import type { TaskWorkspaceStartFrom } from '@shared/task-workspace'
import { normalizeWorkspaceRoot, workspaceRootIdentityKey } from '../../lib/workspace-path'
import { useChatStore } from '../../store/chat-store'

type ReadyBranches = Extract<GitBranchesResult, { ok: true }>
type Probe = {
  rootKey: string
  status: 'idle' | 'loading' | 'ready' | 'not-git' | 'error'
  branches?: ReadyBranches
  error?: string
}

/** Git eligibility belongs to the draft project, never to an earlier request. */
export function useAdeWorktreeGit({
  enabled,
  activeThreadId,
  workspaceRoot
}: {
  enabled: boolean
  activeThreadId: string | null
  workspaceRoot: string
}) {
  const root = normalizeWorkspaceRoot(workspaceRoot)
  const rootKey = workspaceRootIdentityKey(root)
  const isolation = useChatStore((s) => s.composerIsolation)
  const startFrom = useChatStore((s) => s.composerWorktreeStartFrom)
  const setComposerIsolation = useChatStore((s) => s.setComposerIsolation)
  const setComposerIsolationForWorkspace = useChatStore((s) => s.setComposerIsolationForWorkspace)
  const [probe, setProbe] = useState<Probe>({ rootKey: '', status: 'idle' })
  const generation = useRef(0)
  const selectedRoot = useRef(rootKey)
  selectedRoot.current = rootKey

  const check = useCallback(async (path: string, key: string): Promise<void> => {
    const request = ++generation.current
    setProbe({ rootKey: key, status: 'loading' })
    try {
      if (typeof window.kunGui?.getGitBranches !== 'function') {
        throw new Error('Git branch inspection is unavailable')
      }
      const result = await window.kunGui.getGitBranches(path)
      if (request !== generation.current || selectedRoot.current !== key) return
      if (result.ok) {
        setProbe({ rootKey: key, status: 'ready', branches: result })
      } else {
        setProbe({
          rootKey: key,
          status: result.reason === 'not_git_repo' ? 'not-git' : 'error',
          error: result.message
        })
      }
    } catch (error) {
      if (request !== generation.current || selectedRoot.current !== key) return
      setProbe({
        rootKey: key,
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }, [])

  useEffect(() => {
    if (!enabled || activeThreadId || !root) {
      generation.current++
      setProbe({ rootKey, status: 'idle' })
      return
    }
    void check(root, rootKey)
    return () => { generation.current++ }
  }, [activeThreadId, check, enabled, root, rootKey])

  const current = probe.rootKey === rootKey ? probe : { rootKey, status: 'loading' as const }
  useEffect(() => {
    if (enabled && !activeThreadId && current.status === 'not-git' && isolation === 'worktree') {
      setComposerIsolationForWorkspace('local')
    }
  }, [activeThreadId, current.status, enabled, isolation, setComposerIsolationForWorkspace])

  const selection = startFrom ?? { kind: 'default-branch' as const }
  const selectedBranchValid = selection.kind !== 'branch' || Boolean(
    current.branches?.branches.some((branch) => branch.name === selection.name)
  )
  return {
    status: current.status,
    branches: current.branches,
    error: current.error,
    startFrom: selection,
    worktreeGitReady: current.status === 'ready' && selectedBranchValid,
    selectedBranchValid,
    retry: (): void => { if (root && enabled && !activeThreadId) void check(root, rootKey) },
    selectStartFrom: (next: TaskWorkspaceStartFrom): void => {
      if (isolation === 'worktree') setComposerIsolation('worktree', next)
    }
  }
}
