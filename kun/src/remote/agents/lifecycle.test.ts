import { roomDiscussionBusy } from '../../rooms/room-discussion-scheduler.js'
import { describe, expect, it, vi } from 'vitest'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { remoteFixture } from '../testing/runtime.test-support.js'
import { openAgentConversation } from '../../agents/agent-conversations.js'
import { AgentDirectRunner } from '../../agents/agent-direct-runner.js'
import { privatePublicationChecks } from '../../agents/agent-direct-publication-guard.js'
import { enqueuePrivateContinuation } from '../../rooms/room-continuation-service.js'
import type { RoomRequestState } from '../../rooms/room-runtime-types.js'
import type { RoomRunRecord } from '../../contracts/room-runs.js'
import { AgentLifecycleService } from '../../agents/agent-lifecycle-service.js'
import { receiptKey } from '../requests/receipts.js'
import { readRestartHandoff } from '../../agents/agent-lifecycle-handoff.js'
import { createHash } from 'node:crypto'
import { agentStableId } from '../../agents/agent-identity-service.js'
import { resolveWorkbenchPolicy } from '../../contracts/workbench-policy.js'
import { putRoomDocument } from '../../rooms/room-service.js'
import { updateRoomRun } from '../../rooms/room-run-recording.js'

async function fixture() {
  const f = await remoteFixture(), agent = (await f.rooms.agents.create({ clientRequestId: 'create', name: 'Keeper' })).agent
  const { room } = await openAgentConversation(f.rooms.agents, f.rooms.service, agent.id)
  const runner = new AgentDirectRunner(f.rooms.deps, f.rooms.service)
  const row = async (id: string) => (await f.store.get<RoomRequestState>('request', id))!
  const prepare = async (id: string) => { for (let index = 0; index < 4 && !(await row(id)).value.turnId; index++) await runner.tick(await row(id)); return (await row(id)).value }
  const send = (id: string, body: string) => f.rooms.service.send(room.id, { clientRequestId: id, body }, { clientSurface: 'api', remoteDeviceId: 'phone' })
  const restartParams = async () => ({ agentId: agent.id, expectedRevision: (await f.rooms.agents.get(agent.id)).revision,
    expectedLifecycleRevision: (await f.rooms.lifecycle.get(agent.id)).lifecycleRevision })
  return { ...f, agent, room, runner, row, prepare, send, restartParams }
}
describe('Manager-owned Agent lifecycle', () => {
  it('preserves the exact legacy thread hash and normal desktop queue when no explicit restart exists', async () => {
    const f = await fixture()
    try {
      const first = await f.rooms.service.send(f.room.id, { clientRequestId: 'desktop-first', body: 'Normal desktop message' })
      const request = await f.prepare(first.requestId), snapshot = request.roomSnapshot
      const member = snapshot.members.find(item => item.id === snapshot.defaultMemberId)!
      const profile = member.presetSnapshot ?? f.rooms.deps.profiles()[member.presetId]
      const main = request.privateModel!, agent = await f.rooms.agents.get(f.agent.id)
      // This is deliberately the previous release's complete fingerprint, with no new zero/default slot.
      const legacy = JSON.stringify([request.roomId, snapshot.privateEpoch ?? 0, request.privateWorkspace,
        main.providerId, main.accountId, snapshot.privateExecutionPolicy, member.presetId, member.agentInstructions,
        profile, member.capabilityOverrides, agent.setup?.status ?? 'completed', resolveWorkbenchPolicy(agent.workbench)])
      expect(request.threadId).toBe(agentStableId('agent-chat', createHash('sha256').update(legacy).digest('hex')))
      const second = await f.rooms.service.send(f.room.id, { clientRequestId: 'desktop-second', body: 'Continue normally' })
      expect((await f.prepare(second.requestId)).threadId).toBe(request.threadId)
      expect((await f.rooms.service.get(f.room.id)).privateContextGeneration).toBeUndefined()
      expect(await f.store.list('agent_lifecycle', { roomId: f.room.id })).toEqual([])
      expect((await f.h.threads.getMetadata(request.threadId))!.queueControl).toBeUndefined()
    } finally { await f.close() }
  })
  it('stops only the main turn, retains transcript/files/independent tasks, and never replays queued input', async () => {
    const f = await fixture()
    try {
      const first = await f.rooms.service.send(f.room.id, { clientRequestId: 'first', body: 'Original request' }), request = await f.prepare(first.requestId)
      expect(request.turnId).toBeTruthy(); await f.h.turns.startNextQueuedTurn(request.threadId)
      const base = { threadId: request.threadId, turnId: request.turnId!, status: 'completed' as const, createdAt: new Date().toISOString() }
      await f.h.sessionStore.appendItem(request.threadId, { ...base, id: 'public-result', kind: 'tool_result', role: 'tool',
        toolName: 'read', callId: 'finished-effect', toolKind: 'tool_call', isError: false,
        output: { summary: 'Already wrote a report', apiKey: 'fixture-secret', providerMetadata: 'fixture-private-capture' } })
      await f.h.sessionStore.appendItem(request.threadId, { ...base, id: 'hidden-reasoning', kind: 'assistant_reasoning', role: 'assistant', text: 'fixture-hidden-reasoning' })
      const queued = await f.rooms.service.send(f.room.id, { clientRequestId: 'queued', body: 'Keep this draft queued' })
      const independent = await f.code('Independent delegated task')
      const delegated = await f.h.turns.enqueueTurn({ threadId: independent.id, request: { prompt: 'Independent work', clientSurface: 'api' } })
      await f.h.turns.startNextQueuedTurn(independent.id)
      const file = join(f.root, 'preserved.txt'); await writeFile(file, 'Preserved file')
      const interrupt = vi.spyOn(f.h.turns, 'interruptTurn'), run = vi.spyOn(f.runtime, 'runTurn')
      const params = await f.restartParams(), result = await f.call('agent.restart', params, 'restart-once')
      expect(result.receipt.status).toBe('applied'); expect(result.receipt.result).toMatchObject({ restarted: true, queuePaused: true })
      expect(interrupt).toHaveBeenCalledWith({ threadId: request.threadId, turnId: request.turnId })
      expect(interrupt).not.toHaveBeenCalledWith(expect.objectContaining({ threadId: independent.id }))
      expect((await f.h.threads.getMetadata(independent.id))!.turns.find(turn => turn.id === delegated.turnId)!.status).toBe('running')
      expect(await readFile(file, 'utf8')).toBe('Preserved file')
      const room = await f.rooms.service.get(f.room.id)
      expect(room.privateEpoch).toBe(f.room.privateEpoch); expect(room.privateContextGeneration).toBe(1)
      expect((await f.rooms.messages(room.id, 20)).messages.map(message => message.body)).toEqual(['Original request', 'Keep this draft queued'])
      const busy = new Set<string>(); await (f.rooms as any).tickRequest(await f.row(queued.requestId), busy); expect(busy.size).toBe(0)
      await f.runner.tick(await f.row(queued.requestId)); expect((await f.row(queued.requestId)).value.turnId).toBeUndefined()
      const fresh = await f.send('fresh', 'Continue with a new explicit message'), next = await f.prepare(fresh.requestId)
      expect(next.threadId).not.toBe(request.threadId); expect(next.clientSurface).toBe('api')
      expect((await f.row(queued.requestId)).value.clientSurface).toBeUndefined()
      expect((await f.h.threads.getMetadata(request.threadId))!.turns.find(turn => turn.id === request.turnId)!.clientSurface).toBe('gui')
      const input = (await f.h.sessionStore.loadItems(next.threadId)).filter(item => item.kind === 'user_message')
      expect(input).toHaveLength(1)
      const serialized = JSON.stringify(input)
      expect(serialized).not.toContain('Keep this draft queued')
      expect(serialized).toContain('Already wrote a report'); expect(serialized).toContain('never replay them')
      for (const hidden of ['fixture-secret', 'fixture-private-capture', 'fixture-hidden-reasoning']) expect(serialized).not.toContain(hidden)
      const consumption = (await f.store.list<any>('agent_lifecycle', { roomId: room.id, limit: 20 })).find(row => row.value.state === 'consumed')
      expect(consumption?.value.clientRequestId).toBe('private-' + next.id + '-0')
      const later = await f.send('later', 'Another explicit message'), third = await f.prepare(later.requestId)
      const thirdInput = (await f.h.sessionStore.loadItems(third.threadId)).find(item => item.kind === 'user_message' && item.turnId === third.turnId)
      expect(JSON.stringify(thirdInput)).not.toContain('Host restart handoff')
      expect(run).not.toHaveBeenCalled()
      expect((await f.call('agent.restart', params, 'restart-once')).receipt).toEqual(result.receipt)
      expect((await f.call('agent.lifecycle.get', { agentId: f.agent.id })).actions).toEqual(['restart'])
    } finally { await f.h.turns.interruptActiveTurns(); await f.close() }
  })
  it('persists restarting when stop is not proven, fences late publication/continuations and only then completes the original receipt', async () => {
    const f = await fixture()
    try {
      const sent = await f.send('first', 'Run'), request = await f.prepare(sent.requestId)
      await f.h.turns.startNextQueuedTurn(request.threadId)
      const run = (await f.store.get<RoomRunRecord>('room_run', request.privateRunId!))!.value
      const oldChecks = await privatePublicationChecks(f.store, run)
      let stopped = false
      f.rooms.deps.proveTurnStopped = async () => stopped
      const params = await f.restartParams()
      const result = await f.call('agent.restart', params, 'restart')
      expect(result.receipt.status).toBe('reconciliation_required'); expect(result.receipt.error).toBeUndefined()
      expect((await f.call('agent.lifecycle.get', { agentId: f.agent.id })).state).toBe('restarting')
      expect((await f.rooms.service.get(f.room.id)).privateContextGeneration).toBeUndefined()
      await expect(f.send('new-during-restart', 'Must wait')).rejects.toThrow('AGENT_RESTART_IN_PROGRESS')
      await expect(privatePublicationChecks(f.store, run)).rejects.toThrow()
      await expect(f.store.commit({ requestId: 'late-publication', checks: oldChecks,
        puts: [{ kind: 'context', id: 'late-publication', value: { text: 'late' } }] })).rejects.toThrow()
      expect(await enqueuePrivateContinuation(f.rooms.deps, { threadId: request.threadId, sourceTurnId: request.turnId!, kind: 'background_shell', key: 'old-background-key', prompt: 'Old automatic continuation' })).toBe('ignored')
      expect((await f.call('request.get', { requestId: 'restart' })).receipt.status).toBe('reconciliation_required')
      stopped = true
      expect((await f.call('request.get', { requestId: 'restart' })).receipt.status).toBe('applied')
      expect((await f.call('agent.lifecycle.get', { agentId: f.agent.id })).state).toBe('active')
    } finally { await f.h.turns.interruptActiveTurns(); await f.close() }
  })
  it('rejects stale metadata/lifecycle revisions and never exposes resume for a non-paused Agent', async () => {
    const f = await fixture()
    try {
      const p = await f.restartParams()
      expect((await f.call('agent.restart', { ...p, expectedRevision: 42 }, 'wrong')).receipt.error?.code).toBe('REVISION_CONFLICT')
      expect((await f.call('agent.restart', p, 'correct')).receipt.status).toBe('applied')
      expect((await f.call('agent.restart', p, 'stale')).receipt.error?.code).toBe('REVISION_CONFLICT')
      expect((await f.call('agent.lifecycle.get', { agentId: f.agent.id })).actions).not.toContain('resume')
    } finally { await f.close() }
  })
  it('reconstructs a pending restart on native startup without the original phone or resending input', async () => {
    const f = await fixture(); let replacement: AgentLifecycleService | undefined
    try {
      const sent = await f.send('first', 'Run'), request = await f.prepare(sent.requestId)
      await f.h.turns.startNextQueuedTurn(request.threadId)
      f.rooms.deps.proveTurnStopped = async () => false
      const params = await f.restartParams()
      await f.call('agent.restart', params, 'restart')
      f.rooms.deps.proveTurnStopped = async () => true
      replacement = new AgentLifecycleService(f.rooms); const run = vi.spyOn(f.runtime, 'runTurn')
      const key = receiptKey(f.envelope('agent.restart', params, 'restart'), 'restart')
      replacement.start()
      await vi.waitFor(async () => expect((await f.rooms.lifecycle.get(f.agent.id)).state).toBe('active'))
      expect(await replacement.recover(f.agent.id, key)).toMatchObject({ restarted: true })
      expect((await f.call('request.get', { requestId: 'restart' })).receipt.status).toBe('applied')
      expect(run).not.toHaveBeenCalled()
    } finally { replacement?.close(); await f.h.turns.interruptActiveTurns(); await f.close() }
  })
  it('rejects a late handoff reservation after another restart changes its generation', async () => {
    const f = await fixture()
    try {
      expect((await f.call('agent.restart', await f.restartParams(), 'first-restart')).receipt.status).toBe('applied')
      const handoff = await readRestartHandoff(f.rooms.deps, await f.rooms.service.get(f.room.id))
      expect(handoff).toBeTruthy()
      expect((await f.call('agent.restart', await f.restartParams(), 'second-restart')).receipt.status).toBe('applied')
      await expect(f.store.commit({ requestId: 'late-reservation', checks: handoff!.checks,
        puts: [{ kind: 'agent_lifecycle', id: handoff!.consumedId, roomId: f.room.id,
          value: { state: 'reserved', threadId: 'stale', clientRequestId: 'stale' } }] })).rejects.toThrow()
      expect(await f.store.get('agent_lifecycle', handoff!.consumedId)).toBeNull()
    } finally { await f.close() }
  })
  it('holds already persisted native queued inputs across restart and never promotes them on a later startup', async () => {
    const f = await fixture()
    try {
      const sent = await f.send('old-queued', 'Preserve this accepted queued input')
      const request = await f.prepare(sent.requestId)
      const original = f.store.commit.bind(f.store)
      const failure = vi.spyOn(f.store, 'commit').mockImplementation(async input => {
        if (input.requestId.startsWith('agent-restart-') && input.requestId.endsWith('-finish')) throw new Error('fixture crash before completion')
        return original(input)
      })
      expect((await f.call('agent.restart', await f.restartParams(), 'restart-queued')).receipt.status).toBe('reconciliation_required')
      failure.mockRestore()
      expect(await f.h.turns.startNextQueuedTurn(request.threadId)).toBeNull()
      expect((await f.call('request.get', { requestId: 'restart-queued' })).receipt.status).toBe('applied')
      const old = (await f.h.threads.getMetadata(request.threadId))!.turns.find(turn => turn.id === request.turnId)!
      expect(old.status).toBe('queued'); expect(old.prompt).toContain('Preserve this accepted queued input')
      expect((await f.row(sent.requestId)).value.cancellationRequested).toBeUndefined()
      expect((await f.call('agent.lifecycle.get', { agentId: f.agent.id })).queuedCount).toBe(1)
      expect(await f.h.turns.startNextQueuedTurn(request.threadId)).toBeNull()
      const fresh = await f.send('new-api', 'A newly authorized explicit API message')
      expect((await roomDiscussionBusy(f.rooms.deps, true)).has('agent:' + f.agent.id)).toBe(false)
      for (let step = 0; step < 4 && !(await f.row(fresh.requestId)).value.turnId; step++)
        await (f.rooms as any).tickRequest(await f.row(fresh.requestId), await roomDiscussionBusy(f.rooms.deps, true))
      const next = (await f.row(fresh.requestId)).value
      const input = (await f.h.sessionStore.loadItems(next.threadId)).find(item => item.kind === 'user_message' && item.turnId === next.turnId)
      expect(JSON.stringify(input)).not.toContain('Preserve this accepted queued input')
      expect(await f.h.turns.startNextQueuedTurn(next.threadId)).toEqual({ turnId: next.turnId })
    } finally { await f.h.turns.interruptActiveTurns(); await f.close() }
  })
  it('waits for exact background stop proof even when both public request and turn already look complete', async () => {
    const f = await fixture()
    try {
      const sent = await f.send('background', 'Start background work'), request = await f.prepare(sent.requestId)
      await f.h.turns.startNextQueuedTurn(request.threadId)
      await f.h.turns.finishTurn({ threadId: request.threadId, turnId: request.turnId!, status: 'completed' })
      const row = await f.row(sent.requestId)
      await putRoomDocument(f.store, 'request', row.id, f.room.id, { ...row.value, status: 'completed' }, row)
      await updateRoomRun(f.store, request.privateRunId!, { status: 'completed' })
      let live = true
      f.rooms.deps.activeBackgroundTurns = () => live ? [{ threadId: request.threadId, turnId: request.turnId! }] : []
      f.rooms.deps.backgroundExecutionActive = () => live
      f.rooms.deps.proveTurnStopped = async () => !live
      const stop = vi.fn(async () => {})
      f.rooms.deps.stopBackgroundExecution = stop
      expect((await f.call('agent.restart', await f.restartParams(), 'background-restart')).receipt.status).toBe('reconciliation_required')
      expect(stop).toHaveBeenCalledWith(request.threadId, request.turnId)
      expect((await f.call('agent.lifecycle.get', { agentId: f.agent.id })).state).toBe('restarting')
      live = false
      expect((await f.call('request.get', { requestId: 'background-restart' })).receipt.status).toBe('applied')
    } finally { await f.close() }
  })
  it('does not finish while an owned tool remains in flight after its model controller stopped', async () => {
    const f = await fixture()
    try {
      const sent = await f.send('late-tool', 'Work'), request = await f.prepare(sent.requestId)
      await f.h.turns.startNextQueuedTurn(request.threadId)
      await f.h.turns.finishTurn({ threadId: request.threadId, turnId: request.turnId!, status: 'completed' })
      const row = await f.row(sent.requestId)
      await putRoomDocument(f.store, 'request', row.id, f.room.id, { ...row.value, status: 'completed' }, row)
      const tracker = f.h.turns['deps'].inflight
      tracker.begin({ id: 'fixture-owned-tool', kind: 'tool', threadId: request.threadId, turnId: request.turnId })
      f.rooms.deps.proveTurnStopped = async () => true
      expect((await f.call('agent.restart', await f.restartParams(), 'late-tool-restart')).receipt.status).toBe('reconciliation_required')
      expect((await f.call('agent.lifecycle.get', { agentId: f.agent.id })).state).toBe('restarting')
      tracker.end('fixture-owned-tool')
      expect((await f.call('request.get', { requestId: 'late-tool-restart' })).receipt.status).toBe('applied')
    } finally { await f.close() }
  })
})
