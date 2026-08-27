import { z } from 'zod'
import {
  CreateThreadRequest,
  ClearThreadGoalResponse,
  ClearThreadTodosResponse,
  DeleteThreadResponse,
  ForkThreadRequest,
  ListThreadsResponse,
  ThreadListSummarySchema,
  ThreadSummarySchema,
  SetThreadGoalRequest,
  SetThreadTodosRequest,
  ThreadGoalResponse,
  ThreadRuntimeStateBatchRequestSchema,
  ThreadRuntimeStateBatchResponseSchema,
  ThreadRuntimeStateSchema,
  ThreadSchema,
  ThreadSchemaReadable,
  ThreadTimelineResponseSchema,
  ThreadTodosResponse,
  THREAD_TIMELINE_MAX_ITEM_BYTES,
  THREAD_TIMELINE_MAX_ITEMS,
  THREAD_RUNTIME_STATE_BATCH_CONCURRENCY,
  THREAD_RUNTIME_STATE_SCHEMA_VERSION,
  UpdateThreadRequest,
  type ThreadRecord
} from '../../contracts/threads.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { threadStateLoadFailure } from './thread-state-error.js'
import type { ForkThreadOptions, ListThreadsOptions, ThreadService } from '../../services/thread-service.js'
import type { RuntimeError } from './runtime-error.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { UserInputGate } from '../../ports/user-input-gate.js'
import type { ApprovalGate } from '../../ports/approval-gate.js'
import {
  isPublicTurnItem,
  type TurnItem
} from '../../contracts/items.js'
import { buildPublicItemHistoryPage } from '../../services/item-history-page.js'
import {
  healSessionItemsForFinishedTurns,
  hydrateThreadItemsFromSession,
  loadThreadMetadata,
  mergePendingApprovalItems,
  omitTurnItems,
  projectPublicThreadRecord,
  projectTimelineThread,
  projectTimelineTurn
} from './thread-projection.js'

/**
 * Handlers for the thread CRUD endpoints. The handlers accept a
 * pre-validated body when possible and otherwise parse it through
 * the contract Zod schema. Validation failures return HTTP 400.
 */
const BooleanQuery = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return value
}, z.boolean())

const ListThreadsQuery = z.object({
  limit: z.preprocess((value) => {
    if (typeof value !== 'string' || value.trim() === '') return undefined
    return Number(value)
  }, z.number().int().positive().max(500).optional()),
  search: z.string().optional(),
  include_archived: BooleanQuery.optional(),
  archived_only: BooleanQuery.optional(),
  /**
   * Comma-separated list of additional categories to include. Currently
   * the only opt-in category is `side` (side conversations are hidden
   * from the default listing).
   */
  include: z.string().optional(),
  /** Opaque keyset cursor for the next page of results. */
  cursor: z.string().optional(),
  /** Filter by workspace root path. */
  workspace: z.string().optional(),
  /** Return the lean sidebar projection (omits heavy metadata blobs). */
  lean: BooleanQuery.optional()
})

export async function listThreads(
  service: ThreadService,
  request: Request
): Promise<JsonResponse> {
  const parsed = parseListThreadsOptions(request)
  if (!parsed.ok) return parsed.response
  const page = await service.listPage(parsed.options)
  const threads = parsed.options.lean
    ? page.threads.map((thread) => ThreadListSummarySchema.parse(thread))
    : page.threads
  const payload: ListThreadsResponse = {
    threads,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    ...(page.hasMore ? { hasMore: page.hasMore } : {}),
    ...(page.total != null ? { total: page.total } : {})
  }
  return jsonResponse(payload)
}

export async function createThread(
  service: ThreadService,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = CreateThreadRequest.safeParse(body.value)
  if (!parsed.success) {
    return validationError('invalid create thread body', parsed.error.issues)
  }
  const thread = await service.create(parsed.data)
  return jsonResponse(ThreadSchema.parse(projectPublicThreadRecord(thread)), 201)
}

