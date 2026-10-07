import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeHarness } from '../../tests/loop-test-harness.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { createKunToolBridgeHost } from '../harness/kun-tool-bridge-host.js'
import { AgentDispatchService } from '../delegation/agent-dispatch-service.js'
import { FileAgentDispatchIntentStore } from '../delegation/agent-dispatch-intent-store.js'
import { kunToolPermissionModeSettings } from '../contracts/policy.js'
import type { WorkbenchLink } from '../contracts/workbench-links.js'
import type { RoomRequestState, RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { RoomRuntime } from '../rooms/room-runtime.js'
import { ensureRoomThread, enqueueRoomTurn } from '../rooms/room-execution.js'
import { workbenchCodeTools } from '../workbench-bridge/code-tools.js'
import { workbenchToolScope } from '../workbench-bridge/tool-scope.js'
import { outcomePrompt } from '../workbench-bridge/reconcile.js'
import { enqueuePrivateContinuation } from '../rooms/room-continuation-service.js'
import { AgentDirectRunner } from './agent-direct-runner.js'
import { openAgentConversation } from './agent-conversations.js'

const closes: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close() })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-external-dispatch-'))
  const h = makeHarness({ provider: 'test', model: 'test', async *stream() { yield { kind: 'completed' as const, stopReason: 'stop' as const } } })
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const deps: RoomRuntimeDeps = { dataDir: root, store, threads: h.threads, threadStore: h.threadStore,
    turns: h.turns, sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId), model: () => ({ model: 'kun-model', providerId: 'kun' }),
    profiles: () => ({}), assertOwnership: async () => {} }
  const runtime = new RoomRuntime(deps), runner = new AgentDirectRunner(deps, runtime.service)
  runtime.agents.setExecutorValidator(async (executor) => executor)
  const coder = (await runtime.agents.create({ clientRequestId: 'codex', name: 'Codex',
    executor: { kind: 'harness', harnessId: 'codex', credentialMode: 'native-login', model: 'original-model' } })).agent
  const registry = CapabilityRegistry.fromLocalTools(workbenchCodeTools(h.threadStore))
  h.toolHost.replaceRuntimeComponents({ registry })
  const bridge = createKunToolBridgeHost({ registry, toolHost: h.toolHost, threadStore: h.threadStore,
    sessionStore: h.sessionStore, turns: h.turns, events: h.events, ids: h.ids,
    defaultApprovalPolicy: 'auto', defaultSandboxMode: 'danger-full-access' })
  const clock = { now: Date.now() }
  const dispatch = new AgentDispatchService({ store: new FileAgentDispatchIntentStore(root), applicationSessionId: 'test-app', now: () => clock.now })
  runtime.workbench.attach({ agentDispatch: dispatch })
  await dispatch.start()
  closes.push(async () => { await dispatch.stop(); await runtime.close(); await h.turns.interruptActiveTurns(); await store.close(); await rm(root, { recursive: true, force: true }) })
  const startPrivate = async () => {
    const { room } = await openAgentConversation(runtime.agents, runtime.service, coder.id)
    const row = (await store.get('room', room.id))!
    await store.commit({ requestId: 'full-access', checks: [{ kind: 'room', id: row.id, expectedRevision: row.revision }],
      puts: [{ kind: 'room', id: row.id, value: { ...row.value as object, privateExecutionPolicy: kunToolPermissionModeSettings('full-access') } }] })
    const sent = await runtime.service.send(room.id, { clientRequestId: 'ask', body: 'Hand the Code change to Kun.' })
    for (let index = 0; index < 6; index++) {
      const row = (await store.get<RoomRequestState>('request', sent.requestId))!
      if (row.value.turnId) break
      await runner.tick(row)
    }
    const request = (await store.get<RoomRequestState>('request', sent.requestId))!.value
    await h.turns.startNextQueuedTurn(request.threadId)
    // The real native transport freezes this when it sends the first model
    // request; this protocol fixture establishes the same bridge boundary.
    const thread = (await h.threadStore.get(request.threadId))!
    thread.turns.find((turn) => turn.id === request.turnId)!.actingModelRoute = { model: 'original-model' }
    await h.threadStore.upsert(thread)
    return { room, request }
  }
  return { root, h, store, deps, runtime, runner, coder, bridge, dispatch, clock, startPrivate }
}

