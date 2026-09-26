import { applyRoomToolPolicy } from '../loop/room-turn-policy.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RoomMemberSchema, type Room, type RoomMessage } from '../contracts/rooms.js'
import type { RoomProposalEntry } from '../contracts/room-proposals.js'
import type { RoomRuntimeDeps, RoomRequestState } from './room-runtime-types.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { makeFakeModel, makeHarness } from '../../tests/loop-test-harness.js'
import { RoomService } from './room-service.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { AgentIdentityService } from '../agents/agent-identity-service.js'
import { RoomPeerRunner } from './room-peer-runner.js'
import { bindRoomPeerStore } from './room-peer-tools.js'
import {
  createRoomProposal,
  readRoomProposal,
  resolveRoomProposal,
  withdrawRunProposals,
  ROOM_PROPOSAL_RUN_LIMIT,
  ROOM_PROPOSAL_ROOM_OPEN_LIMIT
} from './room-proposals.js'
import { roomProposalTool } from './room-proposal-tool.js'

const cleanups: Array<() => Promise<void>> = []
let resolveSerial = 0
const resolveId = () => 'resolve-' + ++resolveSerial
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'room-proposals-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const wake = vi.fn()
  const service = new RoomService(store, wake)
  const agents = new AgentIdentityService(store, () => ({}))
  const room = (await service.create({
    clientRequestId: 'room', name: 'Proposals', collaborationMode: 'peer',
    members: [
      RoomMemberSchema.parse({ id: 'developer', displayName: 'Developer', role: 'developer',
        presetId: 'developer', participantAgentId: 'agent-dev', revision: 0 }),
      RoomMemberSchema.parse({ id: 'reviewer', displayName: 'Reviewer', role: 'reviewer',
        presetId: 'reviewer', revision: 0 })
    ]
  })).room
  const input = (overrides: Record<string, unknown> = {}) => ({
    clientRequestId: 'draft', originRunId: 'run-1', authorMemberId: 'developer',
    authorLabelSnapshot: 'Developer', rationale: 'Worth pinning.',
    payload: { kind: 'pin_agreement', body: 'Agreements stay durable.' },
    ...overrides
  })
  cleanups.push(async () => { await store.close(); await rm(root, { recursive: true, force: true }) })
  return { root, store, service, room, agents, wake, input }
}

