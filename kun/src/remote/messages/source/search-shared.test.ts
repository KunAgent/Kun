import { describe, expect, it } from 'vitest'
import { sourceSearchFixture } from './search.test-support.js'
import { SharedTaskFacade } from '../../sharing/guest.js'
import { localCaller } from '../../runtime/local-call.js'
import { RemoteMessages } from '../service.js'
import { cursorScope, writeCursor } from '../../cursor-codec.js'
describe('shared and legacy source search authority', () => {
  it('permits only the current shared branch and keeps native foreign queued inputs out of results', async () => {
    const f = await sourceSearchFixture('codex', 'x'.repeat(300000) + 'source-shared-needle')
    try {
      const shared = new SharedTaskFacade(f.runtime, localCaller(f.router, f.runtime)), owner = { ownerAccountId: 'owner', hostDeviceId: 'host', controllerId: 'phone' }
      const prepared = await shared.journal.prepare(owner, 'create', { action: 'create', threadId: f.source.thread.id })
      const share = { id: 'share', ownerAccountId: 'owner', hostDeviceId: 'host', resourceHandle: prepared.receipt.resourceHandle!,
        version: 1, state: 'active', expiresAt: Date.now() + 86400000 }
      await shared.journal.settle(owner, 'create', { share })
      const actor = { ownerAccountId: 'owner', hostDeviceId: 'host', shareId: 'share', resourceHandle: share.resourceHandle,
        shareVersion: 1, memberId: 'member', memberVersion: 1, guestAccountId: 'guest', deviceId: 'guest_phone', mode: 'read', expiresAt: Date.now() + 59000, sessionId: 'socket' }
      await shared.journal.admit(actor)
      let n = 0
      const call = (params: unknown) => ({ method: 'message.search', requestId: 'read_' + ++n, expiresAt: Date.now() + 60000, params })
      const p = { resource: f.resource, query: 'source-shared-needle', limit: 1 }
      const first: any = await shared.execute(actor, call(p))
      expect(first).toMatchObject({ messages: [], hasMore: true, complete: false, coverage: { source: 'scanning' } })
      const other = { ...actor, memberId: 'second_member', guestAccountId: 'second_guest', deviceId: 'second_phone', sessionId: 'second_socket' }
      await shared.journal.admit(other)
      await expect(shared.execute(other, call({ ...p, cursor: first.nextCursor }))).rejects.toThrow('INVALID_CURSOR')
      const outside = await f.code('not shared')
      await expect(shared.execute(actor, call({ ...p, resource: { kind: 'code', id: outside.id } }))).rejects.toThrow('SHARE_RESOURCE_NOT_ALLOWED')
      let cursor = first.nextCursor, matches: any[] = [], pages = 0
      do {
        const page: any = await shared.execute(actor, call({ ...p, cursor }))
        matches.push(...page.messages); cursor = page.nextCursor; pages++; expect(pages).toBeLessThan(20)
      } while (cursor)
      expect(matches.length).toBe(3)
      expect(matches.every((match) => match.sourceHistoryOrder.referenceId === f.source.reference.id)).toBe(true)
      await f.h.turns.startTurn({ threadId: f.source.thread.id, request: { prompt: 'owner running', clientSurface: 'gui' } })
      await f.h.turns.enqueueTurn({ threadId: f.source.thread.id, request: { prompt: 'FOREIGN_QUEUED_NEEDLE', clientSurface: 'gui' } })
      const hidden: any = await shared.execute(actor, call({ ...p, query: 'FOREIGN_QUEUED_NEEDLE', limit: 20 }))
      expect(hidden.messages).toEqual([])
      await shared.journal.fence(owner, 'share', undefined, actor.sessionId)
      await expect(shared.execute(actor, call(p))).rejects.toThrow('SHARE_AUTHORIZATION_STALE')
    } finally { await f.close() }
  })
  it('continues an old native-only 0.7 cursor while source branches keep their own stronger binding', async () => {
    const f = await sourceSearchFixture()
    try {
      const task = await f.code('Native only'), query = 'needle', resource = { kind: 'code' as const, id: task.id }
      for (const [id, text] of [['older', 'native needle'], ['newer', 'new record']]) await f.h.sessionStore.appendItem(task.id,
        { id, threadId: task.id, turnId: 'turn', kind: 'assistant_text', role: 'assistant', status: 'completed', text, createdAt: new Date().toISOString() })
      const version = await f.h.sessionStore.itemHistoryVersion(task.id)
      const legacy = writeCursor(cursorScope(['message.search', resource, query, version]), { before: 'newer' })
      const result = await new RemoteMessages(f.runtime).search({ resource, query, cursor: legacy })
      expect(result).toMatchObject({ messages: [{ messageId: 'older' }], hasMore: false, complete: true, coverage: { source: 'not_applicable' } })
    } finally { await f.close() }
  })
})
