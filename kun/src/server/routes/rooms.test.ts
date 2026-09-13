import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeFakeModel, makeHarness } from '../../../tests/loop-test-harness.js'
import type { Room } from '../../contracts/rooms.js'
import type { RoomTask } from '../../contracts/room-tasks.js'
import { SqliteRoomStore } from '../../rooms/room-store-sqlite.js'
import { RoomRuntime } from '../../rooms/room-runtime.js'
import { Router } from '../router.js'
import { dispatchRequest } from '../http-server.js'
import { ThreadEventStreamRegistry } from '../thread-event-stream-registry.js'
import { registerRoomRoutes } from './register-room-routes.js'
import type { ServerRuntime } from './server-runtime.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-room-http-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const h = makeHarness(makeFakeModel([]))
  const rooms = new RoomRuntime({ store, threads: h.threads, threadStore: h.threadStore,
    turns: h.turns, sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    dataDir: root, model: () => ({ model: 'fake' }), profiles: () => ({}),
    assertOwnership: () => store.assertOwnership(), runTurn: (id, turnId) => h.loop.runTurn(id, turnId) })
  const streams = new ThreadEventStreamRegistry()
  const runtime = { rooms, runtimeToken: 'room-token', insecure: false, eventStreamRegistry: streams } as ServerRuntime
  const router = new Router()
  registerRoomRoutes(router, runtime)
  const call = async (path: string, method = 'GET', value?: unknown, headers: Record<string, string> = {}) => {
    const response = await dispatchRequest(router, new Request(`http://localhost${path}`, { method,
      headers: { authorization: 'Bearer room-token', 'content-type': 'application/json', ...headers },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }) }))
    return { response, status: response.status, body: await response.json() }
  }
  const created = await call('/v1/rooms', 'POST', { name: 'Room A', clientRequestId: 'create-room' })
  expect(created.status).toBe(200)
  const room = created.body.room as Room
  cleanups.push(async () => {
    streams.closeAll()
    await rooms.close()
    await store.close()
    await rm(root, { recursive: true, force: true })
  })
  return { room, rooms, router, store, streams, call }
}

