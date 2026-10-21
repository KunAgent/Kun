import { ipcMain, shell } from 'electron'
import {
  gitCommitMessagePayloadSchema,
  gitCommitPayloadSchema,
  gitDiscardPayloadSchema,
  gitFileDiffPayloadSchema,
  gitPathsPayloadSchema,
  gitPushPayloadSchema,
  gitWorkspacePayloadSchema
} from './app-ipc-schemas'
import { getGitBranchComparison, getGitFileDiff } from '../services/git-branch-comparison'
import {
  commitGitChanges,
  discardGitPaths,
  pushGitBranch,
  stageGitPaths,
  unstageGitPaths
} from '../services/git-commit-operations'
import { generateGitCommitMessage } from '../services/git-commit-message-service'
import { getGitWorkingState } from '../services/git-working-state'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { parseIpcPayload } from './app-ipc-handler-utils'

/** Changes panel commit flow: working state, stage / unstage / discard, commit, push, message generation. */
export function registerAppGitCommitIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  const withRegistryCredentials = options.withRegistryCredentials ?? (async (settings) => settings)

  ipcMain.handle('git:working-state', async (_, payload: unknown) =>
    getGitWorkingState(parseIpcPayload('git:working-state', gitWorkspacePayloadSchema, payload))
  )
  ipcMain.handle('git:branch-comparison', async (_, payload: unknown) =>
    getGitBranchComparison(parseIpcPayload('git:branch-comparison', gitWorkspacePayloadSchema, payload))
  )
  ipcMain.handle('git:file-diff', async (_, payload: unknown) =>
    getGitFileDiff(parseIpcPayload('git:file-diff', gitFileDiffPayloadSchema, payload))
  )
  ipcMain.handle('git:stage', async (_, payload: unknown) =>
    stageGitPaths(parseIpcPayload('git:stage', gitPathsPayloadSchema, payload))
  )
  ipcMain.handle('git:unstage', async (_, payload: unknown) =>
    unstageGitPaths(parseIpcPayload('git:unstage', gitPathsPayloadSchema, payload))
  )
  ipcMain.handle('git:discard', async (_, payload: unknown) => {
    const request = parseIpcPayload('git:discard', gitDiscardPayloadSchema, payload)
    return discardGitPaths(request, (path) => shell.trashItem(path))
  })
  ipcMain.handle('git:commit', async (_, payload: unknown) =>
    commitGitChanges(parseIpcPayload('git:commit', gitCommitPayloadSchema, payload))
  )
  ipcMain.handle('git:push', async (_, payload: unknown) =>
    pushGitBranch(parseIpcPayload('git:push', gitPushPayloadSchema, payload))
  )
  ipcMain.handle('git:commit-message', async (_, payload: unknown) => {
    const request = parseIpcPayload('git:commit-message', gitCommitMessagePayloadSchema, payload)
    return generateGitCommitMessage(await withRegistryCredentials(await options.store.load()), request)
  })
}
