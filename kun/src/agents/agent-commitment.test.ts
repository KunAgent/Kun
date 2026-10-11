import { afterEach, expect, it } from 'vitest'
import { AgentCommitmentService } from './agent-commitment-service.js'
import { AgentIdentityService } from './agent-identity-service.js'
import { agentCommitmentTools, bindAgentCommitmentService } from './agent-commitment-tools.js'
import { workbenchFixture } from '../workbench-bridge/workbench-test-support.js'
import { RoomMessageSchema, type RoomMessage } from '../contracts/rooms.js'
import { putRoomDocument } from '../rooms/room-service.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { join } from 'node:path'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture() {
  const f = await workbenchFixture(); cleanups.push(f.cleanup)
  const agents = new AgentIdentityService(f.store, () => ({}))
  const service = new AgentCommitmentService(f.deps, agents)
  const source = RoomMessageSchema.parse({ id: 'source', roomId: f.room.id, messageSeq: 1, authorKind: 'user',
    authorLabelSnapshot: 'You', body: 'Track my conference registration and confirm the booking by Friday', bodyRevision: 0,
    mentionMemberIds: [], attachmentIds: [], status: 'final', createdAt: new Date().toISOString() })
  await putRoomDocument(f.store, 'message', source.id, f.room.id, source, null)
  bindAgentCommitmentService(f.deps.threadStore, service)
  const input = { clientRequestId: 'create-commitment', objective: 'Conference registration',
    acceptance: 'Booking confirmation received', sourceRoomId: f.room.id, sourceMessageId: source.id }
  return { ...f, agents, commitments: service, input }
}

it('persists a cross-thread commitment with source authorization, paging and evidence after reopening', async () => {
  const f = await fixture()
  const first = await f.commitments.create('agent-1', f.input)
  expect(await f.commitments.create('agent-1', f.input)).toEqual(first)
  expect(first.authorization.text).toContain('conference registration')
  for (let n = 0; n < 3; n++) await f.commitments.create('agent-1', { ...f.input, clientRequestId: `more-${n}`, objective: 'Another outcome ' + n })
  const page = await f.commitments.list('agent-1', { limit: 2 })
  expect(page.commitments).toHaveLength(2); expect(page.nextCursor).toBeTruthy()
  expect((await f.commitments.list('agent-1', { limit: 2, cursor: page.nextCursor })).commitments).toHaveLength(2)
  expect((await f.commitments.list('agent-1', { search: 'conference' })).commitments.map((item) => item.id)).toEqual([first.id])
  const waiting = await f.commitments.update('agent-1', first.id, { clientRequestId: 'waiting', expectedRevision: 0,
    status: 'waiting', waitingOn: 'Organizer confirmation', nextCheckAt: '2026-10-02T12:00:00Z' })
  expect(waiting.revision).toBe(1)
  await expect(f.commitments.update('agent-1', first.id, { clientRequestId: 'stale', expectedRevision: 0, status: 'cancelled' })).rejects.toThrow('changed')
  await expect(f.commitments.update('agent-1', first.id, { clientRequestId: 'done-no-evidence', expectedRevision: 1, status: 'completed' })).rejects.toThrow('evidence')
  const completed = await f.commitments.update('agent-1', first.id, { clientRequestId: 'done', expectedRevision: 1,
    status: 'completed', acceptanceEvidence: [{ summary: 'Organizer sent confirmation ABC-123' }], results: [{ summary: 'Registration confirmed' }] })
  expect(completed.nextCheckAt).toBeNull()
  await f.store.close()
  const reopened = new SqliteRoomStore({ path: join(f.directory, 'rooms.sqlite') }); cleanups.push(() => reopened.close())
  const read = new AgentCommitmentService({ ...f.deps, store: reopened }, new AgentIdentityService(reopened, () => ({})))
  expect(await read.get('agent-1', first.id)).toEqual(completed)
})

it('rejects fabricated authorization and foreign execution links, cancellation never stops a linked executor', async () => {
  const f = await fixture()
  await expect(f.commitments.create('agent-1', { ...f.input, sourceMessageId: 'missing' })).rejects.toThrow('actual user message')
  const source = (await f.store.get<RoomMessage>('message', 'source'))!
  await putRoomDocument(f.store, 'message', 'agent-auth', f.room.id, { ...source.value, id: 'agent-auth', authorKind: 'member' }, null)
  await expect(f.commitments.create('agent-1', { ...f.input, sourceMessageId: 'agent-auth' })).rejects.toThrow('actual user message')
  f.addCodeThread('foreign-thread', f.directory)
  await expect(f.commitments.create('agent-1', { ...f.input, links: [{ kind: 'thread', id: 'foreign-thread' }] })).rejects.toThrow('outside')
  const first = await f.commitments.create('agent-1', f.input)
  const cancelled = await f.commitments.update('agent-1', first.id, { clientRequestId: 'cancel', expectedRevision: 0, status: 'cancelled' })
  expect(cancelled.status).toBe('cancelled'); expect(f.stub.calls.interrupted).toEqual([])
  const tool = agentCommitmentTools(f.deps.threadStore).find((item) => item.name === 'list_agent_commitments')!
  expect((await tool.execute({}, f.context())).isError).not.toBe(true)
  expect((await tool.execute({}, { ...f.context(), turnId: 'forged' })).isError).toBe(true)
})


it('preserves omitted fields on a status-only update', async () => {
  const f = await fixture()
  const first = await f.commitments.create('agent-1', { ...f.input, deadline: '2026-10-05T12:00:00Z',
    nextCheckAt: '2026-10-02T12:00:00Z', waitingOn: 'Registration email' })
  const next = await f.commitments.update('agent-1', first.id, { clientRequestId: 'status-only', expectedRevision: 0, status: 'in_progress' })
  expect(next.deadline).toBe(first.deadline); expect(next.nextCheckAt).toBe(first.nextCheckAt)
  expect(next.waitingOn).toBe(first.waitingOn)
})


it('preserves omitted fields through the model tool parser as well as the API', async () => {
  const f = await fixture()
  const first = await f.commitments.create('agent-1', { ...f.input, deadline: '2026-10-05T12:00:00Z',
    nextCheckAt: '2026-10-02T12:00:00Z', waitingOn: 'Registration email' })
  const tool = agentCommitmentTools(f.deps.threadStore).find((item) => item.name === 'update_agent_commitment')!
  const result = await tool.execute({ id: first.id, expectedRevision: 0, status: 'in_progress' }, f.context('status-tool'))
  expect(result.isError).not.toBe(true)
  const next = await f.commitments.get('agent-1', first.id)
  expect(next.deadline).toBe(first.deadline); expect(next.nextCheckAt).toBe(first.nextCheckAt)
  expect(next.waitingOn).toBe(first.waitingOn)
})
