import type {
  TaskWorkspaceDiffFileResponse,
  TaskWorkspaceDiffListResponse,
  TaskWorkspaceListResponse
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
    }
  }
}

export type KunTaskWorkspaceClient = ReturnType<typeof createKunTaskWorkspaceClient>
