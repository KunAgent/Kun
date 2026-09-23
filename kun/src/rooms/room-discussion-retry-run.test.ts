import { roomRequestAction } from './room-request-actions.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeFakeModel, makeHarness } from '../../tests/loop-test-harness.js'
import { makeAssistantTextItem, makeErrorItem } from '../domain/item.js'
import type { RoomMessage } from '../contracts/rooms.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import { RoomService, putRoomDocument } from './room-service.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { RoomProductService } from './room-product-service.js'
import { RoomRequestRunner } from './room-request-runner.js'
import { ensureRoomThread, enqueueRoomTurn } from './room-execution.js'
import type { RoomRequestState, RoomRuntimeDeps } from './room-runtime-types.js'
import { roomDiscussionMessageId, roomDiscussionMessageThreads } from './room-discussion-message.js'
import { roomDiscussionContext } from './room-discussion-evidence.js'
import { roomMessageRunSource } from './room-run-query.js'
import { roomRunSegmentMessageId } from './room-run-segments.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'room-discussion-retry-'))
  const store = new SqliteRoomStore({ path: join(directory, 'rooms.sqlite') })
  const h = makeHarness(makeFakeModel([]))
  const deps: RoomRuntimeDeps = { store, threads: h.threads, threadStore: h.threadStore,
    turns: h.turns, sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    dataDir: directory, runTurn: (id, turnId) => h.loop.runTurn(id, turnId),
    profiles: () => ({}), model: () => ({ model: 'fake' }), assertOwnership: async () => {} }
  cleanup.push(async () => { await h.turns.interruptActiveTurns(); await store.close(); await rm(directory, { recursive: true, force: true }) })
  const service = new RoomService(store, () => {})
  const room = (await service.create({ clientRequestId: 'room', name: 'Directed retry', collaborationMode: 'directed' })).room
  const sent = await service.send(room.id, { clientRequestId: 'question', body: 'Inspect this design without implementing it.',
    executionIntent: 'discussion', mentionMemberIds: ['developer'] })
  const request = async () => (await store.get<RoomRequestState>('request', sent.requestId))!
  const initial = await request()
  const coordinator = await ensureRoomThread(deps, { id: initial.value.threadId, roomId: room.id,
    requestId: sent.requestId, member: room.members[0], kind: 'coordination' })
  const coordinatorTurnId = await enqueueRoomTurn(deps, coordinator.id, 'coordinator', 'Choose discussion members')
  const settle = async (threadId: string, turnId: string, status: 'completed' | 'failed') => {
    const thread = (await h.threads.getMetadata(threadId))!
    await h.threadStore.upsert({ ...thread, turns: thread.turns.map((turn) => turn.id === turnId
      ? { ...turn, status, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() } : turn) })
  }
  await settle(coordinator.id, coordinatorTurnId, 'completed')
  const threadId = 'room-member-' + sent.requestId + '-0-0-developer'
  await putRoomDocument(store, 'request', sent.requestId, room.id, { ...initial.value, stage: 'discuss',
    turnId: coordinatorTurnId, admissionAttempted: true,
    discussions: [{ memberId: 'developer', threadId, round: 0, continuation: 0, sourceMessageId: sent.message.id }] }, initial)
  const runner = new RoomRequestRunner(deps, service)
  return { h, deps, store, service, room, sent, threadId, request, settle, runner,
    tick: async () => runner.tick(await request()) }
}

