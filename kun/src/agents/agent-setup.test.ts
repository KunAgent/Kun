import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeHarness } from '../../tests/loop-test-harness.js'
import type { ModelClient } from '../ports/model-client.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { RoomRuntime } from '../rooms/room-runtime.js'
import type { RoomRequestState, RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import type { RoomMessage } from '../contracts/rooms.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { quickCreateAgent } from './agent-chat-entry.js'
import { AGENT_SETUP_PROMPT } from './agent-setup-prompt.js'
import { persistDirectChoiceMessages } from './agent-choice-messages.js'
import { AGENT_SETUP_ALLOWED_TOOLS, skipAgentSetup, startAgentSetupTurn } from './agent-setup.js'
import { agentSetupTools, COMMIT_AGENT_SETUP_TOOL } from './agent-setup-tools.js'
import { AgentDirectRunner } from './agent-direct-runner.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn() })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-agent-setup-'))
  const client: ModelClient = { provider: 'test', model: 'first', async *stream() {
    yield { kind: 'assistant_text_delta', text: 'Hello.' }
    yield { kind: 'completed', stopReason: 'stop' }
  } }
  const h = makeHarness(client)
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const deps: RoomRuntimeDeps = { dataDir: root, store, threads: h.threads, threadStore: h.threadStore,
    turns: h.turns, sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId), model: () => ({ model: 'first', providerId: 'test' }),
    profiles: () => ({}), assertOwnership: async () => {} }
  const runtime = new RoomRuntime(deps), runner = new AgentDirectRunner(deps, runtime.service)
  cleanup.push(async () => { await runtime.close(); await h.turns.interruptActiveTurns(); await store.close(); await rm(root, { recursive: true, force: true }) })
  return { root, h, store, deps, runtime, runner }
}

it('marks chat quick-create as pending and skips interview for default, template and form paths', async () => {
  const f = await fixture()
  const chat = await quickCreateAgent(f.runtime.agents, { clientRequestId: 'chat', setupMode: 'chat', name: '新 Agent' })
  expect((await f.runtime.agents.get(chat.agentId)).setup).toMatchObject({ status: 'pending' })
  const form = await quickCreateAgent(f.runtime.agents, { clientRequestId: 'form', setupMode: 'form', name: '手册 Agent' })
  expect((await f.runtime.agents.get(form.agentId)).setup).toBeUndefined()
  const template = await quickCreateAgent(f.runtime.agents, { clientRequestId: 'template', templateId: 'developer' })
  expect((await f.runtime.agents.get(template.agentId)).setup).toBeUndefined()
  const created = await quickCreateAgent(f.runtime.agents, { clientRequestId: 'default' }, true)
  expect((await f.runtime.agents.get(created.agentId)).setup).toBeUndefined()
  const filled = await f.runtime.agents.create({ clientRequestId: 'filled', name: 'Ada', instructions: 'Be precise' })
  expect(filled.agent.setup?.status).toBe('completed')
})

it('starts a hidden setup turn, injects the interview prompt, and restricts tools', async () => {
  const f = await fixture()
  const created = await quickCreateAgent(f.runtime.agents, { clientRequestId: 'chat', setupMode: 'chat', name: '新 Agent' })
  await startAgentSetupTurn({ service: f.runtime.service, store: f.store, agents: f.runtime.agents,
    wake: () => undefined, created, clientRequestId: 'chat' })
  const listed = await f.runtime.messages(created.roomId, 20)
  expect(listed.messages).toEqual([])
  expect((await f.store.list<RoomMessage>('message', { roomId: created.roomId })).some((row) => row.value.presentationKind === 'setup')).toBe(true)
  const request = (await f.store.list<RoomRequestState>('request', { roomId: created.roomId }))[0]
  await f.runner.tick(request)
  const prepared = (await f.store.get<RoomRequestState>('request', request.id))!
  expect(prepared.value.privateInput).toContain(AGENT_SETUP_PROMPT)
  expect(prepared.value.privateInput).toContain('Start the interview now.')
  await f.runner.tick(prepared)
  const thread = await f.h.threads.getMetadata((await f.store.get<RoomRequestState>('request', request.id))!.value.threadId)
  expect(thread?.roomContext?.allowedToolNames).toEqual([...AGENT_SETUP_ALLOWED_TOOLS])
  expect(thread?.roomContext?.blockedToolNames).toEqual(expect.arrayContaining(['list_collaboration_agents', 'read_room_rules']))
  expect(thread?.systemPrompt).not.toContain('Ask 3-6 short questions')
  expect(thread?.sandboxMode).toBe('workspace-write')
})

