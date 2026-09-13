import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeFakeModel, makeHarness } from '../../../tests/loop-test-harness.js'
import { SqliteRoomStore } from '../../rooms/room-store-sqlite.js'
import { RoomRuntime } from '../../rooms/room-runtime.js'
import { ensureRoomThread, enqueueRoomTurn } from '../../rooms/room-execution.js'
import { roomRunId, prepareRoomRun } from '../../rooms/room-run-recording.js'
import { decodeRunCursor } from '../../rooms/room-run-query.js'
import type { RoomRunDetail, RoomRunItemsPage } from '../../contracts/room-run-query.js'
import type { RoomRequestState } from '../../rooms/room-runtime-types.js'
import type { TurnItem } from '../../contracts/items.js'
import { putRoomDocument } from '../../rooms/room-service.js'
import { Router } from '../router.js'
import { dispatchRequest } from '../http-server.js'
import { ThreadEventStreamRegistry } from '../thread-event-stream-registry.js'
import { registerRoomRoutes } from './register-room-routes.js'
import type { ServerRuntime } from './server-runtime.js'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-room-runs-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const h = makeHarness(makeFakeModel([]))
  const rooms = new RoomRuntime({ store, threads: h.threads, threadStore: h.threadStore,
    turns: h.turns, sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    dataDir: root, model: () => ({ model: 'fake' }), profiles: () => ({}),
    assertOwnership: () => store.assertOwnership(), runTurn: (id, turnId) => h.loop.runTurn(id, turnId) })
  const streams = new ThreadEventStreamRegistry()
  const router = new Router()
  registerRoomRoutes(router, { rooms, runtimeToken: 'room-token', eventStreamRegistry: streams } as ServerRuntime)
  const call = async <T = Record<string, unknown>>(path: string, method = 'GET', body?: unknown) => {
    const response = await dispatchRequest(router, new Request('http://localhost' + path, { method,
      headers: { authorization: 'Bearer room-token', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
    return { status: response.status, body: await response.json() as T }
  }
  const { room } = await rooms.service.create({ name: 'Run fixture', clientRequestId: 'create' })
  const source = await rooms.service.send(room.id, { clientRequestId: 'source', body: 'A precise user request', executionIntent: 'discussion' })
  const member = room.members.find((entry) => entry.id === 'developer')!
  const base = `/v1/rooms/${room.id}`
  const admit = async (clientId: string, threadId = 'shared-discussion', rootRequestId = source.requestId) => {
    await ensureRoomThread(rooms.deps, { id: threadId, roomId: room.id, member,
      kind: 'discussion', requestId: source.requestId, rootRequestId })
    const turnId = await enqueueRoomTurn(rooms.deps, threadId, clientId, `Input for ${clientId}`)
    return { runId: roomRunId(room.id, clientId), threadId, turnId }
  }
  const item = (run: { threadId: string; turnId: string }, id: string, text: string): TurnItem => ({
    id, ...run, kind: 'assistant_text', role: 'assistant', status: 'completed',
    text, createdAt: new Date().toISOString() })
  cleanups.push(async () => { streams.closeAll(); await rooms.close(); await store.close(); await rm(root, { recursive: true, force: true }) })
  return { h, rooms, room, member, source, root, store, streams, router, call, base, admit, item }
}

describe('room run read-only scoped API', () => {
  it('keeps old messages on their exact attempt and filters before bounded pagination', async () => {
    const f = await fixture()
    const old = await f.admit('old-attempt')
    const latest = await f.admit('new-attempt')
    const other = await f.admit('other-topic', 'other-discussion', 'other-topic')
    for (let index = 0; index < 5; index++) await f.h.sessionStore.appendItem(old.threadId, f.item(old, `old-${index}`, `old text ${index}`))
    for (let index = 0; index < 75; index++) await f.h.sessionStore.appendItem(latest.threadId, f.item(latest, `new-${index}`, 'new text'))
    await f.h.sessionStore.appendItem(other.threadId, f.item(other, 'other', 'foreign topic'))
    const first = await f.call<RoomRunItemsPage>(`${f.base}/runs/${old.runId}/items?limit=2`)
    expect(first.status).toBe(200)
    expect(first.body.items.map((item) => item.id)).toEqual(['old-3', 'old-4'])
    const second = await f.call<RoomRunItemsPage>(`${f.base}/runs/${old.runId}/items?limit=2&cursor=${first.body.nextCursor}`)
    expect(second.body.items.map((item) => item.id)).toEqual(['old-1', 'old-2'])
    const list = await f.call<{ runs: Array<{ id: string; rootRequestId: string }> }>(`${f.base}/runs?root_request_id=${f.source.requestId}&member_id=developer`)
    expect(list.body.runs.map((run) => run.id)).toEqual([latest.runId, old.runId])
    const commit = vi.spyOn(f.store, 'commit')
    const enqueue = vi.spyOn(f.h.turns, 'enqueueTurn')
    const loadAll = vi.spyOn(f.h.sessionStore, 'loadItems')
    const rewrite = vi.spyOn(f.h.sessionStore, 'rewriteItems')
    const detail = await f.call<RoomRunDetail>(`${f.base}/runs/${old.runId}`)
    expect(detail.body.run).toMatchObject({ threadId: old.threadId, turnId: old.turnId, input: 'A precise user request' })
    expect(detail.body.context?.prompt).toBe('Input for old-attempt')
    await f.call(`${f.base}/runs/${old.runId}/items`)
    await f.call(`${f.base}/runs/${old.runId}/events?cursor=${detail.body.eventsCursor}`)
    expect(commit).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
    expect(loadAll).not.toHaveBeenCalled()
    expect(rewrite).not.toHaveBeenCalled()
  })

  it('validates room/member/turn scope and refuses client identity substitution', async () => {
    const f = await fixture()
    const run = await f.admit('scope')
    const { room: other } = await f.rooms.service.create({ name: 'Other', clientRequestId: 'other-room' })
    expect((await f.call(`/v1/rooms/${other.id}/runs/${run.runId}`)).status).toBe(404)
    expect((await f.call(`${f.base}/runs/${run.runId}/items?thread_id=foreign`)).status).toBe(400)
    expect((await f.call(`${f.base}/runs/${run.runId}/items?max_bytes=9999999`)).status).toBe(400)
    const thread = (await f.h.threadStore.get(run.threadId))!
    await f.h.threadStore.upsert({ ...thread, roomContext: { ...thread.roomContext!, memberId: 'coordinator' } })
    const response = await f.call<RoomRunItemsPage>(`${f.base}/runs/${run.runId}/items`)
    expect(response.body.availability.status).toBe('scope_mismatch')
    expect(response.body.items).toEqual([])
  })

  it('keeps huge tool output bounded and expands only the exact selected item', async () => {
    const f = await fixture()
    const run = await f.admit('huge')
    const other = await f.admit('hidden')
    const output = 'long output '.repeat(100000)
    await f.h.sessionStore.appendItem(run.threadId, { ...f.item(run, 'tool-output', ''), kind: 'tool_result', role: 'tool',
      toolName: 'read_file', callId: 'call', toolKind: 'tool_call', output, isError: false } as TurnItem)
    await f.h.sessionStore.appendItem(other.threadId, f.item(other, 'foreign-item', 'do not disclose'))
    const preview = await f.call<RoomRunItemsPage>(`${f.base}/runs/${run.runId}/items?max_bytes=4096`)
    expect(Buffer.byteLength(JSON.stringify(preview.body.items))).toBeLessThanOrEqual(4096)
    const part = await f.call<RoomRunItemsPage>(`${f.base}/runs/${run.runId}/items?item_id=tool-output&content_offset=0`)
    expect(part.body.items).toEqual([])
    expect(part.body.content?.text.length).toBeLessThanOrEqual(8192)
    expect(part.body.content?.nextOffset).toBeGreaterThan(0)
    expect(part.body.content?.totalChars).toBe(output.length)
    const next = await f.call<RoomRunItemsPage>(`${f.base}/runs/${run.runId}/items?item_id=tool-output&content_offset=${part.body.content!.nextOffset}`)
    expect(next.body.content?.offset).toBe(part.body.content?.nextOffset)
    const foreign = await f.call<RoomRunItemsPage>(`${f.base}/runs/${run.runId}/items?item_id=foreign-item`)
    expect(foreign.body.content).toBeUndefined()
  })

  it('replays only selected-turn changes, advances across other turns and cleans up streams', async () => {
    const f = await fixture()
    const run = await f.admit('live')
    const other = await f.admit('unrelated')
    const detail = await f.call<RoomRunDetail>(`${f.base}/runs/${run.runId}`)
    let seq = decodeRunCursor(detail.body.eventsCursor, run.runId).seq
    await f.h.sessionStore.appendEvent(run.threadId, { kind: 'assistant_text_delta', threadId: run.threadId,
      turnId: other.turnId, item: f.item(other, 'other-item', 'hidden'), seq: ++seq, timestamp: new Date().toISOString() })
    const quiet = await f.call<{ events: Array<{ kind: string }>; cursor: string }>(`${f.base}/runs/${run.runId}/events?cursor=${detail.body.eventsCursor}`)
    expect(quiet.body.events.map((event) => event.kind)).toEqual(['run.cursor'])
    await f.h.sessionStore.appendEvent(run.threadId, { kind: 'assistant_text_delta', threadId: run.threadId,
      turnId: run.turnId, item: f.item(run, 'own-item', 'visible'), seq: ++seq, timestamp: new Date().toISOString() })
    const changed = await f.call<{ events: Array<{ kind: string }>; cursor: string }>(`${f.base}/runs/${run.runId}/events?cursor=${quiet.body.cursor}`)
    expect(changed.body.events.map((event) => event.kind)).toContain('run.items_changed')
    const replay = await f.call<{ events: unknown[] }>(`${f.base}/runs/${run.runId}/events?cursor=${changed.body.cursor}`)
    expect(replay.body.events).toEqual([])
    expect((await f.call(`${f.base}/runs/${other.runId}/events?cursor=${changed.body.cursor}`)).status).toBe(400)
    const controller = new AbortController()
    const response = await dispatchRequest(f.router, new Request(`http://localhost${f.base}/runs/${run.runId}/events?cursor=${changed.body.cursor}`, {
      headers: { authorization: 'Bearer room-token', accept: 'text/event-stream' }, signal: controller.signal }))
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('connected')
    controller.abort()
    expect((await reader.read()).done).toBe(true)
  })

  it('shows deleted history honestly and resolves admission receipts without re-enqueueing', async () => {
    const f = await fixture()
    const threadId = 'lost-receipt-thread'
    await ensureRoomThread(f.rooms.deps, { id: threadId, roomId: f.room.id, member: f.member,
      kind: 'discussion', requestId: f.source.requestId })
    const record = await prepareRoomRun(f.rooms.deps, (await f.h.threadStore.get(threadId))!, 'lost-receipt', 'input', [])
    const accepted = await f.h.turns.enqueueTurn({ threadId, request: { clientRequestId: 'lost-receipt', prompt: 'input' } })
    const run = { threadId, turnId: accepted.turnId, runId: record.id }
    const enqueue = vi.spyOn(f.h.turns, 'enqueueTurn')
    const detail = await f.call<RoomRunDetail>(`${f.base}/runs/${run.runId}`)
    expect(detail.body.run.turnId).toBe(run.turnId)
    expect(enqueue).not.toHaveBeenCalled()
    await f.h.threadStore.delete(run.threadId)
    const missing = await f.call<RoomRunDetail>(`${f.base}/runs/${run.runId}`)
    expect(missing.body.availability.status).toBe('missing_thread')
    expect(missing.body.run.input).toBe('A precise user request')
  })

  it('resolves historical exact discussion evidence, never names/time/latest guesses', async () => {
    const f = await fixture()
    const run = await f.admit('legacy-attempt', 'old-member-thread')
    const request = (await f.store.get<RoomRequestState>('request', f.source.requestId))!
    await putRoomDocument(f.store, 'request', request.id, f.room.id, { ...request.value,
      discussions: [{ memberId: 'developer', threadId: run.threadId, turnId: run.turnId,
        sourceMessageId: request.value.sourceMessageId, response: 'Exact legacy response' }] }, request)
    await f.rooms.service.append(f.room.id, 'reply-' + run.threadId, 'Exact legacy response', 'developer')
    const source = await f.call<{ runId?: string }>(`${f.base}/messages/reply-${run.threadId}/run`)
    expect(source.body.runId).toBe('legacy-reply-' + run.threadId)
    const detail = await f.call<RoomRunDetail>(`${f.base}/runs/${source.body.runId}`)
    expect(detail.body.run.turnId).toBe(run.turnId)
    expect(detail.body.context?.prompt).toBe('Input for legacy-attempt')
    const thread = (await f.h.threadStore.get(run.threadId))!
    await f.h.threadStore.upsert({ ...thread, turns: [] })
    expect((await f.call<RoomRunDetail>(`${f.base}/runs/${source.body.runId}`)).body.availability.status).toBe('missing_turn')
    await f.rooms.service.append(f.room.id, 'unlinked', 'Exact legacy response', 'developer')
    const unknown = await f.call<{ unavailableReason: string }>(`${f.base}/messages/unlinked/run`)
    expect(unknown.body.unavailableReason).toBe('历史消息未记录运行来源')
  })

  it('keeps the metadata snapshot race replayable and escapes oversized old events', async () => {
    const f = await fixture()
    const run = await f.admit('snapshot-race')
    const original = f.h.threadStore.getMetadata.bind(f.h.threadStore)
    let injectedSeq = 0
    const read = vi.spyOn(f.h.threadStore, 'getMetadata').mockImplementationOnce(async (id) => {
      const prior = await original(id)
      injectedSeq = await f.h.sessionStore.highestSeq(id) + 1
      await f.h.sessionStore.appendEvent(id, { kind: 'item_completed', seq: injectedSeq,
        timestamp: new Date().toISOString(), threadId: id, turnId: run.turnId,
        item: f.item(run, 'raced-completion', 'completed after metadata snapshot') })
      return prior
    })
    const detail = await f.call<RoomRunDetail>(`${f.base}/runs/${run.runId}`)
    read.mockRestore()
    expect(decodeRunCursor(detail.body.eventsCursor, run.runId).seq).toBeLessThan(injectedSeq)
    const iterator = vi.spyOn(f.h.sessionStore, 'iterateEventsSince').mockImplementation(() => ({
      [Symbol.asyncIterator]() { return {
        async next() { throw new Error('event replay record exceeds 4194304 bytes') }
      } }
    }))
    const replay = await f.call<{ events: Array<{ kind: string }>; cursor: string }>(`${f.base}/runs/${run.runId}/events?cursor=${detail.body.eventsCursor}`)
    expect(replay.body.events.map((event) => event.kind)).toContain('run.items_changed')
    expect(decodeRunCursor(replay.body.cursor, run.runId).seq).toBe(injectedSeq)
    const again = await f.call<{ events: unknown[] }>(`${f.base}/runs/${run.runId}/events?cursor=${replay.body.cursor}`)
    expect(again.body.events).toEqual([])
    expect(iterator).toHaveBeenCalledTimes(1)
  })
})