describe('legacy discussion retry provenance', () => {
  it('keeps the failed first message and opens each attempt through its exact native run', async () => {
    const f = await fixture()
    await f.tick()
    const first = (await f.request()).value.discussions![0]
    await f.settle(f.threadId, first.turnId!, 'failed')
    await f.h.sessionStore.appendItem(f.threadId, makeErrorItem({ id: 'first-error', threadId: f.threadId,
      turnId: first.turnId!, message: 'First attempt failed' }))
    await f.tick()
    const failed = await f.request()
    expect(failed.value.status).toBe('failed')
    const originalId = roomDiscussionMessageId(f.threadId)
    const original = (await f.store.get<RoomMessage>('message', originalId))!.value
    expect(original.body).toBe('First attempt failed')
    expect(original.originRunId).toBeDefined()
    await new RoomProductService(f.deps, f.service).retryRequest(f.room.id, f.sent.requestId, 'retry', failed.revision)
    await f.tick()
    const second = (await f.request()).value.discussions![0]
    expect(second.threadId).toBe(first.threadId)
    expect(second.turnId).not.toBe(first.turnId)
    expect(second.attempt).toBe(1)
    await f.settle(f.threadId, second.turnId!, 'completed')
    await f.h.sessionStore.appendItem(f.threadId, makeAssistantTextItem({ id: 'second-answer', threadId: f.threadId,
      turnId: second.turnId!, text: 'A successful concrete finding.' }))
    await f.tick()
    const retryId = roomDiscussionMessageId(f.threadId, second.attempt)
    expect(retryId).toBe(originalId + '-attempt-1')
    expect((await f.store.get<RoomMessage>('message', originalId))!.value).toEqual(original)
    const retry = (await f.store.list<RoomMessage>('message', { roomId: f.room.id }))
      .map((row) => row.value).find((message) => message.originItemId === 'second-answer')!
    expect(retry.body).toBe('A successful concrete finding.')
    expect(retry.id).toBe(roomRunSegmentMessageId(retry.originRunId!, 'second-answer'))
    expect(retry.originRunId).not.toBe(original.originRunId)
    const previousRun = (await f.store.get<RoomRunRecord>('room_run', original.originRunId!))!.value
    const retryRun = (await f.store.get<RoomRunRecord>('room_run', retry.originRunId!))!.value
    expect(previousRun).toMatchObject({ turnId: first.turnId, status: 'failed', publishedMessageId: originalId })
    expect(retryRun).toMatchObject({ turnId: second.turnId, attempt: 2, previousRunId: previousRun.id, publishedMessageId: retry.id })
    expect(await roomMessageRunSource(f.deps, f.room.id, originalId)).toEqual({ runId: previousRun.id })
    expect(await roomMessageRunSource(f.deps, f.room.id, retry.id)).toEqual({ runId: retryRun.id })
    const frozen = { id: 'frozen', roomId: f.room.id, coveredSeq: 0, summary: '', messages: [], rules: [], truncated: false }
    const before = structuredClone(frozen)
    const evidence = roomDiscussionContext((await f.request()).value, frozen, 8000).discussionEvidence!
    expect(evidence.responses).toEqual([expect.objectContaining({ messageId: retryId, turnId: second.turnId, attempt: 1 })])
    expect(frozen).toEqual(before)
  })

  it('allocates a fresh native identity when a failed legacy request continues at round zero', async () => {
    const f = await fixture()
    await f.tick()
    const first = (await f.request()).value.discussions![0]
    await f.settle(f.threadId, first.turnId!, 'failed')
    await f.h.sessionStore.appendItem(f.threadId, makeErrorItem({ id: 'failed', threadId: f.threadId,
      turnId: first.turnId!, message: 'First discussion failed' }))
    await f.tick()
    const failed = await f.request()
    await roomRequestAction(f.deps, f.service, f.room.id, f.sent.requestId, 'continue', {
      clientRequestId: 'continue-request', expectedRevision: failed.revision,
      message: { body: 'Continue inspecting the cancellation boundary.', mentionMemberIds: ['developer'], executionIntent: 'discussion' }
    })
    await f.tick()
    const coordinating = await f.request()
    await f.settle(coordinating.value.threadId, coordinating.value.turnId!, 'completed')
    await f.h.sessionStore.appendItem(coordinating.value.threadId, makeAssistantTextItem({ id: 'coordination-result',
      threadId: coordinating.value.threadId, turnId: coordinating.value.turnId!,
      text: JSON.stringify({ kind: 'discussion', response: 'Inspect the cancellation boundary.', participants: ['developer'] }) }))
    await f.tick()
    await f.tick()
    const next = (await f.request()).value.discussions![0]
    expect(next.threadId).not.toBe(first.threadId)
    expect(next.turnId).toBeDefined()
    const runs = await f.store.list<RoomRunRecord>('room_run', { roomId: f.room.id, memberId: 'developer', phase: 'discussion', order: 'asc' })
    expect(runs).toHaveLength(2)
    expect(runs[1].value.clientRequestId).toContain('-continuation-1')
    expect(runs[1].value).toMatchObject({ threadId: next.threadId, turnId: next.turnId, previousRunId: runs[0].id })
    expect(runs[0].value.threadId).toBe(first.threadId)
  })

  it('does not assume suffix-like thread names are a retry and bounds new message IDs', () => {
    expect(roomDiscussionMessageThreads('reply-member-attempt-1')).toEqual(['member-attempt-1', 'member'])
    expect(roomDiscussionMessageId('member-attempt-1')).toBe('reply-member-attempt-1')
    expect(roomDiscussionMessageId('x'.repeat(120), 1).length).toBeLessThanOrEqual(128)
  })
})
