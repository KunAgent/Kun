import { describe, expect, it, vi } from 'vitest'
import { SharedTaskFacade } from './guest.js'
import { localCaller } from '../runtime/local-call.js'
import { sharedTurnKey } from './projection.js'
import { shareFixture } from './guest.test-support.js'
describe('independent single Code shared task boundary', () => {
  it('requires an admitted lease and exact resource mapping, with no personal/global/consent fallback', async () => {
    const f = await shareFixture()
    try {
      const bootstrap = await f.invoke('catalog.get', {})
      expect(bootstrap).toMatchObject({ threadId: f.task.id, title: 'Shared task' })
      expect(bootstrap.capabilities).not.toContain('approval.resolve')
      for (const hidden of ['projects', 'model', 'workspace', 'provider', 'credentials']) expect(bootstrap).not.toHaveProperty(hidden)
      await expect(f.facade.execute({ ...f.actor, sessionId: 'forged' }, f.call('catalog.get', {}))).rejects.toThrow('SHARE_AUTHORIZATION_STALE')
      await expect(f.invoke('code.history', { threadId: f.other.id })).rejects.toThrow('SHARE_RESOURCE_NOT_ALLOWED')
      for (const method of ['approval.resolve', 'input.resolve', 'code.create', 'code.settings.update', 'project.files.preview', 'agent.list'])
        await expect(f.invoke(method, {})).rejects.toThrow()
      await f.journal.admit({ ...f.actor, mode: 'read', memberVersion: 2, shareVersion: 2, expiresAt: f.actor.expiresAt + 1 })
      await expect(f.facade.execute({ ...f.actor, mode: 'read', memberVersion: 2, shareVersion: 2, expiresAt: f.actor.expiresAt + 1 },
        f.call('code.turn.start', { threadId: f.task.id, text: 'denied' }))).rejects.toThrow('SHARE_READ_ONLY')
      expect((await f.h.threads.get(f.task.id))!.turns).toHaveLength(0)
    } finally { await f.close() }
  })
  it('keeps one API turn after lost settlement and a grant-version change, without a second execution', async () => {
    const f = await shareFixture()
    try {
      const e = f.call('code.turn.start', { threadId: f.task.id, text: 'one shared input' }, 'stable')
      const first: any = await f.facade.execute(f.actor, e)
      expect(first.receipt.status).toBe('applied')
      expect(first.receipt.origin).toMatchObject({ shareId: 'share', memberId: 'member', guestAccountId: 'guest', deviceId: 'guestphone', memberVersion: 1, shareVersion: 1 })
      const replay = new SharedTaskFacade(f.runtime, localCaller(f.router, f.runtime))
      expect(await replay.execute(f.actor, e)).toEqual(first)
      expect(await replay.execute(f.actor, { ...e, expiresAt: e.expiresAt + 1000 })).toEqual(first)
      await expect(replay.execute(f.actor, { ...e, expiresAt: e.expiresAt + 2000, params: { ...e.params, text: 'conflicting input' } })).rejects.toThrow('REQUEST_CONFLICT')
      const thread = (await f.h.threads.get(f.task.id))!
      expect(thread.turns).toHaveLength(1); expect(thread.turns[0].clientSurface).toBe('api')
      expect(thread.turns[0].clientRequestId).toBe(sharedTurnKey(f.actor, 'stable'))
      const content = await f.invoke('message.get', { resource: { kind: 'code', id: f.task.id }, turnId: thread.turns[0].id, messageId: 'item_' + thread.turns[0].id + '_user', historyVersion: await f.runtime.sessionStore.itemHistoryVersion!(f.task.id) })
      expect(content.content.text).toBe('one shared input')
      const row = (await f.store.list<any>('shared_receipt', { taskId: 'share', limit: 10 })).find((r) => r.value.requestId === 'stable')!
      await f.store.commit({ requestId: 'simulate-missing-settlement', checks: [{ kind: 'shared_receipt', id: row.id, expectedRevision: row.revision }],
        puts: [{ kind: 'shared_receipt', id: row.id, taskId: 'share', value: { ...row.value, status: 'accepted', result: undefined } }] })
      const next = { ...f.actor, memberVersion: 2, shareVersion: 2, expiresAt: f.actor.expiresAt + 1 }
      await f.journal.admit(next)
      const recovered: any = await replay.execute(next, f.call('request.get', { requestId: 'stable' }))
      expect(recovered.receipt).toMatchObject({ status: 'applied', result: { turnId: thread.turns[0].id } })
      expect((await f.h.threads.get(f.task.id))!.turns).toHaveLength(1)
    } finally { await f.close() }
  })
  it('hides other users queued inputs from queue, history and search, and forbids guessed edits or stop', async () => {
    const f = await shareFixture()
    try {
      await f.h.turns.startTurn({ threadId: f.task.id, request: { prompt: 'published input', clientSurface: 'gui' } })
      const foreign = await f.h.turns.enqueueTurn({ threadId: f.task.id, request: { prompt: 'FOREIGN_PENDING_PRIVATE', clientSurface: 'api', clientRequestId: 'owner_request' } })
      await f.invoke('execution.queue.enqueue', { threadId: f.task.id, text: 'my queued input' }, 'mine')
      const queue = await f.invoke('execution.queue.list', { threadId: f.task.id })
      expect(queue.totalQueuedCount).toBe(2); expect(queue.items).toHaveLength(1); expect(queue.items[0].text).toBe('my queued input')
      const history = await f.invoke('code.history', { threadId: f.task.id })
      expect(JSON.stringify(history)).not.toContain('FOREIGN_PENDING_PRIVATE'); expect(history).not.toHaveProperty('workspace')
      expect((await f.invoke('message.search', { resource: { kind: 'code', id: f.task.id }, query: 'FOREIGN_PENDING_PRIVATE' })).messages).toEqual([])
      const denied = await f.invoke('execution.queue.remove', { threadId: f.task.id, turnId: foreign.turnId, expectedRevision: queue.revision })
      expect(denied.receipt).toMatchObject({ status: 'reconciliation_required', error: { code: 'INVALID_REQUEST', definitive: true } })
      expect((await f.h.turns.getTurn(f.task.id, foreign.turnId))!.status).toBe('queued')
      const active = (await f.h.threads.get(f.task.id))!.turns.find((t) => t.status === 'running')!
      const stop = await f.invoke('execution.stop', { threadId: f.task.id, turnId: active.id })
      expect(stop.receipt.error.code).toBe('INVALID_REQUEST')
      expect((await f.h.turns.getTurn(f.task.id, active.id))!.status).toBe('running')
    } finally { await f.close() }
  })
  it('fences locally before revoke/close reaches the cloud, and stores no invitation secret', async () => {
    const f = await shareFixture()
    try {
      const create = await f.journal.lookup(f.owner, 'share_create')
      expect(JSON.stringify(create)).not.toContain('must-not-persist')
      await expect(f.journal.prepare(f.owner, 'secret', { action: 'invite', shareId: 'share', expectedVersion: 1, invitation: 'raw-secret', mode: 'read' })).rejects.toThrow()
      await f.journal.prepare(f.owner, 'revoke', { action: 'revoke', shareId: 'share', memberId: 'member', expectedVersion: 1 })
      await expect(f.invoke('catalog.get', {})).rejects.toThrow('SHARE_AUTHORIZATION_STALE')
      await expect(f.journal.admit({ ...f.actor, expiresAt: f.actor.expiresAt + 1 })).rejects.toThrow('SHARE_AUTHORIZATION_STALE')
      const local = await f.journal.resource(f.owner, f.share.resourceHandle)
      expect(local?.threadId).toBe(f.task.id)
    } finally { await f.close() }
  })
  it('a late Stop of an own completed turn never pauses or interrupts its successor', async () => {
    const f = await shareFixture()
    try {
      const started = await f.invoke('code.turn.start', { threadId: f.task.id, text: 'own active' }, 'own_active')
      const own = started.receipt.result.turnId
      const queued = await f.h.turns.enqueueTurn({ threadId: f.task.id, request: { prompt: 'owner next', clientSurface: 'api' } })
      vi.spyOn(f.h.turns, 'isTurnExecutionActive').mockReturnValue(true)
      const interrupt = f.h.turns.interruptTurn.bind(f.h.turns)
      vi.spyOn(f.h.turns, 'interruptTurn').mockImplementationOnce(async (input) => {
        await f.h.turns.finishTurn({ threadId: f.task.id, turnId: own, status: 'completed' })
        await f.h.turns.startNextQueuedTurn(f.task.id)
        return interrupt(input)
      })
      const result = await f.invoke('execution.stop', { threadId: f.task.id, turnId: own }, 'late_stop')
      expect(result.receipt).toMatchObject({ status: 'applied', result: { turnId: own, status: 'completed' } })
      const thread = (await f.h.threads.get(f.task.id))!
      expect(thread.turns.find((t) => t.id === queued.turnId)?.status).toBe('running'); expect(thread.queueControl).toBeUndefined()
    } finally { await f.close() }
  })
  it('persists session retirement before any delayed admission and preserves a newer socket authority', async () => {
    const f = await shareFixture()
    try {
      const late = { ...f.actor, deviceId: 'latephone', sessionId: 'late_socket', expiresAt: f.actor.expiresAt + 1 }
      await f.journal.fence(f.owner, 'share', undefined, late.sessionId)
      await expect(f.journal.admit(late)).rejects.toThrow('SHARE_NOT_ALLOWED')
      await f.journal.fence(f.owner, 'share', undefined, f.actor.sessionId)
      const next = { ...f.actor, sessionId: 'fresh_socket', expiresAt: f.actor.expiresAt + 2 }
      await f.journal.admit(next)
      await f.journal.fence(f.owner, 'share', undefined, f.actor.sessionId)
      expect((await f.journal.authorize(next)).thread.id).toBe(f.task.id)
      await expect(f.journal.admit({ ...f.actor, expiresAt: f.actor.expiresAt + 3 })).rejects.toThrow('SHARE_NOT_ALLOWED')
    } finally { await f.close() }
  })

  it('allows the same membership across installations to control own turns, but rejects a rejoined membership', async () => {
    const f = await shareFixture()
    try {
      const active = (await f.invoke('code.turn.start', { threadId: f.task.id, text: 'member active' }, 'active')).receipt.result.turnId
      const queued = (await f.invoke('execution.queue.enqueue', { threadId: f.task.id, text: 'member queued' }, 'queued')).receipt.result.turnId
      const sibling = { ...f.actor, deviceId: 'second_installation', sessionId: 'second_socket', expiresAt: f.actor.expiresAt + 1 }
      await f.journal.admit(sibling)
      const queue: any = await f.facade.execute(sibling, f.call('execution.queue.list', { threadId: f.task.id }))
      expect(queue.items[0].turnId).toBe(queued)
      const edited: any = await f.facade.execute(sibling, f.call('execution.queue.update', { threadId: f.task.id,
        turnId: queued, expectedRevision: queue.revision, text: 'edited on another installation' }))
      expect(edited.receipt.status).toBe('applied')
      const rejoined = { ...sibling, memberId: 'new_membership', sessionId: 'rejoined_socket' }
      await f.journal.admit(rejoined)
      const denied: any = await f.facade.execute(rejoined, f.call('execution.stop', { threadId: f.task.id, turnId: active }))
      expect(denied.receipt.error?.code).toBe('INVALID_REQUEST')
      expect((await f.h.turns.getTurn(f.task.id, active))!.status).toBe('running')
      vi.spyOn(f.h.turns, 'isTurnExecutionActive').mockReturnValue(true)
      const stopped: any = await f.facade.execute(sibling, f.call('execution.stop', { threadId: f.task.id, turnId: active }))
      expect(stopped.receipt).toMatchObject({ status: 'applied', result: { status: 'aborted' } })
      expect((await f.h.threads.get(f.task.id))!.queueControl).toBeUndefined()
      const updatedQueue: any = await f.facade.execute(sibling, f.call('execution.queue.list', { threadId: f.task.id }))
      const removed: any = await f.facade.execute(sibling, f.call('execution.queue.remove', { threadId: f.task.id, turnId: queued, expectedRevision: updatedQueue.revision }))
      expect(removed.receipt.status).toBe('applied')
    } finally { await f.close() }
  })

  it('bounds live retirement tombstones without allowing evicted sessions during a reconnect storm', async () => {
    const f = await shareFixture()
    try {
      for (let i = 0; i < 257; i++) await f.journal.fence(f.owner, 'share', undefined, 'socket_' + i)
      const resource = (await f.journal.resource(f.owner, f.share.resourceHandle))!
      expect(resource.retiredSessions).toHaveLength(256)
      expect(resource.admissionBlockedUntil).toBeGreaterThan(Date.now())
      await expect(f.journal.admit({ ...f.actor, sessionId: 'socket_0', expiresAt: Date.now() + 59000 })).rejects.toThrow('SHARE_NOT_ALLOWED')
      vi.useFakeTimers(); vi.setSystemTime(Date.now() + 61000)
      await f.journal.admit({ ...f.actor, sessionId: 'after_all_leases_expired', expiresAt: Date.now() + 59000 })
    } finally { vi.useRealTimers(); await f.close() }
  })

})
