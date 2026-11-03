import {
  ipcMain
} from 'electron'
import {
  gitBranchPayloadSchema,
  gitCheckpointCreatePayloadSchema,
  gitCheckpointRestorePayloadSchema,
  gitWorktreeRemoveSchema,
  openEditorPathPayloadSchema,
  worktreeCommitSchema,
  worktreeContinueMergeSchema,
  worktreeMergeSchema,
  worktreePoolIndexSchema,
  worktreePoolSchema,
  worktreeProjectPathSchema,
  worktreeOptionalRootSchema,
  worktreePathSchema,
  workspaceRootSchema
} from './app-ipc-schemas'
import {
  DEFAULT_KUN_DATA_DIR,
  resolveKunRuntimeSettings
} from '../../shared/app-settings'
import {
  checkoutGitBranchWorktree,
  createAndSwitchGitBranch,
  createGitBranchWorktree,
  getGitBranches,
  listGitBranchWorktrees,
  removeGitBranchWorktree,
  switchGitBranch
} from '../services/git-service'
import { getGitFileStatus } from '../services/git-file-status'
import {
  createGitCheckpoint,
  failGitCheckpointGate,
  restoreGitCheckpoint,
  type GitCheckpointStorageOptions
} from '../services/git-checkpoint-service'
import {
  abortMerge,
  abortRebase,
  acquireWorktree,
  cleanupWorktrees,
  commitWorktree,
  continueMerge,
  findAvailablePoolIndex,
  getWorktreeChanges,
  listWorktrees,
  mergeWorktreeToMain,
  releaseWorktree,
  removeWorktree,
  syncWorktreeFromMain
} from '../services/worktree-service'
import {
  expandHomePath,
  listEditorsResult,
  openEditorPath
} from '../services/workspace-service'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { parseIpcPayload } from './app-ipc-handler-utils'

