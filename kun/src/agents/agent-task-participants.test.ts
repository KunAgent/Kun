import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { RoomService } from '../rooms/room-service.js'
import { AgentIdentityService } from './agent-identity-service.js'
import { openAgentConversation } from './agent-conversations.js'
import { taskParticipantRoom, resolveAgentTaskReviewer } from './agent-task-participants.js'
import type { RoomRequestState, RoomRuntimeDeps, RoomTaskExecution } from '../rooms/room-runtime-types.js'
import { roomTaskContext } from '../rooms/room-context.js'

const run = promisify(execFile)
const resources: Array<{ root: string; store: SqliteRoomStore }> = []
afterEach(async () => { for (const { root, store } of resources.splice(0)) { await store.close(); await rm(root, { recursive: true, force: true }) } })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-agent-task-'))
  await run('git', ['init', '-b', 'develop'], { cwd: root })
  await run('git', ['config', 'user.name', 'Fixture'], { cwd: root })
  await run('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root })
  await writeFile(join(root, 'source.txt'), 'baseline\n')
  await run('git', ['add', 'source.txt'], { cwd: root })
  await run('git', ['commit', '-m', 'fixture'], { cwd: root })
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') }); resources.push({ root, store })
  const agents = new AgentIdentityService(store, () => ({}))
  const service = new RoomService(store, () => {}); service.setAgentDirectory(agents)
  const a = (await agents.create({ clientRequestId: 'a', name: 'Owner' })).agent
  const reviewer = (await agents.create({ clientRequestId: 'r', name: 'Reviewer', defaultRole: 'reviewer' })).agent
  const worker = (await agents.create({ clientRequestId: 'w', name: 'Worker', reviewerAgentId: reviewer.id })).agent
  const direct = (await openAgentConversation(agents, service, a.id)).room
  const room = (await service.update(direct.id, { clientRequestId: 'repo', expectedRevision: direct.revision,
    repositories: [{ id: 'repo', displayPath: root }],
    members: direct.members.map((member) => ({ ...member, allowedRepositoryIds: ['repo'], defaultRepositoryId: 'repo' })) })).room
  const sent = await service.send(room.id, { clientRequestId: 'work', body: 'Implement the selected change',
    executionIntent: 'execute', executionAgentId: worker.id, repositoryId: 'repo' })
  const request = (await store.get<RoomRequestState>('request', sent.requestId))!.value
  return { root, store, agents, service, a, reviewer, worker, room, request, sent }
}

it('freezes a task-only owner and configured reviewer without adding private-chat members', async () => {
  const f = await fixture()
  expect((await f.service.get(f.room.id)).members.map((member) => member.participantAgentId)).toEqual([f.a.id])
  const owner = taskParticipantRoom(f.request).members.find((member) => member.participantAgentId === f.worker.id)!
  expect(owner.taskScopedMemory).toBe(true)
  expect(owner.allowedRepositoryIds).toEqual(['repo'])
  const reviewer = await resolveAgentTaskReviewer({ agentDirectory: f.agents } as RoomRuntimeDeps,
    f.request, owner, owner.configuredReviewerAgentId, 'repo')
  expect(reviewer?.participantAgentId).toBe(f.reviewer.id)
  expect(reviewer?.taskScopedMemory).toBe(true)
  expect((await f.service.get(f.room.id)).members).toHaveLength(1)
})

it('does not expose unrelated private history to an external reviewer', async () => {
  const f = await fixture()
  const owner = f.request.taskParticipants![0]
  const reviewer = await resolveAgentTaskReviewer({ agentDirectory: f.agents } as RoomRuntimeDeps,
    f.request, owner, owner.configuredReviewerAgentId, 'repo')
  const execution = { task: { stage: 'develop', sourceMessageId: f.sent.message.id }, reviewer,
    contextSnapshot: { summary: 'UNRELATED PRIVATE SUMMARY', messages: [
      { id: 'unrelated', author: 'user', body: 'UNRELATED PRIVATE HISTORY' },
      { id: f.sent.message.id, author: 'user', body: 'Selected requirement' }
    ], rules: [], agreements: undefined }
  } as unknown as RoomTaskExecution
  const review = roomTaskContext(execution, 'review')
  expect(JSON.stringify(review)).not.toContain('UNRELATED')
  expect(JSON.stringify(review)).toContain('Selected requirement')
  expect(JSON.stringify(roomTaskContext(execution, 'execution'))).toContain('UNRELATED')
})

it('enforces repository ceilings and rejects self-review by stable Agent identity', async () => {
  const f = await fixture()
  const owner = f.request.taskParticipants![0]
  await expect(resolveAgentTaskReviewer({ agentDirectory: f.agents } as RoomRuntimeDeps,
    f.request, owner, owner.participantAgentId, 'repo')).rejects.toThrow('own work')
  await f.agents.update(f.reviewer.id, { clientRequestId: 'narrow', expectedRevision: 0, allowedRepositoryRoots: [] })
  await expect(resolveAgentTaskReviewer({ agentDirectory: f.agents } as RoomRuntimeDeps,
    f.request, owner, f.reviewer.id, 'repo')).rejects.toThrow('unauthorized')
})
