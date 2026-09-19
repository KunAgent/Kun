import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeFakeModel, makeHarness } from '../../../tests/loop-test-harness.js'
import { SqliteRoomStore } from '../../rooms/room-store-sqlite.js'
import { RoomRuntime } from '../../rooms/room-runtime.js'
import { Router } from '../router.js'
import { dispatchRequest } from '../http-server.js'
import { registerRoomRoutes } from './register-room-routes.js'
import type { ServerRuntime } from './server-runtime.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-poll-http-')), store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const h = makeHarness(makeFakeModel([]))
  const rooms = new RoomRuntime({ store, threads: h.threads, threadStore: h.threadStore, turns: h.turns,
    sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate, dataDir: root,
    model: () => ({ model: 'fake' }), profiles: () => ({}), assertOwnership: () => store.assertOwnership(), runTurn: (id, turnId) => h.loop.runTurn(id, turnId) })
  const router = new Router()
  registerRoomRoutes(router, { rooms, runtimeToken: 'poll-token', insecure: false } as ServerRuntime)
  const room = (await rooms.service.create({ clientRequestId: 'room', name: 'Poll HTTP' })).room
  const call = async (path: string, method = 'GET', body?: unknown, token = 'poll-token') => {
    const response = await dispatchRequest(router, new Request('http://localhost' + path, { method,
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
    return { status: response.status, body: await response.json() }
  }
  cleanups.push(async () => { await rooms.close(); await store.close(); await rm(root, { recursive: true, force: true }) })
  return { rooms, room, store, call, base: '/v1/rooms/' + room.id }
}

describe('room interaction HTTP presentation boundary', () => {
  it('keeps polls, ballots and reactions outside the request queue until the user explicitly invites', async () => {
    const f = await fixture(), send = vi.spyOn(f.rooms.service, 'send')
    const created = await f.call(f.base + '/polls', 'POST', { clientRequestId: 'poll', question: 'Pick API', options: ['First', 'Second'] })
    expect(created.status).toBe(200)
    const { poll, messageId } = created.body
    const messages = await f.call(f.base + '/messages')
    expect(messages.body.messages).toHaveLength(1)
    expect(messages.body.messages[0]).toMatchObject({ presentationKind: 'poll', pollId: poll.pollId })
    const before = messages.body.messages[0]
    const vote = await f.call(`${f.base}/polls/${poll.pollId}/vote`, 'PUT', { clientRequestId: 'vote', optionIds: ['option-1'] })
    expect(vote.status).toBe(200)
    const reaction = await f.call(`${f.base}/messages/${messageId}/reactions`, 'PUT', { clientRequestId: 'react', emoji: '👍', active: true })
    expect(reaction.status).toBe(200)
    expect((await f.call(`${f.base}/messages/${messageId}/interactions`)).body.reactions.reactions).toHaveLength(1)
    expect((await f.call(f.base + '/messages')).body.messages[0]).toEqual(before)
    expect(send).not.toHaveBeenCalled()
    expect(await f.store.list('request', { roomId: f.room.id })).toHaveLength(0)
    const invited = await f.call(`${f.base}/polls/${poll.pollId}/invite`, 'POST', { clientRequestId: 'invite', memberIds: ['developer'] })
    expect(invited.status).toBe(200)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][1]).toMatchObject({ executionIntent: 'discussion', pollInvitation: { pollId: poll.pollId, memberIds: ['developer'] } })
    expect((await f.call(`${f.base}/polls/${poll.pollId}/invite`, 'POST', { clientRequestId: 'invite', memberIds: ['developer'] })).body).toEqual(invited.body)
    expect(send).toHaveBeenCalledTimes(1)
    await f.call(`${f.base}/polls/${poll.pollId}/close`, 'POST', { clientRequestId: 'close' })
    expect((await f.call(`${f.base}/polls/${poll.pollId}/vote`, 'PUT', { clientRequestId: 'late', optionIds: ['option-2'] })).status).toBe(409)
  })

  it('authenticates, scopes and validates all presentation writes', async () => {
    const f = await fixture()
    expect((await f.call(f.base + '/polls', 'POST', { clientRequestId: 'bad', question: 'One', options: ['only'] })).status).toBe(400)
    expect((await f.call(f.base + '/polls', 'POST', { clientRequestId: 'bad', question: 'Many', options: Array.from({ length: 11 }, (_, i) => String(i)) })).status).toBe(400)
    const created = await f.call(f.base + '/polls', 'POST', { clientRequestId: 'good', question: 'Pick', options: ['A', 'B'] })
    const path = `${f.base}/polls/${created.body.poll.pollId}`
    expect((await f.call(path, 'GET', undefined, 'wrong')).status).toBe(401)
    expect((await f.call(`/v1/rooms/other/polls/${created.body.poll.pollId}`)).status).toBe(404)
    expect((await f.call(path + '/vote', 'PUT', { clientRequestId: 'fake', optionIds: ['option-1'], memberId: 'developer' })).status).toBe(400)
    expect((await f.call(path + '/invite', 'POST', { clientRequestId: 'bad-member', memberIds: ['unknown'] })).status).toBe(409)
    expect((await f.call(`${f.base}/messages/${created.body.messageId}/reactions`, 'PUT', { clientRequestId: 'fake-react', emoji: 'not-an-emoji', active: true })).status).toBe(400)
  })
})
