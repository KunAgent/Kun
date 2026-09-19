import { createHash } from 'node:crypto'
import { RoomAvatarAssetSchema, type RoomAvatarAsset, type RoomAvatarReference, type RoomPreviewImage } from '../contracts/room-content.js'
import type { AttachmentMetadata } from '../contracts/attachments.js'
import type { AttachmentStore } from '../attachments/attachment-store.js'
import type { RoomStore } from './room-store.js'

export async function recordRoomAvatarAsset(store: RoomStore, metadata: AttachmentMetadata): Promise<void> {
  const asset = RoomAvatarAssetSchema.parse({ attachmentId: metadata.id, hash: metadata.hash,
    mimeType: metadata.mimeType, width: metadata.width, height: metadata.height,
    byteSize: metadata.byteSize, createdAt: metadata.createdAt })
  const previous = await store.get<RoomAvatarAsset>('room_avatar', asset.attachmentId)
  if (previous) {
    if (previous.value.hash !== asset.hash) throw new Error('avatar identity changed')
    return
  }
  await store.commit({ requestId: `room-avatar:${asset.attachmentId}`,
    checks: [{ kind: 'room_avatar', id: asset.attachmentId, expectedRevision: null }],
    puts: [{ kind: 'room_avatar', id: asset.attachmentId, value: asset }], result: { attachmentId: asset.attachmentId } })
}

async function verifiedAvatarMetadata(store: RoomStore, attachments: AttachmentStore | undefined, id: string) {
  if (!attachments) throw new Error('avatar storage unavailable')
  const marker = await store.get<RoomAvatarAsset>('room_avatar', id)
  const asset = marker ? RoomAvatarAssetSchema.safeParse(marker.value) : undefined
  if (!asset?.success || asset.data.attachmentId !== id) throw new Error('avatar unavailable')
  const metadata = await attachments.get(id)
  if (!metadata || metadata.hash !== asset.data.hash || metadata.mimeType !== asset.data.mimeType ||
    metadata.width !== 128 || metadata.height !== 128 || metadata.byteSize !== asset.data.byteSize) throw new Error('avatar unavailable')
  const scope = metadata.threadIds[0] ? { threadId: metadata.threadIds[0] }
    : metadata.workspaces[0] ? { workspace: metadata.workspaces[0] } : {}
  return { asset: asset.data, scope }
}
export async function validateRoomAvatarReferences(
  store: RoomStore, attachments: AttachmentStore | undefined,
  avatars: Array<RoomAvatarReference | null | undefined>
): Promise<void> {
  const ids = new Set(avatars.flatMap((avatar) => avatar?.kind === 'uploaded' ? [avatar.attachmentId] : []))
  for (const id of ids) await verifiedAvatarMetadata(store, attachments, id)
}
export async function validateRoomMemberAvatars(
  store: RoomStore, attachments: AttachmentStore | undefined,
  members: Array<{ avatar?: RoomAvatarReference | null }>
): Promise<void> {
  await validateRoomAvatarReferences(store, attachments, members.map((member) => member.avatar))
}
export async function getRoomAvatarImage(store: RoomStore, attachments: AttachmentStore | undefined, id: string): Promise<RoomPreviewImage> {
  const { asset, scope } = await verifiedAvatarMetadata(store, attachments, id)
  const content = await attachments!.resolveContent(id, scope)
  if (content.data.length !== asset.byteSize || createHash('sha256').update(content.data).digest('hex') !== asset.hash) {
    throw new Error('avatar content changed')
  }
  return { dataBase64: content.data.toString('base64'), mimeType: asset.mimeType, width: 128, height: 128 }
}
