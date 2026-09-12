import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeHarness, makeSilentModel } from './loop-test-harness.js'
import type { ModelClient } from '../src/ports/model-client.js'
import { CapabilityRegistry } from '../src/adapters/tool/capability-registry.js'
import { defaultLocalTools } from '../src/adapters/tool/local-tool-host.js'
import { RoomMemberSchema } from '../src/contracts/rooms.js'
import { RoomTaskSchema } from '../src/contracts/room-tasks.js'
import { SqliteRoomStore } from '../src/rooms/room-store-sqlite.js'
import { createRoomTaskWorktree, observeRoomRepository } from '../src/rooms/task-workspace-service.js'
import { createRoomDelivery } from '../src/rooms/room-delivery-service.js'
import { roomGit } from '../src/rooms/room-git.js'
import { roomResultProvider } from '../src/rooms/room-result-tools.js'
import type { RoomRuntimeDeps, RoomTaskExecution, RoomWorkspace } from '../src/rooms/room-runtime-types.js'
import { RoomIntegrationService } from '../src/rooms/room-integration.js'

export async function productGitFixture(model: ModelClient = makeSilentModel()) {
  const root = await mkdtemp(join(tmpdir(), 'kun-room-product-'))
  const source = join(root, 'source project')
  const dataDir = join(root, 'data')
  await mkdir(source)
  await roomGit(source, ['init', '-b', 'develop'])
  await roomGit(source, ['config', 'user.name', 'Room Test'])
  await roomGit(source, ['config', 'user.email', 'room@example.invalid'])
  await writeFile(join(source, 'source.txt'), 'original\n')
  await roomGit(source, ['add', '.'])
  await roomGit(source, ['commit', '-m', 'baseline'])
  const repository = await observeRoomRepository(source)
  const taskId = 'task_one'
  const roomId = 'room_one'
  const destination = join(dataDir, 'rooms', 'worktrees', taskId)
  await mkdir(join(dataDir, 'rooms', 'worktrees'), { recursive: true })
  const ownership = async () => {}
  const created = await createRoomTaskWorktree({ repository, taskId, destination, assertOwnership: ownership })
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const h = makeHarness(model)
  h.threads.updateRuntimeDefaults({ approvalPolicy: 'auto', sandboxMode: 'workspace-write', approvalReviewer: 'user', modelRequestCaptureEnabled: false })
  h.toolHost.replaceRuntimeComponents({ registry: new CapabilityRegistry([
    { id: 'builtin', kind: 'built-in', enabled: true, available: true, tools: defaultLocalTools }, roomResultProvider(h.threadStore)
  ]) })
  const deps: RoomRuntimeDeps = { store, threads: h.threads, threadStore: h.threadStore, turns: h.turns,
    sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (threadId, turnId) => h.loop.runTurn(threadId, turnId), dataDir,
    model: () => ({ model: 'fake' }), profiles: () => ({}), assertOwnership: ownership }
  await writeFile(join(created.path, 'source.txt'), 'delivered\n')
  const delivery = await createRoomDelivery({ repository, taskId, workspacePath: created.path,
    workspaceBranch: created.branch, baseRevision: repository.head, id: 'delivery_one', attemptId: 'attempt_one',
    version: 1, summary: 'Replace source content', assertOwnership: ownership, persistDiff: async () => {} })
  const member = RoomMemberSchema.parse({ id: 'developer', displayName: 'Developer', role: 'developer', presetId: 'general', revision: 0 })
  const workspace: RoomWorkspace = { id: 'workspace_one', roomId, taskId, ...created, repository, state: 'ready' }
  const execution: RoomTaskExecution = { task: RoomTaskSchema.parse({ id: taskId, roomId, requestId: 'request_one',
    sourceMessageId: 'message_one', title: 'Implementation', ownerMemberId: member.id, memberSnapshot: member,
    repositoryId: 'repository_one', workspaceId: workspace.id, executionThreadId: 'execution_one', status: 'completed',
    stage: 'develop', requirementRevision: 0, revision: 0, latestDeliveryId: delivery.id, acceptedDeliveryId: delivery.id,
    updatedAt: new Date().toISOString() }), prompt: 'Replace source content', attachmentIds: [], dependencyTaskIds: [],
    attempt: 1, reworkRounds: 0, configuration: null }
  await store.commit({ requestId: 'initial', checks: [
    { kind: 'task', id: taskId, expectedRevision: null },
    { kind: 'workspace', id: workspace.id, expectedRevision: null },
    { kind: 'delivery', id: delivery.id, expectedRevision: null }
  ], puts: [
    { kind: 'task', id: taskId, roomId, taskId, value: execution },
    { kind: 'workspace', id: workspace.id, roomId, taskId, value: workspace },
    { kind: 'delivery', id: delivery.id, roomId, taskId, value: delivery }
  ] })
  const service = new RoomIntegrationService(deps)
  const prepare = (requestId = 'prepare_one') => service.prepare(roomId, taskId, { clientRequestId: requestId, expectedRevision: 0 })
  return { root, source, repository, workspace, execution, delivery, roomId, taskId, deps, h, store, service, prepare,
    close: async () => { await h.turns.interruptActiveTurns(); await store.close(); await rm(root, { recursive: true, force: true }) } }
}
