import { z } from 'zod'
import { createHash, randomUUID } from 'node:crypto'
import { RoomContentReferenceSchema, type RoomAvatarReference } from '../../contracts/room-content.js'
import type { RoomMessage } from '../../contracts/rooms.js'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import { resolveRoomContent } from '../../rooms/room-content-service.js'
import { listRoomContentOptions } from '../../rooms/room-content-options.js'
import { firstRoomBodyUrl, RoomLinkPreviewService } from '../../rooms/room-link-preview.js'
import { roomPreviewImage } from '../../rooms/room-preview-image.js'
import { getRoomAvatarImage, recordRoomAvatarAsset, validateRoomMemberAvatars } from '../../rooms/room-avatar-service.js'
import type { ServerRuntime } from './server-runtime.js'
import type { RouteContext } from '../router.js'
import { readJsonBody } from '../read-json-body.js'

type Add = (method: string, path: string, handle: (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown> | unknown) => void
const ContentQuery = z.object({ reference: z.string().max(8192), mode: z.enum(['summary', 'thumbnail', 'preview']).default('summary'),
  message_id: z.string().min(1).max(128).optional() }).strict()
const OptionsQuery = z.object({ kind: z.enum(['attachment', 'repository_file', 'task', 'delivery', 'board_card']),
  repository_id: z.string().min(1).max(128).optional(), query: z.string().max(200).default(''), cursor: z.string().max(2048).optional() }).strict()
const AvatarUpload = z.object({ name: z.string().max(200).optional(), mimeType: z.enum(['image/png', 'image/jpeg']),
  dataBase64: z.string().min(1).max(Math.ceil(2 * 1024 * 1024 / 3) * 4) }).strict()
const AvatarId = z.string().regex(/^att_[a-f0-9]{24}$/)
const query = (request: Request) => Object.fromEntries(new URL(request.url).searchParams)

export function registerRoomContentRoutes(add: Add, runtime: ServerRuntime): void {
  const links = new RoomLinkPreviewService()
  runtime.rooms?.service.setMemberAvatarValidator((members) => validateRoomMemberAvatars(runtime.rooms!.deps.store, runtime.attachmentStore, members))
  runtime.rooms?.service.setContentReferenceValidator(async (room, references) => {
    for (const reference of references) {
      const result = await resolveRoomContent(runtime, room, reference, 'summary', undefined, true)
      if (result.state !== 'available') throw new Error(`room reference unavailable: ${result.reason ?? reference.kind}`)
    }
  })
  const sourceUrl = async (rooms: RoomRuntime, roomId: string, messageId: string) => {
    await rooms.service.get(roomId)
    const message = await rooms.deps.store.get<RoomMessage>('message', messageId)
    if (!message || message.roomId !== roomId) throw new Error('message not found')
    if (message.value.status === 'streaming') return undefined
    return firstRoomBodyUrl(message.value.body)
  }
  add('GET', '/v1/rooms/:roomId/content', async (rooms, request, { params }) => {
    const input = ContentQuery.parse(query(request))
    let reference: unknown
    try { reference = JSON.parse(input.reference) } catch {
      return new Response(JSON.stringify({ code: 'validation_error', message: 'invalid content reference' }), { status: 400 })
    }
    return resolveRoomContent(runtime, await rooms.service.get(params.roomId), RoomContentReferenceSchema.parse(reference), input.mode, input.message_id)
  })
  add('GET', '/v1/rooms/:roomId/content-options', async (rooms, request, { params }) => {
    const input = OptionsQuery.parse(query(request))
    return listRoomContentOptions(runtime, await rooms.service.get(params.roomId), input.kind, input.repository_id, input.query, input.cursor)
  })
  add('GET', '/v1/rooms/:roomId/messages/:messageId/link-preview', async (rooms, _request, { params }) => {
    const url = await sourceUrl(rooms, params.roomId, params.messageId)
    return { preview: url ? await links.preview(url) : { state: 'none' } }
  })
  add('GET', '/v1/rooms/:roomId/messages/:messageId/link-preview/image', async (rooms, _request, { params }) => {
    const url = await sourceUrl(rooms, params.roomId, params.messageId)
    try { return { image: url ? await links.image(url) : undefined } }
    catch { return { reason: 'preview_unavailable' } }
  })
  add('POST', '/v1/rooms/avatars', async (rooms, request) => {
    if (!runtime.attachmentStore) throw new Error('avatar storage unavailable')
    const parsed = await readJsonBody(request, 3 * 1024 * 1024)
    if (!parsed.ok) return new Response(parsed.response.body, { status: parsed.response.status, headers: { 'content-type': 'application/json' } })
    const input = AvatarUpload.parse(parsed.value)
    let image: Awaited<ReturnType<typeof roomPreviewImage>>
    try {
      const data = Buffer.from(input.dataBase64, 'base64')
      if (data.length > 2 * 1024 * 1024 || data.toString('base64') !== input.dataBase64) throw new Error('invalid avatar image')
      image = await roomPreviewImage(data, 128, true)
    } catch {
      return new Response(JSON.stringify({ code: 'validation_error', message: 'unsupported or oversized avatar image' }), { status: 400 })
    }
    const normalized = Buffer.from(image.dataBase64, 'base64')
    const leaseId = `room-avatar:${randomUUID()}`
    const attachment = await runtime.attachmentStore.create({ name: `rooms-avatar-${createHash('sha256').update(normalized).digest('hex').slice(0, 12)}.jpg`,
      data: normalized, mimeType: image.mimeType, leaseId })
    await recordRoomAvatarAsset(rooms.deps.store, attachment)
    if (runtime.attachmentStore.releaseLease) await runtime.attachmentStore.releaseLease(attachment.id, leaseId, true).catch(() => undefined)
    return { avatar: { kind: 'uploaded', attachmentId: attachment.id } satisfies RoomAvatarReference, image }
  })
  add('GET', '/v1/rooms/avatars/:attachmentId', async (rooms, _request, { params }) => {
    const id = AvatarId.parse(params.attachmentId)
    try {
      return { image: await getRoomAvatarImage(rooms.deps.store, runtime.attachmentStore, id) }
    } catch { return { reason: 'avatar_unavailable' } }
  })
}
