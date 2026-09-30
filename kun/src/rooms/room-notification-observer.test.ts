import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { RoomNotificationObserver } from './room-notification-observer.js'

it('durably projects private user gates once and ignores automatic reviews and other rooms', async () => {
  const root = await mkdtemp(join(tmpdir(), 'room-notification-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const threadStore = new InMemoryThreadStore()
  try {
    const thread = createThreadRecord({ id: 'thread', title: 'private', workspace: '/', model: 'm' })
    await threadStore.upsert({ ...thread, roomContext: { roomId: 'room', memberId: 'member', kind: 'conversation',
      blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: [] } })
    const observer = new RoomNotificationObserver({ threadStore, store })
    const event = { kind: 'approval_requested' as const, threadId: thread.id, turnId: 'turn', seq: 1,
      timestamp: new Date().toISOString(), approvalId: 'approval', toolName: 'write', status: 'pending' as const }
    await observer.record(event)
    await new RoomNotificationObserver({ threadStore, store }).record(event)
    await observer.record({ ...event, approvalId: 'automatic', approvalReviewer: 'agent' })
    expect(await store.events('room')).toMatchObject([{ kind: 'notification.requested',
      payload: { id: 'approval', threadId: thread.id, gateKind: 'approval' } }])
    await threadStore.upsert(thread)
    await observer.record({ ...event, approvalId: 'not-private' })
    expect(await store.events('room')).toHaveLength(1)
  } finally { await store.close(); await rm(root, { recursive: true, force: true }) }
})


it('reconciles a live gate after failed projection and a new observer without duplicating or resurrecting resolved gates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'room-notification-recovery-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const threadStore = new InMemoryThreadStore()
  try {
    const thread = createThreadRecord({ id: 'thread', title: 'private', workspace: '/', model: 'm' })
    await threadStore.upsert({ ...thread, roomContext: { roomId: 'room', memberId: 'member', kind: 'conversation',
      blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: [] } })
    const event = { kind: 'approval_requested' as const, threadId: thread.id, turnId: 'turn', seq: 1,
      timestamp: new Date().toISOString(), approvalId: 'approval', toolName: 'write', status: 'pending' as const }
    const observer = new RoomNotificationObserver({ threadStore, store })
    vi.spyOn(store, 'commit').mockRejectedValueOnce(new Error('temporary store failure'))
    await expect(observer.record(event)).rejects.toThrow('temporary')
    const gate = { id: event.approvalId, threadId: thread.id, turnId: 'turn', toolName: 'write',
      summary: 'Allow write', status: 'pending' as const, createdAt: event.timestamp }
    const gates = { approvals: { pending: () => [gate] }, inputs: { pending: () => [] } } as never
    const restarted = new RoomNotificationObserver({ threadStore, store })
    await restarted.reconcile(gates)
    await restarted.reconcile(gates)
    expect(await store.events('room')).toHaveLength(1)
    await restarted.reconcile({ approvals: { pending: () => [] }, inputs: { pending: () => [] } } as never)
    expect(await store.events('room')).toHaveLength(1)
  } finally { await store.close(); await rm(root, { recursive: true, force: true }) }
})