export async function getThread(
  service: ThreadService,
  threadId: string,
  sessionStore?: SessionStore,
  userInputGate?: UserInputGate,
  approvalGate?: ApprovalGate
): Promise<JsonResponse> {
  // Freeze the replay floor before reading the projection. Runtime writers
  // persist terminal/tool/goal state before appending the corresponding event,
  // so those records at or below this boundary are visible to the reads below.
  // Streaming text deltas follow the same state-first ordering and carry a
  // text offset, making a fragment replayed from the opposite hydration window
  // idempotent. Every event appended after this floor therefore remains safely
  // replayable without creating either an old-state/new-cursor gap or duplicate
  // assistant text.
  const latestSeq = sessionStore ? await sessionStore.highestSeq(threadId) : 0
  // With a durable session store, the thread metadata and items are separate
  // projections. Read only metadata here, then hydrate item history once
  // below; `service.get()` would otherwise transfer the same history first.
  let thread: ThreadRecord | null
  let loadedSessionItems: TurnItem[] | undefined
  if (sessionStore) {
    const loaded = await Promise.all([
      loadThreadMetadata(service, threadId),
      sessionStore.loadItems(threadId)
    ])
    thread = loaded[0]
    loadedSessionItems = loaded[1]
  } else {
    thread = await service.get(threadId)
  }
  if (!thread) {
    return jsonResponse(
      { code: 'not_found', message: `thread not found: ${threadId}` },
      404
    )
  }
  const pendingApprovals = approvalGate?.pending(threadId) ?? []
  let sessionItems: TurnItem[] = []
  if (sessionStore) {
    sessionItems = loadedSessionItems ?? []
    sessionItems = await healSessionItemsForFinishedTurns(thread, sessionItems, sessionStore)
  } else if (pendingApprovals.length > 0) {
    // Tests and lightweight embedded callers can omit the session store. Use
    // the thread's in-memory items as the merge base so recovering a live
    // approval never replaces the rest of that turn with only the card.
    sessionItems = thread.turns.flatMap((turn) => turn.items)
  }
  // Goal context belongs to canonical model history only. It has no event and
  // must not become visible through the GET snapshot used to hydrate the
  // renderer after reconnect or restart.
  sessionItems = sessionItems.filter(isPublicTurnItem)
  // Tool approvals intentionally remain event-only in history. A live gate is
  // the authoritative source during SSE recovery, so materialize only the
  // currently actionable requests rather than replaying the full events log
  // on every thread-detail poll.
  sessionItems = mergePendingApprovalItems(sessionItems, pendingApprovals)
  const hydratedThread = projectPublicThreadRecord(hydrateThreadItemsFromSession(thread, sessionItems))
  // Request ids the runtime is still actively awaiting. The renderer uses these
  // to tell a live ask-user prompt (answerable across reconnects) apart from a
  // stale `pending` item rehydrated from a finished thread (issue #606).
  const pendingUserInputIds = userInputGate?.pending(threadId).map((request) => request.id) ?? []
  // The renderer uses this live-gate list to distinguish an actionable approval
  // from a stale pending card rehydrated after its runtime request expired.
  const pendingApprovalIds = approvalGate
    ? pendingApprovals.map((request) => request.id)
    : undefined
  return jsonResponse({
    ...ThreadSchemaReadable.parse(hydratedThread),
    latestSeq,
    pendingUserInputIds,
    ...(pendingApprovalIds ? { pendingApprovalIds } : {})
  })
}

/**
 * Return just enough state to decide whether a background thread is still
 * running. This route intentionally never reads session items.
 */
export async function getThreadState(
  service: ThreadService,
  threadId: string,
  sessionStore?: SessionStore,
  userInputGate?: UserInputGate
): Promise<JsonResponse> {
  const state = await loadThreadRuntimeState(service, threadId, sessionStore, userInputGate)
  if (!state) {
    return jsonResponse(
      { code: 'not_found', message: `thread not found: ${threadId}` },
      404
    )
  }
  return jsonResponse(state)
}

