import { describe, expect, it, vi } from 'vitest'
import { remoteFixture } from '../../testing/runtime.test-support.js'
import { RemoteCodeHistory } from './service.js'
import { CodeForkParams } from './contracts.js'
import { RemoteReceipts } from '../../requests/receipts.js'
import { Envelope } from '../../contracts.js'
import { requireCode, isRemoteCodeAllowed } from '../access.js'
import { RemoteNoEffect } from '../../requests/rejections.js'
import { RemoteFacade } from '../../facade.js'

async function fixture() {
  const f = await remoteFixture(), task = await f.code('Original'), history = new RemoteCodeHistory(f.runtime), receipts = new RemoteReceipts(f.rooms)
  const first = await f.h.turns.startTurn({ threadId: task.id, request: { prompt: 'first input', clientSurface: 'gui' } })
  await f.h.turns.finishTurn({ threadId: task.id, turnId: first.turnId, status: 'completed' })
  const second = await f.h.turns.startTurn({ threadId: task.id, request: { prompt: 'second input', clientSurface: 'gui' } })
  await f.h.turns.finishTurn({ threadId: task.id, turnId: second.turnId, status: 'completed' })
  const source = (await f.h.threads.getMetadata(task.id))!, historyVersion = await f.h.sessionStore.itemHistoryVersion(task.id)
  const params = { threadId: task.id, turnId: first.turnId, expectedRevision: `thread-v1:${source.revision ?? 0}`, historyVersion, title: 'Phone branch' }
  const envelope = (p = params, id = 'fork-once', phone = 'phone') => Envelope.parse(f.envelope('code.fork', p, id, phone))
  const execute = (e = envelope()) => receipts.execute(e, () => history.dispatch('code.fork', CodeForkParams.parse(e.call.params), e))
  return { ...f, task, first, second, params, history, receipts, envelope, execute }
}
describe('remote Code fork with native commit and Manager provenance', () => {
  it('can branch before turn one without starting a new task or inheriting later messages', async () => {
    const f = await fixture()
    try {
      const run = vi.spyOn(f.runtime, 'runTurn'), result = await f.execute(f.envelope({ ...f.params, beforeTurn: true } as any))
      const thread = await requireCode(f.runtime, (result.result as any).thread.id)
      expect(thread.turns).toEqual([]); expect(await f.h.sessionStore.loadItems(thread.id)).toEqual([])
      expect(run).not.toHaveBeenCalled()
    } finally { await f.close() }
  })
  it('creates one readable branch at the chosen round, keeps policy and requires API on the next input', async () => {
    const f = await fixture()
    try {
      const result = await f.execute(), id = (result.result as any).thread.id
      expect(result.status).toBe('applied')
      const branch = await requireCode(f.runtime, id)
      expect(branch.turns).toHaveLength(1)
      expect(branch).toMatchObject({ parentThreadId: f.task.id, relation: 'fork', title: 'Phone branch', approvalReviewer: f.task.approvalReviewer })
      expect(branch.turns[0].clientSurface).toBe('gui')
      expect((await f.h.sessionStore.loadItems(id)).filter(item => item.kind === 'user_message').map(item => item.text)).toEqual(['first input'])
      expect((await f.call('code.search', {})).threads.map((thread: { id: string }) => thread.id)).toContain(id)
      expect((await f.call('code.list', {})).threads.map((thread: { id: string }) => thread.id)).toContain(id)
      const next = await f.call('code.turn.start', { threadId: id, text: 'new API input' })
      expect(next.receipt.status).toBe('applied')
      expect((await f.h.turns.getTurn(id, next.receipt.result.turnId))?.clientSurface).toBe('api')
    } finally { await f.close() }
  })

  it('does not replay across fresh transport TTLs or facade restarts, and rejects changed parameters', async () => {
    const f = await fixture()
    try {
      const e = f.envelope(), first = await f.execute(e)
      expect(await f.execute({ ...e, call: { ...e.call, expiresAt: e.call.expiresAt + 1000 } })).toEqual(first)
      const facade = new RemoteFacade(f.runtime, f.router)
      expect((await facade.execute(e) as any).receipt).toEqual(first)
      // Same operation ID still binds exact original semantics.
      await expect(f.execute(f.envelope({ ...f.params, beforeTurn: true } as any))).rejects.toThrow('REQUEST_CONFLICT')
      const branch = (first.result as any).thread.id
      expect((await f.h.threads.list({ includeSide: true })).filter(thread => thread.id === branch)).toHaveLength(1)
    } finally { await f.close() }
  })

  it('recovers a committed branch after native ACK loss without cloning twice', async () => {
    const f = await fixture()
    try {
      const upsert = f.h.threadStore.upsert.bind(f.h.threadStore)
      const write = vi.spyOn(f.h.threadStore, 'upsert').mockImplementation(async thread => {
        const saved = await upsert(thread)
        if (thread.remoteFork) throw new Error('fixture native ACK lost')
        return saved
      })
      const result = await f.execute()
      expect(result.status).toBe('reconciliation_required')
      const recovered: any = await f.history.recover(f.envelope(), result)
      expect(recovered.thread.id).toMatch(/^thr_mobile_fork_/)
      expect(await isRemoteCodeAllowed(f.runtime, (await f.h.threads.getMetadata(recovered.thread.id))!)).toBe(true)
      await f.receipts.recovered(f.envelope(), result.requestId, recovered)
      expect((await f.execute()).status).toBe('applied')
      expect(write.mock.calls.filter(([thread]) => thread.remoteFork)).toHaveLength(1)
    } finally { await f.close() }
  })

  it('leaves a pre-commit failure unknown and never exposes or retries an orphan copy', async () => {
    const f = await fixture()
    try {
      const upsert = f.h.threadStore.upsert.bind(f.h.threadStore), write = vi.spyOn(f.h.threadStore, 'upsert').mockImplementation(async thread => {
        if (thread.remoteFork) throw new Error('fixture before native commit')
        return upsert(thread)
      })
      const first = await f.execute()
      expect(first.status).toBe('reconciliation_required')
      expect(await f.history.recover(f.envelope(), first)).toBeUndefined()
      expect(await f.execute()).toEqual(first)
      expect(write.mock.calls.filter(([thread]) => thread.remoteFork)).toHaveLength(1)
      expect((await f.h.threads.list({ includeSide: true })).filter(thread => thread.parentThreadId)).toEqual([])
    } finally { await f.close() }
  })

  it('does not trust copied metadata or expose ordinary internal children', async () => {
    const f = await fixture()
    try {
      const result = await f.execute(), branch = await f.h.threads.get((result.result as any).thread.id)
      const internal = await f.h.threads.fork(f.task.id)
      await expect(requireCode(f.runtime, internal.id)).rejects.toThrow('NOT_A_CODE_TASK')
      const forged = { ...branch!, id: 'thr_mobile_fork_' + 'f'.repeat(32) }
      await f.h.threadStore.upsert(forged)
      await expect(requireCode(f.runtime, forged.id)).rejects.toThrow('NOT_A_CODE_TASK')
      for (const extra of [{ workspace: '/untrusted' }, { sandboxMode: 'danger-full-access' }, { approvalReviewer: 'agent' }, { remoteFork: branch!.remoteFork }])
        expect(() => CodeForkParams.parse({ ...f.params, ...extra })).toThrow()
    } finally { await f.close() }
  })

  it('isolates equal request IDs by installation and rejects busy or changed source snapshots before cloning', async () => {
    const f = await fixture()
    try {
      const [a, b] = await Promise.all([f.execute(), f.execute(f.envelope(undefined, 'fork-once', 'second-phone'))])
      expect((a.result as any).thread.id).not.toBe((b.result as any).thread.id)
      await f.h.threads.update(f.task.id, { title: 'Desktop changed' })
      await expect(f.history.preflight('code.fork', f.params)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
      const metadata = (await f.h.threads.getMetadata(f.task.id))!
      await f.h.turns.startTurn({ threadId: f.task.id, request: { prompt: 'active' } })
      const active = (await f.h.threads.getMetadata(f.task.id))!
      await expect(f.history.preflight('code.fork', { ...f.params, expectedRevision: `thread-v1:${active.revision}` })).rejects.toBeInstanceOf(RemoteNoEffect)
      expect(metadata.title).toBe('Desktop changed')
    } finally { await f.close() }
  })
  it('checks the actual execution lease again at native admission even when metadata still says idle', async () => {
    const f = await fixture()
    try {
      let busy = false
      f.h.turns['deps'].executionLeases = { owner: async () => busy ? { threadId: f.task.id } : null } as any
      const commit = f.store.commit.bind(f.store)
      vi.spyOn(f.store, 'commit').mockImplementation(async input => {
        const result = await commit(input)
        if (input.requestId.startsWith('remote-fork:') && input.requestId.endsWith('-prepare')) busy = true
        return result
      })
      const result = await f.execute()
      expect(result.error).toEqual({ code: 'TASK_BUSY', definitive: true })
      expect((await f.h.threads.list({ includeSide: true })).filter(thread => thread.parentThreadId)).toEqual([])
    } finally { await f.close() }
  })
})
