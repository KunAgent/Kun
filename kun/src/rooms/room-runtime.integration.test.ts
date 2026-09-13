import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeHarness } from '../../tests/loop-test-harness.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { openAgentConversation } from '../agents/agent-conversations.js'
import { QueuedTurnDispatcher } from '../server/queued-turn-dispatcher.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { roomResultProvider } from './room-result-tools.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { buildBuiltinLocalTools } from '../adapters/tool/builtin-tools.js'
import { RoomRuntime } from './room-runtime.js'
import type { RoomTaskExecution } from './room-runtime-types.js'

const exec = promisify(execFile)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture(structuredResults = false, malformedResults = false) {
  const root = await mkdtemp(join(tmpdir(), 'kun-room-runtime-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const repo = join(root, 'repo with spaces')
  await exec('git', ['init', '-b', 'develop', repo])
  await exec('git', ['-C', repo, 'config', 'user.name', 'Room Test'])
  await exec('git', ['-C', repo, 'config', 'user.email', 'room@example.test'])
  await writeFile(join(repo, 'source.txt'), 'original\n')
  await exec('git', ['-C', repo, 'add', '.'])
  await exec('git', ['-C', repo, 'commit', '-m', 'baseline'])
  const plans: Record<string, unknown> = {}
  const calls = new Map<string, number>()
  const modelRequests: ModelRequest[] = []
  const model: ModelClient = { provider: 'fake', model: 'fake',
    async *stream(request): AsyncIterable<ModelStreamChunk> {
      modelRequests.push(request)
      calls.set(request.threadId, (calls.get(request.threadId) ?? 0) + 1)
      if (request.threadId.startsWith('room-discussion')) {
        if (structuredResults && (malformedResults || calls.get(request.threadId) === 1)) {
          expect(request.tools.map((tool) => tool.name).sort()).toEqual([
            'get_agent_handoff', 'list_collaboration_agents', 'read_room_rules', 'send_agent_message', 'submit_room_plan'
          ])
          yield { kind: 'tool_call_complete', callId: 'plan', toolName: 'submit_room_plan', arguments: malformedResults ? { response: 'Invalid attempt ' + calls.get(request.threadId) } : plans.current as Record<string, unknown> }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'assistant_text_delta', text: JSON.stringify(plans.current ?? {
          kind: 'answer', response: '讨论完成', participants: [], assignments: []
        }) }
      } else if (request.threadId.startsWith('room-review')) {
        expect(request.tools.some((tool) => tool.name === 'write' || tool.name === 'bash')).toBe(false)
        if (structuredResults && (malformedResults || calls.get(request.threadId) === 1)) {
          expect(request.tools.map((tool) => tool.name)).toContain('submit_room_review')
          yield { kind: 'tool_call_complete', callId: 'review', toolName: 'submit_room_review', arguments: { verdict: 'passed', findings: [], limitations: ['No tests executed by reviewer'] } }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'assistant_text_delta', text: JSON.stringify({ verdict: 'passed', findings: [], limitations: ['No tests executed by reviewer'] }) }
      } else if (request.threadId.startsWith('room-execution')) {
        if ((calls.get(request.threadId) ?? 0) === 1) {
          yield { kind: 'tool_call_complete', callId: 'create-file', toolName: 'write',
            arguments: { path: 'result.txt', content: 'from real Kun tool execution\n' } }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'assistant_text_delta', text: 'Created result.txt. No tests were run.' }
      } else {
        yield { kind: 'assistant_text_delta', text: '成员的独立讨论意见。' }
      }
      yield { kind: 'completed', stopReason: 'stop' }
    } }
  const h = makeHarness(model)
  if (structuredResults) h.toolHost.replaceRuntimeComponents({ registry: new CapabilityRegistry([
    { id: 'builtin', kind: 'built-in', enabled: true, available: true, tools: buildBuiltinLocalTools() }, roomResultProvider(h.threadStore)
  ]) })
  h.threads.updateRuntimeDefaults({ approvalPolicy: 'auto', sandboxMode: 'workspace-write',
    approvalReviewer: 'user', modelRequestCaptureEnabled: false })
  const dispatcher = new QueuedTurnDispatcher({ turns: h.turns, threadStore: h.threadStore,
    runTurn: (threadId, turnId) => h.loop.runTurn(threadId, turnId) })
  h.turns.setTurnQueuedHook((id) => dispatcher.requestDrain(id))
  h.turns.setTurnSettledHook((id, status) => dispatcher.onTurnSettled(id, status))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const deps = { store, threads: h.threads, threadStore: h.threadStore, turns: h.turns,
    sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (threadId: string, turnId: string) => h.loop.runTurn(threadId, turnId), dataDir: join(root, 'data'),
    model: () => ({ model: 'fake' }), profiles: () => ({}), assertOwnership: async () => {} }
  let runtime = new RoomRuntime(deps)
  cleanups.push(async () => {
    await runtime.close()
    await dispatcher.dispose()
    await h.turns.interruptActiveTurns()
    await store.close()
  })
  const { room } = await runtime.service.create({ clientRequestId: 'create-room', name: '研发室', collaborationMode: 'autonomous',
    repositories: [{ id: 'repo', displayPath: repo }] })
  runtime.start()
  return { root, repo, room, plans, calls, modelRequests, h, store, get runtime() { return runtime },
    restart: async () => { await runtime.close(); runtime = new RoomRuntime(deps); runtime.start() } }
}

describe('Rooms real queue, AgentLoop and Git integration', () => {
  it.each([false, true])('delivers and reviews an actual isolated tool change without duplicate execution (structured results: %s)', async (structuredResults) => {
    const f = await fixture(structuredResults)
    const enqueue = f.h.turns.enqueueTurn.bind(f.h.turns)
    let lostAdmissionResponse = false
    vi.spyOn(f.h.turns, 'enqueueTurn').mockImplementation(async (input) => {
      const admitted = await enqueue(input)
      if (!lostAdmissionResponse && input.threadId.startsWith('room-execution')) {
        lostAdmissionResponse = true
        throw new Error('injected lost admission response after durable commit')
      }
      return admitted
    })
    f.plans.current = { kind: 'execute', response: '已安排开发和评审。', participants: [],
      assignments: [{ key: 'change', memberId: 'developer', repositoryId: 'repo',
        title: 'Create result', prompt: 'Create result.txt', dependsOn: [], reviewerMemberId: 'reviewer' }] }
    const message = { clientRequestId: 'execute-once', body: '实现结果文件，交给评审', executionIntent: 'execute' }
    const sent = await f.runtime.service.send(f.room.id, message)
    expect(await f.runtime.service.send(f.room.id, message)).toEqual(sent)
    let task!: RoomTaskExecution['task']
    await vi.waitFor(async () => {
      const rows = await f.store.list<RoomTaskExecution>('task', { roomId: f.room.id })
      expect(rows).toHaveLength(1)
      task = rows[0].value.task
      expect(task.status, task.latestProgress).toBe('awaiting_acceptance')
    }, { timeout: 25000, interval: 100 })
    const detail = await f.runtime.taskDetail(f.room.id, task.id)
    expect(detail.delivery?.changedFiles).toEqual(['result.txt'])
    expect(detail.reviews[0].versionHash).toBe(detail.delivery?.versionHash)
    expect(detail.task.verificationStatus).toBe('not_run')
    await expect(readFile(join(f.repo, 'result.txt'))).rejects.toThrow()
    await f.restart()
    expect((await f.runtime.taskDetail(f.room.id, task.id)).task.status).toBe('awaiting_acceptance')
    await f.runtime.action(f.room.id, task.id, 'accept', { clientRequestId: 'accept', expectedRevision: task.revision })
    task = (await f.runtime.taskDetail(f.room.id, task.id)).task
    expect(task.status).toBe('completed')
    expect(task.applicationStatus).toBe('not_applied')
    const applied = await f.runtime.action(f.room.id, task.id, 'apply', { clientRequestId: 'apply', expectedRevision: task.revision })
    expect(await f.runtime.action(f.room.id, task.id, 'apply', { clientRequestId: 'apply', expectedRevision: task.revision })).toEqual(applied)
    expect(await readFile(join(f.repo, 'result.txt'), 'utf8')).toContain('real Kun tool')
    expect((await f.store.list('task', { roomId: f.room.id })).length).toBe(1)
    expect(lostAdmissionResponse).toBe(true)
    const execution = await f.h.threads.getMetadata(task.executionThreadId)
    expect(execution?.turns).toHaveLength(1)
  }, 30000)

  it('stops invalid native result submission after the initial attempt and two repairs without scheduling work', async () => {
    const f = await fixture(true, true)
    await f.runtime.service.send(f.room.id, { clientRequestId: 'invalid-native', body: 'Implement result', executionIntent: 'execute' })
    await vi.waitFor(async () => {
      const request = (await f.store.list<{ status: string; error?: string }>('request', { roomId: f.room.id }))[0]
      expect(request.value.status).toBe('failed')
    }, { timeout: 15000 })
    expect([...f.calls.values()]).toEqual([3])
    expect(await f.store.list('task', { roomId: f.room.id })).toHaveLength(0)
  }, 20000)

  it('executes privately with an external owner and reviewer without exposing unrelated history', async () => {
    const f = await fixture(true)
    const caller = (await f.runtime.agents.create({ clientRequestId: 'private-caller', name: 'Caller', defaultRole: 'coordinator' })).agent
    const reviewer = (await f.runtime.agents.create({ clientRequestId: 'private-reviewer', name: 'Independent reviewer', defaultRole: 'reviewer' })).agent
    const worker = (await f.runtime.agents.create({ clientRequestId: 'private-worker', name: 'Task worker', reviewerAgentId: reviewer.id })).agent
    const direct = (await openAgentConversation(f.runtime.agents, f.runtime.service, caller.id)).room
    const room = (await f.runtime.service.update(direct.id, { clientRequestId: 'private-repository', expectedRevision: direct.revision,
      repositories: [{ id: 'repo', displayPath: f.repo }],
      members: direct.members.map((member) => ({ ...member, allowedRepositoryIds: ['repo'], defaultRepositoryId: 'repo' })) })).room
    await f.store.commit({ requestId: 'private-history', checks: [{ kind: 'message', id: 'private-history', expectedRevision: null }],
      puts: [{ kind: 'message', id: 'private-history', roomId: room.id, value: {
        id: 'private-history', roomId: room.id, authorKind: 'user', authorLabelSnapshot: 'User', status: 'final',
        body: 'UNRELATED_PRIVATE_HISTORY_NOT_FOR_TASK_PARTICIPANTS', bodyRevision: 0,
        mentionMemberIds: [], attachmentIds: [], createdAt: new Date().toISOString()
      } }] })
    f.plans.current = { kind: 'execute', response: 'The selected worker will implement the change.', participants: [],
      assignments: [{ key: 'private-change', memberId: worker.id, repositoryId: 'repo', title: 'Private task', prompt: 'Create result.txt', dependsOn: [] }] }
    await f.runtime.service.send(room.id, { clientRequestId: 'private-task', body: 'Create the result file', executionIntent: 'execute',
      executionAgentId: worker.id, repositoryId: 'repo' })
    let task: RoomTaskExecution | undefined
    await vi.waitFor(async () => {
      task = (await f.store.list<RoomTaskExecution>('task', { roomId: room.id }))[0]?.value
      expect(task?.task.status).toBe('awaiting_acceptance')
    }, { timeout: 25000, interval: 100 })
    expect(task?.task.memberSnapshot.participantAgentId).toBe(worker.id)
    expect(task?.reviewer?.participantAgentId).toBe(reviewer.id)
    expect((await f.runtime.service.get(room.id)).members.map((member) => member.participantAgentId)).toEqual([caller.id])
    const participants = f.modelRequests.filter((request) => request.threadId.startsWith('room-execution') || request.threadId.startsWith('room-review'))
    expect(participants.length).toBeGreaterThan(1)
    expect(JSON.stringify(participants)).not.toContain('UNRELATED_PRIVATE_HISTORY_NOT_FOR_TASK_PARTICIPANTS')
    expect(await f.store.list('task', { roomId: room.id })).toHaveLength(1)
  }, 30000)

  it('fails closed when a discussion classifier tries to schedule code', async () => {
    const f = await fixture()
    f.plans.current = { kind: 'execute', response: 'wrong', participants: [], assignments: [{
      key: 'unauthorized', memberId: 'developer', repositoryId: 'repo', title: 'wrong', prompt: 'wrong', dependsOn: []
    }] }
    await f.runtime.service.send(f.room.id, { clientRequestId: 'discussion', body: '只讨论', executionIntent: 'discussion' })
    await vi.waitFor(async () => {
      const rows = await f.store.list<{ status: string }>('request', { roomId: f.room.id })
      expect(rows[0].value.status).toBe('failed')
    }, { timeout: 10000 })
    expect(await f.store.list('task', { roomId: f.room.id })).toHaveLength(0)
  }, 15000)
})
