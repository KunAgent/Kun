import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { ThreadService } from './thread-service.js'

async function fixture() {
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const nowIso = () => '2026-09-12T00:00:00.000Z'
  const events = new RuntimeEventRecorder({ eventBus, sessionStore,
    allocateSeq: (id) => eventBus.allocateSeq(id), nowIso })
  const service = new ThreadService({ threadStore, sessionStore, events,
    ids: new SequentialIdGenerator(), nowIso })
  const roomThread = await service.create({ workspace: '/room-task', title: 'Room task',
    model: 'test', mode: 'agent', approvalPolicy: 'always', sandboxMode: 'workspace-write'
  }, { relation: 'side', roomContext: { roomId: 'room_one', taskId: 'task_one', memberId: 'member_one',
    kind: 'execution', blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: [] } })
  return { service, threadStore, roomThread }
}

describe('room-managed thread lifecycle guards', () => {
  it('rejects workspace and policy expansion while allowing display metadata changes', async () => {
    const { service, roomThread } = await fixture()
    const changes: Array<Parameters<ThreadService['update']>[1]> = [
      { workspace: '/other' }, { additionalWorkspaces: ['/other'] },
      { knowledgeBases: [{ id: 'kb', root: '/other', name: 'Outside', access: 'read-only', source: 'write-workspace' }] },
      { sandboxMode: 'danger-full-access' }, { approvalPolicy: 'auto' }, { mode: 'plan' },
      { status: 'archived' }, { relation: 'primary' }
    ]
    for (const patch of changes) await expect(service.update(roomThread.id, patch)).rejects.toThrow('policy is frozen')
    expect((await service.update(roomThread.id, { title: 'Renamed', pinned: true })).title).toBe('Renamed')
    expect((await service.getMetadata(roomThread.id))?.roomContext).toEqual(roomThread.roomContext)
  })

  it('retains evidence through direct deletion and skips room threads during workspace deletion', async () => {
    const { service, roomThread } = await fixture()
    const ordinary = await service.create({ workspace: '/room-task', model: 'test', mode: 'agent' })
    await expect(service.delete(roomThread.id)).rejects.toThrow('history is retained')
    expect(await service.deleteByWorkspace('/room-task')).toEqual([ordinary.id])
    expect(await service.getMetadata(roomThread.id)).not.toBeNull()
    expect(await service.getMetadata(ordinary.id)).toBeNull()
  })

  it('prevents fork and session-resume from creating an unguarded copy in the task checkout', async () => {
    const { service, threadStore, roomThread } = await fixture()
    await expect(service.fork(roomThread.id)).rejects.toThrow('cannot be forked')
    await expect(service.resumeSession(roomThread.id, { workspace: '/outside' }))
      .rejects.toThrow('resumed through its room task')
    expect(await threadStore.list({ includeSide: true })).toHaveLength(1)
  })
})
