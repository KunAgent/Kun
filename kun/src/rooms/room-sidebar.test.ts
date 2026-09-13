import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { AgentIdentityService } from '../agents/agent-identity-service.js'
import { RoomService } from './room-service.js'
import { openAgentConversation, openAgentPairConversation } from '../agents/agent-conversations.js'

const resources: Array<{ store: SqliteRoomStore; dir: string }> = []
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'kun-sidebar-')), store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') })
  resources.push({ store, dir }); const agents = new AgentIdentityService(store, () => ({})), service = new RoomService(store, () => {})
  service.setAgentDirectory(agents)
  const a = (await agents.create({ clientRequestId: 'a', name: 'Alpha', title: 'Research' })).agent
  const b = (await agents.create({ clientRequestId: 'b', name: 'Beta' })).agent
  return { store, agents, service, a, b }
}
afterEach(async () => { for (const { store, dir } of resources.splice(0)) { await store.close(); await rm(dir, { recursive: true, force: true }) } })
it('pages one union, preserves identity on opening a private chat, and excludes peer chats by default', async () => {
  const { store, agents, service, a, b } = await fixture()
  await service.create({ clientRequestId: 'group', name: 'Team', members: [agents.asMember(a), agents.asMember(b)] })
  await openAgentPairConversation(agents, service, a.id, b.id)
  const first = await store.sidebarPage({ limit: 1 })
  expect(first.nextCursor).toBeTruthy()
  const entries = [...first.entries]; let cursor = first.nextCursor
  while (cursor) { const page = await store.sidebarPage({ limit: 1, cursor }); entries.push(...page.entries); cursor = page.nextCursor }
  expect(entries).toHaveLength(3)
  expect(new Set(entries.map((entry) => entry.id)).size).toBe(3)
  const before = entries.find((entry) => entry.agentId === a.id)!
  expect(before.roomId).toBeUndefined()
  const opened = (await openAgentConversation(agents, service, a.id)).room
  const after = (await store.sidebarPage({})).entries.find((entry) => entry.agentId === a.id)!
  expect(after.id).toBe(before.id); expect(after.roomId).toBe(opened.id)
  expect((await store.sidebarPage({ kind: 'agent_agent' })).entries).toHaveLength(1)
  await expect(store.sidebarPage({ search: 'different', cursor: first.nextCursor })).rejects.toThrow('scope')
})
it('ignores streaming drafts and profile edits for recency while keeping unread and archiving accurate', async () => {
  const { store, agents, service, a, b } = await fixture()
  const direct = (await openAgentConversation(agents, service, a.id)).room
  const sent = await service.send(direct.id, { clientRequestId: 'hello', body: 'Hello', executionIntent: 'discussion' })
  const before = (await store.sidebarPage({})).entries.map((entry) => entry.id)
  await agents.update(b.id, { clientRequestId: 'rename', expectedRevision: b.revision, name: 'Renamed' })
  expect((await store.sidebarPage({})).entries.map((entry) => entry.id)).toEqual(before)
  const row = await store.get('message', sent.message.id)
  await store.commit({ requestId: 'draft', checks: [{ kind: 'message', id: 'streaming', expectedRevision: null }], puts: [{ kind: 'message', id: 'streaming', roomId: direct.id,
    value: { ...sent.message, id: 'streaming', status: 'streaming', createdAt: '2099-01-01T00:00:00.000Z', body: 'Uncommitted draft' } }] })
  const unread = await store.sidebarPage({ unreadOnly: true })
  expect(unread.entries).toHaveLength(1)
  expect(unread.entries[0].latestMessage?.preview).toBe('Hello')
  await store.commit({ requestId: 'read', checks: [{ kind: 'read_state', id: direct.id, expectedRevision: null }], puts: [{ kind: 'read_state', id: direct.id, value: { seq: row!.seq } }] })
  expect((await store.sidebarPage({ unreadOnly: true })).entries).toEqual([])
  await agents.update(a.id, { clientRequestId: 'archive', expectedRevision: a.revision, archived: true })
  expect((await store.sidebarPage({ archivedOnly: true })).entries[0].agentId).toBe(a.id)
  expect((await store.sidebarPage({})).entries).toHaveLength(1)
})
