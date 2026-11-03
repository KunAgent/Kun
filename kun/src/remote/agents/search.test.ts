import { describe, expect, it, vi } from 'vitest'
import { remoteFixture } from '../testing/runtime.test-support.js'
import { RemoteAgentSearch } from './search.js'
import {ParamSchemas } from '../contracts.js'
import { openAgentConversation, openAgentPairConversation } from '../../agents/agent-conversations.js'
import { putRoomDocument } from '../../rooms/room-service.js'
import type { Room, RoomMessage } from '../../contracts/rooms.js'

async function fixture() {
  const f = await remoteFixture(), search = new RemoteAgentSearch(f.runtime)
  let serial = 0
  const create = async (name = 'Partner') => (await f.rooms.agents.create({ clientRequestId: 'agent_' + ++serial, name,
    instructions: 'private fixture instructions', modelRef: { providerId: 'fixture', model: 'fake', accountId: 'private-keychain-reference' } })).agent
  return { ...f, create, search: (params: unknown) => search.search(ParamSchemas['agent.search'].parse(params)) }
}
describe('personal Agent global content search', () => {
  it('exposes the strict read method through the real Facade without writing remote receipts', async () => {
    const f = await fixture()
    try {
      const agent = await f.create('Needle partner'), before = await f.store.list('remote_receipt')
      const result = await f.call('agent.search', { query: 'needle', limit: 10 })
      expect(result.agents.map((entry: { id: string }) => entry.id)).toEqual([agent.id])
      expect(result.complete).toBe(true)
      expect(await f.store.list('remote_receipt')).toEqual(before)
      await expect(f.call('agent.search', { query: 'needle', roomId: 'forged' })).rejects.toThrow()
      await expect(f.call('agent.search', { query: '   ' })).rejects.toThrow()
    } finally { await f.close() }
  })
  it('searches profile metadata and private message content without revealing identity configuration', async () => {
    const f = await fixture()
    try {
      const profile = await f.create('Needle profile'), body = await f.create('Body partner')
      const { room } = await openAgentConversation(f.rooms.agents, f.rooms.service, body.id)
      const message = (await f.rooms.service.send(room.id, { clientRequestId: 'source', body: 'A needle in the private transcript' })).message
      const commit = vi.spyOn(f.store, 'commit')
      const result = await f.search({ query: 'needle' })
      expect(result).toMatchObject({ searchScope: 'profile_and_private_messages', coverage: 'current_private_conversations', complete: true, hasMore: false, scanned: 2 })
      expect(result.agents.map(agent => agent.id).sort()).toEqual([profile.id, body.id].sort())
      expect(result.agents.find(agent => agent.id === body.id)?.match).toMatchObject({ messageId: message.id, historyVersion: '0' })
      expect(JSON.stringify(result)).not.toContain('private fixture instructions')
      expect(JSON.stringify(result)).not.toContain('private-keychain-reference')
      expect(commit).not.toHaveBeenCalled()
    } finally { await f.close() }
  })

  it('continues past hidden setup matches and binds continuation to the same query and identity revision', async () => {
    const f = await fixture()
    try {
      const agent = await f.create(), { room } = await openAgentConversation(f.rooms.agents, f.rooms.service, agent.id)
      const visible = (await f.rooms.service.send(room.id, { clientRequestId: 'visible', body: 'needle visible' })).message
      const hidden = (await f.rooms.service.send(room.id, { clientRequestId: 'hidden', body: 'needle hidden setup' })).message
      const row = await f.store.get<RoomMessage>('message', hidden.id)
      await putRoomDocument(f.store, 'message', hidden.id, room.id, { ...row!.value, presentationKind: 'setup' }, row!)
      const first = await f.search({ query: 'needle', limit: 1 })
      expect(first.agents).toEqual([]); expect(first.hasMore).toBe(true); expect(first.complete).toBe(false)
      await expect(f.search({ query: 'different', cursor: first.nextCursor })).rejects.toThrow('INVALID_CURSOR')
      const second = await f.search({ query: 'needle', limit: 1, cursor: first.nextCursor })
      expect(second.agents[0].match?.messageId).toBe(visible.id)
      await f.rooms.agents.update(agent.id, { clientRequestId: 'rename', expectedRevision: agent.revision, name: 'Changed partner' })
      await expect(f.search({ query: 'needle', cursor: first.nextCursor })).rejects.toThrow('HISTORY_CHANGED')
    } finally { await f.close() }
  })

  it('never searches group, bot-to-bot or deleted private rooms and defaults archived identities off', async () => {
    const f = await fixture()
    try {
      const first = await f.create(), second = await f.create(), archived = await f.create('Needle archived')
      const pair = await openAgentPairConversation(f.rooms.agents, f.rooms.service, first.id, second.id)
      const group = await f.rooms.service.create({ clientRequestId: 'group', name: 'Group', members: [f.rooms.agents.asMember(first)] })
      const sample = (await f.rooms.service.send(group.room.id, { clientRequestId: 'group-message', body: 'needle outside personal scope' })).message
      await putRoomDocument(f.store, 'message', 'pair-message', pair.room.id, { ...sample, id: 'pair-message', roomId: pair.room.id }, null)
      const { room: personal } = await openAgentConversation(f.rooms.agents, f.rooms.service, first.id)
      await f.rooms.service.send(personal.id, { clientRequestId: 'deleted-private', body: 'needle no longer visible' })
      const old = await f.store.get<Room>('room', personal.id)
      await putRoomDocument(f.store, 'room', personal.id, personal.id, { ...old!.value, deletedAt: new Date().toISOString() }, old!)
      await f.rooms.agents.update(archived.id, { clientRequestId: 'archive', expectedRevision: archived.revision, archived: true })
      expect((await f.search({ query: 'needle' })).agents).toEqual([])
      expect((await f.search({ query: 'needle', includeArchived: true })).agents.map(agent => agent.id)).toEqual([archived.id])
    } finally { await f.close() }
  })

  it('makes bounded progress across more than a directory page without silently declaring no results', async () => {
    const f = await fixture()
    try {
      const oldest = await f.create('Oldest partner'), { room } = await openAgentConversation(f.rooms.agents, f.rooms.service, oldest.id)
      await f.rooms.service.send(room.id, { clientRequestId: 'old-body', body: 'needle only in oldest body' })
      for (let index = 0; index < 105; index++) await f.create('New partner ' + index)
      let cursor: string | undefined, pages = 0, complete = false
      const ids: string[] = []
      do {
        const page = await f.search({ query: 'needle', limit: 1, ...(cursor ? { cursor } : {}) })
        expect(page.scanned).toBeLessThanOrEqual(100)
        expect(Boolean(page.nextCursor)).toBe(page.hasMore)
        complete = page.complete; cursor = page.nextCursor; pages++
        ids.push(...page.agents.map(agent => agent.id))
        expect(pages).toBeLessThan(10)
      } while (cursor)
      expect(complete).toBe(true); expect(pages).toBeGreaterThan(1); expect(ids).toEqual([oldest.id])
    } finally { await f.close() }
  })
})
