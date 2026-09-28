import type { ActivityPollResponse, ActivitySnapshotResponse } from '@shared/activity-row'
import {
  KUN_ACTIVITY_EVENTS_PATH,
  KUN_ACTIVITY_FOREGROUND_PATH,
  KUN_ACTIVITY_PATH,
  KUN_APPROVALS_PATH,
  kunActivityUnitPath
} from '@shared/kun-endpoints'
import type { PendingApprovalItem } from '@shared/ade-approvals'
import { runtimeErrorToError } from '@shared/runtime-error'
import { buildQuery } from './kun-query'
import { rendererRuntimeClient } from './runtime-client'
import { readRuntimeError, readRuntimeJson } from './kun-runtime-services'

/**
 * /v1/activity client surface (docs/ade/06 §9): snapshot + long-poll feed,
 * per-unit user facts, and the foreground report used by dormancy. Kept as
 * a standalone client the provider delegates to so kun-runtime.ts stays
 * under the file-size gate.
 */
export function createKunActivityClient() {
  const mutateActivityFact = async (
    unitId: string,
    action: 'ack' | 'dismiss' | 'pin',
    body?: string
  ): Promise<void> => {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunActivityUnitPath(unitId, action),
      'POST',
      body
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, `failed to ${action} activity`))
    }
  }

  return {
    /** Execution-unit activity snapshot (docs/ade/06 §9). */
    async getActivitySnapshot(options: {
      scope?: 'all' | 'workspace'
      workspace?: string
    } = {}): Promise<ActivitySnapshotResponse> {
      const query = buildQuery({
        scope: options.scope ?? 'all',
        workspace: options.workspace
      })
      const response = await rendererRuntimeClient.runtimeRequest(
        `${KUN_ACTIVITY_PATH}${query}`,
        'GET'
      )
      if (!response.ok) {
        throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load activity'))
      }
      return readRuntimeJson<ActivitySnapshotResponse>(
        response.body,
        'runtime returned an invalid activity snapshot'
      )
    },

    /** Long-poll execution-unit activity changes after `cursor`. */
    async pollActivity(
      cursor: string,
      waitMs: number,
      signal?: AbortSignal
    ): Promise<ActivityPollResponse> {
      const query = buildQuery({ cursor, wait_ms: waitMs })
      const response = await rendererRuntimeClient.runtimeRequest(
        `${KUN_ACTIVITY_EVENTS_PATH}${query}`,
        'GET',
        undefined,
        signal ? { signal } : {}
      )
      if (!response.ok) {
        throw runtimeErrorToError(readRuntimeError(response.body, 'failed to poll activity'))
      }
      return readRuntimeJson<ActivityPollResponse>(
        response.body,
        'runtime returned an invalid activity events response'
      )
    },

    /**
     * Pending approval requests, optionally scoped to one thread (P3-19).
     * The mobile attention surface resolves approval ids per waiting row.
     */
    async listPendingApprovals(threadId?: string): Promise<PendingApprovalItem[]> {
      const query = buildQuery({ threadId })
      const response = await rendererRuntimeClient.runtimeRequest(
        `${KUN_APPROVALS_PATH}${query}`,
        'GET'
      )
      if (!response.ok) {
        throw runtimeErrorToError(
          readRuntimeError(response.body, 'failed to list pending approvals')
        )
      }
      return readRuntimeJson<{ approvals: PendingApprovalItem[] }>(
        response.body,
        'runtime returned an invalid approvals response'
      ).approvals
    },

    ackActivity: (unitId: string): Promise<void> => mutateActivityFact(unitId, 'ack'),

    dismissActivity: (unitId: string): Promise<void> =>
      mutateActivityFact(unitId, 'dismiss'),

    pinActivity: (unitId: string, pinned = true): Promise<void> =>
      mutateActivityFact(unitId, 'pin', JSON.stringify({ pinned })),

    /** Report the thread currently in this client's foreground (06 §7.2). */
    async reportActivityForeground(threadId: string): Promise<void> {
      const response = await rendererRuntimeClient.runtimeRequest(
        KUN_ACTIVITY_FOREGROUND_PATH,
        'POST',
        JSON.stringify({ threadId })
      )
      if (!response.ok) {
        throw runtimeErrorToError(
          readRuntimeError(response.body, 'failed to report activity foreground')
        )
      }
    }
  }
}

export type KunActivityClient = ReturnType<typeof createKunActivityClient>
