import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { remoteFixture } from '../../testing/runtime.test-support.js'
import { FileAttachmentStore } from '../../../attachments/attachment-store.js'
import { AttachmentsCapabilityConfig } from '../../../contracts/capabilities.js'
import { png } from '../../../../tests/support/attachment-store-fixtures.js'
import { RemoteFacade } from '../../facade.js'

afterEach(() => vi.restoreAllMocks())
async function fixture(attachment = false, long = false) {
  const f = await remoteFixture(), task = await f.code('History task')
  const store = new FileAttachmentStore({ rootDir: join(f.root, 'attachments'), config: AttachmentsCapabilityConfig.parse({ enabled: true }) })
  f.runtime.attachmentStore = store; f.h.turns['deps'].attachmentStore = () => store
  const file = attachment ? await store.create({ name: 'original.png', mimeType: 'image/png', data: png(2, 2), threadId: task.id }) : undefined
  const turns: string[] = []
  for (let index = 0; index < 3; index++) {
    const started = await f.h.turns.startTurn({ threadId: task.id, request: { prompt: long && index === 1 ? 'x'.repeat(65000) : `input ${index}`,
      ...(file && index === 1 ? { attachmentIds: [file.id] } : {}), clientSurface: 'gui' } })
    await f.h.turns.finishTurn({ threadId: task.id, turnId: started.turnId, status: 'completed' }); turns.push(started.turnId)
  }
  const history = await f.call('code.history', { threadId: task.id })
  const params = { threadId: task.id, turnId: turns[1], expectedRevision: history.revision, historyVersion: history.historyVersion }
  const preview = async (id = 'preview', device = 'phone') => (await f.call('code.rewind.preview', params, id, device)).receipt
  const commit = (token: string, id = 'commit', device = 'phone') => f.call('code.rewind.commit', { threadId: task.id, token }, id, device)
  return { ...f, task, turns, params, preview, commit, file, attachments: store }
}
describe('remote rewind persistent preview and canonical WAL', () => {
  it('previews without cutting history and explicitly commits once while preserving workspace effects', async () => {
    const f = await fixture()
    try {
      const path = join(f.root, 'workspace-effect.txt'); await writeFile(path, 'unchanged external effect')
      const run = vi.spyOn(f.runtime, 'runTurn'), before = await f.preview()
      expect(before.status).toBe('applied')
      expect(before.result).toMatchObject({ canCommit: true, summary: { removedTurns: 2, remainingTurns: 1, filesReverted: false, externalEffectsReverted: false },
        draft: { text: 'input 1', attachmentIds: [], complete: true, totalChars: 7, totalAttachments: 0 } })
      expect((await f.h.threads.get(f.task.id))!.turns).toHaveLength(3)
      expect((await f.preview()).result.token).toBe(before.result.token)
      const result = (await f.commit(before.result.token)).receipt
      expect(result.status).toBe('applied'); expect(result.result.rewound).toBe(true)
      expect(result.result.historyVersion).not.toBe(f.params.historyVersion)
      expect(result.result.draft).toEqual(before.result.draft)
      expect((await f.h.threads.get(f.task.id))!.turns.map(turn => turn.id)).toEqual([f.turns[0]])
      expect((await f.h.sessionStore.loadItems(f.task.id)).filter(item => item.kind === 'user_message').map(item => item.text)).toEqual(['input 0'])
      expect(await readFile(path, 'utf8')).toBe('unchanged external effect'); expect(run).not.toHaveBeenCalled()
      expect((await f.commit(before.result.token)).receipt).toEqual(result)
      const history = await f.call('code.history', { threadId: f.task.id })
      expect(history.revision).toMatch(/^thread-v1:/); expect(history).not.toHaveProperty('remoteRewind')
      expect(JSON.stringify(history)).not.toContain('input 1')
    } finally { await f.close() }
  })

  it('keeps restored attachment references admitted after the original turn is removed', async () => {
    const f = await fixture(true)
    try {
      const preview = await f.preview(), result = (await f.commit(preview.result.token)).receipt
      expect(result.status).toBe('applied'); expect(result.result.draft.attachmentIds).toEqual([f.file!.id])
      const next = await f.call('code.turn.start', { threadId: f.task.id, text: result.result.draft.text, attachmentIds: result.result.draft.attachmentIds })
      expect(next.receipt.status).toBe('applied')
      expect((await f.h.turns.getTurn(f.task.id, next.receipt.result.turnId))?.attachmentIds).toEqual([f.file!.id])
    } finally { await f.close() }
  })

  it('refuses stale, expired, foreign-installation tokens and a busy task', async () => {
    const f = await fixture()
    try {
      const preview = await f.preview(), token = preview.result.token
      expect((await f.commit(token, 'foreign', 'second-phone')).receipt.error?.code).toBe('INVALID_REQUEST')
      const changedAuthority = { ...f.envelope('code.rewind.commit', { threadId: f.task.id, token }, 'new-authority'), authorizationId: 'different-authority' }
      expect((await f.facade.execute(changedAuthority) as any).receipt.error?.code).toBe('INVALID_REQUEST')
      const now = vi.spyOn(Date, 'now').mockReturnValue(preview.result.expiresAt + 1)
      expect((await f.commit(token, 'expired')).receipt.error?.code).toBe('INVALID_REQUEST'); now.mockRestore()
      await f.h.threads.update(f.task.id, { title: 'Desktop change' })
      expect((await f.commit(token, 'stale')).receipt.error?.code).toBe('REVISION_CONFLICT')
      const current = await f.call('code.history', { threadId: f.task.id })
      await f.h.turns.startTurn({ threadId: f.task.id, request: { prompt: 'active work' } })
      const active = await f.call('code.history', { threadId: f.task.id })
      expect((await f.call('code.rewind.preview', { ...f.params, expectedRevision: active.revision, historyVersion: current.historyVersion }, 'busy')).receipt.error?.code).toBe('TASK_BUSY')
      expect((await f.h.threads.get(f.task.id))!.turns).toHaveLength(4)
    } finally { await f.close() }
  })
  it('refuses a preview while execution is still settling despite terminal metadata', async () => {
    const f = await fixture()
    try {
      vi.spyOn(f.h.turns, 'isTurnExecutionActive').mockImplementation(id => id === f.turns[2])
      expect((await f.preview()).error?.code).toBe('TASK_BUSY')
      expect((await f.store.list<any>('remote_history')).filter(row => row.value.kind === 'rewind_preview')).toEqual([])
    } finally { await f.close() }
  })

  it('does not claim complete restoration of oversized legacy input or missing attachment bytes', async () => {
    const f = await fixture(false, true)
    try {
      const before = await f.preview()
      expect(before.result).toMatchObject({ canCommit: false, reason: 'DRAFT_LIMIT', draft: { complete: false, totalChars: 65000 } })
      expect(before.result.draft.text).toHaveLength(64000)
      expect((await f.commit(before.result.token)).receipt.error?.code).toBe('INVALID_REQUEST')
      expect((await f.h.threads.get(f.task.id))!.turns).toHaveLength(3)
    } finally { await f.close() }
    const g = await fixture(true)
    try {
      const read = vi.spyOn(g.attachments, 'resolveContent').mockRejectedValue(new Error('missing blob'))
      const before = await g.preview()
      expect(before.result).toMatchObject({ canCommit: false, reason: 'ATTACHMENT_UNAVAILABLE', draft: { attachmentIds: [g.file!.id], complete: true } })
      read.mockRestore()
      const fresh = await g.preview('available')
      vi.spyOn(g.attachments, 'resolveContent').mockRejectedValue(new Error('removed after preview'))
      expect((await g.commit(fresh.result.token)).receipt.error?.code).toBe('ATTACHMENT_NOT_CONFIRMED')
      expect((await g.h.threads.get(g.task.id))!.turns).toHaveLength(3)
    } finally { await g.close() }
  })

  it('marks more than eight legacy attachments incomplete instead of silently dropping them', async () => {
    const f = await fixture()
    try {
      const ids = Array.from({ length: 9 }, (_, index) => 'att_' + String(index).padStart(24, '0'))
      const items = await f.h.sessionStore.loadItems(f.task.id), user = items.find(item => item.kind === 'user_message' && item.turnId === f.turns[1])!
      await f.h.sessionStore.updateItem(f.task.id, user.id, { attachmentIds: ids })
      const thread = (await f.h.threads.get(f.task.id))!
      await f.h.threadStore.upsert({ ...thread, turns: thread.turns.map(turn => turn.id === f.turns[1] ? { ...turn, attachmentIds: ids } : turn) })
      const history = await f.call('code.history', { threadId: f.task.id })
      f.params.expectedRevision = history.revision; f.params.historyVersion = history.historyVersion
      const result = await f.preview()
      expect(result.result).toMatchObject({ canCommit: false, reason: 'DRAFT_LIMIT', draft: { complete: false, totalAttachments: 9 } })
      expect(result.result.draft.attachmentIds).toHaveLength(8)
      expect((await f.commit(result.result.token)).receipt.error?.code).toBe('INVALID_REQUEST')
      expect((await f.h.threads.get(f.task.id))!.turns).toHaveLength(3)
    } finally { await f.close() }
  })

  it('repairs the projection after a crash following the canonical rewrite without repeating it', async () => {
    const f = await fixture()
    try {
      const preview = await f.preview(), rewrite = vi.spyOn(f.h.sessionStore, 'rewriteItemsIfRevision')
      const original = f.h.threadStore.upsertIfRevision.bind(f.h.threadStore)
      const failure = vi.spyOn(f.h.threadStore, 'upsertIfRevision').mockImplementation(async (thread, revision) => {
        if (thread.remoteRewind?.phase === 'applied') throw new Error('fixture crash after rewrite')
        return original(thread, revision)
      })
      const result = (await f.commit(preview.result.token)).receipt
      expect(result.status).toBe('reconciliation_required'); expect(result.error).toBeUndefined()
      expect((await f.h.threads.get(f.task.id))!.remoteRewind?.phase).toBe('pending')
      await expect(f.h.turns.startTurn({ threadId: f.task.id, request: { prompt: 'cannot cross pending WAL' } })).rejects.toThrow('history reconciliation required')
      await expect(f.h.turns.enqueueTurn({ threadId: f.task.id, request: { prompt: 'cannot queue either' } })).rejects.toThrow('history reconciliation required')
      failure.mockRestore()
      const recovered = await f.call('request.get', { requestId: 'commit' })
      expect(recovered.receipt.status).toBe('applied'); expect(recovered.receipt.result.rewound).toBe(true)
      expect(rewrite).toHaveBeenCalledOnce()
      expect((await f.h.threads.get(f.task.id))!.turns).toHaveLength(1)
      expect((await f.h.threads.get(f.task.id))!.remoteRewind?.phase).toBe('applied')
    } finally { await f.close() }
  })

  it('recovers the same persisted preview after its native ACK is lost', async () => {
    const f = await fixture()
    try {
      const original = f.store.commit.bind(f.store)
      const failure = vi.spyOn(f.store, 'commit').mockImplementation(async input => {
        const result = await original(input)
        if (input.requestId.startsWith('rewind-preview:')) throw new Error('fixture preview ACK lost')
        return result
      })
      expect((await f.preview()).status).toBe('reconciliation_required'); failure.mockRestore()
      const recovered = (await f.call('request.get', { requestId: 'preview' })).receipt
      expect(recovered.status).toBe('applied'); expect(recovered.result.token).toMatch(/^[a-f0-9]{64}$/)
      expect((await f.preview()).result.token).toBe(recovered.result.token)
      expect((await f.store.list<any>('remote_history')).filter(row => row.value.kind === 'rewind_preview')).toHaveLength(1)
      expect((await f.h.threads.get(f.task.id))!.turns).toHaveLength(3)
    } finally { await f.close() }
  })

  it('repairs a failure before rewrite from the exact staged WAL and blocks competing native history actions', async () => {
    const f = await fixture()
    try {
      const preview = await f.preview(), rewrite = vi.spyOn(f.h.sessionStore, 'rewriteItemsIfRevision').mockRejectedValueOnce(new Error('fixture before rewrite'))
      expect((await f.commit(preview.result.token)).receipt.status).toBe('reconciliation_required')
      await expect(f.h.turns.compact({ threadId: f.task.id, request: {} })).rejects.toThrow('history reconciliation required')
      await expect(f.h.turns.rewindThread({ threadId: f.task.id, turnId: f.turns[1] })).rejects.toThrow('history reconciliation required')
      const current = await f.call('request.get', { requestId: 'commit' })
      expect(current.receipt.status).toBe('applied'); expect(rewrite).toHaveBeenCalledTimes(2)
      expect((await f.h.threads.get(f.task.id))!.turns).toHaveLength(1)
    } finally { await f.close() }
  })

  it('does not repeat a committed rewrite when the final projection ACK is lost', async () => {
    const f = await fixture()
    try {
      const preview = await f.preview(), rewrite = vi.spyOn(f.h.sessionStore, 'rewriteItemsIfRevision')
      const original = f.h.threadStore.upsertIfRevision.bind(f.h.threadStore)
      const failure = vi.spyOn(f.h.threadStore, 'upsertIfRevision').mockImplementation(async (thread, revision) => {
        const result = await original(thread, revision)
        if (thread.remoteRewind?.phase === 'applied') throw new Error('fixture final ACK lost')
        return result
      })
      expect((await f.commit(preview.result.token)).receipt.status).toBe('reconciliation_required'); failure.mockRestore()
      const recovered = (await f.call('request.get', { requestId: 'commit' })).receipt
      expect(recovered.status).toBe('applied'); expect(rewrite).toHaveBeenCalledOnce()
      expect((await f.commit(preview.result.token)).receipt).toEqual(recovered)
    } finally { await f.close() }
  })

  it('serializes two explicit previews and never removes a second range with a consumed token', async () => {
    const f = await fixture()
    try {
      const a = await f.preview('preview-a'), b = await f.preview('preview-b')
      const rewrite = vi.spyOn(f.h.sessionStore, 'rewriteItemsIfRevision')
      const results = await Promise.all([f.commit(a.result.token, 'commit-a'), f.commit(b.result.token, 'commit-b')])
      expect(results.filter(result => result.receipt.status === 'applied')).toHaveLength(1)
      expect(rewrite).toHaveBeenCalledOnce()
      const winner = results.find(result => result.receipt.status === 'applied')!.receipt
      const token = winner.requestId === 'commit-a' ? a.result.token : b.result.token
      expect((await f.commit(token, 'new-id-same-token')).receipt.error?.code).toBe('INVALID_REQUEST')
      expect((await f.h.threads.get(f.task.id))!.turns).toHaveLength(1)
    } finally { await f.close() }
  })

  it('finishes a trusted pending WAL on independent startup facades without the original phone', async () => {
    const f = await fixture(), cleanups: Array<() => Promise<void>> = []
    try {
      await new Promise(resolve => setTimeout(resolve, 0))
      const preview = await f.preview(), rewrite = vi.spyOn(f.h.sessionStore, 'rewriteItemsIfRevision')
      const original = f.h.threadStore.upsertIfRevision.bind(f.h.threadStore)
      const failure = vi.spyOn(f.h.threadStore, 'upsertIfRevision').mockImplementation(async (thread, revision) => {
        if (thread.remoteRewind?.phase === 'applied') throw new Error('fixture crash')
        return original(thread, revision)
      })
      expect((await f.commit(preview.result.token)).receipt.status).toBe('reconciliation_required')
      failure.mockRestore()
      const run = vi.spyOn(f.runtime, 'runTurn')
      for (let index = 0; index < 2; index++) new RemoteFacade({ ...f.runtime,
        registerRemoteCleanup: cleanup => { cleanups.push(cleanup) } }, f.router)
      await vi.waitFor(async () => expect((await f.h.threads.get(f.task.id))!.remoteRewind?.phase).toBe('applied'))
      expect((await f.h.threads.get(f.task.id))!.turns).toHaveLength(1)
      expect(rewrite).toHaveBeenCalledOnce(); expect(run).not.toHaveBeenCalled()
      await vi.waitFor(async () => expect(await f.store.list<any>('remote_history', { status: 'pending' })).toEqual([]))
    } finally { await Promise.all(cleanups.map(cleanup => cleanup())); await f.close() }
  })

  it('leaves a changed or missing Manager proof unresolved instead of trusting a copied Thread marker', async () => {
    const f = await fixture()
    try {
      await new Promise(resolve => setTimeout(resolve, 0))
      const preview = await f.preview(), original = f.h.threadStore.upsertIfRevision.bind(f.h.threadStore)
      const failure = vi.spyOn(f.h.threadStore, 'upsertIfRevision').mockImplementation(async (thread, revision) => {
        if (thread.remoteRewind?.phase === 'applied') throw new Error('fixture crash')
        return original(thread, revision)
      })
      await f.commit(preview.result.token); failure.mockRestore()
      const row = (await f.store.list<any>('remote_history', { status: 'pending' }))[0]
      await f.store.commit({ requestId: 'alter-proof', checks: [{ kind: 'remote_history', id: row.id, expectedRevision: row.revision }],
        puts: [{ kind: 'remote_history', id: row.id, value: { ...row.value, plan: { ...row.value.plan, afterHash: 'f'.repeat(64) } } }] })
      const rewrite = vi.spyOn(f.h.sessionStore, 'rewriteItemsIfRevision'), snapshot = await f.h.sessionStore.loadItemSnapshot(f.task.id)
      expect((await f.call('code.history', { threadId: f.task.id })).historyState).toBe('reconciliation_required')
      expect((await f.call('request.get', { requestId: 'commit' })).receipt.status).toBe('reconciliation_required')
      expect(rewrite).not.toHaveBeenCalled(); expect(await f.h.sessionStore.loadItemSnapshot(f.task.id)).toEqual(snapshot)
      expect((await f.h.threads.get(f.task.id))!.remoteRewind?.phase).toBe('pending')
    } finally { await f.close() }
  })
})
