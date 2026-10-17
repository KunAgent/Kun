import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { shareFixture } from '../../sharing/guest.test-support.js'
import { HistoryReferenceService } from '../../../history/history-reference-service.js'
import { longSource } from './content.test-support.js'
import { RemoteFacade } from '../../facade.js'
async function fixture() {
  const f = await shareFixture()
  f.runtime.historyReferences = new HistoryReferenceService({ dataDir: join(f.root, 'source-data'), threadService: f.h.threads,
    threadStore: f.h.threadStore, enabled: () => true, enabledFor: () => true, defaultModel: () => ({ model: 'fake' }) })
  const source = await longSource(f.root, f.runtime.historyReferences, 'codex')
  const prepared = await f.journal.prepare(f.owner, 'source_share_create', { action: 'create', threadId: source.thread.id })
  const share = { ...f.share, id: 'source_share', resourceHandle: prepared.receipt.resourceHandle! }
  await f.journal.settle(f.owner, 'source_share_create', { share })
  const actor = { ...f.actor, shareId: share.id, resourceHandle: share.resourceHandle, mode: 'read' as const, sessionId: 'source_connection' }
  await f.journal.admit(actor)
  const params = { resource: { kind: 'code' as const, id: source.thread.id }, referenceId: source.reference.id,
    historyVersion: await f.runtime.sessionStore.itemHistoryVersion!(source.thread.id), turnId: source.item.turnId, messageId: source.item.id }
  const personal = new RemoteFacade(f.runtime, f.router)
  return { ...f, source, actor, params, personal: (method: string, params: Record<string, unknown>) => personal.execute(f.envelope(method, params)) as Promise<any>,
    invoke: (method: string, p: Record<string, unknown>, who = actor) => f.facade.execute(who, f.call(method, p)) as Promise<any> }
}
describe('external source content personal and shared routing', () => {
  it('uses the dedicated personal read capability without widening native message IDs or writing a receipt', async () => {
    const f = await fixture()
    try {
      const catalog = await f.personal('catalog.get', {})
      expect(catalog.capabilityDescriptors).toContainEqual(expect.objectContaining({ operation: 'message.source.get', allowedActions: ['read'] }))
      const first = await f.personal('message.source.get', f.params)
      expect(first.content.text).toBe(f.source.text.slice(0, 8192)); expect(first.hasMore).toBe(true)
      await expect(f.personal('message.get', { resource: f.params.resource, messageId: f.params.messageId, turnId: f.params.turnId,
        historyVersion: f.params.historyVersion })).rejects.toThrow()
      const next = await f.personal('message.source.get', { ...f.params, cursor: first.nextCursor })
      expect(next.content.offset).toBe(first.content.nextOffset)
      expect((await f.store.list('remote_receipt')).filter((row) => (row.value as any).method === 'message.source.get')).toEqual([])
      expect(await f.h.sessionStore.loadItems(f.source.thread.id)).toEqual([])
    } finally { await f.close() }
  })
  it('only reads the admitted shared task current frozen branch, with a trusted source marker and member-scoped cursors', async () => {
    const f = await fixture()
    try {
      const catalog = await f.invoke('catalog.get', {})
      expect(catalog.capabilities).toContain('message.source.get')
      const history = await f.invoke('code.history', { threadId: f.source.thread.id })
      const marker = history.turns.flatMap((turn: any) => turn.items).find((item: any) => item.id === f.source.item.id)
      expect(marker.sourceHistoryOrder).toEqual(f.source.item.sourceHistoryOrder)
      expect(JSON.stringify(history)).not.toContain('_SOURCE_COMPLETE_TAIL')
      const first = await f.invoke('message.source.get', f.params)
      expect(first.content.text).toBe(f.source.text.slice(0, 8192))
      await expect(f.invoke('message.source.get', { ...f.params, resource: { kind: 'code', id: f.other.id } })).rejects.toThrow('SHARE_RESOURCE_NOT_ALLOWED')
      const laterTurn = 'codex:' + f.source.sessionId + ':turn-2'
      await expect(f.invoke('message.source.get', { ...f.params, turnId: laterTurn, messageId: laterTurn + ':item:10' })).rejects.toThrow('NOT_FOUND')
      const second = await longSource(f.root, f.runtime.historyReferences!, 'codex', 'other-source')
      await expect(f.invoke('message.source.get', { ...f.params, referenceId: second.reference.id })).rejects.toThrow('HISTORY_CHANGED')
      const peer = { ...f.actor, memberId: 'other_member', guestAccountId: 'other_guest', sessionId: 'other_connection' }
      await f.journal.admit(peer)
      await expect(f.invoke('message.source.get', { ...f.params, cursor: first.nextCursor }, peer)).rejects.toThrow('INVALID_CURSOR')
      const page = f.runtime.historyReferences!.page.bind(f.runtime.historyReferences)
      vi.spyOn(f.runtime.historyReferences!, 'page').mockImplementationOnce(async (...args) => {
        const result = await page(...args)
        await f.journal.fence(f.owner, f.actor.shareId, undefined, f.actor.sessionId)
        return result
      })
      await expect(f.invoke('message.source.get', f.params)).rejects.toThrow('SHARE_AUTHORIZATION_STALE')
      expect(await f.h.sessionStore.loadItems(f.source.thread.id)).toEqual([])
      expect((await f.store.list('shared_receipt', { taskId: f.actor.shareId })).filter((row) => (row.value as any).method === 'message.source.get')).toEqual([])
    } finally { await f.close() }
  })
})
