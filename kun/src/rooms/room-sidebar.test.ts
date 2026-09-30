import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { AgentIdentityService } from '../agents/agent-identity-service.js'
import { RoomService } from './room-service.js'
import { openAgentConversation, openAgentPairConversation } from '../agents/agent-conversations.js'
import { roomActivitySummary } from './room-activity-summary.js'

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
it('lists conversations separately from agents and excludes peer chats by default', async () => {
  const { store, agents, service, a, b } = await fixture()
  await service.create({ clientRequestId: 'group', name: 'Team', members: [agents.asMember(a), agents.asMember(b)] })
  await service.create({ clientRequestId: 'group-two', name: 'Second team', members: [agents.asMember(a), agents.asMember(b)] })
  await openAgentPairConversation(agents, service, a.id, b.id)
  const first = await store.sidebarPage({ limit: 1 })
  expect(first.nextCursor).toBeTruthy()
  const entries = [...first.entries]; let cursor = first.nextCursor
  while (cursor) { const page = await store.sidebarPage({ limit: 1, cursor }); entries.push(...page.entries); cursor = page.nextCursor }
  expect(entries).toHaveLength(2)
  expect(new Set(entries.map((entry) => entry.id)).size).toBe(2)
  expect(entries.some((entry) => entry.agentId === a.id)).toBe(false)
  const opened = (await openAgentConversation(agents, service, a.id)).room
  expect((await store.sidebarPage({})).entries.some((entry) => entry.roomId === opened.id)).toBe(true)
  // Both Rooms and the Code private list retain an explicitly opened empty chat.
  const privatePage = await store.sidebarPage({ kind: 'agents' })
  expect(privatePage.entries.map((entry) => entry.roomId)).toEqual([opened.id])
  expect(privatePage.entries[0]).toMatchObject({ agentId: a.id, pinned: false, latestMessageSeq: 0 })
  await service.send(opened.id, { clientRequestId: 'start-chat', body: 'Hello' })
  const after = (await store.sidebarPage({})).entries.find((entry) => entry.agentId === a.id)!
  expect(after.roomId).toBe(opened.id)
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
  await agents.update(a.id, { clientRequestId: 'archive-agent', expectedRevision: a.revision, archived: true })
  expect((await store.sidebarPage({})).entries[0].roomId).toBe(direct.id)
  expect((await store.sidebarPage({ archivedOnly: true })).entries).toEqual([])
  await service.update(direct.id, { clientRequestId: 'archive-chat', expectedRevision: direct.revision, archived: true })
  expect((await store.sidebarPage({ archivedOnly: true })).entries[0].agentId).toBe(a.id)
  expect((await store.sidebarPage({})).entries).toHaveLength(0)
})
it('keeps a paged conversation list stable when a new Agent chat opens', async () => {
  const { store, agents, service, a } = await fixture()
  for (let index = 0; index < 25; index++) await service.create({ clientRequestId: 'group-' + index, name: 'Group ' + index })
  const first = await store.sidebarPage({ limit: 17 })
  const allBefore = await store.sidebarPage({ limit: 100 })
  await openAgentConversation(agents, service, a.id)
  const entries = [...first.entries]; let cursor = first.nextCursor
  while (cursor) {
    const next = await store.sidebarPage({ limit: 17, cursor })
    expect(next.entries.length).toBeLessThanOrEqual(17)
    entries.push(...next.entries); cursor = next.nextCursor
  }
  expect(entries.map((entry) => entry.id)).toEqual(allBefore.entries.map((entry) => entry.id))
  expect(new Set(entries.map((entry) => entry.id)).size).toBe(25)
})
it('pages mixed empty private and group conversations without unused Agent catalog or pair rooms', async () => {
  const { store, agents, service, a, b } = await fixture()
  const group = (await service.create({ clientRequestId: 'empty-group', name: 'Empty team',
    members: [agents.asMember(a), agents.asMember(b)] })).room
  const direct = (await openAgentConversation(agents, service, a.id)).room
  const pair = (await openAgentPairConversation(agents, service, a.id, b.id)).room
  const first = await store.sidebarPage({ kind: 'all', limit: 1 })
  expect(first.entries[0].roomId).toBe(direct.id)
  expect(first.entries[0]).toMatchObject({ id: 'room:' + direct.id, agentId: a.id, latestMessageSeq: 0 })
  expect(first.entries[0].latestMessage).toBeUndefined()
  expect(first.nextCursor).toBeTruthy()
  const second = await store.sidebarPage({ kind: 'all', limit: 1, cursor: first.nextCursor })
  expect(second.entries.map((entry) => entry.roomId)).toEqual([group.id])
  expect(second.nextCursor).toBeUndefined()
  expect((await store.sidebarPage({ kind: 'agents' })).entries.map((entry) => entry.roomId)).toEqual([direct.id])
  expect((await store.sidebarPage({ kind: 'group' })).entries.map((entry) => entry.roomId)).toEqual([group.id])
  expect((await store.sidebarPage({ kind: 'agent_agent' })).entries.map((entry) => entry.roomId)).toEqual([pair.id])
  expect((await store.sidebarPage({ search: 'Research' })).entries.map((entry) => entry.roomId)).toEqual([direct.id])
  expect((await store.sidebarPage({ unreadOnly: true })).entries).toEqual([])
  expect((await store.sidebarPage({})).entries.some((entry) => entry.agentId === b.id)).toBe(false)
  await expect(store.sidebarPage({ kind: 'agents', cursor: first.nextCursor })).rejects.toThrow('scope')
})
it('retains queued work and integration attention, excluding cancelled integration failures', async () => {
  const { store, agents, service, a } = await fixture()
  const room = (await openAgentConversation(agents, service, a.id)).room
  await store.commit({ requestId: 'activities', checks: [
    { kind: 'task', id: 'queued', expectedRevision: null }, { kind: 'task', id: 'done', expectedRevision: null },
    { kind: 'integration', id: 'integration', expectedRevision: null }
  ], puts: [
    { kind: 'task', id: 'queued', roomId: room.id, value: { task: { id: 'queued', status: 'waiting_dependency' } } },
    { kind: 'task', id: 'done', roomId: room.id, value: { task: { id: 'done', status: 'completed' } } },
    { kind: 'integration', id: 'integration', roomId: room.id, taskId: 'done', value: { taskId: 'done', status: 'failed' } }
  ] })
  const entry = (await store.sidebarPage({ attentionOnly: true })).entries[0]
  expect(entry.roomId).toBe(room.id); expect(entry.attentionCount).toBe(1); expect(entry.runningCount).toBe(1)
  await store.commit({ requestId: 'cancelled-integration', checks: [{ kind: 'integration', id: 'integration', expectedRevision: 0 }],
    puts: [{ kind: 'integration', id: 'integration', roomId: room.id, value: { taskId: 'done', status: 'failed', cancelRequested: true } }] })
  expect((await store.sidebarPage({ attentionOnly: true })).entries).toEqual([])
})
it('shows only the latest private request as needing attention', async () => {
  const { store, agents, service, a } = await fixture()
  const room = (await openAgentConversation(agents, service, a.id)).room
  const put = async (id: string, status: string) => store.commit({ requestId: id,
    checks: [{ kind: 'request', id, expectedRevision: null }],
    puts: [{ kind: 'request', id, roomId: room.id, value: {
      id, roomId: room.id, privateProtocol: 'direct-v1', status,
      message: { body: id, attachmentIds: [] }
    } }] })
  const attention = async () => (await store.sidebarPage({})).entries.find((entry) => entry.roomId === room.id)?.attentionCount
  await put('first-failure', 'failed')
  expect(await attention()).toBe(1)
  await put('later-success', 'completed')
  expect(await attention()).toBe(0)
  expect((await store.sidebarPage({ attentionOnly: true })).entries).toEqual([])
  expect(await roomActivitySummary(store, room.id)).toMatchObject({ attentionCount: 0 })
  const old = await store.list<{ currentAttentionRequest: number }>('request', { roomId: room.id, status: 'failed', summaryOnly: true })
  expect(old[0].value.currentAttentionRequest).toBe(0)
  await put('new-failure', 'failed')
  expect(await attention()).toBe(1)
  expect(await roomActivitySummary(store, room.id)).toMatchObject({ attentionCount: 1 })
  expect((await store.sidebarPage({ attentionOnly: true })).entries[0].roomId).toBe(room.id)
})
it('moves only the conversation to Recently deleted and starts a fresh chat with the same Agent', async () => {
  const { store, agents, service, a } = await fixture()
  const original = (await openAgentConversation(agents, service, a.id)).room
  await store.commit({ requestId: 'old-failure', checks: [{ kind: 'request', id: 'old-failure', expectedRevision: null }],
    puts: [{ kind: 'request', id: 'old-failure', roomId: original.id, value: {
      id: 'old-failure', privateProtocol: 'direct-v1', status: 'failed'
    } }] })
  expect(await roomActivitySummary(store, original.id)).toMatchObject({ attentionCount: 1 })
  const deleted = (await service.update(original.id, { clientRequestId: 'delete-chat', expectedRevision: original.revision,
    deleted: true })).room
  expect(deleted.deletedAt).toBeTruthy()
  expect((await store.sidebarPage({})).entries).toEqual([])
  expect((await store.sidebarPage({ deletedOnly: true })).entries.map((entry) => entry.roomId)).toEqual([original.id])
  expect((await store.listRooms({ conversationKind: 'user_agent' })).rooms).toEqual([])
  expect(await roomActivitySummary(store, original.id)).toMatchObject({ attentionCount: 0 })
  expect(await store.get('agent_identity', a.id)).not.toBeNull()
  const fresh = (await openAgentConversation(agents, service, a.id)).room
  expect(fresh.id).not.toBe(original.id)
  expect((await store.sidebarPage({})).entries.map((entry) => entry.roomId)).toEqual([fresh.id])
  await service.send(fresh.id, { clientRequestId: 'start-fresh', body: 'New conversation' })
  expect((await store.sidebarPage({})).entries.map((entry) => entry.roomId)).toEqual([fresh.id])
  await service.update(original.id, { clientRequestId: 'restore-chat', expectedRevision: deleted.revision,
    deleted: false })
  expect((await store.sidebarPage({})).entries.map((entry) => entry.roomId)).toContain(original.id)
  expect((await store.sidebarPage({ deletedOnly: true })).entries).toEqual([])
})
it('requires active work to stop before a conversation moves to Recently deleted', async () => {
  const { store, agents, service, a } = await fixture()
  const room = (await openAgentConversation(agents, service, a.id)).room
  await store.commit({ requestId: 'running-request', checks: [{ kind: 'request', id: 'running-request', expectedRevision: null }],
    puts: [{ kind: 'request', id: 'running-request', roomId: room.id, value: { status: 'running' } }] })
  await expect(service.update(room.id, { clientRequestId: 'delete-busy', expectedRevision: room.revision, deleted: true }))
    .rejects.toThrow('stop or reconcile active work')
  expect((await store.sidebarPage({})).entries[0].roomId).toBe(room.id)
})
it('does not treat superseded peer requests or orphan integrations as attention', async () => {
  const { store, agents, service, a } = await fixture()
  const room = (await openAgentConversation(agents, service, a.id)).room
  await store.commit({ requestId: 'ghosts', checks: [
    { kind: 'request', id: 'root', expectedRevision: null }, { kind: 'request', id: 'old', expectedRevision: null },
    { kind: 'integration', id: 'orphan', expectedRevision: null }
  ], puts: [
    { kind: 'request', id: 'root', roomId: room.id, value: {
      id: 'root', status: 'completed', collaborationProtocol: 'peer', rootRequestId: 'root',
      peerLatestRequestId: 'current', message: { body: 'Root' } } },
    { kind: 'request', id: 'old', roomId: room.id, value: {
      id: 'old', status: 'needs_input', collaborationProtocol: 'peer', rootRequestId: 'root',
      message: { body: 'Stale clarify' } } },
    { kind: 'integration', id: 'orphan', roomId: room.id, value: { taskId: 'missing', status: 'ready' } }
  ] })
  expect((await store.sidebarPage({ attentionOnly: true })).entries).toEqual([])
  expect((await store.sidebarPage({})).entries.find((entry) => entry.roomId === room.id)?.attentionCount).toBe(0)
})
it('surfaces a group room avatar without replacing a private agent portrait', async () => {
  const { store, agents, service, a, b } = await fixture()
  const agent = (await agents.update(a.id, {
    clientRequestId: 'agent-avatar', expectedRevision: a.revision, avatar: { kind: 'builtin', id: 'explorer' }
  })).agent
  await service.create({
    clientRequestId: 'group-avatar', name: 'Team',
    members: [agents.asMember(agent), agents.asMember(b)],
    avatar: { kind: 'builtin', id: 'scientist' }
  })
  const direct = (await openAgentConversation(agents, service, agent.id)).room
  await service.send(direct.id, { clientRequestId: 'open-chat', body: 'Hello' })
  const entries = (await store.sidebarPage({})).entries
  expect(entries.find((entry) => entry.kind === 'group')?.avatar).toEqual({ kind: 'builtin', id: 'scientist' })
  expect(entries.find((entry) => entry.agentId === agent.id)?.avatar).toEqual({ kind: 'builtin', id: 'explorer' })
})