describe('room proposal drafts', () => {
  it('atomically writes the proposal and presentation message without inbox, request or budget work', async () => {
    const f = await fixture()
    const created = await createRoomProposal(f.store, f.room.id, f.input())
    const proposal = await readRoomProposal(f.store, f.room.id, created.proposal.proposalId)
    expect(proposal).toMatchObject({ status: 'open', authorMemberId: 'developer', originRunId: 'run-1' })
    const message = (await f.store.get<RoomMessage>('message', proposal.messageId))!.value
    expect(message).toMatchObject({
      presentationKind: 'proposal', proposalId: proposal.proposalId,
      authorKind: 'member', authorMemberId: 'developer', status: 'final',
      body: 'Worth pinning.'
    })
    const events = await f.store.events(f.room.id)
    expect(events.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['message.presentation.created', 'room.proposal.updated']))
    // Presentation-only: no wake, inbox, request, task or budget documents.
    expect(f.wake).not.toHaveBeenCalled()
    for (const kind of ['request', 'peer_inbox', 'task', 'agent_budget', 'agent_budget_claim'] as const) {
      expect(await f.store.list(kind, { roomId: f.room.id })).toHaveLength(0)
    }
  })

  it('replays creation idempotently and rejects conflicting request reuse', async () => {
    const f = await fixture()
    const first = await createRoomProposal(f.store, f.room.id, f.input())
    expect(await createRoomProposal(f.store, f.room.id, f.input())).toEqual(first)
    expect(await f.store.list('room_proposal', { roomId: f.room.id })).toHaveLength(1)
    expect(await f.store.list('message', { roomId: f.room.id })).toHaveLength(1)
    await expect(createRoomProposal(f.store, f.room.id, f.input({ rationale: 'Different.' })))
      .rejects.toThrow('identity reused')
    await expect(createRoomProposal(f.store, f.room.id, f.input({
      clientRequestId: 'other-author', authorMemberId: 'nobody' }))).rejects.toThrow('member')
    await expect(createRoomProposal(f.store, f.room.id, f.input({
      clientRequestId: 'bad-payload', payload: { kind: 'pin_agreement', body: ' ' } }))).rejects.toThrow()
  })

  it('enforces the per-run and per-room open limits', async () => {
    const f = await fixture()
    await createRoomProposal(f.store, f.room.id, f.input({ clientRequestId: 'a' }))
    await createRoomProposal(f.store, f.room.id, f.input({ clientRequestId: 'b' }))
    expect(ROOM_PROPOSAL_RUN_LIMIT).toBe(2)
    await expect(createRoomProposal(f.store, f.room.id, f.input({ clientRequestId: 'c' })))
      .rejects.toThrow('run proposal limit')
    const resolved = await readRoomProposal(f.store, f.room.id,
      (await f.store.list('room_proposal', { roomId: f.room.id, limit: 1 }))[0].id)
    await resolveRoomProposal(f.store, f.room.id, resolved.proposalId, {
      clientRequestId: 'dismiss', expectedRevision: resolved.revision, decision: 'dismissed' })
    // A closed slot frees room capacity but the run cap still applies to the same run.
    await createRoomProposal(f.store, f.room.id, f.input({ clientRequestId: 'd', originRunId: 'run-2' }))
    for (let index = 0; index < ROOM_PROPOSAL_ROOM_OPEN_LIMIT - 2; index += 1) {
      await createRoomProposal(f.store, f.room.id, f.input({
        clientRequestId: 'bulk-' + index, originRunId: 'run-bulk-' + index }))
    }
    await expect(createRoomProposal(f.store, f.room.id, f.input({
      clientRequestId: 'overflow', originRunId: 'run-overflow' }))).rejects.toThrow('open proposal limit')
  })

  it('resolves the state machine idempotently and survives concurrent conflicts', async () => {
    const f = await fixture()
    const proposal = (await createRoomProposal(f.store, f.room.id, f.input())).proposal
    const entry = await readRoomProposal(f.store, f.room.id, proposal.proposalId)
    await expect(resolveRoomProposal(f.store, f.room.id, proposal.proposalId, {
      clientRequestId: 'commit', expectedRevision: entry.revision, decision: 'committed' }))
      .rejects.toThrow('result reference')
    const stale = resolveRoomProposal(f.store, f.room.id, proposal.proposalId, {
      clientRequestId: 'stale', expectedRevision: entry.revision + 9, decision: 'dismissed' })
    await expect(stale).rejects.toThrow('changed')
    const dismissed = await resolveRoomProposal(f.store, f.room.id, proposal.proposalId, {
      clientRequestId: 'dismiss', expectedRevision: entry.revision, decision: 'dismissed' })
    expect(dismissed.status).toBe('dismissed')
    expect(await resolveRoomProposal(f.store, f.room.id, proposal.proposalId, {
      clientRequestId: 'dismiss', expectedRevision: entry.revision, decision: 'dismissed' })).toEqual(dismissed)
    await expect(resolveRoomProposal(f.store, f.room.id, proposal.proposalId, {
      clientRequestId: 'again', expectedRevision: dismissed.revision, decision: 'dismissed' }))
      .rejects.toThrow('not open')
    const second = (await createRoomProposal(f.store, f.room.id, f.input({ clientRequestId: 'two', originRunId: 'run-2' }))).proposal
    const current = await readRoomProposal(f.store, f.room.id, second.proposalId)
    const [winner, loser] = await Promise.allSettled([
      resolveRoomProposal(f.store, f.room.id, second.proposalId, {
        clientRequestId: 'one', expectedRevision: current.revision, decision: 'dismissed' }),
      resolveRoomProposal(f.store, f.room.id, second.proposalId, {
        clientRequestId: 'two', expectedRevision: current.revision, decision: 'dismissed' })
    ])
    expect([winner.status, loser.status].sort()).toEqual(['fulfilled', 'rejected'])
    expect((await readRoomProposal(f.store, f.room.id, second.proposalId)).status).toBe('dismissed')
  })

  it('withdraws every still-open draft of a cancelled run only', async () => {
    const f = await fixture()
    await createRoomProposal(f.store, f.room.id, f.input({ clientRequestId: 'a' }))
    await createRoomProposal(f.store, f.room.id, f.input({ clientRequestId: 'b' }))
    await createRoomProposal(f.store, f.room.id, f.input({ clientRequestId: 'c', originRunId: 'other-run' }))
    expect(await withdrawRunProposals(f.store, 'run-1', 'run_cancelled')).toBe(2)
    const rows = await f.store.list<RoomProposalEntry>('room_proposal', { roomId: f.room.id, limit: 10 })
    const byRun = new Map(rows.map((row) => [row.value.originRunId, row.value]))
    expect(byRun.get('run-1')).toMatchObject({ status: 'withdrawn', withdrawnReason: 'run_cancelled' })
    expect(byRun.get('other-run')?.status).toBe('open')
    expect(rows.filter((row) => row.value.status === 'withdrawn')).toHaveLength(2)
    expect(await withdrawRunProposals(f.store, 'run-1', 'run_cancelled')).toBe(0)
  })
})

