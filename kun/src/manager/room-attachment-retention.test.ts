import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Jimp } from 'jimp'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_KUN_CAPABILITIES_CONFIG } from '../contracts/capabilities.js'
import type { AttachmentMetadata } from '../contracts/attachments.js'
import { RoomMessageSchema } from '../contracts/rooms.js'
import { recordRoomAvatarAsset } from '../rooms/room-avatar-service.js'
import { ManagerSharedDataStore } from './shared-data-store.js'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
const config = DEFAULT_KUN_CAPABILITIES_CONFIG.attachments
const expiration = '2999-01-01T00:00:00.000Z'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-room-attachment-retention-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const store = await ManagerSharedDataStore.create(root)
  cleanup.push(() => store.close())
  const call = (operation: Parameters<typeof store.executeAttachment>[0], value: unknown) =>
    store.executeAttachment(operation, { config, value })
  const text = async (name: string, leaseId: string): Promise<AttachmentMetadata> => call('create', {
    name: `${name}.txt`, mimeType: 'text/plain', dataBase64: Buffer.from(name).toString('base64'), documentText: name, leaseId
  }) as Promise<AttachmentMetadata>
  const prune = () => call('pruneExpiredLeases', { referencedIds: [], expiresBeforeIso: expiration })
  return { store, call, text, prune }
}

describe('Manager room-owned attachment retention', () => {
  it('preserves a deduplicated avatar when an old composer lease is released with referenced=false', async () => {
    const f = await fixture()
    const data = await new Jimp({ width: 128, height: 128, color: 0x3388ffff }).getBuffer('image/jpeg')
    const original = await f.call('create', { name: 'original-photo.jpg', mimeType: 'image/jpeg',
      dataBase64: data.toString('base64'), leaseId: 'old-composer-lease' }) as AttachmentMetadata
    // Older runtimes persisted JPEG uploads without dimensions. Exercise the
    // same content-addressed record being promoted into a managed portrait.
    await f.call('replaceMetadata', { ...original, width: undefined, height: undefined })
    const avatar = await f.call('create', { name: 'normalized-avatar.jpg', mimeType: 'image/jpeg',
      dataBase64: data.toString('base64'), leaseId: 'fresh-avatar-upload-lease' }) as AttachmentMetadata
    expect(avatar.id).toBe(original.id)
    expect(avatar).toMatchObject({ width: 128, height: 128 })
    await recordRoomAvatarAsset(f.store.roomStore, avatar)
    expect(await f.store.roomStore.isAttachmentReferenced(avatar.id)).toBe(true)
    await f.call('releaseLease', { id: avatar.id, leaseId: 'fresh-avatar-upload-lease', referenced: true })
    await f.call('releaseLease', { id: avatar.id, leaseId: 'old-composer-lease', referenced: false })
    expect(await f.call('get', { id: avatar.id })).toMatchObject({ id: avatar.id, hash: avatar.hash })
    expect(await f.prune()).toMatchObject({ deleted: 0 })
    const content = await f.call('resolveContent', { id: avatar.id, scope: {} }) as { dataBase64: string }
    expect(Buffer.from(content.dataBase64, 'base64')).toEqual(data)
  })

  it('keeps expired pending avatar leases through pruning while deleting ordinary unreferenced uploads', async () => {
    const f = await fixture()
    const data = await new Jimp({ width: 128, height: 128, color: 0x66bb88ff }).getBuffer('image/jpeg')
    const avatar = await f.call('create', { name: 'avatar.jpg', mimeType: 'image/jpeg',
      dataBase64: data.toString('base64'), leaseId: 'expired-avatar-lease' }) as AttachmentMetadata
    await recordRoomAvatarAsset(f.store.roomStore, avatar)
    const orphan = await f.text('ordinary-unreferenced-expired-file', 'expired-orphan-lease')
    expect(await f.store.roomStore.isAttachmentReferenced(orphan.id)).toBe(false)
    expect(await f.prune()).toMatchObject({ deleted: 1, released: 2 })
    expect(await f.call('get', { id: avatar.id })).toMatchObject({ id: avatar.id })
    expect(await f.call('get', { id: orphan.id })).toBeNull()
  })

  it('retains both structured references and legacy attachment IDs in public room messages', async () => {
    const f = await fixture()
    const structured = await f.text('structured-reference-content', 'structured-reference-lease')
    const legacy = await f.text('legacy-message-content', 'legacy-message-lease')
    const orphan = await f.text('another-unreferenced-file', 'another-orphan-lease')
    const message = RoomMessageSchema.parse({ id: 'public-message', roomId: 'room', messageSeq: 1,
      authorKind: 'user', authorLabelSnapshot: 'User', body: 'Keep these sources.', bodyRevision: 0,
      mentionMemberIds: [], attachmentIds: [legacy.id],
      references: [{ kind: 'attachment', attachmentId: structured.id }], createdAt: '2026-09-13T00:00:00.000Z' })
    await f.store.roomStore.commit({ requestId: 'publish-reference', checks: [{ kind: 'message', id: message.id, expectedRevision: null }],
      puts: [{ kind: 'message', id: message.id, roomId: message.roomId, value: message }] })
    expect(await f.store.roomStore.isAttachmentReferenced(structured.id)).toBe(true)
    expect(await f.store.roomStore.isAttachmentReferenced(legacy.id)).toBe(true)
    await f.call('releaseLease', { id: structured.id, leaseId: 'structured-reference-lease', referenced: false })
    expect(await f.call('get', { id: structured.id })).toMatchObject({ id: structured.id })
    expect(await f.prune()).toMatchObject({ deleted: 1 })
    expect(await f.call('get', { id: legacy.id })).toMatchObject({ id: legacy.id })
    expect(await f.call('get', { id: orphan.id })).toBeNull()
    expect(await f.call('resolveContent', { id: structured.id, scope: {} })).toMatchObject({
      dataBase64: Buffer.from('structured-reference-content').toString('base64')
    })
  })
})
