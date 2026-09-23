import { z } from 'zod'
import type { Turn } from '../contracts/turns.js'
import { isPublicTurnItem } from '../contracts/items.js'
import type { RoomMessage } from '../contracts/rooms.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { RoomRunAvailability, RoomRunDetail, RoomRunItemsPage,
  RoomRunListPage, RoomMessageRunSource } from '../contracts/room-run-query.js'
import type { RoomRuntimeDeps } from './room-runtime-types.js'
import type { RoomStoreListOptions } from './room-store.js'
import { getRoomRunRow, resolveHistoricalRoomRun } from './room-run-history.js'
import { roomRunSegmentMessageId } from './room-run-segments.js'

const Cursor = z.object({ v: z.literal(1), id: z.string().min(1).max(256),
  revision: z.number().int().nonnegative(), seq: z.number().int().nonnegative(),
  availability: z.string().max(40).optional() }).strict()
export type RoomRunCursor = z.infer<typeof Cursor>
export function encodeRunCursor(value: RoomRunCursor): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}
export function decodeRunCursor(value: string, runId: string): RoomRunCursor {
  const encoded = z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/).parse(value)
  let parsed: unknown
  try { parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) } catch { parsed = null }
  const result = Cursor.parse(parsed)
  z.literal(runId).parse(result.id)
  return result
}

/** Metadata-only scope validation. Reading a run must not heal or re-dispatch its thread. */
export async function inspectRoomRun(deps: RoomRuntimeDeps, roomId: string, runId: string) {
  const row = await getRoomRunRow(deps, roomId, runId)
  const run = { ...row.value }
  // A transition after this boundary is replayed even when its metadata was read just before it.
  const snapshotSeq = run.threadId ? await deps.sessions.highestSeq(run.threadId) : 0
  let availability: RoomRunAvailability = { status: 'available' }
  let turn: Turn | undefined
  let workspaceRoot: string | undefined
  if (run.phase === 'memory' || run.phase === 'triage' || !run.threadId) {
    availability = run.phase === 'memory' ? { status: 'no_session', reason: '记忆整理是独立的轻量调用，没有 Code 会话。' } : run.phase === 'triage'
      ? { status: 'no_session', reason: '轻量接话判断没有独立的 Code 会话。' }
      : { status: 'pending', reason: '本次运行尚未确认会话身份。' }
  } else {
    const thread = await deps.threadStore.getMetadata?.(run.threadId)
    const scope = thread?.roomContext
    if (!thread) availability = { status: 'missing_thread', reason: '原会话已清理或当前不可用，仍保留已保存的运行信息。' }
    else if (!scope || scope.roomId !== roomId || scope.memberId !== run.memberId ||
      (run.taskId && scope.taskId !== run.taskId) ||
      (run.rootRequestId && scope.rootRequestId && run.rootRequestId !== scope.rootRequestId) ||
      (run.phase === 'integration' ? !['execution', 'review'].includes(scope.kind) : scope.kind !== run.phase)) {
      availability = { status: 'scope_mismatch', reason: '运行记录与原会话归属不一致，无法展示会话内容。' }
    } else {
      // A lost admission acknowledgement may precede the producer's reconciliation.
      // Exact durable clientRequestId is proof; latest turn/name/time are not.
      const matches = thread.turns.filter((item) => run.turnId ? item.id === run.turnId : item.clientRequestId === run.clientRequestId)
      turn = matches.length === 1 ? matches[0] : undefined
      if (turn && (turn.threadId !== run.threadId ||
        (!run.id.startsWith('legacy-') && turn.clientRequestId !== run.clientRequestId))) {
        availability = { status: 'scope_mismatch', reason: '原轮次的派发身份与本次运行不一致。' }
        turn = undefined
      } else if (!turn) availability = run.turnId
        ? { status: 'missing_turn', reason: '原会话中已找不到本次轮次，可能已被清理或裁剪。' }
        : { status: 'pending', reason: '本次运行正在等待队列确认。' }
      else {
        workspaceRoot = thread.workspace
        run.turnId = turn.id
        run.status = turn.status === 'aborted' ? 'cancelled' : turn.status
        run.startedAt = turn.startedAt
        run.endedAt = turn.finishedAt
        if (turn.startedAt && turn.finishedAt) run.elapsedMs = Math.max(0, Date.parse(turn.finishedAt) - Date.parse(turn.startedAt))
      }
    }
  }
  return { row, run, availability, turn, snapshotSeq, workspaceRoot }
}

export function publicRoomRun(run: RoomRunRecord, summary = false): RoomRunRecord {
  const { usageBaseline: _baseline, usageSinceSeq: _since, ...value } = run
  return { ...value, input: summary ? run.input.slice(0, 512) : run.input }
}

export async function roomRunList(deps: RoomRuntimeDeps, roomId: string,
  options: RoomStoreListOptions = {}): Promise<RoomRunListPage> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 25))
  const rows = await deps.store.list<RoomRunRecord>('room_run', { ...options, roomId, limit: limit + 1 })
  const page = rows.slice(0, limit)
  return { runs: page.map((row) => publicRoomRun(row.value, true)),
    nextCursor: rows.length > limit ? String(page.at(-1)!.seq) : undefined }
}

