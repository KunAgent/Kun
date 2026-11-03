import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { shareFixture } from './guest.test-support.js'
import { SharedTaskFiles, sharedAttachmentKey } from './files.js'
import { SharedTaskReceipts } from './receipts.js'
import { FileAttachmentStore } from '../../attachments/attachment-store.js'
import { AttachmentsCapabilityConfig } from '../../contracts/capabilities.js'
import { png } from '../../../tests/support/attachment-store-fixtures.js'
import { makeUserItem } from '../../domain/item.js'
import type { TurnItem } from '../../contracts/items.js'
import { attachmentAdmissionKey } from '../files/admissions.js'
import type { ShareActor } from './contracts.js'
async function fixture() {
  const f = await shareFixture(), receipts = new SharedTaskReceipts(f.runtime), files = new SharedTaskFiles(f.runtime, f.journal, receipts)
  const attachments = new FileAttachmentStore({ rootDir: join(f.root, 'attachments'), config: AttachmentsCapabilityConfig.parse({ enabled: true }) })
  f.runtime.attachmentStore = attachments; f.h.turns['deps'].attachmentStore = () => attachments
  const attachment = await attachments.create({ name: 'image.png', data: png(2, 2), mimeType: 'image/png', threadId: f.task.id })
  const receive = (id = 'receive') => f.call('attachment.receive', { transferId: '23adbe3a-90d0-4473-9f33-97c87673dd5a',
    name: 'image.png', mimeType: 'image/png', size: 128, sha256: 'a'.repeat(64) }, id)
  async function nativeReference(id: string, threadId = f.task.id) {
    const turn = await f.h.turns.startTurn({ threadId, request: { prompt: 'published', clientSurface: 'gui' } })
    await f.h.sessionStore.appendItem(threadId, makeUserItem({ id: 'attachment_' + id, threadId, turnId: turn.turnId,
      text: 'published attachment', attachmentIds: [id] }))
    return turn
  }
  return { ...f, files, receipts, attachments, attachment, receive, nativeReference,
    list: (actor = f.actor, cursor?: string, limit?: number) => files.list(actor, { resource: { kind: 'code', id: f.task.id }, cursor, limit }) }
}
describe('shared task file custody and Manager receipts', () => {
  it('rejects guessed metadata/workspace and personal proofs while allowing a real public task reference', async () => {
    const f = await fixture()
    try {
      const personalKey = attachmentAdmissionKey({ accountId: f.actor.guestAccountId }, f.attachment.id)
      await f.store.commit({ requestId: 'personal-proof', checks: [{ kind: 'remote_attachment_admission', id: personalKey, expectedRevision: null }],
        puts: [{ kind: 'remote_attachment_admission', id: personalKey, value: { attachmentId: f.attachment.id } }] })
      await expect(f.files.assertInputs(f.actor, f.task.id, [f.attachment.id])).rejects.toThrow('ATTACHMENT_NOT_CONFIRMED')
      await expect(f.files.content(f.actor, { threadId: f.task.id, attachmentId: f.attachment.id })).rejects.toThrow('ATTACHMENT_NOT_CONFIRMED')
      await f.nativeReference(f.attachment.id, f.other.id)
      await expect(f.files.assertInputs(f.actor, f.task.id, [f.attachment.id])).rejects.toThrow('ATTACHMENT_NOT_CONFIRMED')
      await f.nativeReference(f.attachment.id)
      await f.files.assertInputs(f.actor, f.task.id, [f.attachment.id])
      expect((await f.files.content(f.actor, { threadId: f.task.id, attachmentId: f.attachment.id })).data).toEqual(png(2, 2))
      await expect(f.files.content(f.actor, { threadId: f.other.id, attachmentId: f.attachment.id })).rejects.toThrow('SHARE_RESOURCE_NOT_ALLOWED')
      expect(await f.store.list('shared_attachment')).toEqual([])
    } finally { await f.close() }
  })
  it('settles native receive and the member-scoped proof atomically, without private metadata in receipts', async () => {
    const f = await fixture()
    try {
      const call = f.receive(), commit = f.store.commit.bind(f.store), seen: any[] = []
      vi.spyOn(f.store, 'commit').mockImplementation(async (value, fence) => { seen.push(value); return commit(value, fence) })
      expect(await f.files.start(f.actor, call)).toEqual({ started: true, threadId: f.task.id })
      await expect(f.files.assertInputs(f.actor, f.task.id, [f.attachment.id])).rejects.toThrow('ATTACHMENT_NOT_CONFIRMED')
      const result = await f.files.finish(f.actor, call, { attachment: { ...f.attachment, localFilePath: '/private/phone.png', documentText: 'SECRET_DOC',
        textFallback: { dataBase64: 'SECRET_BYTES' } } })
      expect(result.receipt).toMatchObject({ status: 'applied', result: { attachment: { id: f.attachment.id, byteSize: f.attachment.byteSize } } })
      expect(seen.at(-1).puts.map((p: any) => p.kind)).toEqual(['shared_receipt', 'shared_attachment'])
      for (const hidden of ['localFilePath', 'documentText', 'textFallback', 'workspaces', 'threadIds', 'SECRET']) expect(JSON.stringify(result)).not.toContain(hidden)
      await f.files.assertInputs(f.actor, f.task.id, [f.attachment.id])
      expect((await f.files.start(f.actor, { ...call, expiresAt: call.expiresAt + 1000 })).receipt).toEqual(result.receipt)
      const sibling = { ...f.actor, deviceId: 'second_phone', sessionId: 'second_session', expiresAt: f.actor.expiresAt + 1 }
      await f.journal.admit(sibling)
      await f.files.assertInputs(sibling, f.task.id, [f.attachment.id])
      const other = { ...sibling, memberId: 'other_member', guestAccountId: 'other_guest' }
      await f.journal.admit(other)
      await expect(f.files.assertInputs(other, f.task.id, [f.attachment.id])).rejects.toThrow('ATTACHMENT_NOT_CONFIRMED')
    } finally { await f.close() }
  })
  it('does not grant an input when the final Manager transaction fails, and never redoes accepted native work', async () => {
    const f = await fixture()
    try {
      const call = f.receive(), commit = f.store.commit.bind(f.store)
      await f.files.start(f.actor, call)
      const failure = vi.spyOn(f.store, 'commit').mockImplementation(async (value, fence) => {
        if (value.puts?.some((put) => put.kind === 'shared_attachment')) throw new Error('manager unavailable')
        return commit(value, fence)
      })
      await expect(f.files.finish(f.actor, call, { attachment: f.attachment })).rejects.toThrow('manager unavailable')
      expect(await f.store.get('shared_attachment', sharedAttachmentKey(f.actor, f.task.id, f.attachment.id))).toBeNull()
      expect((await f.files.start(f.actor, call)).receipt?.status).toBe('reconciliation_required')
      await expect(f.files.assertInputs(f.actor, f.task.id, [f.attachment.id])).rejects.toThrow('ATTACHMENT_NOT_CONFIRMED')
      failure.mockRestore()
      expect((await f.files.finish(f.actor, call, { attachment: f.attachment })).receipt?.status).toBe('applied')
      await expect(f.files.start(f.actor, { ...call, params: { ...call.params, name: 'different' } })).rejects.toThrow('REQUEST_CONFLICT')
    } finally { await f.close() }
  })
  it('requires a real native thread binding and an existing start receipt; body metadata cannot create authority', async () => {
    const f = await fixture()
    try {
      const wrong = await f.attachments.create({ name: 'wrong.png', data: png(3, 3), mimeType: 'image/png', threadId: f.other.id })
      await expect(f.files.finish(f.actor, f.receive(), { attachment: f.attachment })).rejects.toThrow('RECEIPT_REQUIRED')
      await f.files.start(f.actor, f.receive())
      await expect(f.files.finish(f.actor, f.receive(), { attachment: { ...wrong, threadIds: [f.task.id] } })).rejects.toThrow('FILE_NOT_ALLOWED')
      expect((await f.receipts.get(f.actor, 'receive'))?.status).toBe('reconciliation_required')
      expect(await f.store.list('shared_attachment')).toEqual([])
    } finally { await f.close() }
  })
  it('fences late finish after revoke or membership-version change, but keeps proofs across unrelated share epochs', async () => {
    const f = await fixture()
    try {
      await f.files.start(f.actor, f.receive())
      const epoch = { ...f.actor, shareVersion: 2, expiresAt: f.actor.expiresAt + 1 }
      await f.journal.admit(epoch)
      await f.files.finish(epoch, f.receive(), { attachment: f.attachment })
      await f.files.assertInputs(epoch, f.task.id, [f.attachment.id])
      const next = { ...epoch, memberVersion: 2, shareVersion: 3, expiresAt: f.actor.expiresAt + 2 }
      await f.journal.admit(next)
      await expect(f.files.assertInputs(next, f.task.id, [f.attachment.id])).rejects.toThrow('ATTACHMENT_NOT_CONFIRMED')
      const late = f.receive('late')
      await f.files.start(next, late)
      const newer = { ...next, memberVersion: 3, shareVersion: 4, expiresAt: f.actor.expiresAt + 3 }
      await f.journal.admit(newer)
      await expect(f.files.finish(newer, late, { attachment: f.attachment })).rejects.toThrow('SHARE_AUTHORIZATION_STALE')
      await f.journal.fence(f.owner, 'share', undefined, newer.sessionId)
      await expect(f.files.finish(newer, late, { attachment: f.attachment })).rejects.toThrow('SHARE_AUTHORIZATION_STALE')
    } finally { await f.close() }
  })
  it('hides foreign queued attachments, pages actual references and rejects forged or stale file cursors', async () => {
    const f = await fixture()
    try {
      await f.nativeReference(f.attachment.id)
      const hidden = await f.attachments.create({ name: 'PRIVATE_QUEUED.png', data: png(3, 3), mimeType: 'image/png', threadId: f.task.id })
      const queued = await f.h.turns.enqueueTurn({ threadId: f.task.id, request: { prompt: 'queued', clientSurface: 'api', attachmentIds: [hidden.id] } })
      const listed = await f.list()
      expect(listed.artifacts.some((file) => file.attachmentId === f.attachment.id)).toBe(true)
      expect(JSON.stringify(listed)).not.toContain(hidden.id); expect(JSON.stringify(listed)).not.toContain('PRIVATE_QUEUED')
      await expect(f.files.assertInputs(f.actor, f.task.id, [hidden.id])).rejects.toThrow('ATTACHMENT_NOT_CONFIRMED')
      const first = await f.list(f.actor, undefined, 1)
      expect(first.artifacts).toHaveLength(1)
      if (first.nextCursor) {
        const other: ShareActor = { ...f.actor, memberId: 'other', guestAccountId: 'other', deviceId: 'otherphone', sessionId: 'other_session' }
        await f.journal.admit(other)
        await expect(f.list(other, first.nextCursor)).rejects.toThrow('INVALID_CURSOR')
      }
      await expect(f.list(f.actor, 'forged')).rejects.toThrow('INVALID_CURSOR')
      expect(queued.turnId).toBeTruthy()
    } finally { await f.close() }
  })
  it('exports only listed artifacts from this task, binds handles to members and revalidates the exact bytes at finish', async () => {
    const f = await fixture()
    try {
      const turn = await f.h.turns.startTurn({ threadId: f.task.id, request: { prompt: 'generate', clientSurface: 'gui' } })
      await writeFile(join(f.root, 'report.txt'), 'published report')
      await f.h.sessionStore.appendItem(f.task.id, { id: 'artifact_item', turnId: turn.turnId, threadId: f.task.id,
        kind: 'tool_result', role: 'tool', status: 'completed', createdAt: new Date().toISOString(), callId: 'call', toolName: 'write',
        output: { generatedFiles: [{ path: 'report.txt' }] } } as TurnItem)
      const listed = await f.list(), file = listed.artifacts.find((entry) => entry.name === 'report.txt')!
      expect(file).toBeTruthy(); expect(JSON.stringify(listed)).not.toContain(f.root)
      const params = { threadId: f.task.id, artifactId: file.id }, call = f.call('attachment.export', params, 'export')
      const data = await f.files.content(f.actor, params)
      const other = { ...f.actor, memberId: 'other', guestAccountId: 'other', sessionId: 'other_session' }
      await f.journal.admit(other)
      await expect(f.files.content(other, params)).rejects.toThrow('REFRESH_HISTORY')
      await f.files.start(f.actor, call)
      const result = { transferId: 'cd1beb03-73aa-460c-abeb-70a3d4e7ec2a', name: data.name, mimeType: data.mimeType,
        size: data.data.length, sha256: createHash('sha256').update(data.data).digest('hex') }
      await expect(f.files.finish(f.actor, call, { ...result, size: result.size + 1 })).rejects.toThrow('FILE_INTEGRITY')
      expect((await f.files.finish(f.actor, call, result)).receipt?.status).toBe('applied')
      await writeFile(join(f.root, 'report.txt'), 'changed later')
      expect((await f.files.start(f.actor, call)).receipt?.status).toBe('applied')
      const second = f.call('attachment.export', params, 'second_export')
      await f.files.start(f.actor, second)
      await f.h.sessionStore.appendItem(f.task.id, makeUserItem({ id: 'new_item', turnId: turn.turnId, threadId: f.task.id, text: 'replacement boundary' }))
      const oldVersion = f.runtime.sessionStore.itemHistoryVersion!.bind(f.runtime.sessionStore)
      vi.spyOn(f.runtime.sessionStore, 'itemHistoryVersion').mockImplementation(async (id) => 'replaced-' + await oldVersion(id))
      await expect(f.files.content(f.actor, params)).rejects.toThrow('REFRESH_HISTORY')
    } finally { await f.close() }
  })
  it('keeps read-only visitors from receiving files and rejects extra path or namespace fields', async () => {
    const f = await fixture()
    try {
      await f.nativeReference(f.attachment.id)
      const actor = { ...f.actor, mode: 'read' as const, memberVersion: 2, shareVersion: 2, expiresAt: f.actor.expiresAt + 1 }
      await f.journal.admit(actor)
      expect((await f.files.content(actor, { threadId: f.task.id, attachmentId: f.attachment.id })).data).toEqual(png(2, 2))
      await expect(f.files.start(actor, f.receive())).rejects.toThrow('SHARE_READ_ONLY')
      await expect(f.files.start(actor, f.call('attachment.export', { threadId: f.task.id, attachmentId: f.attachment.id, path: '/private' }))).rejects.toThrow()
      await expect(f.files.list(actor, { resource: { kind: 'code', id: f.other.id } })).rejects.toThrow('SHARE_RESOURCE_NOT_ALLOWED')
      await expect(f.files.list(actor, { resource: { kind: 'agent', id: f.task.id } })).rejects.toThrow()
      expect(await f.store.list('shared_receipt', { taskId: 'share' })).toEqual([])
    } finally { await f.close() }
  })
  it('admits an external file only once under concurrent delivery and keeps its unknown result after runtime replacement', async () => {
    const f = await fixture()
    try {
      const call = f.receive(), results = await Promise.all([f.files.start(f.actor, call), f.files.start(f.actor, call)])
      expect(results.filter((result) => result.started)).toHaveLength(1)
      expect(results.find((result) => result.receipt)?.receipt?.status).toBe('reconciliation_required')
      const restarted = new SharedTaskFiles(f.runtime, f.journal, new SharedTaskReceipts(f.runtime))
      expect((await restarted.start(f.actor, call)).receipt?.status).toBe('reconciliation_required')
      expect((await f.store.list('shared_receipt', { taskId: 'share' })).filter((row) => (row.value as any).requestId === call.requestId)).toHaveLength(1)
    } finally { await f.close() }
  })
  it('does not disclose a private name or timestamp when native content-addressed storage deduplicates a new guest upload', async () => {
    const f = await fixture()
    try {
      const old = new FileAttachmentStore({ rootDir: join(f.root, 'attachments'), config: AttachmentsCapabilityConfig.parse({ enabled: true }),
        nowIso: () => '2001-01-01T00:00:00.000Z' })
      const privateFile = await old.create({ name: 'PRIVATE_CONTRACT_2001.png', data: png(5, 5), mimeType: 'image/png', threadId: f.other.id })
      const native = await f.attachments.create({ name: 'my-upload.png', data: png(5, 5), mimeType: 'image/png', threadId: f.task.id })
      expect(native.name).toBe(privateFile.name)
      const call = f.receive('deduplicated')
      call.params.name = 'my-upload.png'
      await f.files.start(f.actor, call)
      const result = await f.files.finish(f.actor, call, { attachment: { id: native.id } })
      const received = result.receipt.result as { attachment: { name: string; createdAt: string; updatedAt: string } }
      expect(received.attachment).toMatchObject({ name: 'my-upload.png', createdAt: new Date(result.receipt.createdAt).toISOString(),
        updatedAt: new Date(result.receipt.createdAt).toISOString() })
      expect(JSON.stringify(result)).not.toContain('PRIVATE_CONTRACT'); expect(JSON.stringify(result)).not.toContain('2001-01-01')
      expect((await f.files.content(f.actor, { threadId: f.task.id, attachmentId: native.id })).name).toBe('my-upload.png')
      await f.nativeReference(native.id)
      expect((await f.list()).artifacts.find((entry) => entry.attachmentId === native.id)?.name).toBe('my-upload.png')
      const peer = { ...f.actor, memberId: 'other_member', guestAccountId: 'other_guest', sessionId: 'other_session' }
      await f.journal.admit(peer)
      expect((await f.list(peer)).artifacts.find((entry) => entry.attachmentId === native.id)?.name).toBe('attachment.png')
      expect((await f.files.content(peer, { threadId: f.task.id, attachmentId: native.id })).name).toBe('attachment.png')
      expect(await f.files.inputAliases(f.actor, f.task.id, [native.id])).toEqual([{ attachmentId: native.id, displayName: 'my-upload.png', mimeType: native.mimeType, byteSize: native.byteSize }])
      expect(await f.files.inputAliases(peer, f.task.id, [native.id])).toEqual([{ attachmentId: native.id, displayName: 'attachment.png', mimeType: native.mimeType, byteSize: native.byteSize }])
    } finally { await f.close() }
  })
  it('builds aliases only after actual shared authorization and removes all path syntax from the declared name', async () => {
    const f = await fixture()
    try {
      await expect(f.files.inputAliases(f.actor, f.task.id, [f.attachment.id])).rejects.toThrow('ATTACHMENT_NOT_CONFIRMED')
      const call = f.receive('safe_alias'); call.params.name = 'C:\\private\\guest-photo.png'
      await f.files.start(f.actor, call); await f.files.finish(f.actor, call, { attachment: { id: f.attachment.id } })
      expect(await f.files.inputAliases(f.actor, f.task.id, [f.attachment.id])).toEqual([{ attachmentId: f.attachment.id,
        displayName: 'guest-photo.png', mimeType: f.attachment.mimeType, byteSize: f.attachment.byteSize }])
      await expect(f.files.inputAliases(f.actor, f.other.id, [f.attachment.id])).rejects.toThrow('SHARE_RESOURCE_NOT_ALLOWED')
      await f.journal.fence(f.owner, f.actor.shareId, undefined, f.actor.sessionId)
      await expect(f.files.inputAliases(f.actor, f.task.id, [f.attachment.id])).rejects.toThrow('SHARE_AUTHORIZATION_STALE')
    } finally { await f.close() }
  })
})
