import { describe, expect, it, vi } from 'vitest'
import { remoteFixture } from '../testing/runtime.test-support.js'
import { RemoteFacade } from '../facade.js'
import { queueRevision } from '../../domain/remote-policy-revision.js'
describe('Execution control through real facade/receipt boundary', () => {
  it('forces api queued input, edits canonical user message, CAS refuses a second phone and removes safely', async () => {
    const f = await remoteFixture()
    try {
      const thread = await f.code()
      await f.h.turns.startTurn({ threadId: thread.id, request: { prompt: 'desktop work', clientSurface: 'gui' } })
      const queued = (await f.call('execution.queue.enqueue', { threadId: thread.id, text: 'next input' })).receipt
      expect(queued.status).toBe('applied')
      const turnId = queued.result.turnId, before = await f.call('execution.queue.list', { threadId: thread.id })
      expect(before).toMatchObject({ canSteer: false, steerReason: 'DESKTOP_SURFACE', items: [
        { turnId, text: 'next input', clientSurface: 'api', editable: true }] })
      const request = f.envelope('execution.queue.update', { threadId: thread.id, turnId,
        expectedRevision: before.revision, text: 'updated input' }, 'edit_once')
      const edited = (await f.facade.execute(request) as any).receipt
      expect(edited.status).toBe('applied')
      expect(edited.result.items[0].text).toBe('updated input')
      expect((await f.h.threads.get(thread.id))?.turns.find((t) => t.id === turnId)?.prompt).toBe('updated input')
      const stale = (await f.call('execution.queue.update', { threadId: thread.id, turnId,
        expectedRevision: before.revision, text: 'stale phone' }, undefined, 'phone2')).receipt
      expect(stale.error).toEqual({ code: 'REVISION_CONFLICT', definitive: true })
      const restarted = new RemoteFacade(f.runtime, f.router)
      expect((await restarted.execute(request) as any).receipt).toEqual(edited)
      const removed = (await f.call('execution.queue.remove', { threadId: thread.id, turnId,
        expectedRevision: edited.result.revision })).receipt
      expect(removed.result.items).toEqual([])
      expect((await f.h.threads.get(thread.id))?.turns.find((t) => t.id === turnId)?.status).toBe('aborted')
    } finally { await f.close() }
  })
  it('completes a staged edit after interrupted canonical write before promotion, never executes stale input', async () => {
    const f = await remoteFixture()
    try {
      const thread = await f.code()
      const queued = await f.h.turns.enqueueTurn({ threadId: thread.id, request: { prompt: 'original', clientSurface: 'api' } })
      const revision = queueRevision((await f.h.threads.get(thread.id))!)
      const update = vi.spyOn(f.h.sessionStore, 'updateItem').mockRejectedValueOnce(new Error('disk unavailable'))
      const failed = (await f.call('execution.queue.update', { threadId: thread.id, turnId: queued.turnId,
        expectedRevision: revision, text: 'authorized replacement' }, 'staged_edit')).receipt
      expect(failed.status).toBe('reconciliation_required')
      expect(failed.error).toBeUndefined()
      expect((await f.h.threads.get(thread.id))?.turns[0].queueEdit?.pending?.text).toBe('authorized replacement')
      update.mockRestore()
      const promoted = await f.h.turns.startNextQueuedTurn(thread.id)
      expect(promoted?.turnId).toBe(queued.turnId)
      const current = (await f.h.threads.get(thread.id))!.turns[0]
      expect(current).toMatchObject({ prompt: 'authorized replacement', clientSurface: 'api', queueEdit: { revision: 1 } })
      expect(current.queueEdit?.pending).toBeUndefined()
      const canonical = (await f.h.sessionStore.loadItems(thread.id)).find((item) => item.id === queued.userMessageItemId)
      expect(canonical).toMatchObject({ text: 'authorized replacement' })
      expect((await f.call('request.get', { requestId: 'staged_edit' })).receipt.status).toBe('applied')
    } finally { await f.close() }
  })
  it('does not edit or steer GUI turns and protects a running turn from queue controls', async () => {
    const f = await remoteFixture()
    try {
      const thread = await f.code()
      const active = await f.h.turns.startTurn({ threadId: thread.id, request: { prompt: 'desktop', clientSurface: 'gui' } })
      const queued = await f.h.turns.enqueueTurn({ threadId: thread.id, request: { prompt: 'desktop queued', clientSurface: 'gui' } })
      const before = await f.call('execution.queue.list', { threadId: thread.id })
      expect(before.items[0]).toMatchObject({ editable: false, reason: 'DESKTOP_SURFACE' })
      for (const method of ['execution.queue.update', 'execution.steer']) {
        const p = method.endsWith('update') ? { threadId: thread.id, turnId: queued.turnId,
          expectedRevision: before.revision, text: 'phone' } : { threadId: thread.id, turnId: active.turnId, text: 'phone' }
        expect((await f.call(method, p)).receipt.error).toEqual({ code: 'INVALID_REQUEST', definitive: true })
      }
      const removeActive = (await f.call('execution.queue.remove', { threadId: thread.id, turnId: active.turnId,
        expectedRevision: before.revision })).receipt
      expect(removeActive.error?.code).toBe('TASK_BUSY')
      expect((await f.h.threads.get(thread.id))?.turns[0].status).toBe('running')
    } finally { await f.close() }
  })
  it('durably steers an api active turn once and does not duplicate a lost receipt settlement', async () => {
    const f = await remoteFixture()
    try {
      const thread = await f.code(), start = await f.h.turns.startTurn({ threadId: thread.id,
        request: { prompt: 'api work', clientSurface: 'api' } })
      const request = f.envelope('execution.steer', { threadId: thread.id, turnId: start.turnId, text: 'new guidance' }, 'steer_once')
      const receipt = (await f.facade.execute(request) as any).receipt
      expect(receipt.status).toBe('applied')
      await new RemoteFacade(f.runtime, f.router).execute(request)
      expect((await f.h.threads.get(thread.id))?.turns[0].steeringDeliveries).toHaveLength(1)
      expect((await f.call('execution.queue.list', { threadId: thread.id })).canSteer).toBe(true)
    } finally { await f.close() }
  })
  it('serializes two phones editing the same queued input without losing the winning canonical message', async () => {
    const f = await remoteFixture()
    try {
      const thread = await f.code(), queued = await f.h.turns.enqueueTurn({ threadId: thread.id,
        request: { prompt: 'before', clientSurface: 'api' } })
      const before = await f.call('execution.queue.list', { threadId: thread.id })
      const replies = await Promise.all(['A', 'B'].map((text, index) => f.call('execution.queue.update', {
        threadId: thread.id, turnId: queued.turnId, expectedRevision: before.revision, text }, 'race_' + index, 'phone_' + index)))
      expect(replies.filter((r) => r.receipt.status === 'applied')).toHaveLength(1)
      expect(replies.filter((r) => r.receipt.error?.code === 'REVISION_CONFLICT')).toHaveLength(1)
      const winner = replies.find((r) => r.receipt.status === 'applied')!.receipt.result.items[0].text
      expect((await f.call('execution.queue.list', { threadId: thread.id })).items[0].text).toBe(winner)
      expect((await f.h.threads.get(thread.id))!.turns[0].prompt).toBe(winner)
    } finally { await f.close() }
  })
})
