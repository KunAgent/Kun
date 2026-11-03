import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { shareFixture } from './guest.test-support.js'
import { FileAttachmentStore } from '../../attachments/attachment-store.js'
import { AttachmentsCapabilityConfig } from '../../contracts/capabilities.js'
import { png } from '../../../tests/support/attachment-store-fixtures.js'
import { validateAttachmentAliases } from '../../contracts/attachment-aliases.js'

async function fixture() {
  const f = await shareFixture()
  const attachments = new FileAttachmentStore({ rootDir: join(f.root, 'attachments'),
    config: AttachmentsCapabilityConfig.parse({ enabled: true }) })
  f.runtime.attachmentStore = attachments; f.h.turns['deps'].attachmentStore = () => attachments
  const native = await attachments.create({ name: 'PRIVATE_CUSTOMER_LIST.png', data: png(2, 2),
    mimeType: 'image/png', threadId: f.other.id, localFilePath: join(f.root, 'PRIVATE_CUSTOMER_LIST.png') })
  await attachments.create({ name: 'shared-input.png', data: png(2, 2), mimeType: 'image/png', threadId: f.task.id })
  async function confirm(name: string, id: string) {
    const call = f.call('attachment.receive', { transferId: 'f12f7b7d-bb12-4779-bf43-456205a1d496',
      name, mimeType: 'image/png', size: native.byteSize, sha256: native.hash! }, id)
    await f.facade.files.start(f.actor, call)
    await f.facade.files.finish(f.actor, call, { attachment: { id: native.id } })
  }
  await confirm('shared-input.png', 'first_receive')
  return { ...f, attachments, native, confirm }
}

describe('host-authored shared attachment snapshots in native durable turns', () => {
  it('freezes the admitted safe name on turn and canonical item; replay cannot replace it', async () => {
    const f = await fixture()
    try {
      const run = vi.fn(() => new Promise<never>(() => {})); f.runtime.runTurn = run
      const p = { threadId: f.task.id, text: 'use image', attachmentIds: [f.native.id] }
      const result = await f.invoke('code.turn.start', p, 'one_turn')
      expect(result.receipt.status).toBe('applied')
      const aliases = [{ attachmentId: f.native.id, displayName: 'shared-input.png', mimeType: 'image/png', byteSize: f.native.byteSize }]
      expect((await f.h.threads.get(f.task.id))!.turns[0].attachmentAliases).toEqual(aliases)
      expect((await f.h.sessionStore.loadItems(f.task.id))[0]).toMatchObject({ attachmentAliases: aliases })
      await f.confirm('later-renamed.png', 'second_receive')
      expect(await f.invoke('code.turn.start', p, 'one_turn')).toEqual(result)
      expect((await f.h.threads.get(f.task.id))!.turns).toHaveLength(1)
      expect((await f.h.threads.get(f.task.id))!.turns[0].attachmentAliases).toEqual(aliases)
      expect(run).toHaveBeenCalledOnce()
      expect((await f.attachments.get(f.native.id))!.name).toBe('PRIVATE_CUSTOMER_LIST.png')
    } finally { await f.close() }
  })

  it('recovers the staged safe edit through promotion without re-reading a changed proof name', async () => {
    const f = await fixture()
    try {
      const queued = await f.invoke('execution.queue.enqueue', { threadId: f.task.id, text: 'initial queue', attachmentIds: [f.native.id] })
      // With an idle task the first input starts; a second input is the durable queue entry.
      expect(queued.receipt.status).toBe('applied')
      const second = await f.invoke('execution.queue.enqueue', { threadId: f.task.id, text: 'queued', attachmentIds: [f.native.id] })
      const queue = await f.invoke('execution.queue.list', { threadId: f.task.id }), turnId = second.receipt.result.turnId
      await f.confirm('edited-input.png', 'edit_receive')
      const update = vi.spyOn(f.h.sessionStore, 'updateItem').mockRejectedValueOnce(new Error('injected write failure'))
      const reply = await f.invoke('execution.queue.update', { threadId: f.task.id, turnId,
        expectedRevision: queue.revision, text: 'authorized edit', attachmentIds: [f.native.id] }, 'staged_edit')
      expect(reply.receipt.status).toBe('reconciliation_required')
      const pending = (await f.h.threads.get(f.task.id))!.turns.find((t) => t.id === turnId)!.queueEdit!.pending!
      expect(pending.attachmentAliases![0].displayName).toBe('edited-input.png')
      update.mockRestore()
      await f.confirm('new-proof-after-crash.png', 'late_receive')
      await f.h.turns.reconcileQueuedEdits(f.task.id)
      await f.h.turns.finishTurn({ threadId: f.task.id, turnId: queued.receipt.result.turnId, status: 'completed' })
      expect((await f.h.turns.startNextQueuedTurn(f.task.id))!.turnId).toBe(turnId)
      const final = (await f.h.threads.get(f.task.id))!.turns.find((t) => t.id === turnId)!
      expect(final).toMatchObject({ prompt: 'authorized edit', attachmentAliases: [{ displayName: 'edited-input.png' }] })
      const canonical = (await f.h.sessionStore.loadItems(f.task.id)).find((item) => item.turnId === turnId && item.kind === 'user_message')
      expect(canonical).toMatchObject({ attachmentAliases: final.attachmentAliases })
      expect((await f.invoke('request.get', { requestId: 'staged_edit' })).receipt.status).toBe('applied')
    } finally { await f.close() }
  })

  it('marks even text-only shared turns restricted and keeps ordinary admission unchanged', async () => {
    const f = await fixture()
    try {
      await f.invoke('code.turn.start', { threadId: f.task.id, text: 'shared text' })
      expect((await f.h.threads.get(f.task.id))!.turns[0].attachmentAliases).toEqual([])
      const ordinary = await f.h.turns.startTurn({ threadId: f.other.id,
        request: { prompt: 'ordinary', clientSurface: 'api', attachmentIds: [f.native.id] } })
      expect((await f.h.turns.getTurn(f.other.id, ordinary.turnId))!.attachmentAliases).toBeUndefined()
      expect((await f.h.sessionStore.loadItems(f.other.id))[0]).not.toHaveProperty('attachmentAliases')
    } finally { await f.close() }
  })

  it('never accepts the alias snapshot from the guest wire and validates exact selected ids', async () => {
    const f = await fixture()
    try {
      await expect(f.invoke('code.turn.start', { threadId: f.task.id, text: 'injection', attachmentIds: [f.native.id],
        attachmentAliases: [{ attachmentId: f.native.id, displayName: 'injected.png' }] })).rejects.toThrow()
      expect((await f.h.threads.get(f.task.id))!.turns).toHaveLength(0)
      expect(() => validateAttachmentAliases([], [f.native.id])).toThrow('INVALID_ATTACHMENT_ALIASES')
      expect(() => validateAttachmentAliases([{ attachmentId: f.native.id, displayName: '../private.png' }], [f.native.id])).toThrow()
    } finally { await f.close() }
  })
})
