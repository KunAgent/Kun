import { describe, expect, it, vi } from 'vitest'
import { remoteFixture } from '../testing/runtime.test-support.js'
import { codeNotification, agentNotification } from './events.js'
import { createApprovalRequest } from '../../domain/approval.js'
import { RemoteNotificationFeed } from './feed.js'
import { openAgentConversation } from '../../agents/agent-conversations.js'
import { putRoomDocument } from '../../rooms/room-service.js'
import type { RoomRequestState } from '../../rooms/room-runtime-types.js'

describe('notification intents use real persisted semantic state', () => {
  it('notifies only a real terminal Code turn, ignores idle/mismatched state/hidden resources and active goal iterations', async () => {
    const f = await remoteFixture()
    try {
      const thread = await f.code(), start = await f.h.turns.startTurn({ threadId: thread.id, request: { prompt: 'private prompt' } })
      const event = { kind: 'turn_completed' as const, threadId: thread.id, turnId: start.turnId, seq: 100, timestamp: new Date().toISOString(), text: 'private reply' }
      expect(await codeNotification(f.runtime, event)).toBeNull()
      await f.h.turns.finishTurn({ threadId: thread.id, turnId: start.turnId, status: 'completed' })
      const intent = await codeNotification(f.runtime, event)
      expect(intent).toMatchObject({ resourceKind: 'code', resourceId: thread.id, kind: 'completed' })
      expect(Object.keys(intent!).sort()).toEqual(['eventId', 'kind', 'resourceId', 'resourceKind'])
      expect(await codeNotification(f.runtime, { ...event, seq: 999 })).toEqual(intent)
      const completed = (await f.h.threads.get(thread.id))!
      await f.h.threadStore.upsert({ ...completed, turns: completed.turns.map((turn) => ({ ...turn, finishedAt: '2020-01-01T00:00:00.000Z' })) })
      expect(await codeNotification(f.runtime, event)).toBeNull()
      await f.h.threadStore.upsert(completed)
      await f.h.threads.setGoal(thread.id, { objective: 'Continue working' })
      expect(await codeNotification(f.runtime, event)).toBeNull()
      const child = (await f.h.threads.get(thread.id))!
      await f.h.threadStore.upsert({ ...child, goal: undefined, parentThreadId: 'parent' })
      expect(await codeNotification(f.runtime, event)).toBeNull()
    } finally { await f.close() }
  })
  it('projects only live human approval gates and never resurrects resolved or agent-reviewed decisions', async () => {
    const f = await remoteFixture()
    try {
      const thread = await f.code(), start = await f.h.turns.startTurn({ threadId: thread.id, request: { prompt: 'work' } })
      const gate = createApprovalRequest({ id: 'approval', threadId: thread.id, turnId: start.turnId, toolName: 'fixture', summary: 'Private tool arguments' })
      const waiting = f.h.approvalGate.request(gate)
      const event = { kind: 'approval_requested' as const, threadId: thread.id, turnId: start.turnId, seq: 99,
        timestamp: new Date().toISOString(), approvalId: gate.id, toolName: gate.toolName, status: 'pending' as const }
      const value = await codeNotification(f.runtime, event)
      expect(value).toMatchObject({ resourceKind: 'code', resourceId: thread.id, kind: 'approval' })
      expect(JSON.stringify(value)).not.toContain('Private')
      expect(await codeNotification(f.runtime, { ...event, approvalReviewer: 'agent' })).toBeNull()
      f.h.approvalGate.decide(gate.id, 'deny'); await waiting
      expect(await codeNotification(f.runtime, event)).toBeNull()
    } finally { await f.close() }
  })
  it('uses final personal Agent request transactions, never a group or unpublished internal turn', async () => {
    const f = await remoteFixture()
    try {
      const agent = (await f.rooms.agents.create({ clientRequestId: 'a', name: 'Agent' })).agent
      const { room } = await openAgentConversation(f.rooms.agents, f.rooms.service, agent.id)
      const sent = await f.rooms.service.send(room.id, { clientRequestId: 'source', body: 'private input' })
      const source = { seq: 1, roomId: room.id, kind: 'request.updated', payload: { id: sent.requestId }, createdAt: new Date().toISOString() }
      expect(await agentNotification(f.runtime, source)).toBeNull()
      const row = (await f.store.get<RoomRequestState>('request', sent.requestId))!
      await putRoomDocument(f.store, 'request', row.id, room.id, { ...row.value, status: 'completed' }, row)
      const value = await agentNotification(f.runtime, source)
      expect(value).toMatchObject({ resourceKind: 'agent', resourceId: agent.id, kind: 'completed' })
      expect(JSON.stringify(value)).not.toContain('private input')
      const group = (await f.rooms.service.create({ name: 'Group', clientRequestId: 'g' })).room
      const groupInput = await f.rooms.service.send(group.id, { clientRequestId: 'group-message', body: 'group input' })
      const groupRow = (await f.store.get<RoomRequestState>('request', groupInput.requestId))!
      await putRoomDocument(f.store, 'request', groupRow.id, group.id, { ...groupRow.value, status: 'completed' }, groupRow)
      expect(await agentNotification(f.runtime, { ...source, roomId: group.id, payload: { id: groupInput.requestId } })).toBeNull()
    } finally { await f.close() }
  })
  it('retries a temporary metadata projection failure without starting another turn', async () => {
    const f = await remoteFixture(), feed = new RemoteNotificationFeed(f.runtime)
    const abort = new AbortController()
    try {
      const thread = await f.code(), turn = await f.h.turns.startTurn({ threadId: thread.id, request: { prompt: 'work' } })
      await f.h.turns.finishTurn({ threadId: thread.id, turnId: turn.turnId, status: 'completed' })
      const stream = feed.stream(new Request('http://runtime/v1/remote/notification-events', { signal: abort.signal })).body!.getReader()
      await stream.read()
      const projection = vi.spyOn(f.h.threads, 'getMetadata').mockRejectedValueOnce(new Error('temporary Manager failure'))
      await f.h.events.record({ kind: 'turn_completed', threadId: thread.id, turnId: turn.turnId })
      const data = new TextDecoder().decode((await stream.read()).value)
      expect(JSON.parse(data.slice(6)).event).toMatchObject({ resourceId: thread.id, kind: 'completed' })
      expect(projection.mock.calls.length).toBeGreaterThanOrEqual(2)
      expect((await f.h.threads.get(thread.id))?.turns).toHaveLength(1)
      abort.abort(); await stream.cancel()
    } finally { abort.abort(); await feed.close(); await f.close() }
  })
  it('replays bounded opaque intents on disconnect without replaying a task and closes its stream at shutdown', async () => {
    const f = await remoteFixture(), feed = new RemoteNotificationFeed(f.runtime)
    const abort = new AbortController()
    try {
      const first = feed.stream(new Request('http://runtime/v1/remote/notification-events', { signal: abort.signal }))
      const reader = first.body!.getReader(), decoder = new TextDecoder()
      const synchronized = decoder.decode((await reader.read()).value), cursor = JSON.parse(synchronized.slice(6)).cursor
      const thread = await f.code(), start = await f.h.turns.startTurn({ threadId: thread.id, request: { prompt: 'work' } })
      await f.h.turns.finishTurn({ threadId: thread.id, turnId: start.turnId, status: 'completed' })
      const data = decoder.decode((await reader.read()).value)
      expect(JSON.parse(data.slice(6)).event).toMatchObject({ resourceKind: 'code', resourceId: thread.id, kind: 'completed' })
      abort.abort(); await reader.cancel()
      const replay = feed.stream(new Request('http://runtime/v1/remote/notification-events?cursor=' + encodeURIComponent(cursor))).body!.getReader()
      await replay.read()
      expect(JSON.parse(decoder.decode((await replay.read()).value).slice(6)).event.eventId).toBe(JSON.parse(data.slice(6)).event.eventId)
      await feed.close(); expect((await replay.read()).done).toBe(true)
      expect((await f.h.threads.get(thread.id))?.turns).toHaveLength(1)
    } finally { abort.abort(); await feed.close(); await f.close() }
  })
  it('drains more than one hundred retained intents under backpressure and reports ring overflow explicitly', async () => {
    const f = await remoteFixture(), feed = new RemoteNotificationFeed(f.runtime)
    const abort = new AbortController()
    try {
      const first = feed.stream(new Request('http://runtime/notification-events', { signal: abort.signal })).body!.getReader()
      const decoder = new TextDecoder(), cursor = JSON.parse(decoder.decode((await first.read()).value).slice(6)).cursor
      abort.abort(); await first.cancel()
      for (let i = 0; i < 101; i++) await feed['enqueue'](async () => ({ eventId: 'event_' + i, resourceKind: 'code', resourceId: 'task', kind: 'completed' }))
      const replay = feed.stream(new Request('http://runtime/notification-events?cursor=' + encodeURIComponent(cursor))).body!.getReader()
      await replay.read()
      const ids = []
      for (let i = 0; i < 101; i++) ids.push(JSON.parse(decoder.decode((await replay.read()).value).slice(6)).event.eventId)
      expect(ids).toHaveLength(101); expect(new Set(ids).size).toBe(101)
      await replay.cancel()
      for (let i = 101; i < 514; i++) await feed['enqueue'](async () => ({ eventId: 'event_' + i, resourceKind: 'code', resourceId: 'task', kind: 'completed' }))
      const overflow = feed.stream(new Request('http://runtime/notification-events?cursor=' + encodeURIComponent(cursor))).body!.getReader()
      const reset = JSON.parse(decoder.decode((await overflow.read()).value).slice(6))
      expect(reset.type).toBe('reset_required'); expect(reset.event).toBeUndefined()
      expect(await f.h.threads.list()).toEqual([])
      await overflow.cancel()
    } finally { abort.abort(); await feed.close(); await f.close() }
  })

})
