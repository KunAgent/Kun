import { resolve } from 'node:path'
import { jsonResponse, type JsonResponse } from '../response.js'
import type { ActivityStore } from '../../services/activity-store.js'
import type { ActivityFactsStore } from '../../services/activity-facts-store.js'
import {
  ACTIVITY_FOREGROUND_TTL_MS,
  type ActivityHibernation
} from '../../services/activity-hibernation.js'

const HEARTBEAT_MS = 15_000
const MAX_WAIT_MS = 30_000

/**
 * GET /v1/activity — snapshot of all rows plus the change cursor.
 * scope=workspace narrows rows to one normalized workspace path.
 */
export function activitySnapshotResponse(
  store: ActivityStore,
  request: Request
): JsonResponse {
  const url = new URL(request.url)
  const scope = url.searchParams.get('scope') ?? 'all'
  const workspace = url.searchParams.get('workspace') ?? undefined
  if (scope !== 'all' && scope !== 'workspace') {
    return jsonResponse({ code: 'validation_error', message: 'invalid scope' }, 400)
  }
  if (scope === 'workspace' && !workspace?.trim()) {
    return jsonResponse(
      { code: 'validation_error', message: 'workspace is required for scope=workspace' },
      400
    )
  }
  const rows = store.list()
  const filtered = scope === 'workspace' && workspace
    ? rows.filter((row) => {
        if (!row.workspace.path) return false
        try {
          return resolve(row.workspace.path) === resolve(workspace)
        } catch {
          return row.workspace.path === workspace
        }
      })
    : rows
  return jsonResponse({ cursor: store.cursor(), rows: filtered })
}

/**
 * GET /v1/activity/events — JSON long poll (wait_ms ≤ 30s) or an SSE
 * stream with a 15s heartbeat, mirroring /v1/thread-activity/events.
 */
export async function activityEventsResponse(
  store: ActivityStore,
  request: Request
): Promise<Response | JsonResponse> {
  if (request.headers.get('accept')?.includes('text/event-stream')) {
    return activityEventStream(store, request)
  }
  const url = new URL(request.url)
  const cursor = url.searchParams.get('cursor') ?? undefined
  const waitRaw = url.searchParams.get('wait_ms')
  const waitMs = waitRaw === null ? 0 : Number(waitRaw)
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > MAX_WAIT_MS) {
    return jsonResponse({ code: 'validation_error', message: 'invalid wait_ms' }, 400)
  }
  let result = store.changesSince(cursor)
  if (cursor && !result.resetRequired && result.batch.changes.length === 0 && waitMs > 0) {
    await store.waitForChange(request.signal, waitMs)
    result = store.changesSince(cursor)
  }
  return jsonResponse(result.resetRequired
    ? { type: 'reset_required', cursor: result.cursor, reason: result.reason }
    : { type: 'activity', ...result.batch })
}

export function activityEventStream(store: ActivityStore, request: Request): Response {
  const cursor = new URL(request.url).searchParams.get('cursor') ?? undefined
  const encoder = new TextEncoder()
  let closed = false
  let unsubscribe: (() => void) | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let removeAbort: (() => void) | undefined
  let deliveredCursor = cursor

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = (): void => {
        if (closed) return
        closed = true
        unsubscribe?.()
        if (heartbeat) clearInterval(heartbeat)
        removeAbort?.()
        try { controller.close() } catch { /* consumer already closed */ }
      }
      const send = (): void => {
        if (closed) return
        const result = store.changesSince(deliveredCursor)
        try {
          if (result.resetRequired) {
            controller.enqueue(encoder.encode(
              `event: reset_required\ndata: ${JSON.stringify({ cursor: result.cursor, reason: result.reason })}\n\n`
            ))
            deliveredCursor = result.cursor
            return
          }
          if (result.batch.changes.length > 0) {
            controller.enqueue(encoder.encode(
              `id: ${result.batch.cursor}\nevent: activity\ndata: ${JSON.stringify(result.batch)}\n\n`
            ))
          } else if (!deliveredCursor) {
            controller.enqueue(encoder.encode(
              `id: ${result.batch.cursor}\nevent: synchronized\ndata: ${JSON.stringify({ cursor: result.batch.cursor })}\n\n`
            ))
          }
          deliveredCursor = result.batch.cursor
        } catch {
          close()
        }
      }
      const abort = (): void => close()
      request.signal.addEventListener('abort', abort, { once: true })
      removeAbort = () => request.signal.removeEventListener('abort', abort)
      unsubscribe = store.subscribe(send)
      send()
      heartbeat = setInterval(() => {
        if (closed) return
        try { controller.enqueue(encoder.encode(': heartbeat\n\n')) } catch { close() }
      }, HEARTBEAT_MS)
      heartbeat.unref?.()
    },
    cancel() {
      closed = true
      unsubscribe?.()
      if (heartbeat) clearInterval(heartbeat)
      removeAbort?.()
    }
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    }
  })
}

/**
 * POST /v1/activity/foreground — a client reports the thread currently in
 * its foreground; the mark expires after 30 s (docs/ade/06 §7.2 cond. 4).
 */
export async function activityForegroundResponse(
  hibernation: ActivityHibernation,
  request: Request
): Promise<JsonResponse> {
  const body = (await request.json().catch(() => undefined)) as
    | { threadId?: unknown }
    | undefined
  const threadId = typeof body?.threadId === 'string' ? body.threadId : ''
  if (!threadId || threadId.length > 256) {
    return jsonResponse({ code: 'validation_error', message: 'invalid threadId' }, 400)
  }
  hibernation.markForeground(threadId)
  return jsonResponse({ threadId, expiresInMs: ACTIVITY_FOREGROUND_TTL_MS })
}

type UserFactMutation = 'ack' | 'dismiss' | 'pin'

/**
 * POST /v1/activity/:unitId/{ack,dismiss,pin} — persist the user fact and
 * apply it to the live row so every client sees the change. The row's
 * provenance is intentionally unchanged (docs/ade/06 §4.1).
 */
export async function activityFactResponse(
  store: ActivityStore,
  facts: ActivityFactsStore,
  request: Request,
  unitId: string,
  mutation: UserFactMutation,
  nowIso: () => string
): Promise<JsonResponse> {
  if (!unitId) {
    return jsonResponse({ code: 'validation_error', message: 'missing unitId' }, 400)
  }
  let pinned: boolean | undefined
  if (mutation === 'pin') {
    try {
      const body = (await request.json().catch(() => undefined)) as { pinned?: unknown } | undefined
      pinned = typeof body?.pinned === 'boolean' ? body.pinned : undefined
    } catch {
      pinned = undefined
    }
  }
  const patch =
    mutation === 'ack'
      ? { acknowledgedAt: nowIso() }
      : mutation === 'dismiss'
        ? { dismissedAt: nowIso() }
        : { pinned: pinned ?? true }
  const fact = facts.setFact(unitId, patch)
  const row = store.get(unitId)
  if (row) store.apply(unitId, patch, row.provenance)
  return jsonResponse({ unitId, fact })
}