/** Build the lightweight state projection without materializing item history. */
export async function loadThreadRuntimeState(
  service: ThreadService,
  threadId: string,
  sessionStore?: SessionStore,
  userInputGate?: UserInputGate
): Promise<z.infer<typeof ThreadRuntimeStateSchema> | null> {
  const [latestSeq, thread] = await Promise.all([
    sessionStore ? sessionStore.highestSeq(threadId) : Promise.resolve(0),
    loadThreadMetadata(service, threadId)
  ])
  if (!thread) {
    return null
  }
  const latestTurn = thread.turns.at(-1)
  return ThreadRuntimeStateSchema.parse({
    schemaVersion: THREAD_RUNTIME_STATE_SCHEMA_VERSION,
    id: thread.id,
    status: thread.status,
    updatedAt: thread.updatedAt,
    latestSeq,
    pendingUserInputIds: userInputGate?.pending(threadId).map((request) => request.id) ?? [],
    latestTurn: latestTurn
      ? {
          id: latestTurn.id,
          status: latestTurn.status,
          orchestration: latestTurn.orchestration === 'graph' ? 'graph' : 'direct'
        }
      : null
  })
}

/**
 * Resolve a bounded set of lightweight states. Failures stay scoped to their
 * thread so one unavailable execution owner cannot block the rest of the list.
 */
export async function getThreadStates(
  request: Request,
  loadState: (threadId: string) => Promise<z.infer<typeof ThreadRuntimeStateSchema> | null>
): Promise<JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = ThreadRuntimeStateBatchRequestSchema.safeParse(body.value)
  if (!parsed.success) {
    return validationError('invalid thread states body', parsed.error.issues)
  }
  const threadIds = [...new Set(parsed.data.threadIds)]
  const results: z.infer<typeof ThreadRuntimeStateBatchResponseSchema>['results'] =
    new Array(threadIds.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= threadIds.length) return
      const id = threadIds[index]
      const startedAt = Date.now()
      try {
        const state = await loadState(id)
        results[index] = state
          ? { id, ok: true, state }
          : { id, ok: false, error: { code: 'not_found', message: `thread not found: ${id}` } }
      } catch (error) {
        const failure = threadStateLoadFailure(error)
        // Diagnostics live in the log only; the public message stays generic
        // and never carries owner instance identifiers or internal details.
        console.warn(`[kun] thread state batch load failed: ${JSON.stringify({
          threadId: id,
          stage: failure.stage ?? 'load',
          durationMs: Date.now() - startedAt,
          httpStatus: failure.httpStatus,
          errorName: failure.errorName,
          code: failure.code
        })}`)
        results[index] = {
          id,
          ok: false,
          error: { code: failure.code, message: `thread state unavailable: ${id}` }
        }
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(THREAD_RUNTIME_STATE_BATCH_CONCURRENCY, threadIds.length) },
    worker
  ))
  return jsonResponse(ThreadRuntimeStateBatchResponseSchema.parse({ results }))
}

/**
 * Return a bounded public history window for normal renderer hydration. The
 * full-detail route remains available for compatibility clients.
 */