export async function roomRunDetail(deps: RoomRuntimeDeps, roomId: string, runId: string): Promise<RoomRunDetail> {
  const current = await inspectRoomRun(deps, roomId, runId)
  const seq = current.snapshotSeq
  const trigger = current.run.triggerMessageId
    ? await deps.store.get<RoomMessage>('message', current.run.triggerMessageId) : null
  const admittedContext = current.run.threadId ? await deps.store.get<{ prompt?: string; attachmentIds?: string[]; memoryIds?: string[] }>('context', current.run.id + '-input') : null
  const context = admittedContext ?? (current.run.contextId
    ? await deps.store.get<{ prompt?: string; attachmentIds?: string[]; memoryIds?: string[] }>('context', current.run.contextId) : null)
  return { run: publicRoomRun(current.run), availability: current.availability,
    ...(current.workspaceRoot ? { workspaceRoot: current.workspaceRoot } : {}),
    trigger: trigger?.roomId === roomId ? { ...trigger.value, messageSeq: trigger.seq } : undefined,
    context: current.run.id.startsWith('legacy-') && current.turn
      ? { prompt: current.turn.prompt.slice(0, 64000), attachmentIds: current.turn.attachmentIds?.slice(0, 20) }
      : context?.roomId === roomId ? { prompt: context.value.prompt?.slice(0, 64000),
        attachmentIds: context.value.attachmentIds?.slice(0, 20), memoryIds: context.value.memoryIds?.slice(0, 8) } : undefined,
    eventsCursor: encodeRunCursor({ v: 1, id: runId, revision: current.row.revision, seq,
      availability: current.availability.status }) }
}

export async function roomRunItems(deps: RoomRuntimeDeps, roomId: string, runId: string, options: {
  before?: string; limit?: number; maxBytes?: number; itemId?: string; callId?: string; contentOffset?: number
} = {}): Promise<RoomRunItemsPage> {
  const current = await inspectRoomRun(deps, roomId, runId)
  const { run } = current
  // Freeze replay boundary before reading a live checkpoint to close the snapshot gap.
  const seq = current.snapshotSeq
  let eventsCursor = encodeRunCursor({ v: 1, id: runId, revision: current.row.revision, seq,
    availability: current.availability.status })
  const empty = { items: [], hasMore: false, itemBytes: 0, eventsCursor }
  if (current.availability.status !== 'available' || !run.threadId || !run.turnId) {
    return { ...empty, availability: current.availability }
  }
  if (!deps.sessions.loadItemPage) return { ...empty, availability: {
    status: 'history_unavailable', reason: '当前会话存储不支持有界运行查询。' } }
  const page = await deps.sessions.loadItemPage(run.threadId, { turnId: run.turnId, before: options.before,
    maxItems: options.limit ?? 40, maxBytes: options.maxBytes ?? 128 * 1024,
    itemId: options.itemId, callId: options.callId, contentOffset: options.contentOffset })
  if (page.replayAfterSeq !== undefined) {
    const floor = await deps.sessions.eventReplayFloorSeq?.(run.threadId) ?? 0
    eventsCursor = encodeRunCursor({ v: 1, id: runId, revision: current.row.revision,
      seq: Math.max(0, floor - 1, Math.min(seq, page.replayAfterSeq)), availability: current.availability.status })
  }
  const items = page.items.filter((item) => item.threadId === run.threadId && item.turnId === run.turnId && isPublicTurnItem(item))
    .map((item) => item.kind === 'tool_call' ? { ...item, providerMetadata: undefined } : item)
  const availability: RoomRunAvailability = !items.length && !page.content && !page.hasMore &&
    !options.before && !['queued', 'running'].includes(run.status)
    ? { status: 'history_unavailable', reason: '本次运行没有可用会话内容，记录可能已被压缩或清理。' }
    : current.availability
  return { items, nextCursor: page.nextCursor, hasMore: page.hasMore,
    itemBytes: Buffer.byteLength(JSON.stringify(items)), content: page.content, availability, eventsCursor }
}

export async function roomMessageRunSource(deps: RoomRuntimeDeps,
  roomId: string, messageId: string): Promise<RoomMessageRunSource> {
  const row = await deps.store.get<RoomMessage>('message', messageId)
  if (!row || row.roomId !== roomId) throw new Error('room message not found')
  if (row.value.originRunId) {
    const run = await deps.store.get<RoomRunRecord>('room_run', row.value.originRunId)
    const segmented = Boolean(row.value.originItemId)
    const valid = run?.roomId === roomId && run.value.memberId === row.value.authorMemberId &&
      (segmented ? row.value.id === roomRunSegmentMessageId(run.id, row.value.originItemId!)
        : run.value.publishedMessageId === messageId)
    return valid ? { runId: run.id } : { unavailableReason: '消息记录的运行来源已不可用。' }
  }
  const run = await resolveHistoricalRoomRun(deps, row.value)
  return run ? { runId: run.id } : { unavailableReason: '历史消息未记录运行来源' }
}
