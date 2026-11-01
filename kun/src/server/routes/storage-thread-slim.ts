import { z } from 'zod'
import type { Router } from '../router.js'
import type { ThreadRecord } from '../../contracts/threads.js'
import { isActiveTurn } from '../../services/turn-service-core.js'
import { withManagerDataMutex } from '../../manager/data-mutex.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'

/**
 * Storage cleanup "slim": drop the replay event log of long-idle threads while
 * keeping their canonical messages. Thread detail hydrates from items, so the
 * conversation stays readable; only per-delta replay history goes away. The
 * trim keeps the newest event, so `highestSeq()` and the replay floor protocol
 * (SSE `replay_reset_required`) stay intact.
 */

const MAX_THREADS_PER_REQUEST = 500

const StorageThreadIdsRequest = z.object({
  threadIds: z.array(z.string().trim().min(1)).max(MAX_THREADS_PER_REQUEST),
  /** Only threads last updated before this instant are eligible. */
  idleBefore: z.string().datetime()
})

export type StorageSlimSkipReason =
  | 'missing'
  | 'recent'
  | 'pinned'
  | 'active'
  | 'room'
  | 'goal'
  | 'already_slim'

export type StorageSlimCandidate = {
  threadId: string
  eligible: boolean
  skipReason?: StorageSlimSkipReason
  title?: string
  workspace?: string
  updatedAt?: string
}

function skipReason(thread: ThreadRecord | null, idleBeforeMs: number): StorageSlimSkipReason | undefined {
  if (!thread || thread.status === 'deleted') return 'missing'
  if (thread.pinned === true) return 'pinned'
  if (thread.status === 'running' || thread.turns.some(isActiveTurn)) return 'active'
  if (thread.roomContext) return 'room'
  const goalStatus = (thread.goal as { status?: string } | undefined)?.status
  if (goalStatus === 'active') return 'goal'
  const updatedMs = Date.parse(thread.updatedAt)
  if (!Number.isFinite(updatedMs) || updatedMs >= idleBeforeMs) return 'recent'
  return undefined
}

async function readRequest(request: Request): Promise<
  { ok: true; threadIds: string[]; idleBeforeMs: number } | { ok: false; response: JsonResponse }
> {
  const body = await readJsonBody(request)
  if (!body.ok) return body
  const parsed = StorageThreadIdsRequest.safeParse(body.value)
  if (!parsed.success) return { ok: false, response: jsonResponse({ error: 'invalid storage thread body' }, 400) }
  return { ok: true, threadIds: [...new Set(parsed.data.threadIds)], idleBeforeMs: Date.parse(parsed.data.idleBefore) }
}

export async function previewThreadSlim(runtime: ServerRuntime, request: Request): Promise<JsonResponse> {
  const input = await readRequest(request)
  if (!input.ok) return input.response
  const candidates: StorageSlimCandidate[] = []
  for (const threadId of input.threadIds) {
    const thread = await runtime.threadService.getMetadata(threadId).catch(() => null)
    const reason = skipReason(thread, input.idleBeforeMs)
    candidates.push({
      threadId,
      eligible: reason === undefined,
      ...(reason ? { skipReason: reason } : {}),
      ...(thread?.title ? { title: thread.title } : {}),
      ...(thread?.workspace ? { workspace: thread.workspace } : {}),
      ...(thread?.updatedAt ? { updatedAt: thread.updatedAt } : {})
    })
  }
  return jsonResponse({ candidates })
}

type SlimOutcome = { trimmed?: { afterBytes: number }; reason?: StorageSlimSkipReason }

export async function applyThreadSlim(runtime: ServerRuntime, request: Request): Promise<JsonResponse> {
  const input = await readRequest(request)
  if (!input.ok) return input.response
  const store = runtime.sessionStore
  if (!store.trimEventsFromSeq) return ERRORS.unavailable('session store cannot trim event logs')
  const slimmed: Array<{ threadId: string; afterBytes: number }> = []
  const skipped: Array<{ threadId: string; reason: StorageSlimSkipReason | 'failed' }> = []
  for (const threadId of input.threadIds) {
    try {
      const result: SlimOutcome = await withManagerDataMutex(`thread:${threadId}`, async () => {
        // Re-check under the thread lock: the preview may be a day old.
        const thread = await runtime.threadService.getMetadata(threadId).catch(() => null)
        const reason = skipReason(thread, input.idleBeforeMs)
        if (reason) return { reason } as SlimOutcome
        const highWater = await store.highestSeq(threadId)
        const floor = await store.eventReplayFloorSeq?.(threadId) ?? 0
        if (highWater <= 1 || floor >= highWater) return { reason: 'already_slim' } as SlimOutcome
        return { trimmed: await store.trimEventsFromSeq!(threadId, highWater) } as SlimOutcome
      })
      if (result.trimmed) slimmed.push({ threadId, afterBytes: result.trimmed.afterBytes })
      else skipped.push({ threadId, reason: result.reason ?? 'failed' })
    } catch (error) {
      console.warn(`[kun] storage slim failed for ${threadId}: ${error instanceof Error ? error.message : String(error)}`)
      skipped.push({ threadId, reason: 'failed' })
    }
  }
  return jsonResponse({ slimmed, skipped })
}

export function registerStorageRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('POST', '/v1/storage/threads/slim/preview', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return previewThreadSlim(runtime, request)
  })
  router.add('POST', '/v1/storage/threads/slim', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return applyThreadSlim(runtime, request)
  })
}
