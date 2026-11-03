import { describe, expect, it, vi } from 'vitest'
import { RemoteGroups, GroupWriteParamSchemas } from './service.js'
import { RemoteReceipts, receiptKey } from '../requests/receipts.js'
import { RemoteNoEffect } from '../requests/rejections.js'
import type { Envelope } from '../contracts.js'
import type { RemoteAuthority } from '../authorization/scopes.js'
import type { Room } from '../../contracts/rooms.js'
import { openAgentConversation } from '../../agents/agent-conversations.js'
import { remoteFixture } from '../testing/runtime.test-support.js'

const authority = (scopes = ['groups.read', 'groups.write']): RemoteAuthority => ({ accountId: 'owner', deviceId: 'phone',
  authorizationId: 'grant', scopes: scopes as RemoteAuthority['scopes'] })
async function fixture() {
  const f = await remoteFixture(), groups = new RemoteGroups(f.runtime), receipts = new RemoteReceipts(f.rooms), scope = authority()
  const first = (await f.rooms.agents.create({ clientRequestId: 'first-agent', name: 'First' })).agent
  const second = (await f.rooms.agents.create({ clientRequestId: 'second-agent', name: 'Second' })).agent
  const expiries = new Map<string, number>()
  let count = 0
  const invoke = async (method: keyof typeof GroupWriteParamSchemas, p: unknown, id = 'request_' + ++count, source = scope) => {
    const params = GroupWriteParamSchemas[method].parse(p)
    if (!expiries.has(id)) expiries.set(id, Date.now() + 60000)
    const envelope = { ...source, call: { method, params: p, requestId: id, expiresAt: expiries.get(id)! } } as unknown as Envelope
    if (!await receipts.get(source, id)) {
      try { await groups.preflight(method, params, source) }
      catch (error) {
        if (!(error instanceof RemoteNoEffect)) throw error
        return receipts.execute(envelope, async () => { throw error })
      }
    }
    return receipts.execute(envelope, () => groups.mutate(source, method, params, id))
  }
  const create = async () => (await invoke('group.create', { name: 'Phone group', participantAgentIds: [first.id, second.id] })).result as { group: ReturnType<typeof import('./projection.js').groupSummary> }
  return { ...f, first, second, groups, receipts, scope, invoke, create }
}
describe('scoped mobile group lifecycle and membership', () => {
  it('creates only a group from existing Agent identities with no caller paths, authors or widened permissions', async () => {
    const f = await fixture()
    try {
      const { group } = await f.create(), stored = await f.rooms.service.get(group.id)
      expect(group).toMatchObject({ name: 'Phone group', revision: 0, collaborationMode: 'peer', defaultMemberId: f.first.id,
        maxConcurrentTasks: 2, pinned: false, archived: false })
      expect(group.members.map((m) => [m.participantAgentId, m.canLead])).toEqual([[f.first.id, true], [f.second.id, true]])
      expect(stored.conversationKind).toBe('group'); expect(stored.repositories).toEqual([])
      expect(stored.members.every((m) => m.allowedRepositoryIds.length === 0)).toBe(true)
      for (const extra of [{ authorKind: 'system' }, { members: [] }, { clientSurface: 'gui' }, { repositories: [{ displayPath: '/private' }] },
        { capabilityOverrides: { allowedTools: ['*'] } }, { modelRef: { providerId: 'secret' } }])
        expect(() => GroupWriteParamSchemas['group.create'].parse({ name: 'No', participantAgentIds: [f.first.id], ...extra })).toThrow()
      expect(group).not.toHaveProperty('repositories')
      expect(group.members[0]).not.toHaveProperty('modelRef')
      expect(group.members[0]).not.toHaveProperty('capabilityOverrides')
    } finally { await f.close() }
  })
  it('never grants group management to personal/default authority, and cannot edit private Agent rooms', async () => {
    const f = await fixture()
    try {
      const { group } = await f.create(), privateRoom = (await openAgentConversation(f.rooms.agents, f.rooms.service, f.first.id)).room
      const get = vi.spyOn(f.store, 'get'), commit = vi.spyOn(f.store, 'commit')
      await expect(f.groups.mutate(authority(['personal']), 'group.update', { roomId: group.id, expectedRevision: 0, name: 'No' }, 'deny')).rejects.toThrow('REMOTE_SCOPE_REQUIRED')
      expect(get).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled()
      const rejected = await f.invoke('group.update', { roomId: privateRoom.id, expectedRevision: privateRoom.revision, name: 'No' })
      expect(rejected.error).toEqual({ code: 'INVALID_REQUEST', definitive: true })
      expect((await f.rooms.service.get(privateRoom.id)).name).not.toBe('No')
    } finally { await f.close() }
  })
  it('metadata CAS, pin, archive and restore use native durable transactions without stopping accepted work', async () => {
    const f = await fixture()
    try {
      const { group } = await f.create(), target = { roomId: group.id, expectedRevision: group.revision }
      const updated = await f.invoke('group.update', { ...target, name: 'Renamed', description: '', pinned: true })
      expect(updated.result).toMatchObject({ group: { name: 'Renamed', revision: 1, pinned: true } })
      const rejected = await f.invoke('group.update', { ...target, name: 'Stale' })
      expect(rejected.error).toEqual({ code: 'REVISION_CONFLICT', definitive: true })
      expect((await f.groups.get(f.scope, { roomId: group.id })).group.name).toBe('Renamed')
      const archived = await f.invoke('group.archive', { ...target, expectedRevision: 1 })
      expect(archived.result).toMatchObject({ group: { archived: true, revision: 2 } })
      expect((await f.groups.list(f.scope, {})).groups).toEqual([])
      expect((await f.groups.list(f.scope, { archived: true })).groups.map((g) => g.id)).toContain(group.id)
      const restored = await f.invoke('group.restore', { ...target, expectedRevision: 2 })
      expect(restored.result).toMatchObject({ group: { archived: false, revision: 3 } })
    } finally { await f.close() }
  })
  it('requires an enabled lead replacement atomically and preserves removed member identity for history and rejoining', async () => {
    const f = await fixture()
    try {
      let { group } = await f.create()
      const invalid = await f.invoke('group.member.remove', { roomId: group.id, expectedRevision: group.revision, memberId: f.first.id })
      expect(invalid.error).toEqual({ code: 'INVALID_REQUEST', definitive: true })
      const removed = await f.invoke('group.member.remove', { roomId: group.id, expectedRevision: group.revision,
        memberId: f.first.id, defaultMemberId: f.second.id })
      group = (removed.result as { group: typeof group }).group
      expect(group).toMatchObject({ defaultMemberId: f.second.id, revision: 1 })
      expect(group.members.find((m) => m.id === f.first.id)).toMatchObject({ removed: true, enabled: false, canLead: false })
      expect((await f.rooms.agents.get(f.first.id)).archivedAt).toBeUndefined()
      const joined = await f.invoke('group.member.add', { roomId: group.id, expectedRevision: group.revision, agentId: f.first.id })
      expect(joined.result).toMatchObject({ group: { revision: 2, members: expect.arrayContaining([
        expect.objectContaining({ id: f.first.id, removed: false, enabled: true, canLead: true })]) } })
      expect((await f.rooms.service.get(group.id)).members).toHaveLength(2)
    } finally { await f.close() }
  })
  it('refuses removing a member with accepted dependencies, while disable changes only future roster snapshots', async () => {
    const f = await fixture()
    try {
      const { group } = await f.create(), room = await f.rooms.service.get(group.id)
      await f.store.commit({ requestId: 'active-request', checks: [{ kind: 'request', id: 'active', expectedRevision: null }],
        puts: [{ kind: 'request', id: 'active', roomId: group.id, value: { id: 'active', roomId: group.id,
          status: 'running', roomSnapshot: room, message: { mentionMemberIds: [] } } }] })
      const rejected = await f.invoke('group.member.remove', { roomId: group.id, expectedRevision: group.revision, memberId: f.second.id })
      expect(rejected.error).toEqual({ code: 'TASK_BUSY', definitive: true })
      const disabled = await f.invoke('group.member.update', { roomId: group.id, expectedRevision: group.revision,
        memberId: f.second.id, enabled: false })
      expect(disabled.result).toMatchObject({ group: { revision: 1, members: [{}, { enabled: false, removed: false }] } })
      const active = await f.store.get<{ status: string; roomSnapshot: Room }>('request', 'active')
      expect(active?.value.status).toBe('running')
      expect(active?.value.roomSnapshot.members.find((m) => m.id === f.second.id)?.enabled).toBe(true)
    } finally { await f.close() }
  })
  it('allows a new Agent to join without inheriting repository authority and rejects archived identities', async () => {
    const f = await fixture()
    try {
      const { group } = await f.create(), third = (await f.rooms.agents.create({ name: 'Third', clientRequestId: 'third-agent' })).agent
      const added = await f.invoke('group.member.add', { roomId: group.id, expectedRevision: group.revision, agentId: third.id })
      expect(added.result).toMatchObject({ group: { revision: 1 } })
      expect((await f.rooms.service.get(group.id)).members.find((m) => m.participantAgentId === third.id)?.allowedRepositoryIds).toEqual([])
      const archived = (await f.rooms.agents.create({ name: 'Archived', clientRequestId: 'archived-agent' })).agent
      await f.rooms.agents.update(archived.id, { clientRequestId: 'archive-agent', expectedRevision: archived.revision, archived: true })
      const rejected = await f.invoke('group.member.add', { roomId: group.id, expectedRevision: 1, agentId: archived.id })
      expect(rejected.error).toEqual({ code: 'AGENT_NOT_AVAILABLE', definitive: true })
      expect((await f.rooms.service.get(group.id)).revision).toBe(1)
    } finally { await f.close() }
  })
  it('deduplicates a stable request but rejects different content, and recovery only reads the native ledger', async () => {
    const f = await fixture()
    try {
      const p = { name: 'Once', participantAgentIds: [f.first.id] }, first = await f.invoke('group.create', p, 'once')
      expect(await f.invoke('group.create', p, 'once')).toEqual(first)
      await expect(f.invoke('group.create', { ...p, name: 'Other' }, 'once')).rejects.toThrow('REQUEST_CONFLICT')
      const roomId = (first.result as { group: { id: string } }).group.id, native = vi.spyOn(f.rooms.service, 'create')
      expect(await f.groups.recoverMutation(authority(['groups.read']), first)).toMatchObject({ group: { id: roomId, name: 'Once' } })
      expect(native).not.toHaveBeenCalled()
      expect(await f.groups.recoverMutation(authority(['groups.read']), { ...first, requestId: 'never-started' })).toBeUndefined()
      expect((await f.groups.list(f.scope, {})).groups).toHaveLength(1)
    } finally { await f.close() }
  })
  it('recovers an applied mutation after losing its settle response without reconstructing members or repeating a write', async () => {
    const f = await fixture()
    try {
      const native = f.store.commit.bind(f.store), key = receiptKey(f.scope, 'lost-ack')
      vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
        if (input.requestId === key + '-settle') throw new Error('settle-response-lost')
        return native(input)
      })
      await expect(f.invoke('group.create', { name: 'Committed', participantAgentIds: [f.first.id] }, 'lost-ack')).rejects.toThrow('settle-response-lost')
      const afterRestart = new RemoteReceipts(f.rooms), uncertain = await afterRestart.get(f.scope, 'lost-ack')
      expect(uncertain?.status).toBe('reconciliation_required')
      const create = vi.spyOn(f.rooms.service, 'create'), recovered = await f.groups.recoverMutation(authority(['groups.read']), uncertain!)
      expect(recovered).toMatchObject({ group: { name: 'Committed' } })
      expect(recovered!.group).not.toHaveProperty('repositories')
      expect(await afterRestart.recovered(f.scope, 'lost-ack', recovered)).toMatchObject({ status: 'applied' })
      expect(create).not.toHaveBeenCalled()
    } finally { await f.close() }
  })
  it('serializes two phones against the same revision and returns a definitive conflict for the second edit', async () => {
    const f = await fixture()
    try {
      const { group } = await f.create(), target = { roomId: group.id, expectedRevision: 0 }, other = { ...f.scope, deviceId: 'second-phone' }
      const results = await Promise.all([f.invoke('group.update', { ...target, name: 'First edit' }, 'parallel-one'),
        f.invoke('group.update', { ...target, name: 'Second edit' }, 'parallel-two', other)])
      expect(results.map((result) => result.status).sort()).toEqual(['applied', 'reconciliation_required'])
      expect(results.find((result) => result.status !== 'applied')?.error).toEqual({ code: 'REVISION_CONFLICT', definitive: true })
      expect((await f.rooms.service.get(group.id)).revision).toBe(1)
    } finally { await f.close() }
  })
  it('a committed member edit replays its original snapshot even after later room changes and never expands stored source authority', async () => {
    const f = await fixture()
    try {
      const { group } = await f.create(), params = { roomId: group.id, expectedRevision: 0, memberId: f.second.id, enabled: false }
      const first = await f.invoke('group.member.update', params, 'member-once')
      await f.rooms.exclusive(() => f.rooms.service.update(group.id, { clientRequestId: 'desktop-edit', expectedRevision: 1, name: 'Desktop later' }))
      expect(await f.groups.mutate(f.scope, 'group.member.update', params, 'member-once')).toEqual(first.result)
      await expect(f.groups.mutate(f.scope, 'group.member.update', { ...params, enabled: true }, 'member-once')).rejects.toThrow('REQUEST_CONFLICT')
      expect((await f.rooms.service.get(group.id)).revision).toBe(2)
    } finally { await f.close() }
  })
  it('derives lead eligibility from actual engine identities, allowing coding discussion members but never a coding lead', async () => {
    const f = await fixture()
    try {
      const externalId = 'external-agent', value = { ...f.second, id: externalId, name: 'Looks like Kun',
        executor: { kind: 'harness', harnessId: 'codex', credentialMode: 'native-login', model: 'fixture-model', accountId: 'private-credential-reference' } }
      await f.store.commit({ requestId: 'seed-coding-identity', checks: [{ kind: 'agent_identity', id: externalId, expectedRevision: null }],
        puts: [{ kind: 'agent_identity', id: externalId, value }] })
      const rejected = await f.invoke('group.create', { name: 'No coding lead', participantAgentIds: [externalId] })
      expect(rejected.error).toEqual({ code: 'AGENT_NOT_AVAILABLE', definitive: true })
      const created = await f.invoke('group.create', { name: 'Mixed', participantAgentIds: [externalId, f.first.id] })
      const group = (created.result as { group: { id: string; defaultMemberId: string; members: Array<{ id: string; canLead: boolean }> } }).group
      expect(group.defaultMemberId).toBe(f.first.id)
      expect(group.members.find((member) => member.id === externalId)?.canLead).toBe(false)
      expect(group.members.find((member) => member.id === f.first.id)?.canLead).toBe(true)
      expect(JSON.stringify(created.result)).not.toContain('private-credential-reference')
      const update = await f.invoke('group.update', { roomId: group.id, expectedRevision: 0, defaultMemberId: externalId })
      expect(update.error).toEqual({ code: 'AGENT_NOT_AVAILABLE', definitive: true })
    } finally { await f.close() }
  })
})