it('commits interviewed identity and treats profile edits or skip as a takeover that cancels the turn', async () => {
  const f = await fixture()
  const created = await quickCreateAgent(f.runtime.agents, { clientRequestId: 'chat', setupMode: 'chat', name: '新 Agent' })
  await startAgentSetupTurn({ service: f.runtime.service, store: f.store, agents: f.runtime.agents,
    wake: () => undefined, created, clientRequestId: 'chat' })
  const request = (await f.store.list<RoomRequestState>('request', { roomId: created.roomId }))[0]
  const thread = {
    ...createThreadRecord({
      id: 'setup-thread', title: 'Setup', workspace: f.root, model: 'first',
      roomContext: { roomId: created.roomId, memberId: created.agentId, participantAgentId: created.agentId, kind: 'conversation',
        allowedToolNames: [...AGENT_SETUP_ALLOWED_TOOLS], blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: [] }
    }),
    turns: [createTurnRecord({ id: 'turn_setup', threadId: 'setup-thread', prompt: 'Interview', status: 'running' })]
  }
  await f.h.threadStore.upsert(thread)
  const tool = agentSetupTools(f.h.threadStore)[0]
  const result = await tool.execute({ name: 'Ada', title: 'Researcher', instructions: 'Investigate with citations.' }, {
    threadId: thread.id, turnId: 'turn_setup', workspace: f.root
  } as never)
  expect(result.isError).toBeFalsy()
  expect((await f.runtime.agents.get(created.agentId))).toMatchObject({
    name: 'Ada', title: 'Researcher', setup: { status: 'completed' }
  })
  const pending = await quickCreateAgent(f.runtime.agents, { clientRequestId: 'skip', setupMode: 'chat', name: '新 Agent' })
  await startAgentSetupTurn({ service: f.runtime.service, store: f.store, agents: f.runtime.agents,
    wake: () => undefined, created: pending, clientRequestId: 'skip' })
  const unchanged = await f.runtime.agents.get(pending.agentId)
  await f.runtime.agents.update(pending.agentId, {
    clientRequestId: 'same', expectedRevision: unchanged.revision, name: unchanged.name
  })
  expect((await f.runtime.agents.get(pending.agentId)).setup?.status).toBe('pending')
  await f.runtime.agents.update(pending.agentId, {
    clientRequestId: 'edit', expectedRevision: unchanged.revision + 1, name: '手册名', title: unchanged.title,
    instructions: 'User wrote this.'
  })
  expect((await f.runtime.agents.get(pending.agentId)).setup?.status).toBe('skipped')
  const third = await quickCreateAgent(f.runtime.agents, { clientRequestId: 'cancel', setupMode: 'chat', name: '新 Agent' })
  await startAgentSetupTurn({ service: f.runtime.service, store: f.store, agents: f.runtime.agents,
    wake: () => undefined, created: third, clientRequestId: 'cancel' })
  await skipAgentSetup({
    agents: f.runtime.agents, store: f.store, inputs: f.h.userInputGate, turns: f.h.turns,
    agentId: third.agentId, clientRequestId: 'skip-now', wake: () => undefined
  })
  expect((await f.runtime.agents.get(third.agentId)).setup?.status).toBe('skipped')
  const cancelled = (await f.store.list<RoomRequestState>('request', { roomId: third.roomId }))[0]
  expect(cancelled.value.status).toBe('stopping')
  expect(cancelled.value.cancellationRequested).toBe(true)
})

it('persists a pending user_input as a public choice card without exposing the hidden kickoff', async () => {
  const f = await fixture()
  const created = await quickCreateAgent(f.runtime.agents, { clientRequestId: 'chat', setupMode: 'chat', name: '新 Agent' })
  await startAgentSetupTurn({ service: f.runtime.service, store: f.store, agents: f.runtime.agents,
    wake: () => undefined, created, clientRequestId: 'chat' })
  const request = (await f.store.list<RoomRequestState>('request', { roomId: created.roomId }))[0]
  await persistDirectChoiceMessages(f.store, request.value, [{
    id: 'in_q1', threadId: 'setup-thread', turnId: 'turn_setup', itemId: 'item', prompt: 'What should this Agent do?',
    questions: [{ header: '', id: 'q1', question: 'What should this Agent do?', options: [] }]
  }])
  const listed = await f.runtime.messages(created.roomId, 20)
  expect(listed.messages).toEqual([expect.objectContaining({
    presentationKind: 'choice', body: 'What should this Agent do?', clientRequestId: 'in_q1'
  })])
})

it('does not advertise commit_agent_setup outside a pending interview', async () => {
  const f = await fixture()
  const tool = agentSetupTools(f.h.threadStore)[0]
  expect(tool.name).toBe(COMMIT_AGENT_SETUP_TOOL)
  expect(tool.shouldAdvertise?.({ threadId: 't', turnId: 'u', workspace: f.root, roomAgent: true } as never)).toBe(false)
  expect(tool.shouldAdvertise?.({
    threadId: 't', turnId: 'u', workspace: f.root, roomAgent: true, allowedToolNames: [COMMIT_AGENT_SETUP_TOOL]
  } as never)).toBe(true)
})
