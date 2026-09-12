import { afterEach, describe, expect, it, vi } from 'vitest'
import { productServiceFixture } from '../../tests/room-product-service-test-fixture.js'
import { roomRequestAction, settleRoomRequestStop } from './room-request-actions.js'
import { putRoomDocument } from './room-service.js'
import type { RoomRequestState } from './room-runtime-types.js'

const fixtures: Awaited<ReturnType<typeof productServiceFixture>>[] = []
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close() })
async function fixture() {
  const f = await productServiceFixture()
  fixtures.push(f)
  const sent = await f.service.send(f.room.id, { clientRequestId: 'initial', body: 'Implement the feature', attachmentIds: ['original-file'] })
  const request = async () => (await f.store.get<RoomRequestState>('request', sent.requestId))!
  await putRoomDocument(f.store, 'request', sent.requestId, f.room.id,
    { ...(await request()).value, status: 'needs_input', clarification: 'Which repository?',
      discussions: [{ memberId: 'developer', threadId: 'completed-discussion', response: 'Prior completed analysis' }] }, await request())
  return { ...f, request, id: sent.requestId }
}
describe('request continuation and stop receipts', () => {
  it('continues the original request with immutable supplemental input, exact attachments and retained discussion', async () => {
    const f = await fixture()
    const input = { clientRequestId: 'answer', expectedRevision: (await f.request()).revision,
      message: { body: 'Use the authorized repository', attachmentIds: ['second-file'] } }
    const result = await roomRequestAction(f.deps, f.service, f.room.id, f.id, 'continue', input)
    expect(await roomRequestAction(f.deps, f.service, f.room.id, f.id, 'continue', input)).toEqual(result)
    const current = await f.request()
    expect(current.value).toMatchObject({ id: f.id, status: 'pending', continuation: 1, originalMessage: { body: 'Implement the feature' },
      previousDiscussions: [{ response: 'Prior completed analysis' }], message: { attachmentIds: ['original-file', 'second-file'] } })
    expect(current.value.message.body).toContain('Which repository?')
    expect(current.value.message.body).toContain('Use the authorized repository')
    expect(await f.store.list('request', { roomId: f.room.id })).toHaveLength(1)
    expect(await f.store.list('request_input', { roomId: f.room.id })).toHaveLength(1)
    await expect(roomRequestAction(f.deps, f.service, f.room.id, f.id, 'continue',
      { ...input, message: { body: 'Different answer' } })).rejects.toThrow('identity conflict')
  })
  it('keeps the original task untouched when closing a coordination request', async () => {
    const f = await fixture()
    const task = await f.task()
    await roomRequestAction(f.deps, f.service, f.room.id, f.id, 'cancel', {
      clientRequestId: 'close', expectedRevision: (await f.request()).revision })
    expect((await f.request()).value.status).toBe('cancelled')
    expect(await f.task()).toEqual(task)
  })
  it('persists a stop intent across transport failure and settles after the original turn ends', async () => {
    const f = await fixture()
    const row = await f.request()
    await putRoomDocument(f.store, 'request', f.id, f.room.id,
      { ...row.value, status: 'running', turnId: 'active-turn', discussions: undefined }, row)
    const metadata = vi.spyOn(f.deps.threads, 'getMetadata').mockResolvedValue({ turns: [{ id: 'active-turn', status: 'running' }] } as never)
    vi.spyOn(f.deps.turns, 'interruptTurn').mockRejectedValue(new Error('temporary transport failure'))
    await roomRequestAction(f.deps, f.service, f.room.id, f.id, 'cancel', {
      clientRequestId: 'cancel', expectedRevision: (await f.request()).revision })
    await settleRoomRequestStop(f.deps, await f.request())
    expect((await f.request()).value).toMatchObject({ cancellationRequested: true, status: 'stopping' })
    metadata.mockResolvedValue({ turns: [{ id: 'active-turn', status: 'aborted' }] } as never)
    await settleRoomRequestStop(f.deps, await f.request())
    expect((await f.request()).value.status).toBe('cancelled')
  })
  it('does not continue a missing execution without stopped evidence', async () => {
    const f = await fixture()
    const row = await f.request()
    await putRoomDocument(f.store, 'request', f.id, f.room.id, { ...row.value, turnId: 'missing' }, row)
    await expect(roomRequestAction(f.deps, f.service, f.room.id, f.id, 'continue', {
      clientRequestId: 'unsafe', expectedRevision: (await f.request()).revision, message: { body: 'Continue' }
    })).rejects.toThrow('reconcile')
    expect((await f.request()).value.status).toBe('needs_input')
  })
})
