import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { AttachmentMetadata } from '../contracts/attachments.js'
import type { AttachmentStore } from '../attachments/attachment-store.js'
import type { RoomStore, RoomStoreCommit } from './room-store.js'
import { defaultRoomMembers, RoomService } from './room-service.js'
import { getRoomAvatarImage, recordRoomAvatarAsset, validateRoomMemberAvatars } from './room-avatar-service.js'

function fixture() {
  const bytes = Buffer.from('canonical normalized JPEG bytes')
  const hash = createHash('sha256').update(bytes).digest('hex'), id = `att_${hash.slice(0, 24)}`
  const metadata: AttachmentMetadata = { id, hash, name: 'avatar.jpg', kind: 'image', mimeType: 'image/jpeg',
    width: 128, height: 128, byteSize: bytes.length, threadIds: [], workspaces: [],
    createdAt: '2026-09-13T00:00:00.000Z', updatedAt: '2026-09-13T00:00:00.000Z' }
  const records = new Map<string, unknown>()
  const store = { get: vi.fn(async (kind, id) => records.get(`${kind}:${id}`) ?? null), getRequest: vi.fn(async () => null),
    commit: vi.fn(async (input: RoomStoreCommit) => {
      for (const put of input.puts ?? []) records.set(`${put.kind}:${put.id}`, { ...put, revision: 0, seq: 1 })
      return { result: input.result }
    }) } as unknown as RoomStore
  const attachments = { get: vi.fn(async () => metadata),
    resolveContent: vi.fn(async () => ({ ...metadata, data: bytes })) } as unknown as AttachmentStore
  return { store, attachments, metadata, id, bytes }
}

describe('room avatar provenance', () => {
  it('does not accept an arbitrary 128px JPEG until the normalized upload receipt exists', async () => {
    const f = fixture()
    await expect(getRoomAvatarImage(f.store, f.attachments, f.id)).rejects.toThrow('avatar unavailable')
    expect(f.attachments.resolveContent).not.toHaveBeenCalled()
    await recordRoomAvatarAsset(f.store, f.metadata)
    expect(f.store.commit).toHaveBeenCalledWith(expect.objectContaining({
      requestId: `room-avatar:${f.id}`, puts: [expect.objectContaining({ kind: 'room_avatar', id: f.id,
        value: expect.objectContaining({ attachmentId: f.id, hash: f.metadata.hash }) })]
    }))
    expect(await getRoomAvatarImage(f.store, f.attachments, f.id)).toMatchObject({ width: 128, height: 128, dataBase64: f.bytes.toString('base64') })
    await recordRoomAvatarAsset(f.store, f.metadata)
    expect(f.store.commit).toHaveBeenCalledTimes(1)
  })
  it('verifies actual pixels against the receipt and tolerates later legitimate attachment binding', async () => {
    const f = fixture()
    await recordRoomAvatarAsset(f.store, f.metadata)
    f.metadata.threadIds.push('thread')
    await getRoomAvatarImage(f.store, f.attachments, f.id)
    expect(f.attachments.resolveContent).toHaveBeenCalledWith(f.id, { threadId: 'thread' })
    vi.mocked(f.attachments.resolveContent).mockResolvedValue({ ...f.metadata, data: Buffer.from('forged pixels') })
    await expect(getRoomAvatarImage(f.store, f.attachments, f.id)).rejects.toThrow('avatar content changed')
  })
  it('validates uploaded avatars before saving a new member while leaving builtin choices local', async () => {
    const f = fixture(), service = new RoomService(f.store, () => undefined)
    service.setMemberAvatarValidator((members) => validateRoomMemberAvatars(f.store, f.attachments, members))
    const members = defaultRoomMembers([]).map((member, index) => index ? member : { ...member, avatar: { kind: 'uploaded' as const, attachmentId: f.id } })
    await expect(service.create({ clientRequestId: 'room-invalid', name: 'Avatar room', members })).rejects.toThrow('avatar unavailable')
    expect(f.store.commit).not.toHaveBeenCalled()
    await recordRoomAvatarAsset(f.store, f.metadata)
    const created = await service.create({ clientRequestId: 'room-valid', name: 'Avatar room', members })
    expect(created.room.members[0].avatar).toEqual({ kind: 'uploaded', attachmentId: f.id })
  })
})
