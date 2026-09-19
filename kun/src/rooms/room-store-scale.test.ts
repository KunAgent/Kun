import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { SqliteRoomStore } from './room-store-sqlite.js'
import type { RoomStoreCommit } from './room-store.js'

it('pages 100 rooms, 100,000 messages and 2,000 historical tasks without returning complete history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-room-scale-'))
  let store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  try {
    for (let room = 0; room < 100; room += 1) {
      const roomId = `room-${room}`
      await store.commit({ requestId: `create-${roomId}`,
        checks: [{ kind: 'room', id: roomId, expectedRevision: null }],
        puts: [{ kind: 'room', id: roomId, value: { id: roomId, name: roomId } }] })
      const messages: NonNullable<RoomStoreCommit['puts']> = Array.from({ length: 1000 }, (_, index) => ({
        kind: 'message', id: `${roomId}-message-${index}`, roomId,
        value: { body: `Message ${index} ${'content '.repeat(12)}` }
      }))
      await store.commit({ requestId: `messages-${roomId}`,
        checks: messages.map(({ kind, id }) => ({ kind, id, expectedRevision: null })),
        puts: messages,
        events: messages.map(({ id }) => ({ roomId, kind: 'message_created', payload: { id } }))
      })
      const tasks: NonNullable<RoomStoreCommit['puts']> = Array.from({ length: 20 }, (_, index) => ({
        kind: 'task', id: `${roomId}-task-${index}`, roomId,
        value: { task: { status: 'completed', executionThreadId: `${roomId}-thread-${index}` } }
      }))
      await store.commit({ requestId: `tasks-${roomId}`,
        checks: tasks.map(({ kind, id }) => ({ kind, id, expectedRevision: null })), puts: tasks })
    }
    await store.close()
    store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
    expect(await store.list('room', { limit: 1000 })).toHaveLength(100)
    const roomPage = await store.listRooms({ limit: 50 })
    const nextRoomPage = await store.listRooms({ limit: 50, cursor: roomPage.nextCursor })
    expect(new Set([...roomPage.rooms, ...nextRoomPage.rooms].map(({ id }) => id)).size).toBe(100)
    expect(nextRoomPage.nextCursor).toBeUndefined()
    const latest = await store.list('message', { roomId: 'room-50' })
    expect(latest).toHaveLength(50)
    expect(latest[0].id).toBe('room-50-message-999')
    const older = await store.list('message', { roomId: 'room-50', beforeSeq: latest.at(-1)!.seq })
    expect(older).toHaveLength(50)
    expect(new Set([...latest, ...older].map(({ id }) => id)).size).toBe(100)
    expect(JSON.stringify(latest).length).toBeLessThan(30_000)
    expect(await store.list('task', { status: ['queued', 'running'], limit: 1000 })).toEqual([])
    expect(await store.list('task', { roomId: 'room-50', status: 'completed' })).toHaveLength(20)
    const replay = await store.events('room-50', 0, 50)
    expect(replay).toHaveLength(50)
    expect((await store.events('room-50', replay.at(-1)!.seq, 50))[0].seq).toBe(replay.at(-1)!.seq + 1)
  } finally {
    await store.close()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
