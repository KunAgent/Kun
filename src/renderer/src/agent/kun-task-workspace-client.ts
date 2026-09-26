import type {
  CreateTaskWorkspaceRequest,
  PreservedBranchesResponse,
  TaskWorkspaceDiffFileResponse,
  TaskWorkspaceDiffListResponse,
  TaskWorkspaceDiscardPreview,
  TaskWorkspaceIntegrateMode,
  TaskWorkspaceIntegratePreviewResponse,
  TaskWorkspaceIntegrateResponse,
  TaskWorkspaceListResponse,
  TaskWorkspaceRecordResponse
} from '@shared/task-workspace'
import { KUN_TASK_WORKSPACES_PATH, kunTaskWorkspacePath } from '@shared/kun-endpoints'
import { runtimeErrorToError } from '@shared/runtime-error'
import { buildQuery } from './kun-query'
import { rendererRuntimeClient } from './runtime-client'
import { readRuntimeError, readRuntimeJson } from './kun-runtime-services'

/**
 * /v1/task-workspaces client surface (docs/ade/07 §11, 11 §3): bound
 * workspace lookup plus the review diff endpoints consumed by the review
 * panel. Standalone client the provider delegates to for the file gate.
 */
export function createKunTaskWorkspaceClient() {
  const get = async <T>(path: string, fallback: string): Promise<T> => {
    const response = await rendererRuntimeClient.runtimeRequest(path, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, fallback))
    }
    return readRuntimeJson<T>(response.body, 'runtime returned an invalid response')
  }

  const post = async <T>(path: string, body: unknown, fallback: string): Promise<T> => {
    const response = await rendererRuntimeClient.runtimeRequest(path, 'POST', JSON.stringify(body))
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, fallback))
    }
    return readRuntimeJson<T>(response.body, 'runtime returned an invalid response')
  }

  return {
    /** Workspaces bound to a thread (ownerThreadId or unitId match). */
    listTaskWorkspaces(options: {
      boundThreadId?: string
      ownerThreadId?: string
    } = {}): Promise<TaskWorkspaceListResponse> {
      const query = buildQuery({
        boundThreadId: options.boundThreadId,
        ownerThreadId: options.ownerThreadId
      })
      return get(
        `${KUN_TASK_WORKSPACES_PATH}${query}`,
        'failed to load task workspaces'
      )
    },

    /**
     * New task workspace for a composer-picked isolation (07 §5). Returns the
     * `creating` record immediately; readiness arrives via `task_workspace`.
     */
    createTaskWorkspace(
      input: CreateTaskWorkspaceRequest
    ): Promise<TaskWorkspaceRecordResponse> {
      return post(
        KUN_TASK_WORKSPACES_PATH,
        input,
        'failed to create task workspace'
      )
    },

    /** Per-file diff stats after a fresh capture (docs/ade/11 §3). */
    getTaskWorkspaceDiff(workspaceId: string): Promise<TaskWorkspaceDiffListResponse> {
      return get(
        kunTaskWorkspacePath(workspaceId, '/diff'),
        'failed to load task workspace diff'
      )
    },

    /** One file's patch plus old/new texts (stats only when binary/large). */
    getTaskWorkspaceDiffFile(
      workspaceId: string,
      path: string
    ): Promise<TaskWorkspaceDiffFileResponse> {
      const query = buildQuery({ path })
      return get(
        `${kunTaskWorkspacePath(workspaceId, '/diff/file')}${query}`,
        'failed to load task workspace file diff'
      )
    },

    /** Read-only availability for the review primary action (11 §7.1). */
    getTaskWorkspaceIntegratePreview(
      workspaceId: string
    ): Promise<TaskWorkspaceIntegratePreviewResponse> {
      return get(
        kunTaskWorkspacePath(workspaceId, '/integrate-preview'),
        'failed to load integrate preview'
      )
    },

    /** Integrate the worktree back into its source checkout (user action). */
    integrateTaskWorkspace(
      workspaceId: string,
      mode: TaskWorkspaceIntegrateMode
    ): Promise<TaskWorkspaceIntegrateResponse> {
      return post(
        kunTaskWorkspacePath(workspaceId, '/integrate'),
        { mode },
        'failed to integrate task workspace'
      )
    },

    /**
     * Damage preview for the discard confirmation dialog: POSTs without
     * `confirm`, reading the 409 `{ uncommittedFiles, unpushedCommits }`.
     */
    async previewTaskWorkspaceDiscard(
      workspaceId: string
    ): Promise<TaskWorkspaceDiscardPreview> {
      const response = await rendererRuntimeClient.runtimeRequest(
        kunTaskWorkspacePath(workspaceId, '/discard'), 'POST', '{}'
      )
      if (response.status === 409) {
        const body = readRuntimeJson<{ preview: TaskWorkspaceDiscardPreview }>(
          response.body, 'runtime returned an invalid discard preview'
        )
        return body.preview
      }
      if (!response.ok) {
        throw runtimeErrorToError(readRuntimeError(response.body, 'failed to preview discard'))
      }
      // Already gone: nothing left to discard.
      return { uncommittedFiles: 0, unpushedCommits: 0 }
    },

    /** Force-remove the worktree + branch; requires `confirm: true`. */
    discardTaskWorkspace(workspaceId: string): Promise<TaskWorkspaceRecordResponse> {
      return post(
        kunTaskWorkspacePath(workspaceId, '/discard'),
        { confirm: true },
        'failed to discard task workspace'
      )
    },

    /** Non-force worktree removal after a successful integrate. */
    cleanupTaskWorkspace(workspaceId: string): Promise<TaskWorkspaceRecordResponse> {
      return post(
        kunTaskWorkspacePath(workspaceId, '/cleanup'),
        {},
        'failed to clean up task workspace'
      )
    },

    /** Branches cleanup declined to delete; users review them (07 §8.3). */
    listPreservedBranches(repoRoot: string): Promise<PreservedBranchesResponse> {
      return get(
        `${KUN_TASK_WORKSPACES_PATH}/preserved-branches${buildQuery({ repo: repoRoot })}`,
        'failed to load preserved branches'
      )
    }
  }
}

export type KunTaskWorkspaceClient = ReturnType<typeof createKunTaskWorkspaceClient>
