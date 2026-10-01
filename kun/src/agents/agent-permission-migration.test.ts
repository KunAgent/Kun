import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { kunToolPermissionModeSettings } from '../contracts/policy.js'
import type { Room } from '../contracts/rooms.js'
import { migrateAgentPermissions } from './agent-permission-migration.js'

it('migrates only unset private room defaults and preserves explicit and admitted authority across restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-permission-migration-'))
  const path = join(root, 'rooms.sqlite')
  let store = new SqliteRoomStore({ path })
  try {
    const full = kunToolPermissionModeSettings('full-access')
    const legacy = { id: 'legacy', conversationKind: 'user_agent', revision: 0 }
    const explicit = { ...legacy, id: 'explicit', privateExecutionPolicy: full }
    const group = { id: 'group', conversationKind: 'group', revision: 0 }
    const accepted = { id: 'accepted', status: 'pending', roomSnapshot: { ...legacy, privateExecutionPolicy: full } }
    await store.commit({ requestId: 'seed', checks: [
      ...[legacy, explicit, group].map((room) => ({ kind: 'room' as const, id: room.id, expectedRevision: null })),
      { kind: 'request', id: accepted.id, expectedRevision: null }
    ], puts: [
      ...[legacy, explicit, group].map((room) => ({ kind: 'room' as const, id: room.id, roomId: room.id, value: room })),
      { kind: 'request', id: accepted.id, roomId: legacy.id, value: accepted }
    ] })
    await migrateAgentPermissions(store)
    expect(await store.get<Room>('room', 'legacy')).toMatchObject({ revision: 1, value: {
      privateExecutionPolicy: kunToolPermissionModeSettings('ask-for-approval')
    } })
    expect(await store.get('room', 'explicit')).toMatchObject({ revision: 0, value: explicit })
    expect(await store.get('room', 'group')).toMatchObject({ revision: 0, value: group })
    expect((await store.get('request', 'accepted'))?.value).toEqual(accepted)
    await store.close()
    store = new SqliteRoomStore({ path })
    await migrateAgentPermissions(store)
    expect((await store.get('room', 'legacy'))?.revision).toBe(1)
    expect((await store.get('request', 'accepted'))?.value).toEqual(accepted)
  } finally {
    await store.close()
    await rm(root, { recursive: true, force: true })
  }
})
