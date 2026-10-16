import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { shareFixture } from './guest.test-support.js'
import { FileAttachmentStore } from '../../attachments/attachment-store.js'
import { AttachmentsCapabilityConfig } from '../../contracts/capabilities.js'
import { png } from '../../../tests/support/attachment-store-fixtures.js'
import { registerSharedTaskRoutes } from './routes.js'
describe('shared native files through the actual guest facade and protected runtime boundary', () => {
  it('admits confirmed inputs for send/enqueue/edit, rejects guessed ids before effects, and recovers one original turn', async () => {
    const f = await shareFixture()
    try {
      const attachments = new FileAttachmentStore({ rootDir: join(f.root, 'attachments'), config: AttachmentsCapabilityConfig.parse({ enabled: true }) })
      f.runtime.attachmentStore = attachments; f.h.turns['deps'].attachmentStore = () => attachments
      const native = await attachments.create({ name: 'guest.png', data: png(2, 2), mimeType: 'image/png', threadId: f.task.id })
      const unknown = await attachments.create({ name: 'other.png', data: png(3, 3), mimeType: 'image/png', threadId: f.task.id })
      const params = { threadId: f.task.id, text: 'confirmed file', attachmentIds: [native.id] }
      expect((await f.invoke('code.turn.start', params, 'unconfirmed')).receipt).toMatchObject({
        status: 'reconciliation_required', error: { code: 'ATTACHMENT_NOT_CONFIRMED', definitive: true } })
      expect((await f.h.threads.get(f.task.id))?.turns).toHaveLength(0)
      const receive = f.call('attachment.receive', { transferId: 'f12f7b7d-bb12-4779-bf43-456205a1d496', name: 'guest.png', mimeType: 'image/png', size: 100, sha256: 'a'.repeat(64) }, 'native_receive')
      await expect(f.facade.execute(f.actor, receive)).rejects.toThrow('FILE_TRANSFER_REQUIRED')
      await f.facade.files.start(f.actor, receive)
      expect((await f.facade.files.finish(f.actor, receive, { attachment: { id: native.id } })).receipt.status).toBe('applied')
      const first = await f.invoke('code.turn.start', params, 'single_send')
      expect(first.receipt.status).toBe('applied')
      expect(await f.invoke('code.turn.start', params, 'single_send')).toEqual(first)
      expect((await f.invoke('request.get', { requestId: 'single_send' })).receipt).toEqual(first.receipt)
      const queued = await f.invoke('execution.queue.enqueue', { ...params, text: 'queued with file' }, 'queue')
      expect(queued.receipt.status).toBe('applied')
      const queue = await f.invoke('execution.queue.list', { threadId: f.task.id })
      const update = { threadId: f.task.id, turnId: queued.receipt.result.turnId, expectedRevision: queue.revision,
        text: 'edited with file', attachmentIds: [unknown.id] }
      expect((await f.invoke('execution.queue.update', update, 'bad_edit')).receipt.error?.code).toBe('ATTACHMENT_NOT_CONFIRMED')
      expect((await f.invoke('execution.queue.list', { threadId: f.task.id })).items[0].text).toBe('queued with file')
      expect((await f.invoke('execution.queue.update', { ...update, attachmentIds: [native.id] }, 'good_edit')).receipt.status).toBe('applied')
      const final = await f.invoke('execution.queue.list', { threadId: f.task.id })
      expect(final.items[0]).toMatchObject({ text: 'edited with file', attachmentIds: [native.id] })
      expect((await f.h.threads.get(f.task.id))?.turns).toHaveLength(2)
      const artifacts = await f.invoke('artifact.list', { resource: { kind: 'code', id: f.task.id } })
      expect(artifacts.artifacts).toContainEqual(expect.objectContaining({ attachmentId: native.id, name: 'guest.png' }))
      const history = await f.invoke('code.history', { threadId: f.task.id })
      expect(JSON.stringify(history)).toContain(native.id)
      expect(JSON.stringify(history)).not.toContain(f.root)
      expect((await f.store.list('remote_attachment_admission')).length).toBe(0)
    } finally { await f.close() }
  })
  it('keeps file stages behind runtime authentication, derives the task server-side and returns only scoped binary bytes', async () => {
    const f = await shareFixture()
    try {
      const attachments = new FileAttachmentStore({ rootDir: join(f.root, 'attachments'), config: AttachmentsCapabilityConfig.parse({ enabled: true }) })
      f.runtime.attachmentStore = attachments
      const native = await attachments.create({ name: 'safe.png', data: png(2, 2), mimeType: 'image/png', threadId: f.task.id })
      registerSharedTaskRoutes(f.router, f.runtime)
      async function request(stage: string, body: unknown, authenticated = true) {
        const path = '/v1/remote/shares/' + stage, route = f.router.match('POST', path)!
        return route.handler(new Request('http://runtime' + path, { method: 'POST', headers: {
          ...(authenticated ? { Authorization: 'Bearer token' } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), { params: route.params })
      }
      const call = f.call('attachment.receive', { transferId: 'b274434f-d30e-4b4e-a9a4-c4fd593cb1de', name: 'safe.png', mimeType: 'image/png', size: 100, sha256: 'a'.repeat(64) })
      expect((await request('file-start', { actor: f.actor, call }, false)).status).toBe(401)
      const started = await request('file-start', { actor: f.actor, call })
      expect(started.status).toBe(200)
      const startedValue = started instanceof Response ? await started.json() : JSON.parse(started.body)
      expect(startedValue).toEqual({ started: true, threadId: f.task.id })
      const finished = await request('file-finish', { actor: f.actor, call, result: { attachment: { id: native.id } } })
      expect(finished.status).toBe(200)
      const content = await request('file-content', { actor: f.actor, params: { threadId: f.task.id, attachmentId: native.id } })
      expect(content).toBeInstanceOf(Response)
      if (!(content instanceof Response)) throw new Error('BINARY_RESPONSE_REQUIRED')
      expect(Buffer.from(await content.arrayBuffer())).toEqual(png(2, 2))
      expect(content.headers.get('X-Kun-File-Name')).toBe('safe.png')
      const wrong = await request('file-content', { actor: f.actor, params: { threadId: f.other.id, attachmentId: native.id } })
      expect(wrong.status).toBe(400)
      const invalid = await request('file-content', { actor: { ...f.actor, sessionId: 'forged' }, params: { threadId: f.task.id, attachmentId: native.id } })
      expect(invalid.status).toBe(400)
    } finally { await f.close() }
  })
})