export async function getThreadTimeline(
  service: ThreadService,
  threadId: string,
  request: Request,
  sessionStore: SessionStore,
  userInputGate?: UserInputGate,
  approvalGate?: ApprovalGate
): Promise<JsonResponse> {
  const url = new URL(request.url)
  const parsedQuery = z.object({
    before: z.string().min(1).max(256).optional(),
    limit: z.preprocess((value) => {
      if (typeof value !== 'string' || value.trim() === '') return THREAD_TIMELINE_MAX_ITEMS
      return Number(value)
    }, z.number().int().positive().max(THREAD_TIMELINE_MAX_ITEMS))
  }).safeParse({
    before: url.searchParams.get('before') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined
  })
  if (!parsedQuery.success) {
    return validationError('invalid thread timeline query', parsedQuery.error.issues)
  }

  // Freeze the replay floor before reading the item projection. Any event
  // appended afterwards is replayed by SSE from this sequence.
  const latestSeq = await sessionStore.highestSeq(threadId)
  const thread = await loadThreadMetadata(service, threadId)
  if (!thread) {
    return jsonResponse(
      { code: 'not_found', message: `thread not found: ${threadId}` },
      404
    )
  }
  // The newest page keeps the active turn's opening user message anchored so
  // a long running turn cannot push the visible request onto an older page
  // that the renderer refuses to page back into while it is busy.
  const latestTurnId = thread.turns.at(-1)?.id
  const pageOptions = {
    ...(parsedQuery.data.before ? { before: parsedQuery.data.before } : {}),
    ...(!parsedQuery.data.before && latestTurnId ? { anchorTurnId: latestTurnId } : {}),
    maxItems: parsedQuery.data.limit,
    maxBytes: THREAD_TIMELINE_MAX_ITEM_BYTES
  }
  const page = sessionStore.loadItemPage
    ? await sessionStore.loadItemPage(threadId, pageOptions)
    : buildPublicItemHistoryPage(await sessionStore.loadItems(threadId), pageOptions)

  const pendingApprovals = approvalGate?.pending(threadId) ?? []
  let sessionItems = await healSessionItemsForFinishedTurns(
    thread,
    page.items.filter(isPublicTurnItem),
    sessionStore
  )
  // Only the newest page materializes live gates. Older pages are immutable
  // history and must not repeat the current approval card.
  if (!parsedQuery.data.before) {
    sessionItems = mergePendingApprovalItems(sessionItems, pendingApprovals)
  }
  // Re-apply the anchor after healing/merging so a newly materialized gate
  // item cannot push the active turn's user message back off the page.
  const bounded = buildPublicItemHistoryPage(sessionItems, {
    ...(!parsedQuery.data.before && latestTurnId ? { anchorTurnId: latestTurnId } : {}),
    maxItems: parsedQuery.data.limit,
    maxBytes: THREAD_TIMELINE_MAX_ITEM_BYTES
  })
  sessionItems = bounded.items
  const turnIds = new Set(sessionItems.map((item) => item.turnId))
  const pageThread = hydrateThreadItemsFromSession({
    ...thread,
    turns: thread.turns
      .filter((turn) => turnIds.has(turn.id))
      .map((turn) => ({ ...turn, items: [] }))
  }, sessionItems)
  const latestTurn = thread.turns.at(-1)
  const latestTurnMetadata = latestTurn
    ? omitTurnItems(projectTimelineTurn(latestTurn, []))
    : null
  const hasMore = page.hasMore || bounded.hasMore
  const nextCursor = bounded.hasMore
    ? bounded.nextCursor
    : page.nextCursor
  const pendingUserInputIds = userInputGate?.pending(threadId).map((value) => value.id) ?? []
  const pendingApprovalIds = approvalGate
    ? pendingApprovals.map((value) => value.id)
    : undefined

  return jsonResponse(ThreadTimelineResponseSchema.parse({
    ...ThreadSchemaReadable.parse(projectTimelineThread(pageThread)),
    latestSeq,
    latestTurn: latestTurnMetadata,
    pendingUserInputIds,
    ...(pendingApprovalIds ? { pendingApprovalIds } : {}),
    timeline: {
      ...(hasMore && nextCursor ? { nextCursor } : {}),
      hasMore,
      itemCount: sessionItems.length,
      itemBytes: bounded.itemBytes
    }
  }))
}

export async function updateThread(
  service: ThreadService,
  threadId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = UpdateThreadRequest.safeParse(body.value)
  if (!parsed.success) {
    return validationError('invalid update thread body', parsed.error.issues)
  }
  try {
    const updated: ThreadRecord = await service.update(threadId, parsed.data)
    return jsonResponse(ThreadSchema.parse(projectPublicThreadRecord(updated)))
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return jsonResponse(
        { code: 'not_found', message: error.message },
        404
      )
    }
    if (error instanceof Error && /cannot be changed while the thread is running/i.test(error.message)) {
      return jsonResponse({ code: 'conflict', message: error.message }, 409)
    }
    if (error instanceof Error && /knowledge base|absolute roots|overlap|primary workspace|unique/i.test(error.message)) {
      return jsonResponse({ code: 'validation_error', message: error.message }, 400)
    }
    throw error
  }
}

export async function deleteThread(
  service: ThreadService,
  threadId: string
): Promise<JsonResponse> {
  const ok = await service.delete(threadId)
  if (!ok) {
    return jsonResponse(
      { code: 'not_found', message: `thread not found: ${threadId}` },
      404
    )
  }
  const payload: DeleteThreadResponse = { id: threadId, deleted: true }
  return jsonResponse(payload)
}

