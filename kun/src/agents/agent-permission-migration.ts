import type { Room } from '../contracts/rooms.js'
import { RoomStoreConflictError, type RoomStore } from '../rooms/room-store.js'
import { defaultAgentExecutionPolicy } from './agent-permission-snapshot.js'

/**
 * Migrate room defaults only. Accepted requests, turns and run snapshots retain
 * their exact authority, including historical explicit full-access grants.
 * CAS protects a concurrent user permission choice; a later initialization
 * retries any interrupted migration before recording the completion marker.
 */
export async function migrateAgentPermissions(store: RoomStore): Promise<void> {
  const marker = 'private-permissions-restricted-v1'
  if (await store.get('agent_bootstrap', marker)) return
  let afterSeq = 0
  for (;;) {
    const rows = await store.list<Room>('room', {
      conversationKind: 'user_agent', afterSeq, order: 'asc', includeArchived: true, limit: 50
    })
    for (const row of rows) {
      if (row.value.privateExecutionPolicy !== undefined) continue
      const now = new Date().toISOString()
      try {
        await store.commit({
          requestId: `${marker}:${row.id}:${row.revision}`,
          checks: [{ kind: 'room', id: row.id, expectedRevision: row.revision }],
          puts: [{ kind: 'room', id: row.id, roomId: row.id, value: {
            ...row.value, privateExecutionPolicy: defaultAgentExecutionPolicy(),
            revision: row.revision + 1, updatedAt: now
          } }],
          events: [{ roomId: row.id, kind: 'room.updated', payload: { id: row.id } }]
        })
      } catch (error) {
        if (!(error instanceof RoomStoreConflictError)) throw error
        const current = await store.get<Room>('room', row.id)
        if (current && current.value.privateExecutionPolicy === undefined) throw error
      }
    }
    if (rows.length < 50) break
    afterSeq = rows.at(-1)!.seq
  }
  await store.commit({ requestId: marker,
    checks: [{ kind: 'agent_bootstrap', id: marker, expectedRevision: null }],
    puts: [{ kind: 'agent_bootstrap', id: marker, value: { completedAt: new Date().toISOString() } }]
  })
}
