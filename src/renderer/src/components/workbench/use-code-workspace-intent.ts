import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { useChatStore } from '../../store/chat-store'

/** The existing Code Git control and first submission share one frozen draft intent. */
export function useCodeWorkspaceIntent(): {
  useWorktreePool: boolean
  setUseWorktreePool: Dispatch<SetStateAction<boolean>>
  worktreeBranch: string
  setWorktreeBranch: Dispatch<SetStateAction<string>>
} {
  const isolation = useChatStore((state) => state.composerIsolation)
  const start = useChatStore((state) => state.composerWorktreeStartFrom)
  const setUseWorktreePool = useCallback<Dispatch<SetStateAction<boolean>>>((next) => {
    const state = useChatStore.getState()
    const enabled = typeof next === 'function' ? next(state.composerIsolation === 'worktree') : next
    state.setComposerIsolation(enabled ? 'worktree' : 'local', enabled
      ? state.composerWorktreeStartFrom ?? { kind: 'current-head' } : undefined)
  }, [])
  const setWorktreeBranch = useCallback<Dispatch<SetStateAction<string>>>((next) => {
    const state = useChatStore.getState()
    const previous = state.composerWorktreeStartFrom?.kind === 'branch'
      ? state.composerWorktreeStartFrom.name : ''
    const branch = (typeof next === 'function' ? next(previous) : next).trim()
    if (state.composerIsolation === 'worktree') {
      state.setComposerIsolation('worktree', branch ? { kind: 'branch', name: branch } : { kind: 'current-head' })
    }
  }, [])
  return {
    useWorktreePool: isolation === 'worktree', setUseWorktreePool,
    worktreeBranch: start?.kind === 'branch' ? start.name : '', setWorktreeBranch
  }
}