export async function forkThread(
  service: ThreadService,
  threadId: string,
  request?: Request
): Promise<JsonResponse> {
  let options: ForkThreadOptions = {}
  if (request) {
    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    const parsed = ForkThreadRequest.safeParse(body.value)
    if (!parsed.success) {
      return validationError('invalid fork thread body', parsed.error.issues)
    }
    options = parsed.data ?? {}
  }
  try {
    const fork = await service.fork(threadId, options)
    return jsonResponse(ThreadSchema.parse(projectPublicThreadRecord(fork)), 201)
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return jsonResponse(
        { code: 'not_found', message: error.message },
        404
      )
    }
    if (error instanceof Error && /Design task|Design document target|Design fork|Design clone/i.test(error.message)) {
      return jsonResponse({ code: 'conflict', message: error.message }, 409)
    }
    throw error
  }
}

export async function getThreadGoal(
  service: ThreadService,
  threadId: string
): Promise<JsonResponse> {
  try {
    const payload: ThreadGoalResponse = { goal: await service.getGoal(threadId) }
    return jsonResponse(payload)
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return jsonResponse(
        { code: 'not_found', message: error.message },
        404
      )
    }
    throw error
  }
}

export async function setThreadGoal(
  service: ThreadService,
  threadId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = SetThreadGoalRequest.safeParse(body.value)
  if (!parsed.success) {
    return validationError('invalid thread goal body', parsed.error.issues)
  }
  try {
    const payload: ThreadGoalResponse = { goal: await service.setGoal(threadId, parsed.data) }
    return jsonResponse(payload)
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return jsonResponse(
        { code: 'not_found', message: error.message },
        404
      )
    }
    if (error instanceof Error && /no goal exists/i.test(error.message)) {
      return jsonResponse(
        { code: 'validation_error', message: error.message },
        400
      )
    }
    throw error
  }
}

export async function clearThreadGoal(
  service: ThreadService,
  threadId: string
): Promise<JsonResponse> {
  try {
    const payload: ClearThreadGoalResponse = { cleared: await service.clearGoal(threadId) }
    return jsonResponse(payload)
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return jsonResponse(
        { code: 'not_found', message: error.message },
        404
      )
    }
    throw error
  }
}

export async function getThreadTodos(
  service: ThreadService,
  threadId: string
): Promise<JsonResponse> {
  try {
    const payload: ThreadTodosResponse = { todos: await service.getTodos(threadId) }
    return jsonResponse(payload)
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return jsonResponse(
        { code: 'not_found', message: error.message },
        404
      )
    }
    throw error
  }
}

export async function setThreadTodos(
  service: ThreadService,
  threadId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = SetThreadTodosRequest.safeParse(body.value)
  if (!parsed.success) {
    return validationError('invalid thread todos body', parsed.error.issues)
  }
  try {
    const payload: ThreadTodosResponse = { todos: await service.setTodos(threadId, parsed.data) }
    return jsonResponse(payload)
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return jsonResponse(
        { code: 'not_found', message: error.message },
        404
      )
    }
    if (error instanceof Error && /todo|plan|in_progress|content/i.test(error.message)) {
      return jsonResponse(
        { code: 'validation_error', message: error.message },
        400
      )
    }
    throw error
  }
}

export async function clearThreadTodos(
  service: ThreadService,
  threadId: string
): Promise<JsonResponse> {
  try {
    const payload: ClearThreadTodosResponse = { cleared: await service.clearTodos(threadId) }
    return jsonResponse(payload)
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return jsonResponse(
        { code: 'not_found', message: error.message },
        404
      )
    }
    throw error
  }
}

function validationError(message: string, issues: unknown): JsonResponse {
  const body: RuntimeError = {
    code: 'validation_error',
    message,
    details: issues
  }
  return jsonResponse(body, 400)
}

// Re-export for tests
export const _internal = { readJsonBody, parseListThreadsOptions }

function parseListThreadsOptions(
  request: Request
): { ok: true; options: ListThreadsOptions } | { ok: false; response: JsonResponse } {
  const url = new URL(request.url)
  const parsed = ListThreadsQuery.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    return {
      ok: false,
      response: validationError('invalid list threads query', parsed.error.issues)
    }
  }
  const includeSide = (parsed.data.include ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .includes('side')
  return {
    ok: true,
    options: {
      limit: parsed.data.limit,
      search: parsed.data.search,
      includeArchived: parsed.data.include_archived,
      archivedOnly: parsed.data.archived_only,
      includeSide,
      cursor: parsed.data.cursor,
      workspace: parsed.data.workspace,
      lean: parsed.data.lean === true
    }
  }
}

void z
