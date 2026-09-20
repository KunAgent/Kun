import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeHarness, makeSilentModel } from './loop-test-harness.js'
import { SqliteRoomStore } from '../src/rooms/room-store-sqlite.js'
import { RoomService } from '../src/rooms/room-service.js'
import { RoomProductService } from '../src/rooms/room-product-service.js'
import type { RoomRuntimeDeps, RoomTaskExecution } from '../src/rooms/room-runtime-types.js'
import { RoomTaskSchema } from '../src/contracts/room-tasks.js'

export async function productServiceFixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-room-product-services-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const h = makeHarness(makeSilentModel())
  const service = new RoomService(store, () => {})
  const { room } = await service.create({ name: 'Product test room', clientRequestId: 'create' })
  const member = room.members.find((member) => member.id === 'developer')!
  const execution: RoomTaskExecution = { task: RoomTaskSchema.parse({ id: 'task_one', roomId: room.id,
    requestId: 'request_original', sourceMessageId: 'source_message', title: 'Task one', ownerMemberId: member.id,
    memberSnapshot: member, repositoryId: 'repository_one', workspaceId: 'workspace_one', executionThreadId: 'execution_one',
    status: 'failed', stage: 'develop', requirementRevision: 0, revision: 0, updatedAt: new Date().toISOString() }),
    prompt: 'Implement the request', attachmentIds: [], dependencyTaskIds: [], attempt: 1, reworkRounds: 0, configuration: null }
  const deps: RoomRuntimeDeps = { store, threads: h.threads, threadStore: h.threadStore, turns: h.turns,
    sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate, runTurn: (id, turnId) => h.loop.runTurn(id, turnId),
    dataDir: root, model: () => ({ model: 'fake' }), profiles: () => ({}), assertOwnership: () => store.assertOwnership() }
  await store.commit({ requestId: 'task-create', checks: [{ kind: 'task', id: execution.task.id, expectedRevision: null }],
    puts: [{ kind: 'task', id: execution.task.id, roomId: room.id, taskId: execution.task.id, value: execution }] })
  const task = async () => (await store.get<RoomTaskExecution>('task', execution.task.id))!
  const updateTask = async (patch: Partial<RoomTaskExecution>) => {
    const row = await task()
    await store.commit({ requestId: 'task-fixture-' + row.revision, checks: [{ kind: 'task', id: row.id, expectedRevision: row.revision }],
      puts: [{ kind: 'task', id: row.id, roomId: room.id, taskId: row.id,
        value: { ...row.value, ...patch, task: { ...row.value.task, ...patch.task, revision: row.revision + 1 } } }] })
  }
  return { root, store, h, service, room, execution, deps, task, updateTask, product: new RoomProductService(deps, service),
    close: async () => { await h.turns.interruptActiveTurns(); await store.close(); await rm(root, { recursive: true, force: true }) } }
}
