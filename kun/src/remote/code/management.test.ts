import { describe, expect, it, vi } from 'vitest'
import { RemoteFacade } from '../facade.js'
import { metadataRevision } from './management.js'
import { remoteFixture } from '../testing/runtime.test-support.js'
import { hasOperation } from '@kun/remote-protocol'
describe('Code durable control', () => {
  it('renames, pins, archives/restores with CAS and replays a settled delete across facade restart', async () => {
    const f = await remoteFixture()
    try {
      const task = await f.code(), id = task.id
      const first = (await f.call('code.search', {})).threads[0]
      expect(first).toMatchObject({ id, revision: metadataRevision(task), pinned: false, archived: false })
      const renamed = (await f.call('code.rename', { threadId: id, expectedRevision: first.revision, title: 'From phone' })).receipt
      expect(renamed.status).toBe('applied')
      expect((await f.h.threads.getMetadata(id))?.titleAuto).toBe(false)
      expect((await f.call('code.pin', { threadId: id, expectedRevision: first.revision, pinned: true })).receipt.error)
        .toEqual({ code: 'REVISION_CONFLICT', definitive: true })
      const pinned = (await f.call('code.pin', { threadId: id, expectedRevision: renamed.result.thread.revision, pinned: true })).receipt.result.thread
      const archived = (await f.call('code.archive', { threadId: id, expectedRevision: pinned.revision })).receipt.result.thread
      expect(archived.archived).toBe(true)
      expect((await f.call('code.search', {})).threads).toEqual([])
      expect((await f.call('code.search', { status: 'archived' })).threads[0].id).toBe(id)
      const restored = (await f.call('code.restore', { threadId: id, expectedRevision: archived.revision })).receipt.result.thread
      const request = f.envelope('code.delete', { threadId: id, expectedRevision: restored.revision }, 'delete_once')
      expect((await f.facade.execute(request) as any).receipt.result).toEqual({ threadId: id, deleted: true })
      expect(await f.h.threads.getMetadata(id)).toBeNull()
      const restarted = new RemoteFacade(f.runtime, f.router)
      expect((await restarted.execute(request) as any).receipt.result).toEqual({ threadId: id, deleted: true })
      expect((await f.call('request.get', { requestId: 'delete_once' })).receipt.status).toBe('applied')
    } finally { await f.close() }
  })
  it('concurrent phones cannot overwrite and only proven CAS refusal is definitive', async () => {
    const f = await remoteFixture()
    try {
      const task = await f.code(), revision = metadataRevision(task)
      const original = f.h.threads.getMetadata.bind(f.h.threads), reads = vi.spyOn(f.h.threads, 'getMetadata')
      // Both requests finish admission against the same version before either write enters its queue.
      let admissions = 0, release!: () => void
      const ready = new Promise<void>((resolve) => { release = resolve })
      reads.mockImplementation(async (id) => {
        const result = await original(id)
        if (admissions++ < 2) { if (admissions === 2) release(); await ready }
        return result
      })
      const results = await Promise.all([
        f.call('code.rename', { threadId: task.id, expectedRevision: revision, title: 'A' }, 'rename_A', 'phone_A'),
        f.call('code.rename', { threadId: task.id, expectedRevision: revision, title: 'B' }, 'rename_B', 'phone_B')
      ])
      expect(results.map((v) => v.receipt.status).sort()).toEqual(['applied', 'reconciliation_required'])
      const rejected = results.find((v) => v.receipt.error)
      expect(rejected.receipt.error).toEqual({ code: 'REVISION_CONFLICT', definitive: true })
      expect((await f.h.threads.getMetadata(task.id))?.title).toMatch(/^[AB]$/)
      reads.mockRestore()
    } finally { await f.close() }
  })
  it('changes only the next route while an API turn is accepted, preserves global policy and rejects arbitrary fields', async () => {
    const f = await remoteFixture()
    try {
      const task = await f.code(); await f.code('Another model', 'other')
      await f.call('code.turn.start', { threadId: task.id, text: 'keep working' })
      const before = await f.call('code.settings.get', { threadId: task.id })
      const after = (await f.call('code.settings.update', { threadId: task.id, expectedRevision: before.revision,
        next: { harnessId: 'kun', model: 'other' } })).receipt.result
      expect(after.effective.model).toBe('fake'); expect(after.next.model).toBe('other')
      const thread = await f.h.threads.getMetadata(task.id)
      expect(thread?.turns[0].clientSurface).toBe('api')
      expect(thread?.model).toBe('fake')
      expect(thread?.pendingExecutionConfig?.route.model).toBe('other')
      await expect(f.call('code.settings.update', { threadId: task.id, expectedRevision: after.revision,
        next: { model: 'fake', sandboxMode: 'danger-full-access' } })).rejects.toThrow()
      expect((await f.call('code.settings.update', { threadId: task.id, expectedRevision: after.revision,
        next: { model: 'not_in_catalog' } })).receipt.error).toEqual({ code: 'MODEL_NOT_AVAILABLE', definitive: true })
    } finally { await f.close() }
  })
  it('uses the durable conditional write when a desktop mutation lands after admission', async () => {
    const f = await remoteFixture()
    try {
      const task = await f.code(), conditional = f.h.threadStore.upsertIfRevision.bind(f.h.threadStore)
      const write = vi.spyOn(f.h.threadStore, 'upsertIfRevision').mockImplementationOnce(async (thread, expected) => {
        await f.h.threadStore.upsert({ ...thread, title: 'Desktop won' })
        return conditional(thread, expected)
      })
      const result = await f.call('code.rename', { threadId: task.id, expectedRevision: metadataRevision(task), title: 'Phone lost' })
      expect(write).toHaveBeenCalledOnce()
      expect(result.receipt.error).toEqual({ code: 'REVISION_CONFLICT', definitive: true })
      expect((await f.h.threads.getMetadata(task.id))?.title).toBe('Desktop won')
    } finally { await f.close() }
  })
  it('only advertises implemented remote operations, preserving the old feature array', async () => {
    const f = await remoteFixture()
    try {
      await f.code()
      const catalog = await f.call('catalog.get', {})
      expect(catalog.capabilities).toContain('code')
      expect(hasOperation(catalog, 'code.rename', 'code')).toBe(true)
      expect(hasOperation(catalog, 'queue.edit')).toBe(false)
    } finally { await f.close() }
  })
  it('never stops or relabels an active task through archive, restore or delete', async () => {
    const f = await remoteFixture()
    try {
      const task = await f.code()
      await f.call('code.turn.start', { threadId: task.id, text: 'active work' })
      const before = await f.h.threads.getMetadata(task.id), revision = metadataRevision(before!)
      const remove = vi.spyOn(f.h.threads, 'delete'), update = vi.spyOn(f.h.threads, 'update')
      for (const method of ['code.archive', 'code.restore', 'code.delete'])
        expect((await f.call(method, { threadId: task.id, expectedRevision: revision })).receipt.error)
          .toEqual({ code: 'TASK_BUSY', definitive: true })
      expect(remove).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled()
      expect(await f.h.threads.getMetadata(task.id)).toEqual(before)
    } finally { await f.close() }
  })
  it('does not repeat a metadata effect when the post-effect receipt settlement is lost', async () => {
    const f = await remoteFixture()
    try {
      const task = await f.code(), request = f.envelope('code.rename', {
        threadId: task.id, expectedRevision: metadataRevision(task), title: 'Persisted before ACK' }, 'lost_settlement')
      const commit = f.store.commit.bind(f.store), mutation = vi.spyOn(f.h.threads, 'update')
      let failed = false
      vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
        if (!failed && input.requestId.endsWith('-settle')) { failed = true; throw new Error('fixture storage lost') }
        return commit(input)
      })
      await expect(f.facade.execute(request)).rejects.toThrow('fixture storage lost')
      expect((await f.h.threads.getMetadata(task.id))?.title).toBe('Persisted before ACK')
      const restarted = new RemoteFacade(f.runtime, f.router)
      expect((await restarted.execute(request) as any).receipt.status).toBe('reconciliation_required')
      expect(mutation).toHaveBeenCalledOnce()
    } finally { await f.close() }
  })
})