describe('external private conversation Code dispatch', () => {
  it('discovers and executes create_code_task through the real Kun bridge while the host owns reply publication', async () => {
    const f = await fixture()
    const { request } = await f.startPrivate()
    const run = (await f.store.get<RoomRunRecord>('room_run', request.privateRunId!))!.value
    expect(run.communicationRequired).toBe(false)
    const tools = await f.bridge.listTools(request.threadId, request.turnId!)
    expect(tools.map((tool) => tool.name)).toContain('create_code_task')
    expect(tools.map((tool) => tool.name)).not.toContain('send_im_message')
    const result = await f.bridge.execute(request.threadId, request.turnId!, { toolName: 'create_code_task',
      args: { title: 'Code handoff', goal: 'Implement and test', projectRoot: f.root }, callId: 'dispatch-call', signal: new AbortController().signal })
    expect(result.isError, JSON.stringify(result.output)).not.toBe(true)
    const output = result.output as { linkId: string; dispatchIntentId: string }
    const link = (await f.store.get<WorkbenchLink>('workbench_link', output.linkId))!.value
    expect(link.origin).toMatchObject({ kind: 'tool', fresh: true })
    expect(link.threadId).toBeUndefined()
    expect((await f.dispatch.get(output.dispatchIntentId))?.state).toBe('countdown')
    await expect(workbenchToolScope(f.h.threadStore, { threadId: request.threadId, turnId: request.turnId!, workspace: f.root,
      approvalPolicy: 'auto', sandboxMode: 'danger-full-access', abortSignal: new AbortController().signal,
      managerToolBridgeAvailable: false, awaitApproval: async () => 'allow' })).rejects.toThrow('no active Kun tool bridge')
    expect(outcomePrompt(link, true)).toContain('host publishes it in the original conversation')
    expect(outcomePrompt(link, true)).not.toContain('send_im_message')
  })

  it('keeps external group discussion unable to create Code tasks even with a Kun bridge', async () => {
    const f = await fixture()
    const lead = (await f.runtime.agents.create({ clientRequestId: 'lead', name: 'Ada' })).agent
    const { room } = await f.runtime.service.create({ clientRequestId: 'team', name: 'Team', defaultMemberId: 'lead',
      members: [{ ...f.runtime.agents.asMember(lead), id: 'lead' }, { ...f.runtime.agents.asMember(f.coder), id: 'coder' }] })
    const sent = await f.runtime.service.send(room.id, { clientRequestId: 'mention', body: '@Codex inspect it', mentionMemberIds: ['coder'] })
    const request = (await f.store.get<RoomRequestState>('request', sent.requestId))!.value
    const member = request.roomSnapshot.members.find((item) => item.id === 'coder')!
    const thread = await ensureRoomThread(f.deps, { id: 'group-discussion', roomId: room.id, requestId: request.id, member, kind: 'discussion' })
    const turnId = await enqueueRoomTurn(f.deps, thread.id, 'group-turn', 'Discuss')
    await f.h.turns.startNextQueuedTurn(thread.id)
    expect((await f.bridge.listTools(thread.id, turnId)).map((tool) => tool.name)).not.toContain('create_code_task')
    const result = await f.bridge.execute(thread.id, turnId, { toolName: 'create_code_task', args: { title: 'Bad', goal: 'Write', projectRoot: f.root },
      callId: 'group-dispatch', signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(await f.dispatch.list()).toHaveLength(0)
  })

  it('returns a task result through the original model and native Agent selection after future model changes', async () => {
    const f = await fixture()
    const { room, request } = await f.startPrivate()
    const thread = (await f.h.threadStore.get(request.threadId))!
    const source = thread.turns.find((turn) => turn.id === request.turnId)!
    source.harnessAgentId = 'original-native-agent'
    source.status = 'completed'
    await f.h.threadStore.upsert(thread)
    const requestRow = (await f.store.get<RoomRequestState>('request', request.id))!
    await f.store.commit({ requestId: 'finish-source', checks: [{ kind: 'request', id: request.id, expectedRevision: requestRow.revision }],
      puts: [{ kind: 'request', id: request.id, roomId: room.id, value: { ...requestRow.value, status: 'completed' } }] })
    await f.runtime.agents.update(f.coder.id, { clientRequestId: 'future-model', expectedRevision: f.coder.revision,
      executor: { ...f.coder.executor!, model: 'new-future-model' } })
    expect(await enqueuePrivateContinuation(f.deps, { threadId: thread.id, sourceTurnId: source.id, kind: 'workbench_task', key: 'outcome', prompt: 'Review this Code result.' })).toBe('queued')
    const returned = (await f.store.list<RoomRequestState>('request', { roomId: room.id })).find((row) => row.value.privateContinuation)!
    await f.runner.tick(returned)
    const resumed = (await f.h.threads.getMetadata(thread.id))!.turns.at(-1)!
    expect(resumed).toMatchObject({ model: 'original-model', harnessId: 'codex', credentialMode: 'native-login', harnessAgentId: 'original-native-agent' })
  })
})
