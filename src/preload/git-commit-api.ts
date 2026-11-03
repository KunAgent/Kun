import { ipcRenderer } from 'electron'
import type { KunGuiGitCommitApi } from '../shared/git-commit'

/** Changes panel commit flow. Spread into the main `kunGui` api object in `index.ts`. */
export const gitCommitApi: KunGuiGitCommitApi = {
  getGitWorkingState: (workspaceRoot) => ipcRenderer.invoke('git:working-state', workspaceRoot),
  getGitBranchComparison: (workspaceRoot) => ipcRenderer.invoke('git:branch-comparison', workspaceRoot),
  getGitFileDiff: (request) => ipcRenderer.invoke('git:file-diff', request),
  stageGitPaths: (request) => ipcRenderer.invoke('git:stage', request),
  unstageGitPaths: (request) => ipcRenderer.invoke('git:unstage', request),
  discardGitPaths: (request) => ipcRenderer.invoke('git:discard', request),
  commitGitChanges: (request) => ipcRenderer.invoke('git:commit', request),
  pushGitBranch: (request) => ipcRenderer.invoke('git:push', request),
  generateGitCommitMessage: (request) => ipcRenderer.invoke('git:commit-message', request)
}
