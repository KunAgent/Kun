import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { RoomService, putRoomDocument } from './room-service.js'
import { roomContext, roomContextBudget } from './room-context.js'
import { roomCoordinationPrompt } from './room-coordination-plan.js'
import type { RoomRequestState, RoomRuntimeDeps } from './room-runtime-types.js'

const execution = vi.hoisted(() => ({ ensure: vi.fn(async () => {}), enqueue: vi.fn(async () => 'summary-turn'),
  observe: vi.fn(async () => ({ status: 'completed', text: 'The earlier goal was to fix search; message original-request.' })) }))
vi.mock('./room-execution.js', () => ({ ensureRoomThread: execution.ensure, enqueueRoomTurn: execution.enqueue, observeRoomTurn: execution.observe }))
vi.mock('../loop/model-context-profile.js', () => ({ modelCapabilitiesForModel: (model: string) => ({ contextWindowTokens: model === 'small' ? 16000 : 128000 }) }))
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.clearAllMocks() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'room-context-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  cleanup.push(() => store.close())
  const service = new RoomService(store, () => {})
  const room = (await service.create({ clientRequestId: 'room', name: 'Context room' })).room
  const deps = { store, dataDir: root, model: () => ({ model: 'large' }), profiles: () => ({}) } as unknown as RoomRuntimeDeps
  const send = async (id: string, body = 'Continue the search fix', replyToMessageId?: string) => {
    const sent = await service.send(room.id, { clientRequestId: id, body, replyToMessageId })
    return (await store.get<RoomRequestState>('request', sent.requestId))!.value
  }
  return { store, service, room, deps, send }
}

describe('shared room context', () => {
  it('keeps a stable bounded snapshot for all members, preserving a direct reply and the full current user input', async () => {
    const f = await fixture()
    await f.service.publish(f.room.id, 'referenced', 'The second option uses the existing search index.', 'developer')
    for (let i = 0; i < 80; i += 1) await f.service.publish(f.room.id, 'history-' + i, '背景讨论'.repeat(500), 'developer')
    const body = 'USER REQUEST MUST STAY IN FULL '.repeat(300)
    const request = await f.send('current', body, 'referenced')
    request.roomSnapshot.members[1].modelRef = { model: 'small', providerId: 'test' }
    const context = await roomContext(f.deps, request)
    expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThanOrEqual(4000)
    expect(roomContextBudget(f.deps, request)).toBe(4000)
    expect(context.messages.find((message) => message.id === 'referenced')?.body).toContain('second option')
    expect(context.truncated).toBe(true)
    expect(roomCoordinationPrompt(request, context)).toContain(body)
    await f.service.publish(f.room.id, 'later', 'This new event must not mutate an admitted context.', 'developer')
    expect(await roomContext(f.deps, request)).toEqual(context)
  })

  it('does not include other rooms or history after the admitted source; finds related older messages by search', async () => {
    const f = await fixture()
    await f.service.publish(f.room.id, 'old-hit', 'quuxsearch uses a trigram index', 'developer')
    for (let i = 0; i < 140; i += 1) await f.service.publish(f.room.id, 'recent-' + i, 'Unrelated update ' + i, 'developer')
    const other = (await f.service.create({ clientRequestId: 'other', name: 'Private room' })).room
    await f.service.publish(other.id, 'private', 'quuxsearch PRIVATE ROOM SECRET', 'developer')
    const request = await f.send('search', 'quuxsearch')
    await f.service.publish(f.room.id, 'future', 'quuxsearch FUTURE UPDATE', 'developer')
    const snapshot = await roomContext(f.deps, request)
    expect(snapshot.messages.some((message) => message.id === 'old-hit')).toBe(true)
    expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE ROOM SECRET|FUTURE UPDATE/)
    const foreign = { ...request, id: 'wrong-reply', message: { ...request.message, replyToMessageId: 'private' } }
    await expect(roomContext(f.deps, foreign)).rejects.toThrow('different room')
  })

  it('advances cached summary only after a completed summary turn, with chronological input and no repeated recent page', async () => {
    const f = await fixture()
    const first = await f.send('first', 'Hello')
    await roomContext(f.deps, first)
    expect(execution.enqueue).not.toHaveBeenCalled()
    for (let i = 0; i < 65; i += 1) await f.service.publish(f.room.id, 'message-' + i, 'A short decision ' + i, 'developer')
    const request = await f.send('later')
    await roomContext(f.deps, request)
    const pending = await f.store.get<{ coveredSeq: number; pendingCoveredSeq: number }>('summary', f.room.id)
    expect(pending?.value.coveredSeq).toBe(0)
    expect(pending?.value.pendingCoveredSeq).toBeGreaterThan(0)
    const input = execution.enqueue.mock.calls.at(-1) as unknown as unknown[]
    expect(String(input[3]).indexOf('message-0')).toBeLessThan(String(input[3]).indexOf('message-10'))
    expect(String(input[3])).not.toContain('message-64')
    const next = await f.send('after-summary')
    const context = await roomContext(f.deps, next)
    expect(context.summary).toContain('earlier goal')
    expect((await f.store.get<{ coveredSeq: number }>('summary', f.room.id))?.value.coveredSeq).toBe(pending?.value.pendingCoveredSeq)
  })

  it('freezes only active project rule versions and rejects a tampered cached context identity', async () => {
    const f = await fixture()
    await putRoomDocument(f.store, 'rule', 'active-rule', f.room.id,
      { id: 'active-rule', messageId: 'original', body: 'Keep backward compatibility.', version: 3, active: true }, null)
    await putRoomDocument(f.store, 'rule', 'old-rule', f.room.id,
      { id: 'old-rule', messageId: 'old', body: 'Obsolete agreement', version: 1, active: false }, null)
    const request = await f.send('rules')
    const context = await roomContext(f.deps, request)
    expect(context.rules.map((rule) => [rule.id, rule.version])).toEqual([['active-rule', 3]])
    const cached = (await f.store.get('context', context.id))!
    await expect(putRoomDocument(f.store, 'context', context.id, 'different-room', context, cached)).rejects.toThrow('immutable')
    const get = f.store.get.bind(f.store)
    vi.spyOn(f.store, 'get').mockImplementation(async (kind, id) => kind === 'context' ? { ...cached, roomId: 'different-room' } : get(kind, id))
    await expect(roomContext(f.deps, request)).rejects.toThrow('another room')
  })
})

it('allocates a new summary attempt after a failed background summary without losing the old coverage', async () => {
  const f = await fixture()
  for (let i = 0; i < 65; i += 1) await f.service.publish(f.room.id, 'decision-' + i, 'Decision ' + i, 'developer')
  await roomContext(f.deps, await f.send('first-summary'))
  const original = await f.store.get<{ threadId: string }>('summary', f.room.id)
  execution.observe.mockResolvedValueOnce({ status: 'failed', text: '' })
  await roomContext(f.deps, await f.send('observe-failed'))
  expect((await f.store.get<{ coveredSeq: number }>('summary', f.room.id))?.value.coveredSeq).toBe(0)
  await roomContext(f.deps, await f.send('retry-summary'))
  expect((await f.store.get<{ threadId: string }>('summary', f.room.id))?.value.threadId).not.toBe(original?.value.threadId)
})