describe('Rooms HTTP routes and durable storage', () => {
  it('projects reply counts for exact loaded roots in bounded batches without crossing rooms or publishing events', async () => {
    const f = await fixture(), path = `/v1/rooms/${f.room.id}`
    const root = (await f.call(path + '/messages', 'POST', { body: 'Old root', clientRequestId: 'root', executionIntent: 'discussion' })).body.message
    const reply = (await f.call(path + '/messages', 'POST', { body: 'User reply', clientRequestId: 'reply', replyToMessageId: root.id, executionIntent: 'discussion' })).body.message
    await f.store.commit({ requestId: 'peer-reply', checks: [{ kind: 'message', id: 'peer-reply', expectedRevision: null }], puts: [{ kind: 'message', id: 'peer-reply', roomId: f.room.id,
      value: { ...reply, id: 'peer-reply', authorKind: 'member', authorMemberId: 'developer', authorLabelSnapshot: 'Developer', body: 'Peer reply' } }] })
    for (let index = 0; index < 55; index += 1) await f.rooms.service.append(f.room.id, 'later-' + index, 'Later message')
    const other = (await f.call('/v1/rooms', 'POST', { name: 'Other room', clientRequestId: 'other-room' })).body.room
    const foreign = (await f.call(`/v1/rooms/${other.id}/messages`, 'POST', { body: 'Foreign secret', clientRequestId: 'foreign', executionIntent: 'discussion' })).body.message
    const before = await f.store.events(f.room.id)
    expect((await f.call(path + '/messages?limit=50')).body.messages.some((message: { id: string }) => message.id === root.id)).toBe(false)
    const batch = await f.call(path + '/messages?message_ids=' + encodeURIComponent([root.id, foreign.id].join(',')))
    expect(batch.status).toBe(200)
    expect(batch.body.messages).toEqual([expect.objectContaining({ id: root.id, replyCount: 2 })])
    expect((await f.call(path + '/messages/' + root.id)).body.message.replyCount).toBe(2)
    expect((await f.call(path + '/messages/' + foreign.id)).status).toBe(404)
    expect((await f.call(path + '/messages?message_ids=' + Array.from({ length: 51 }, (_, index) => 'id-' + index).join(','))).status).toBe(400)
    expect((await f.call(path + '/messages?message_ids=valid%3Binvalid')).status).toBe(400)
    expect((await f.call(path + '/messages?message_ids=' + root.id + '&cursor=1')).status).toBe(400)
    expect(await f.store.events(f.room.id)).toEqual(before)
    expect((await f.store.get<{ replyCount?: number }>('message', root.id))!.value.replyCount).toBeUndefined()
  })
  it('creates, sends idempotently, pages history, pins an agreement and archives without discarding data', async () => {
    const f = await fixture()
    const path = `/v1/rooms/${f.room.id}`
    const message = { body: 'Discuss the plan', clientRequestId: 'send-once', executionIntent: 'discussion' }
    const sent = await f.call(path + '/messages', 'POST', message)
    expect(sent.status).toBe(200)
    expect((await f.call(path + '/messages', 'POST', message)).body).toEqual(sent.body)
    const history = await f.call(path + '/messages?limit=1')
    expect(history.body.messages).toHaveLength(1)
    expect((await f.call('/v1/rooms')).body.rooms[0]).toMatchObject({
      latestMessage: { id: sent.body.message.id, authorKind: 'user', preview: 'Discuss the plan', attachmentCount: 0 },
      latestMessageSeq: history.body.messages[0].messageSeq, readSeq: 0, runningCount: 1, attentionCount: 0
    })
    const pinned = await f.call(path + '/rules', 'POST', { messageId: sent.body.message.id, clientRequestId: 'rule-once' })
    expect(pinned.body.rule).toMatchObject({ body: 'Discuss the plan', version: 1 })
    expect((await f.call(path + '/rules')).body.rules).toHaveLength(1)
    expect((await f.call(path, 'PATCH', { clientRequestId: 'archive', expectedRevision: 0, archived: true })).status).toBe(200)
    expect((await f.call('/v1/rooms')).body.rooms).toHaveLength(0)
    expect((await f.call('/v1/rooms?archived_only=true')).body.rooms).toHaveLength(1)
    expect((await f.call(path + '/messages')).body.messages).toHaveLength(1)
    expect((await f.call(path + '/messages', 'POST', { ...message, clientRequestId: 'send-archived' })).status).toBe(409)
    expect((await f.call(path, 'PATCH', { clientRequestId: 'restore', expectedRevision: 1, archived: false })).status).toBe(200)
  })

  it('authenticates routes, validates paging and preserves typed concurrency conflicts', async () => {
    const f = await fixture()
    expect((await f.call('/v1/rooms', 'GET', undefined, { authorization: 'Bearer wrong' })).status).toBe(401)
    expect((await f.call('/v1/rooms?limit=10000')).status).toBe(400)
    expect((await f.call('/v1/rooms?cursor=-1')).status).toBe(400)
    expect((await f.call('/v1/rooms?archived_only=maybe')).status).toBe(400)
    expect((await f.call('/v1/rooms/missing-room')).status).toBe(404)
    expect((await f.call('/v1/rooms/presets')).body.presets.map((preset: { id: string }) => preset.id))
      .toEqual(expect.arrayContaining(['coordinator', 'developer', 'reviewer']))
    const conflict = await f.call(`/v1/rooms/${f.room.id}`, 'PATCH', {
      clientRequestId: 'stale-config', expectedRevision: 99, name: 'Changed'
    })
    expect(conflict.status).toBe(409)
    expect(conflict.body.currentRevision).toBe(0)
  })

  it('returns canonical message cursors from search and detail reads', async () => {
    const f = await fixture()
    const path = `/v1/rooms/${f.room.id}`
    await f.rooms.service.append(f.room.id, 'first-searchable', 'searchable first')
    await f.rooms.service.append(f.room.id, 'second-searchable', 'searchable second')
    const history = (await f.call(path + '/messages')).body.messages
    const search = (await f.call(path + '/search?q=searchable&limit=1')).body
    const latest = history.at(-1)
    expect(latest.messageSeq).toBeGreaterThan(1)
    expect(search.messages[0]).toEqual(latest)
    expect((await f.call(path + '/messages/' + latest.id)).body.message).toEqual(latest)
    const earlier = (await f.call(path + '/search?q=searchable&limit=1&cursor=' + search.nextCursor)).body
    expect(earlier.messages[0]).toEqual(history[0])
  })

  it('counts waiting and failed tasks across every page in room and global badges', async () => {
    const f = await fixture()
    for (let start = 0; start < 1002; start += 500) {
      await f.store.commit({ requestId: 'badge-page-' + start,
        checks: Array.from({ length: Math.min(500, 1002 - start) }, (_, offset) => ({
          kind: 'task' as const, id: 'badge-task-' + (start + offset), expectedRevision: null
        })),
        puts: Array.from({ length: Math.min(500, 1002 - start) }, (_, offset) => {
          const index = start + offset
          return { kind: 'task' as const, id: 'badge-task-' + index, roomId: f.room.id,
            value: { task: { id: 'badge-task-' + index, status: index < 1001 ? 'failed' : 'waiting_dependency' } } }
        }) })
    }
    const rooms = (await f.call('/v1/rooms')).body.rooms
    expect(rooms[0]).toMatchObject({ runningCount: 1, attentionCount: 1001 })
    expect((await f.call('/v1/rooms/attention')).body).toEqual({ attentionCount: 1001 })
  })

  it('includes integration gates on completed tasks in both badges without double counting a task', async () => {
    const f = await fixture()
    await f.store.commit({ requestId: 'integration-badges', checks: [
      { kind: 'task', id: 'task', expectedRevision: null }, { kind: 'integration', id: 'checking', expectedRevision: null },
      { kind: 'integration', id: 'ready', expectedRevision: null }
    ], puts: [
      { kind: 'task', id: 'task', roomId: f.room.id, taskId: 'task', value: { task: { id: 'task', status: 'completed' } } },
      { kind: 'integration', id: 'checking', roomId: f.room.id, taskId: 'task', value: {
        taskId: 'task', status: 'validating', attention: { approvalIds: ['approval'], userInputIds: ['question'] } } },
      { kind: 'integration', id: 'ready', roomId: f.room.id, taskId: 'task', value: { taskId: 'task', status: 'ready' } }
    ] })
    expect((await f.call('/v1/rooms')).body.rooms[0]).toMatchObject({ runningCount: 1, attentionCount: 1 })
    expect((await f.call('/v1/rooms/attention')).body).toEqual({ attentionCount: 1 })
    await f.store.commit({ requestId: 'also-task-attention', checks: [{ kind: 'task', id: 'task', expectedRevision: 0 }],
      puts: [{ kind: 'task', id: 'task', roomId: f.room.id, taskId: 'task', value: { task: { id: 'task', status: 'awaiting_acceptance' } } }] })
    expect((await f.call('/v1/rooms/attention')).body).toEqual({ attentionCount: 1 })
    await f.store.commit({ requestId: 'all-resolved', checks: [
      { kind: 'task', id: 'task', expectedRevision: 1 }, { kind: 'integration', id: 'checking', expectedRevision: 0 },
      { kind: 'integration', id: 'ready', expectedRevision: 0 }
    ], puts: [
      { kind: 'task', id: 'task', roomId: f.room.id, taskId: 'task', value: { task: { id: 'task', status: 'completed' } } },
      { kind: 'integration', id: 'checking', roomId: f.room.id, taskId: 'task', value: { taskId: 'task', status: 'applied' } },
      { kind: 'integration', id: 'ready', roomId: f.room.id, taskId: 'task', value: { taskId: 'task', status: 'failed', cancelRequested: true } }
    ] })
    expect((await f.call('/v1/rooms')).body.rooms[0]).toMatchObject({ runningCount: 0, attentionCount: 0 })
    expect((await f.call('/v1/rooms/attention')).body).toEqual({ attentionCount: 0 })
  })

  it('paginates task projections, scopes detail reads and returns updated detail after a cancel action', async () => {
    const f = await fixture()
    const path = `/v1/rooms/${f.room.id}/tasks`
    for (let index = 0; index < 3; index += 1) {
      const task: RoomTask = { id: `task-${index}`, roomId: f.room.id, requestId: 'request', sourceMessageId: 'source',
        title: 'Task', ownerMemberId: 'developer', memberSnapshot: f.room.members[1], repositoryId: 'repository',
        workspaceId: 'workspace', executionThreadId: `execution-${index}`, status: 'queued', stage: 'develop',
        requirementRevision: 0, revision: 0, latestProgress: '', verificationStatus: 'not_run',
        applicationStatus: 'not_applied', updatedAt: new Date().toISOString() }
      await f.store.commit({ requestId: `create-${task.id}`, checks: [{ kind: 'task', id: task.id, expectedRevision: null }],
        puts: [{ kind: 'task', id: task.id, roomId: f.room.id, taskId: task.id,
          value: { task, prompt: 'Task', attachmentIds: [], dependencyTaskIds: [], attempt: 1, reworkRounds: 0, configuration: null } }] })
    }
    const first = await f.call(path + '?limit=2')
    expect(first.body.tasks).toHaveLength(2)
    expect((await f.call(path + `?limit=2&cursor=${first.body.nextCursor}`)).body.tasks).toHaveLength(1)
    expect((await f.call('/v1/rooms/wrong-room/tasks/task-0')).status).toBe(404)
    const cancelled = await f.call(path + '/task-0/cancel', 'POST', { clientRequestId: 'cancel', expectedRevision: 0 })
    expect(cancelled.body.task).toMatchObject({ status: 'cancelled', revision: 1 })
    expect(cancelled.body.reviews).toEqual([])
    expect((await f.call(path + '?status=queued')).body.tasks).toHaveLength(2)
  })

  it('pages long agreement histories and filters historical reviews before applying the limit', async () => {
    const f = await fixture()
    const path = '/v1/rooms/' + f.room.id
    const rules = Array.from({ length: 125 }, (_, i) => ({ kind: 'rule' as const, id: 'rule-' + i, roomId: f.room.id,
      value: { id: 'rule-' + i, messageId: 'source', version: 1, active: true, body: 'Agreement ' + i } }))
    await f.store.commit({ requestId: 'many-rules', puts: rules,
      checks: rules.map((rule) => ({ kind: rule.kind, id: rule.id, expectedRevision: null })) })
    const seen = new Set<string>()
    let cursor: string | undefined
    do {
      const page = (await f.call(path + '/rules?limit=50' + (cursor ? '&cursor=' + cursor : ''))).body
      for (const rule of page.rules) { expect(seen.has(rule.id)).toBe(false); seen.add(rule.id) }
      cursor = page.nextCursor
    } while (cursor)
    expect(seen.size).toBe(125)
    await f.store.commit({ requestId: 'old-delivery', checks: [{ kind: 'delivery', id: 'old', expectedRevision: null }],
      puts: [{ kind: 'delivery', id: 'old', roomId: f.room.id, taskId: 'task', value: { id: 'old', taskId: 'task', diffArtifactId: 'diff' } }] })
    const reviews = Array.from({ length: 151 }, (_, i) => ({ kind: 'review' as const, id: 'review-' + i, roomId: f.room.id, taskId: 'task',
      value: { id: 'review-' + i, deliveryId: i === 0 ? 'old' : 'new', verdict: 'passed' } }))
    await f.store.commit({ requestId: 'many-reviews', puts: reviews,
      checks: reviews.map((review) => ({ kind: review.kind, id: review.id, expectedRevision: null })) })
    const old = (await f.call(path + '/tasks/task/deliveries/old?include_diff=false')).body
    expect(old.reviews.map((review: { id: string }) => review.id)).toEqual(['review-0'])
    expect((await f.call(path + '/tasks/task/reviews?delivery_id=old')).body.reviews).toHaveLength(1)
  })

  it('replays room events from Last-Event-ID and releases live streams on shutdown', async () => {
    const f = await fixture()
    const path = `/v1/rooms/${f.room.id}`
    const initial = await f.call(path + '/events')
    await f.call(path + '/messages', 'POST', { body: 'New message', clientRequestId: 'stream-message' })
    const response = await dispatchRequest(f.router, new Request(`http://localhost${path}/events`, {
      headers: { authorization: 'Bearer room-token', accept: 'text/event-stream', 'last-event-id': String(initial.body.cursor) }
    }))
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    expect(decoder.decode((await reader.read()).value)).toContain('connected')
    const event = decoder.decode((await reader.read()).value)
    expect(event).toContain('event: message.created')
    expect(event).not.toContain('event: room.created')
    f.streams.closeAll()
    expect((await reader.read()).done).toBe(true)
    reader.releaseLock()
  })
})
