import { z } from 'zod'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import { RoomSidebarQuery } from '../../contracts/room-sidebar.js'
import { RoomUserProfileSchema, UpdateRoomUserProfile } from '../../contracts/room-onboarding.js'
import { roomFingerprint } from '../../rooms/room-service.js'
import { RoomStoreConflictError } from '../../rooms/room-store.js'
import { validateRoomMemberAvatars } from '../../rooms/room-avatar-service.js'
import { RoomMemberSchema } from '../../contracts/rooms.js'
import type { ServerRuntime } from './server-runtime.js'
import { readJsonBody } from '../read-json-body.js'

type Add = (method: string, path: string, handler: (rooms: RoomRuntime, request: Request) => Promise<unknown>) => void
export function registerRoomProfileRoutes(add: Add, runtime: ServerRuntime) {
  add('GET', '/v1/rooms/sidebar', async (rooms, request) => {
    const p = new URL(request.url).searchParams
    const bool = (key: string) => z.enum(['true', 'false']).parse(p.get(key) ?? 'false') === 'true'
    return rooms.service.store.sidebarPage(RoomSidebarQuery.parse({ kind: p.get('kind') ?? undefined,
      search: p.get('search') ?? undefined, cursor: p.get('cursor') ?? undefined, limit: p.get('limit') ?? undefined,
      repositoryRoot: p.get('repository_root') ?? undefined, archivedOnly: bool('archived_only'),
      unreadOnly: bool('unread_only'), attentionOnly: bool('attention_only') }))
  })
  const detail = async (rooms: RoomRuntime) => {
    const row = await rooms.service.store.get('room_user_profile', 'self')
    return { profile: RoomUserProfileSchema.parse(row?.value ?? {}), revision: row?.revision ?? null }
  }
  add('GET', '/v1/rooms/user-profile', detail)
  add('PUT', '/v1/rooms/user-profile', async (rooms, request) => {
    const raw = await readJsonBody(request)
    if (!raw.ok) return raw.response
    const input = UpdateRoomUserProfile.parse(raw.value)
    return rooms.exclusive(async () => {
      const store = rooms.service.store, requestId = 'room-user-profile:' + input.clientRequestId, fingerprint = roomFingerprint(input)
      const previous = await store.getRequest(requestId)
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new RoomStoreConflictError('profile request changed')
        return detail(rooms)
      }
      await validateRoomMemberAvatars(store, runtime.attachmentStore, [RoomMemberSchema.parse({
        id: 'user', revision: 0, displayName: 'User', presetId: 'general', role: 'developer', avatar: input.avatar ?? undefined })])
      await store.commit({ requestId, fingerprint,
        checks: [{ kind: 'room_user_profile', id: 'self', expectedRevision: input.expectedRevision }],
        puts: [{ kind: 'room_user_profile', id: 'self', value: { avatar: input.avatar } }],
        events: [{ roomId: 'agent-directory', kind: 'presentation.user-profile.updated', payload: {} }] })
      return detail(rooms)
    })
  })
}