describe('room proposal result validation', () => {
  it('requires the pinned rule to belong to this proposal message', async () => {
    const f = await fixture()
    const proposal = (await createRoomProposal(f.store, f.room.id, f.input())).proposal
    const entry = await readRoomProposal(f.store, f.room.id, proposal.proposalId)
    const resolve = (resultRef?: { kind: 'rule'; id: string }) =>
      resolveRoomProposal(f.store, f.room.id, proposal.proposalId, {
        clientRequestId: resolveId(), expectedRevision: entry.revision,
        decision: 'committed', resultRef })
    const other = await f.service.send(f.room.id, { clientRequestId: 'other', body: 'Other message' })
    const wrong = (await f.service.rule(f.room.id, other.message.id, 'wrong-rule')).result as { id: string }
    await expect(resolve({ kind: 'rule', id: wrong.id })).rejects.toThrow('proposal message')
    const rule = (await f.service.rule(f.room.id, proposal.messageId, 'pin')).result as { id: string }
    const committed = await resolve({ kind: 'rule', id: rule.id })
    expect(committed).toMatchObject({ status: 'committed', resultRef: { kind: 'rule', id: rule.id } })
    expect(committed.resolvedAt).toBeTruthy()
  })

  it('requires a newer user message for execution requests', async () => {
    const f = await fixture()
    const before = await f.service.send(f.room.id, { clientRequestId: 'before', body: 'Old request' })
    const proposal = (await createRoomProposal(f.store, f.room.id, f.input({
      clientRequestId: 'execute', payload: { kind: 'execution_request', goal: 'Do the port', memberIds: ['developer'] }
    }))).proposal
    const entry = await readRoomProposal(f.store, f.room.id, proposal.proposalId)
    const resolve = (id: string) => resolveRoomProposal(f.store, f.room.id, proposal.proposalId, {
      clientRequestId: resolveId(), expectedRevision: entry.revision,
      decision: 'committed', resultRef: { kind: 'message', id } })
    await expect(resolve(before.message.id)).rejects.toThrow('newer user message')
    const member = (await createRoomProposal(f.store, f.room.id, f.input({
      clientRequestId: 'shadow', originRunId: 'run-2' }))).proposal
    await expect(resolve(member.messageId)).rejects.toThrow('newer user message')
    const sent = await f.service.send(f.room.id, { clientRequestId: 'adopt', body: 'Do the port please' })
    expect(await resolve(sent.message.id)).toMatchObject({ status: 'committed' })
  })

  it('requires the proposed agent to be an enabled member for add_member', async () => {
    const f = await fixture()
    const proposal = (await createRoomProposal(f.store, f.room.id, f.input({
      clientRequestId: 'member', payload: { kind: 'add_member', participantAgentId: 'agent-new', roleNotes: 'Review' }
    }))).proposal
    const entry = await readRoomProposal(f.store, f.room.id, proposal.proposalId)
    const resolve = () => resolveRoomProposal(f.store, f.room.id, proposal.proposalId, {
      clientRequestId: resolveId(), expectedRevision: entry.revision,
      decision: 'committed', resultRef: { kind: 'room', id: f.room.id } })
    await expect(resolve()).rejects.toThrow('not an enabled room member')
    const row = (await f.store.get<Room>('room', f.room.id))!
    const updated = { ...row.value, members: [...row.value.members, RoomMemberSchema.parse({
      id: 'member-new', displayName: 'New Agent', role: 'developer', presetId: 'developer',
      participantAgentId: 'agent-new', revision: 0 })] }
    await f.store.commit({ requestId: 'add-member', checks: [{ kind: 'room', id: f.room.id, expectedRevision: row.revision }],
      puts: [{ kind: 'room', id: f.room.id, roomId: f.room.id, value: updated }] })
    expect(await resolve()).toMatchObject({ status: 'committed', resultRef: { kind: 'room', id: f.room.id } })
  })

  it('requires a newly created agent identity for create_agent', async () => {
    const f = await fixture()
    const old = (await f.agents.create({ clientRequestId: 'old', name: 'Old Agent' })).agent
    const proposal = (await createRoomProposal(f.store, f.room.id, f.input({
      clientRequestId: 'agent', payload: { kind: 'create_agent', name: 'New Agent', title: '', instructions: '' }
    }))).proposal
    const entry = await readRoomProposal(f.store, f.room.id, proposal.proposalId)
    const resolve = (id: string) => resolveRoomProposal(f.store, f.room.id, proposal.proposalId, {
      clientRequestId: resolveId(), expectedRevision: entry.revision,
      decision: 'committed', resultRef: { kind: 'agent', id } })
    await expect(resolve('missing-agent')).rejects.toThrow('not created after')
    await expect(resolve(old.id)).rejects.toThrow('not created after')
    const fresh = (await f.agents.create({ clientRequestId: 'new', name: 'New Agent' })).agent
    expect(await resolve(fresh.id)).toMatchObject({ status: 'committed', resultRef: { kind: 'agent', id: fresh.id } })
  })
})

