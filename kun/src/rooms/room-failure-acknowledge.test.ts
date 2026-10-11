import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { AgentIdentityService } from '../agents/agent-identity-service.js'
import { RoomService } from './room-service.js'
import { RoomProductService } from './room-product-service.js'
import type { RoomRuntimeDeps } from './room-runtime-types.js'
import { openAgentConversation } from '../agents/agent-conversations.js'
import { roomActivitySummary } from './room-activity-summary.js'

const resources: Array<{ store: SqliteRoomStore; dir: string }> = []
afterEach(async () => {
  for (const { store, dir } of resources.splice(0)) { await store.close(); await rm(dir, { recursive: true, force: true }) }
})

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'kun-failure-ack-'))
  const store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') })
  resources.push({ store, dir })
  const agents = new AgentIdentityService(store, () => ({}))
  const service = new RoomService(store, () => {})
  service.setAgentDirectory(agents)
  const agent = (await agents.create({ clientRequestId: 'agent', name: 'Kun' })).agent
  const room = (await openAgentConversation(agents, service, agent.id)).room
  const product = new RoomProductService({ store } as unknown as RoomRuntimeDeps, service)
  const write = async (status: string, expectedRevision: number | null) => store.commit({
    requestId: `request-${status}-${expectedRevision}`,
    checks: [{ kind: 'request', id: 'reply', expectedRevision }],
    puts: [{ kind: 'request', id: 'reply', roomId: room.id, value: {
      id: 'reply', roomId: room.id, privateProtocol: 'direct-v1', status, message: { body: 'hi', attachmentIds: [] }
    } }] })
  const attention = async () => ({
    sidebar: (await store.sidebarPage({})).entries.find((entry) => entry.roomId === room.id)?.attentionCount,
    summary: (await roomActivitySummary(store, room.id)).attentionCount
  })
  const revision = async () => (await store.get('request', 'reply'))!.revision
  return { store, room, product, write, attention, revision }
}

it('stops listing a seen direct-chat failure as pending', async () => {
  const { room, product, write, attention } = await fixture()
  await write('failed', null)
  expect(await attention()).toEqual({ sidebar: 1, summary: 1 })

  await expect(product.acknowledgeRequestFailure(room.id, 'reply', 'seen-1')).resolves.toEqual({ id: 'reply', acknowledged: true })
  expect(await attention()).toEqual({ sidebar: 0, summary: 0 })
  // A replayed acknowledgement is idempotent; a second one is a no-op.
  await expect(product.acknowledgeRequestFailure(room.id, 'reply', 'seen-1')).resolves.toEqual({ id: 'reply', acknowledged: true })
  await expect(product.acknowledgeRequestFailure(room.id, 'reply', 'seen-2')).resolves.toEqual({ id: 'reply', acknowledged: false })
})

it('raises attention again when the request fails after a retry', async () => {
  const { room, product, write, attention, revision } = await fixture()
  await write('failed', null)
  await product.acknowledgeRequestFailure(room.id, 'reply', 'seen')
  expect(await attention()).toEqual({ sidebar: 0, summary: 0 })

  await write('pending', await revision())
  await write('failed', await revision())
  expect(await attention()).toEqual({ sidebar: 1, summary: 1 })
})

it('only acknowledges failures, never pending input or recovery', async () => {
  const { room, product, write, attention } = await fixture()
  await write('needs_input', null)
  await expect(product.acknowledgeRequestFailure(room.id, 'reply', 'seen')).resolves.toEqual({ id: 'reply', acknowledged: false })
  expect(await attention()).toEqual({ sidebar: 1, summary: 1 })
  await expect(product.acknowledgeRequestFailure('another-room', 'reply', 'seen-elsewhere')).rejects.toThrow('request not found')
})
