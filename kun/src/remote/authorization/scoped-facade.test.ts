import { describe, expect, it } from 'vitest'
import { remoteFixture } from '../testing/runtime.test-support.js'
import { RemoteFacade } from '../facade.js'

describe('Scoped operations through real facade/receipt persistence', () => {
  it('cannot retrieve a prior group result through request.get or direct replay after scope is removed', async () => {
    const f = await remoteFixture()
    try {
      const group = (await f.rooms.service.create({ name: 'Team', clientRequestId: 'team' })).room
      const raw = f.envelope('group.message.send', { roomId: group.id, text: 'group input', executionIntent: 'discussion' }, 'group_once')
      await expect(f.facade.execute(raw)).rejects.toThrow('REMOTE_SCOPE_REQUIRED')
      const full = { ...raw, scopes: ['personal', 'groups.read', 'groups.write'] }
      const applied = (await f.facade.execute(full) as any).receipt
      expect(applied.status).toBe('applied')
      await expect(f.facade.execute({ ...raw, scopes: ['personal', 'groups.read'] })).rejects.toThrow('REMOTE_SCOPE_REQUIRED')
      await expect(f.call('request.get', { requestId: 'group_once' })).rejects.toThrow('REMOTE_SCOPE_REQUIRED')
      const query = { ...f.envelope('request.get', { requestId: 'group_once' }), scopes: ['personal', 'groups.read'] }
      expect((await f.facade.execute(query) as any).receipt).toEqual(applied)
      expect((await f.store.list('message', { roomId: group.id })).filter((row: any) => row.value.authorKind === 'user')).toHaveLength(1)
      expect((await f.call('catalog.get', {})).capabilityDescriptors.some((d: any) => d.operation === 'group.list')).toBe(false)
      const catalog = await f.facade.execute({ ...f.envelope('catalog.get', {}), scopes: ['personal', 'groups.read'] }) as any
      expect(catalog.capabilityDescriptors.some((d: any) => d.operation === 'group.list')).toBe(true)
      expect(catalog.capabilityDescriptors.some((d: any) => d.operation === 'group.message.send')).toBe(false)
    } finally { await f.close() }
  })
  it('finds archived Agents after a fresh facade starts and restores with directory CAS revision, without credential/profile disclosure', async () => {
    const f = await remoteFixture()
    try {
      const first = (await f.call('agent.create', { name: 'Archive me', instructions: 'Private instructions' })).receipt.result.agent
      const second = (await f.call('agent.create', { name: 'Visible' })).receipt.result.agent
      const archived = (await f.call('agent.archive', { agentId: first.id, expectedRevision: first.revision })).receipt.result.agent
      const restarted = new RemoteFacade(f.runtime, f.router)
      const read = (params: unknown) => restarted.execute(f.envelope('agent.directory.list', params)) as Promise<any>
      const page = await read({ directoryView: 'archived', limit: 1 })
      expect(page.agents[0]).toEqual({ id: first.id, name: 'Archive me', title: '', archived: true, revision: archived.revision, canLeadGroup: false })
      expect(JSON.stringify(page)).not.toContain('instructions'); expect(JSON.stringify(page)).not.toContain('modelRef')
      expect((await read({})).agents.map((a: any) => a.id)).toContain(second.id)
      expect((await read({})).agents.map((a: any) => a.id)).not.toContain(first.id)
      const all = [], cursors = new Set<string>(); let cursor: string | undefined
      do {
        const next = await read({ directoryView: 'all', limit: 1, ...(cursor ? { cursor } : {}) })
        all.push(...next.agents); cursor = next.nextCursor
        if (cursor) { expect(cursors.has(cursor)).toBe(false); cursors.add(cursor) }
      } while (cursor)
      expect(all.map((a) => a.id)).toEqual(expect.arrayContaining([first.id, second.id]))
      const restored = (await f.call('agent.restore', { agentId: first.id, expectedRevision: page.agents[0].revision })).receipt
      expect(restored.result.agent.archived).toBe(false)
      expect((await read({ directoryView: 'archived' })).agents.some((a: any) => a.id === first.id)).toBe(false)
      expect((await f.call('agent.list', {})).agents.every((a: any) => !Object.hasOwn(a, 'archived'))).toBe(true)
    } finally { await f.close() }
  })
})