describe('propose_room_action tool binding', () => {
  async function invited() {
    const f = await fixture()
    const h = makeHarness(makeFakeModel([]))
    const deps: RoomRuntimeDeps = { store: f.store, threads: h.threads, threadStore: h.threadStore, turns: h.turns,
      sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate, dataDir: f.root,
      runTurn: (id, turnId) => h.loop.runTurn(id, turnId), model: () => ({ model: 'fake' }), profiles: () => ({}),
      assertOwnership: async () => {} }
    const runner = new RoomPeerRunner(deps, () => {})
    cleanups.push(async () => { await runner.close(); await h.turns.interruptActiveTurns() })
    bindRoomPeerStore(h.threadStore, f.store)
    if (!(await f.store.get('agent_identity', 'agent-dev')))
      await f.store.commit({ requestId: 'seed-agent', checks: [{ kind: 'agent_identity', id: 'agent-dev', expectedRevision: null }],
        puts: [{ kind: 'agent_identity', id: 'agent-dev', value: { schemaVersion: 1, id: 'agent-dev', name: 'Dev',
          title: '', instructions: '', defaultRole: 'developer', presetId: 'developer', revision: 0,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), memory: { readEnabled: true, captureEnabled: true } } }] })
    const sent = await f.service.send(f.room.id, { clientRequestId: 'topic', body: 'Discuss the draft',
      executionIntent: 'discussion', mentionMemberIds: ['developer'] })
    const request = (await f.store.get<RoomRequestState>('request', sent.requestId))!
    await runner.state.initialize(request.value)
    await runner.tick()
    const member = (await runner.state.member(request.id, 'developer'))!
    const active = member.value.activation!
    const thread = (await h.threads.getMetadata(active.threadId))!
    await h.threadStore.upsert({ ...thread, turns: thread.turns.map((turn) =>
      turn.id === active.turnId ? { ...turn, status: 'running' } : turn) })
    const context: ToolHostContext = applyRoomToolPolicy({ threadId: thread.id, turnId: active.turnId!,
      workspace: thread.workspace, sandboxMode: 'read-only', approvalPolicy: 'auto', threadMode: 'plan',
      abortSignal: new AbortController().signal, awaitApproval: async () => 'allow', activeToolCallId: 'call-propose',
      roomStepKind: 'discussion', roomPeer: true, allowedToolNames: thread.roomContext?.allowedToolNames }, thread)
    return { ...f, h, runner, request, thread, context, tool: roomProposalTool(h.threadStore) }
  }

  it('advertises only in discussion and conversation steps and stages an idempotent draft', async () => {
    const f = await invited()
    expect(f.thread.roomContext?.allowedToolNames).toContain('propose_room_action')
    expect(f.context.allowedToolNames).toContain('propose_room_action')
    expect(f.tool.shouldAdvertise?.(f.context)).toBe(true)
    expect(f.tool.shouldAdvertise?.({ ...f.context, roomStepKind: 'execution' })).toBe(false)
    expect(f.tool.shouldAdvertise?.({ ...f.context, roomStepKind: 'review' })).toBe(false)
    expect(f.tool.shouldAdvertise?.({ ...f.context, roomAgent: false })).toBe(false)
    const draft = {
      payload: { kind: 'pin_agreement', body: 'Use the shared rule format.' },
      rationale: 'Both members suggested it.'
    }
    const inboxBefore = (await f.store.list('peer_inbox', { roomId: f.room.id })).length
    const first = await f.tool.execute(draft, f.context)
    expect(first).toMatchObject({ output: { accepted: true } })
    const proposalId = (first.output as { proposalId: string }).proposalId
    const again = await f.tool.execute(draft, f.context)
    expect((again.output as { proposalId: string }).proposalId).toBe(proposalId)
    const proposal = await readRoomProposal(f.store, f.room.id, proposalId)
    expect(proposal).toMatchObject({ status: 'open', originRunId: expect.any(String), rootRequestId: f.request.id })
    expect((first.output as { note?: string }).note).toMatch(/confirm/i)
    // No inbox delivery and no budget consumption came from the draft.
    expect(await f.store.list('peer_inbox', { roomId: f.room.id })).toHaveLength(inboxBefore)
    expect(await f.store.list('agent_budget_claim', { roomId: f.room.id })).toHaveLength(0)
  })

  it('rejects spoofed, stale, disabled and invalid proposals without side effects', async () => {
    const f = await invited()
    const inboxBefore = (await f.store.list('peer_inbox', { roomId: f.room.id })).length
    const draft = { payload: { kind: 'pin_agreement', body: 'x' }, rationale: 'r' }
    expect(await f.tool.execute(draft, { ...f.context, turnId: 'wrong' })).toMatchObject({ isError: true })
    expect(await f.tool.execute({ payload: { kind: 'pin_agreement' }, rationale: 'r' }, f.context))
      .toMatchObject({ isError: true })
    expect(await f.tool.execute({ payload: { kind: 'execution_request', goal: 'g', memberIds: ['nobody'] }, rationale: 'r' }, f.context))
      .toMatchObject({ isError: true, output: { error: expect.stringContaining('enabled room member') } })
    expect(await f.tool.execute({ payload: { kind: 'execution_request', goal: 'g', memberIds: [], repositoryId: 'other-repo' }, rationale: 'r' }, f.context))
      .toMatchObject({ isError: true, output: { error: expect.stringContaining('belong to this room') } })
    const duplicate = { payload: { kind: 'add_member', participantAgentId: 'agent-dev', roleNotes: '' }, rationale: 'r' }
    if (!(await f.store.get('agent_identity', 'agent-dev')))
      await f.store.commit({ requestId: 'seed-agent', checks: [{ kind: 'agent_identity', id: 'agent-dev', expectedRevision: null }],
        puts: [{ kind: 'agent_identity', id: 'agent-dev', value: { schemaVersion: 1, id: 'agent-dev', name: 'Dev',
          title: '', instructions: '', defaultRole: 'developer', presetId: 'developer', revision: 0,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), memory: { readEnabled: true, captureEnabled: true } } }] })
    expect(await f.tool.execute(duplicate, f.context)).toMatchObject({ isError: true, output: { error: expect.stringContaining('already a room member') } })
    const featurePut = async (patch: Record<string, boolean>, requestId: string) => {
      const row = await f.store.get('agent_features', 'features')
      const features = row?.value as Record<string, boolean> | undefined
      await f.store.commit({ requestId, checks: [{ kind: 'agent_features', id: 'features', expectedRevision: row?.revision ?? null }],
        puts: [{ kind: 'agent_features', id: 'features',
          value: { identities: true, memory: true, collaboration: true, proposals: true, ...features, ...patch } }] })
    }
    // create_agent needs the identity feature; all proposals need the proposal flag.
    await featurePut({ identities: false }, 'features-no-identities')
    expect(await f.tool.execute({ payload: { kind: 'create_agent', name: 'Writer', title: '', instructions: '' }, rationale: 'r' }, f.context))
      .toMatchObject({ isError: true, output: { error: expect.stringContaining('disabled') } })
    await featurePut({ identities: true, proposals: false }, 'features-off')
    expect(await f.tool.execute(draft, f.context)).toMatchObject({ isError: true, output: { error: expect.stringContaining('disabled') } })
    expect(await f.store.list('room_proposal', { roomId: f.room.id })).toHaveLength(0)
    expect(await f.store.list('peer_inbox', { roomId: f.room.id })).toHaveLength(inboxBefore)
  })
})