export function registerAppGitIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  const { store, runtimeRequest } = options
  const resolveKunThreadsDataDir = async (): Promise<string> => {
    const settings = await store.load()
    const runtime = resolveKunRuntimeSettings(settings)
    return expandHomePath(runtime.dataDir?.trim() || DEFAULT_KUN_DATA_DIR)
  }

  // Map the user's checkpoint settings (issue #651) to the service storage
  // options: an optional directory override (e.g. another drive) and the
  // per-thread retention cap. Home-relative paths are expanded.
  const resolveCheckpointStorageOptions = (
    cfg: { directory?: string, maxPerThread?: number, maxTotalBytes?: number, minFreeDiskBytes?: number }
  ): GitCheckpointStorageOptions => ({
    ...(cfg.directory?.trim() ? { checkpointsRoot: expandHomePath(cfg.directory.trim()) } : {}),
    ...(cfg.maxPerThread !== undefined ? { maxPerThread: cfg.maxPerThread } : {}),
    ...(cfg.maxTotalBytes !== undefined ? { maxTotalBytes: cfg.maxTotalBytes } : {}),
    ...(cfg.minFreeDiskBytes !== undefined ? { minFreeDiskBytes: cfg.minFreeDiskBytes } : {})
  })
  ipcMain.handle('git:branches', async (_, workspaceRoot: unknown) =>
    getGitBranches(parseIpcPayload('git:branches', workspaceRootSchema, workspaceRoot))
  )
  ipcMain.handle('git:status-files', async (_, workspaceRoot: unknown) =>
    getGitFileStatus(parseIpcPayload('git:status-files', workspaceRootSchema, workspaceRoot))
  )
  ipcMain.handle(
    'git:switch-branch',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('git:switch-branch', gitBranchPayloadSchema, payload)
      return switchGitBranch(request.workspaceRoot, request.branch)
    }
  )
  ipcMain.handle(
    'git:create-and-switch-branch',
    async (_, payload: unknown) => {
      const request = parseIpcPayload(
        'git:create-and-switch-branch',
        gitBranchPayloadSchema,
        payload
      )
      return createAndSwitchGitBranch(request.workspaceRoot, request.branch)
    }
  )
  ipcMain.handle('git:checkpoint:create', async (_, payload: unknown) => {
    const request = parseIpcPayload('git:checkpoint:create', gitCheckpointCreatePayloadSchema, payload)
    const settings = await store.load()
    if (!settings.checkpointCleanup.createEnabled) {
      if (request.checkpointId) {
        await failGitCheckpointGate(
          await resolveKunThreadsDataDir(),
          request.checkpointId,
          'disabled',
          'Git checkpoint creation is disabled in settings.'
        ).catch(() => undefined)
      }
      return {
        ok: false as const,
        reason: 'disabled' as const,
        message: 'Git checkpoint creation is disabled in settings.'
      }
    }
    return createGitCheckpoint({
      dataDir: await resolveKunThreadsDataDir(),
      workspaceRoot: request.workspaceRoot,
      threadId: request.threadId,
      ...(request.checkpointId ? { checkpointId: request.checkpointId } : {}),
      deferRetention: true,
      storage: resolveCheckpointStorageOptions(settings.checkpointCleanup)
    })
  })
  ipcMain.handle('git:checkpoint:restore', async (_, payload: unknown) => {
    const request = parseIpcPayload('git:checkpoint:restore', gitCheckpointRestorePayloadSchema, payload)
    const settings = await store.load()
    return restoreGitCheckpoint({
      dataDir: await resolveKunThreadsDataDir(),
      checkpointId: request.checkpointId,
      ...(request.allowPartialRestore ? { allowPartialRestore: true } : {}),
      ...(request.expectedThreadId ? { expectedThreadId: request.expectedThreadId } : {}),
      ...(request.expectedWorkspaceRoot ? { expectedWorkspaceRoot: request.expectedWorkspaceRoot } : {}),
      storage: resolveCheckpointStorageOptions(settings.checkpointCleanup),
      // Bridge the main-process runtimeRequest into the shape restoreGitCheckpoint
      // expects ((path, {method, body}) => {ok,status,body}). On a transport-level
      // failure (runtime not up, connection refused) we return a non-ok result so
      // the busy guard fails closed instead of throwing past the handler.
      runtimeRequest: async (path, init) => {
        try {
          return await runtimeRequest(path, init?.method, init?.body)
        } catch (error) {
          return { ok: false, status: 0, body: error instanceof Error ? error.message : String(error) }
        }
      }
    })
  })
  ipcMain.handle(
    'git:checkout-branch-worktree',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('git:checkout-branch-worktree', gitBranchPayloadSchema, payload)
      return checkoutGitBranchWorktree(request.workspaceRoot, request.branch)
    }
  )
  ipcMain.handle(
    'git:create-branch-worktree',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('git:create-branch-worktree', gitBranchPayloadSchema, payload)
      return createGitBranchWorktree(request.workspaceRoot, request.branch)
    }
  )
  ipcMain.handle('git:branch-worktrees', async (_, payload: unknown) => {
    const request = parseIpcPayload('git:branch-worktrees', worktreePoolSchema, payload)
    return listGitBranchWorktrees(request.projectPath, request.worktreeRoot)
  })
  ipcMain.handle('git:remove-branch-worktree', async (_, payload: unknown) => {
    const request = parseIpcPayload('git:remove-branch-worktree', gitWorktreeRemoveSchema, payload)
    return removeGitBranchWorktree(request)
  })

  // Worktree pool management
  ipcMain.handle('worktree:acquire', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:acquire', worktreeOptionalRootSchema, payload)
    return acquireWorktree({
      projectPath: r.projectPath,
      poolIndex: r.poolIndex,
      taskId: r.taskId,
      force: r.force,
      worktreeRoot: r.worktreeRoot
    })
  })
  ipcMain.handle('worktree:release', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:release', worktreePoolIndexSchema, payload)
    return releaseWorktree({ projectPath: r.projectPath, poolIndex: r.poolIndex })
  })
  ipcMain.handle('worktree:list', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:list', worktreePoolSchema, payload)
    return listWorktrees({ projectPath: r.projectPath, worktreeRoot: r.worktreeRoot })
  })
  ipcMain.handle('worktree:remove', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:remove', worktreePoolIndexSchema, payload)
    return removeWorktree({
      projectPath: r.projectPath,
      poolIndex: r.poolIndex,
      worktreeRoot: r.worktreeRoot
    })
  })
  ipcMain.handle('worktree:changes', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:changes', worktreePathSchema, payload)
    return getWorktreeChanges({ worktreePath: r.worktreePath })
  })
  ipcMain.handle('worktree:commit', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:commit', worktreeCommitSchema, payload)
    return commitWorktree({ worktreePath: r.worktreePath, message: r.message })
  })
  ipcMain.handle('worktree:merge', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:merge', worktreeMergeSchema, payload)
    return mergeWorktreeToMain({
      projectPath: r.projectPath,
      poolIndex: r.poolIndex,
      commitMessage: r.commitMessage,
      worktreeRoot: r.worktreeRoot
    })
  })
  ipcMain.handle('worktree:abort-merge', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:abort-merge', worktreeProjectPathSchema, payload)
    return abortMerge({ projectPath: r.projectPath })
  })
  ipcMain.handle('worktree:continue-merge', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:continue-merge', worktreeContinueMergeSchema, payload)
    return continueMerge({ projectPath: r.projectPath, message: r.message })
  })
  ipcMain.handle('worktree:sync', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:sync', worktreePoolIndexSchema, payload)
    return syncWorktreeFromMain({
      projectPath: r.projectPath,
      poolIndex: r.poolIndex,
      worktreeRoot: r.worktreeRoot
    })
  })
  ipcMain.handle('worktree:abort-rebase', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:abort-rebase', worktreePathSchema, payload)
    return abortRebase({ worktreePath: r.worktreePath })
  })
  ipcMain.handle('worktree:cleanup', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:cleanup', worktreePoolSchema, payload)
    return cleanupWorktrees({ projectPath: r.projectPath, worktreeRoot: r.worktreeRoot })
  })
  ipcMain.handle('worktree:find-available', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:find-available', worktreePoolSchema, payload)
    return findAvailablePoolIndex({ projectPath: r.projectPath, worktreeRoot: r.worktreeRoot })
  })

  ipcMain.handle('editor:list', async () => listEditorsResult())
  ipcMain.handle('editor:open-path', async (_, payload: unknown) =>
    openEditorPath(parseIpcPayload('editor:open-path', openEditorPathPayloadSchema, payload))
  )

}
