import { describe, expect, it, vi } from 'vitest'
import { remoteFixture } from '../testing/runtime.test-support.js'
import { AgentImportParams } from './import-contracts.js'
import { RemoteFacade } from '../facade.js'
import type { Room } from '../../contracts/rooms.js'

const document = { format: 'kun-agent-profile', version: 1, profile: { name: 'Imported', title: 'Helper', instructions: 'Keep concise' } }
describe('strict portable Agent profile import', () => {
  it('previews without creating, then creates one identity and private conversation without starting setup/model work', async () => {
    const f = await remoteFixture()
    try {
      const model = vi.spyOn(f.runtime, 'runTurn'), before = await f.store.list('agent_identity', { includeArchived: true })
      const preview = (await f.call('agent.import.preview', { document }, 'preview')).receipt.result
      expect(preview.canCommit).toBe(true); expect(preview.imported).toEqual(['profile'])
      expect(await f.store.list('agent_identity', { includeArchived: true })).toEqual(before)
      const response = await f.call('agent.import.commit', { token: preview.token, name: 'Fresh helper' }, 'import-once')
      expect(response.receipt.status).toBe('applied')
      const result = response.receipt.result
      expect(result.agent).toMatchObject({ name: 'Fresh helper', title: 'Helper', instructions: 'Keep concise' })
      expect((await f.rooms.agents.get(result.agent.id)).setup?.status).toBe('completed')
      expect((await f.store.get<Room>('room', result.conversationId))!.value).toMatchObject({ conversationKind: 'user_agent' })
      expect(await f.store.list('message', { roomId: result.conversationId })).toEqual([])
      expect(await f.store.list('request', { roomId: result.conversationId })).toEqual([]); expect(model).not.toHaveBeenCalled()
      const again = f.envelope('agent.import.commit', { token: preview.token, name: 'Fresh helper' }, 'import-once')
      again.call.expiresAt += 5000
      expect((await new RemoteFacade(f.runtime, f.router).execute(again) as any).receipt).toEqual(response.receipt)
      expect((await f.call('agent.import.commit', { token: preview.token, name: 'Fresh helper' }, 'new-request-same-token')).receipt.result).toEqual(result)
      const afterReconnect = f.envelope('agent.import.commit', { token: preview.token, name: 'Fresh helper' }, 'new-request-after-reconnect')
      afterReconnect.authorizationId = 'fresh-authority'
      expect((await f.facade.execute(afterReconnect) as any).receipt.result).toEqual(result)
      expect(await f.store.list('agent_identity', { includeArchived: true })).toHaveLength(before.length + 1)
      const catalog = await f.call('catalog.get', {})
      expect(catalog.capabilityDescriptors.some((entry: any) => entry.operation === 'agent.import.commit' && entry.enabled)).toBe(true)
    } finally { await f.close() }
  })
  it('rejects unknown portable fields and name conflicts, binds preview to device/authority, and permits explicit rename', async () => {
    const f = await remoteFixture()
    try {
      for (const key of ['modelRef', 'accountId', 'apiKey', 'env', 'executor', 'workspace', 'permissions'])
        expect(() => AgentImportParams['agent.import.preview'].parse({ document: { ...document, profile: { ...document.profile, [key]: 'forged' } } })).toThrow()
      await f.rooms.agents.create({ clientRequestId: 'existing', name: 'ＩＭＰＯＲＴＥＤ' })
      const preview = (await f.call('agent.import.preview', { document }, 'preview')).receipt.result
      expect(preview.canCommit).toBe(false); expect(preview.conflicts).toHaveLength(1)
      expect((await f.call('agent.import.commit', { token: preview.token, name: 'Imported' }, 'conflict')).receipt.error?.code).toBe('REVISION_CONFLICT')
      expect((await f.call('agent.import.commit', { token: preview.token, name: 'Renamed' }, 'wrong-device', 'phone2')).receipt.error?.code).toBe('INVALID_REQUEST')
      const changedAuthority = f.envelope('agent.import.commit', { token: preview.token, name: 'Renamed' }, 'wrong-authority')
      changedAuthority.authorizationId = 'other-connection'
      expect((await f.facade.execute(changedAuthority) as any).receipt.error?.code).toBe('INVALID_REQUEST')
      expect((await f.call('agent.import.commit', { token: preview.token, name: 'Renamed' }, 'correct')).receipt.status).toBe('applied')
      expect((await f.call('agent.import.commit', { token: preview.token, name: 'Another' }, 'reused-token')).receipt.error?.code).toBe('REVISION_CONFLICT')
    } finally { await f.close() }
  })
  it('recovers an identity creation ACK loss without a second identity or model call', async () => {
    const f = await remoteFixture()
    try {
      const preview = (await f.call('agent.import.preview', { document }, 'preview')).receipt.result
      const original = f.rooms.agents.create.bind(f.rooms.agents)
      const failure = vi.spyOn(f.rooms.agents, 'create').mockImplementation(async input => { await original(input); throw new Error('fixture ACK lost') })
      expect((await f.call('agent.import.commit', { token: preview.token, name: 'Imported' }, 'once')).receipt.status).toBe('reconciliation_required')
      failure.mockRestore()
      expect(await f.store.list('agent_identity', { includeArchived: true })).toHaveLength(1)
      const recovered = await f.call('request.get', { requestId: 'once' })
      expect(recovered.receipt.status).toBe('applied')
      expect(await f.store.list('agent_identity', { includeArchived: true })).toHaveLength(1)
      expect(await f.store.list('room', { conversationKind: 'user_agent' })).toHaveLength(1)
    } finally { await f.close() }
  })
  it('serializes two phones importing the same final name and preserves definitive conflict status', async () => {
    const f = await remoteFixture()
    try {
      const a = (await f.call('agent.import.preview', { document }, 'a')).receipt.result
      const b = (await f.call('agent.import.preview', { document }, 'b', 'phone2')).receipt.result
      const results = await Promise.all([f.call('agent.import.commit', { token: a.token, name: 'Equal' }, 'commit-a'),
        f.call('agent.import.commit', { token: b.token, name: 'Equal' }, 'commit-b', 'phone2')])
      expect(results.filter(result => result.receipt.status === 'applied')).toHaveLength(1)
      expect(results.find(result => result.receipt.error)?.receipt.error).toEqual({ code: 'REVISION_CONFLICT', definitive: true })
      expect(await f.store.list('agent_identity', { includeArchived: true })).toHaveLength(1)
    } finally { await f.close() }
  })
})
