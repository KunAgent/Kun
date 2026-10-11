import { ipcRenderer } from 'electron'
import type { KunGuiApi } from '../shared/kun-gui-api'

type WorktreeApi = Pick<KunGuiApi,
  | 'acquireWorktree' | 'releaseWorktree' | 'listWorktrees' | 'removeWorktree'
  | 'getWorktreeChanges' | 'commitWorktree' | 'mergeWorktree' | 'abortWorktreeMerge'
  | 'continueWorktreeMerge' | 'syncWorktreeFromMain' | 'abortWorktreeRebase' | 'cleanupWorktrees'
  | 'findAvailableWorktreePoolIndex'>

/** Worktrees that Code sessions run in: pool, changes, commit, merge and sync. */
export const worktreePreloadApi: WorktreeApi = {
  acquireWorktree: (params) =>
    ipcRenderer.invoke('worktree:acquire', params),
  releaseWorktree: (params) =>
    ipcRenderer.invoke('worktree:release', params),
  listWorktrees: (params) =>
    ipcRenderer.invoke('worktree:list', params),
  removeWorktree: (params) =>
    ipcRenderer.invoke('worktree:remove', params),
  getWorktreeChanges: (params) =>
    ipcRenderer.invoke('worktree:changes', params),
  commitWorktree: (params) =>
    ipcRenderer.invoke('worktree:commit', params),
  mergeWorktree: (params) =>
    ipcRenderer.invoke('worktree:merge', params),
  abortWorktreeMerge: (params) =>
    ipcRenderer.invoke('worktree:abort-merge', params),
  continueWorktreeMerge: (params) =>
    ipcRenderer.invoke('worktree:continue-merge', params),
  syncWorktreeFromMain: (params) =>
    ipcRenderer.invoke('worktree:sync', params),
  abortWorktreeRebase: (params) =>
    ipcRenderer.invoke('worktree:abort-rebase', params),
  cleanupWorktrees: (params) =>
    ipcRenderer.invoke('worktree:cleanup', params),
  findAvailableWorktreePoolIndex: (params) =>
    ipcRenderer.invoke('worktree:find-available', params)
}
