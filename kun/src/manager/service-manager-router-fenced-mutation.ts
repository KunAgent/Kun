import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { jsonResponse, type JsonResponse } from '../server/response.js'
import {
  ManagerResourceFenceSchema,
  RESOURCE_COMMIT_TTL_MS,
  ResourceFenceStaleError
} from './resource-lease-state.js'
import type { ServiceManagerState } from './service-manager-state.js'

export async function flushRenewal(
  input: {
    flushState?: () => Promise<void>
    flushStateForRenewal?: (ttlMs: number) => Promise<void>
  },
  ttlMs: number
): Promise<void> {
  if (input.flushStateForRenewal) {
    await input.flushStateForRenewal(ttlMs)
    return
  }
  await input.flushState?.()
}

export async function fencedAtomicJsonMutation<T>(
  input: {
    state: ServiceManagerState
    flushState?: () => Promise<void>
    flushStateForRenewal?: (ttlMs: number) => Promise<void>
  },
  mutation: { fence?: z.infer<typeof ManagerResourceFenceSchema>; commitId?: string },
  operation: (commitId?: string) => Promise<T>
): Promise<JsonResponse> {
  const needsReservation = Boolean(mutation.fence && !mutation.commitId)
  const commitId = mutation.commitId ?? (needsReservation ? randomUUID() : undefined)
  if (mutation.fence && commitId && needsReservation) {
    const lease = input.state.beginResourceCommit(mutation.fence, commitId)
    if (!lease) return resourceFenceStale()
    await input.flushState?.()
  }
  let renewalInFlight: Promise<void> | undefined
  const renewalTimer = needsReservation && mutation.fence && commitId
    ? setInterval(() => {
        if (renewalInFlight) return
        renewalInFlight = Promise.resolve().then(async () => {
          const lease = input.state.renewResourceCommit(mutation.fence!, commitId)
          if (!lease) throw new ResourceFenceStaleError()
          await flushRenewal(input, RESOURCE_COMMIT_TTL_MS)
        }).finally(() => { renewalInFlight = undefined })
        void renewalInFlight.catch(() => undefined)
      }, 3_000)
    : undefined
  renewalTimer?.unref?.()
  try {
    if (mutation.fence && commitId) input.state.assertResourceCommit(mutation.fence, commitId)
    return jsonResponse({ snapshot: await operation(commitId) })
  } finally {
    if (renewalTimer) clearInterval(renewalTimer)
    if (renewalInFlight) await renewalInFlight
    if (mutation.fence && commitId && needsReservation) {
      input.state.endResourceCommit(mutation.fence, commitId)
      await input.flushState?.()
    }
  }
}

export function resourceFenceStale(): JsonResponse {
  return jsonResponse({
    code: 'resource_fence_stale',
    message: 'resource lease fencing token is no longer current'
  }, 409)
}

export function isResourceFenceStale(error: unknown): boolean {
  return error instanceof ResourceFenceStaleError ||
    (error instanceof Error && error.cause instanceof ResourceFenceStaleError)
}
