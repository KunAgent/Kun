import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentIdentitySchema } from '../contracts/agent-identities.js'
import { RoomMessageSchema, RoomSchema } from '../contracts/rooms.js'
import { CommitmentEffectSchema, CommitmentExecutionSchema } from '../contracts/collaboration-effects.js'
import { ContinueCommitmentResult, ManualFollowUpClaim } from '../contracts/collaboration-followup-api.js'
import { manualContinueIds } from '../agents/followup/manual-contract.js'
import { control, link, time, userEvidence } from '../rooms/room-collaboration-test-fixtures.js'
import { ManagerFollowUpWriteArbitration } from './followup-arbitration.js'
import { nativeManagerFixture, type NativeManagerFixture } from './followup-thread-test-support.js'
import { stageManualFollowUp } from './manual-followup-stage.js'
import { issueManualNativeFollowUpPermit } from './native-followup-permit-issuer.js'
import { reconcileManualFollowUp } from './manual-followup-reconcile.js'
import { makeUserItem } from '../domain/item.js'
import { resolveThreadAgentSurface } from '../domain/thread.js'
import { claimManualFollowUp } from './manual-followup-claim.js'
import { beginManualFollowUpDispatch } from './manual-followup-dispatch.js'
import { requestManagerJson } from './manager-client.js'
import { RemoteRoomStore } from './remote-room-store.js'
import { FollowUpService } from '../agents/followup/service.js'
import type { RoomRuntime } from '../rooms/room-runtime.js'
import type { RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import type { ThreadStore } from '../ports/thread-store.js'
import { registerAgentWorkRoutes } from '../server/routes/register-agent-work-routes.js'

const fixtures: NativeManagerFixture[] = []
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close() })

async function setup(manualFollowUpEnabled?: () => boolean) {
  const h = await nativeManagerFixture(undefined, undefined, {}, manualFollowUpEnabled)
  fixtures.push(h)
  const room = RoomSchema.parse({ schemaVersion: 1, id: 'room', name: 'Repair', defaultMemberId: 'member',
    members: [{ id: 'member', participantAgentId: 'agent', displayName: 'Agent', presetId: 'test', role: 'developer', revision: 0 }],
    repositories: [], revision: 0, createdAt: time, updatedAt: time })
  const message = RoomMessageSchema.parse({ id: 'message', roomId: 'room', messageSeq: 1, authorKind: 'user',
    authorLabelSnapshot: 'User', body: 'Continue the approved repair', bodyRevision: 0, mentionMemberIds: [],
    attachmentIds: [], status: 'final', createdAt: time })
  const agent = AgentIdentitySchema.parse({ schemaVersion: 1, id: 'agent', name: 'Agent', revision: 0,
    createdAt: time, updatedAt: time })
  const owner = { ...link(), nativeTarget: { threadId: 'thread', fingerprint: h.exec.permit!.native!.targetFingerprint } }
  await h.put('room', room.id, room)
  await h.put('message', message.id, message)
  await h.put('agent_identity', agent.id, agent)
  await h.put('agent_commitment', h.commitment.id, h.commitment)
  await h.put('commitment_control', 'commitment', control())
  await h.put('collaboration_policy', h.policy.id, h.policy)
  await h.put('commitment_link', owner.id, owner)
  const acquired = h.state.acquireResource({ resource: 'rooms-coordinator', ownerFlavor: 'production', ownerInstanceId: 'runtime' })
  const { resource, ownerFlavor, ownerInstanceId, fencingToken } = acquired.lease
  const fence = { resource, ownerFlavor, ownerInstanceId, fencingToken }
  const command = { sourceRoomId: 'room', linkId: 'link', expectedControlRevision: 0, expectedLinkRevision: 0,
    expectedPolicyRevision: 0, clientRequestId: 'user-click', userEvidence }
  const enabled = { value: true }, writes = new ManagerFollowUpWriteArbitration()
  const args = { state: h.state, store: h.data.roomStore, threads: h.data.threadStore, writes, fence,
    arbitration: h.scope.arbitration, enabled: () => enabled.value, participantAgentId: 'agent', commitmentId: 'commitment',
    command, now: () => new Date().toISOString() }
  return { h, room, message, agent, owner, command, enabled, args, writes }
}

type StageFixture = Awaited<ReturnType<typeof setup>>
async function prepareAdmission(f: StageFixture, begin = true) {
  const staged = await stageManualFollowUp(f.args)
  const effectRow = await f.h.data.roomStore.get('commitment_effect', staged.effectId)
  const effect = CommitmentEffectSchema.parse(effectRow?.value)
  const claim = await claimManualFollowUp({ ...f.args, attemptId: staged.attemptId })
  const permit = await issueManualNativeFollowUpPermit({ ...f.args, attemptId: staged.attemptId, claimToken: claim.token })
  if (begin) await beginManualFollowUpDispatch({ ...f.args, attemptId: staged.attemptId, claimToken: claim.token })
  const admission = { requestId: staged.requestId, effectId: staged.effectId, attemptId: staged.attemptId,
    admissionKey: effect.admissionKey, fingerprint: effect.fingerprint }
  const requestFingerprint = permit.native!.requestFingerprint
  const next = { ...f.h.next, turns: [{ ...f.h.next.turns[0], prompt: f.message.body,
    clientRequestId: staged.requestId, clientRequestFingerprint: requestFingerprint }],
    nativeFollowUpRequests: [{ ...f.h.row, admission, requestFingerprint }] }
  return { staged, permit, admission, next }
}

describe('Manager explicit manual follow-up staging', () => {
  it('atomically records the user action and stable pending effect without starting a turn', async () => {
    const f = await setup()
    const result = await stageManualFollowUp(f.args)
    const ids = manualContinueIds('room', 'commitment', f.command.clientRequestId)
    expect(result).toEqual({ requestId: ids.requestId, effectId: ids.effectId, attemptId: ids.attemptId, status: 'pending' })
    expect((await f.h.data.roomStore.get('collaboration_event', ids.eventId))?.value).toMatchObject({
      kind: 'user_continue', provenance: { kind: 'user_message', evidence: userEvidence }, userAction: { actionId: ids.requestId } })
    expect((await f.h.data.roomStore.get('commitment_event_binding', ids.bindingId))?.value)
      .toMatchObject({ eventId: ids.eventId, effectId: ids.effectId, consumption: 'reserved' })
    expect((await f.h.data.roomStore.get('commitment_effect', ids.effectId))?.value).toMatchObject({ status: 'pending' })
    expect((await f.h.data.roomStore.get('commitment_execution', ids.attemptId))?.value).toMatchObject({
      phase: 'reserved', nativeRequest: { request: { prompt: f.message.body, clientRequestId: ids.requestId } } })
    expect((await f.h.data.threadStore.get('thread'))?.turns).toHaveLength(0)
    expect(await stageManualFollowUp(f.args)).toEqual(result)
  })

  it('reuses a live claim and fences a replacement after expiry without dispatching', async () => {
    const f = await setup(), staged = await stageManualFollowUp(f.args)
    let clock = Date.now()
    const args = { ...f.args, attemptId: staged.attemptId, now: () => new Date(clock).toISOString() }
    const first = await claimManualFollowUp(args)
    expect(await claimManualFollowUp(args)).toEqual(first)
    clock += 61_000
    const second = await claimManualFollowUp(args)
    expect(second.token).toBe(first.token + 1)
    await expect(issueManualNativeFollowUpPermit({ ...args, claimToken: first.token })).rejects.toMatchObject({
      code: 'native_followup_permit_required' })
    await expect(issueManualNativeFollowUpPermit({ ...args, claimToken: second.token })).resolves.toHaveProperty('native')
    expect((await f.h.data.threadStore.get('thread'))?.turns).toHaveLength(0)
  })

  it('does not claim paused work or retry an unknown outcome', async () => {
    const paused = await setup(), staged = await stageManualFollowUp(paused.args)
    await paused.writes.run(() => paused.h.put('commitment_control', 'commitment', { ...control(),
      paused: true, generation: 1 }))
    await expect(claimManualFollowUp({ ...paused.args, attemptId: staged.attemptId })).rejects.toMatchObject({
      code: 'native_followup_permit_required' })
    expect((await paused.h.data.roomStore.get('commitment_effect', staged.effectId))?.value).toMatchObject({ status: 'pending' })

    const unknown = await setup(), pending = await stageManualFollowUp(unknown.args)
    await claimManualFollowUp({ ...unknown.args, attemptId: pending.attemptId })
    const row = await unknown.h.data.roomStore.get('commitment_effect', pending.effectId)
    const effect = CommitmentEffectSchema.parse(row?.value)
    await unknown.writes.run(() => unknown.h.put('commitment_effect', effect.id, { ...effect,
      status: 'outcome_unknown', retryAt: null, nextReconcileAt: time }))
    await expect(claimManualFollowUp({ ...unknown.args, attemptId: pending.attemptId })).rejects.toMatchObject({
      code: 'native_followup_permit_required' })
  })

  it('commits exactly one send decision; a lost reply can only reconcile', async () => {
    const f = await setup(), { staged } = await prepareAdmission(f, false)
    const args = { ...f.args, attemptId: staged.attemptId, claimToken: 1 }
    const decisions = await Promise.all([beginManualFollowUpDispatch(args), beginManualFollowUpDispatch(args)])
    expect(decisions.filter(item => item.shouldDispatch)).toHaveLength(1)
    expect(decisions.filter(item => !item.shouldDispatch)).toHaveLength(1)
    expect(decisions[0].dispatchId).toBe(decisions[1].dispatchId)
    const execution = CommitmentExecutionSchema.parse((await f.h.data.roomStore.get('commitment_execution', staged.attemptId))?.value)
    expect(execution.dispatch?.id).toBe(decisions[0].dispatchId)
    expect(execution.nextReconcileAt).toBeTruthy()
    expect(await beginManualFollowUpDispatch(args)).toEqual({ shouldDispatch: false, dispatchId: decisions[0].dispatchId })
    expect(await reconcileManualFollowUp({ ...args, sessions: f.h.data.sessionStore })).toMatchObject({ state: 'unknown' })
    await expect(claimManualFollowUp(args)).rejects.toMatchObject({ code: 'native_followup_permit_required' })
    expect((await f.h.data.threadStore.get('thread'))?.turns).toHaveLength(0)
  })

  it('preserves an issued permit on pause but blocks a stop before the send decision', async () => {
    const paused = await setup(), staged = await prepareAdmission(paused, false)
    await paused.writes.run(() => paused.h.put('commitment_control', 'commitment', { ...control(),
      paused: true, generation: 1 }))
    await expect(beginManualFollowUpDispatch({ ...paused.args, attemptId: staged.staged.attemptId, claimToken: 1 }))
      .resolves.toMatchObject({ shouldDispatch: true })
    const stopped = await setup(), pending = await prepareAdmission(stopped, false)
    await stopped.writes.run(() => stopped.h.put('commitment_control', 'commitment', { ...control(),
      paused: true, trackingEnabled: false, generation: 1, authorizationEpoch: 1, stoppedAt: time }))
    await expect(beginManualFollowUpDispatch({ ...stopped.args, attemptId: pending.staged.attemptId, claimToken: 1 }))
      .rejects.toMatchObject({ code: 'native_followup_permit_required' })
    const execution = CommitmentExecutionSchema.parse((await stopped.h.data.roomStore.get('commitment_execution', pending.staged.attemptId))?.value)
    expect(execution.dispatch).toBeUndefined()
  })

  it('can issue a permit only after the same staged effect has a current claim', async () => {
    const f = await setup()
    const { staged, permit, admission, next } = await prepareAdmission(f)
    expect(permit.native?.threadId).toBe('thread')
    expect((await f.h.data.roomStore.get('commitment_execution', staged.attemptId))?.value).toMatchObject({ phase: 'admitted', permit })
    await expect(f.h.send(next, { ...f.h.scope, admission })).resolves.toHaveProperty('result')
  })

  it.each(['message', 'agent'] as const)('rejects native enqueue if %s authority changes after permit issuance', async (changed) => {
    const f = await setup()
    const { admission, next } = await prepareAdmission(f)
    if (changed === 'message') await f.h.put('message', f.message.id, { ...f.message, bodyRevision: 1, body: 'Changed' })
    else await f.h.put('agent_identity', f.agent.id, { ...f.agent, archivedAt: time })
    await expect(f.h.send(next, { ...f.h.scope, admission })).rejects.toMatchObject({ status: 409 })
    expect((await f.h.data.threadStore.get('thread'))?.turns).toHaveLength(0)
  })

  it('rejects disabled, stale or non-user action evidence without writing an action', async () => {
    const f = await setup()
    f.enabled.value = false
    await expect(stageManualFollowUp(f.args)).rejects.toMatchObject({ code: 'native_followup_permit_required' })
    f.enabled.value = true
    await expect(stageManualFollowUp({ ...f.args, command: { ...f.command, expectedControlRevision: 1 } }))
      .rejects.toMatchObject({ code: 'native_followup_permit_required' })
    await f.h.put('message', f.message.id, { ...f.message, authorKind: 'member' })
    await expect(stageManualFollowUp(f.args)).rejects.toMatchObject({ code: 'native_followup_permit_required' })
    const ids = manualContinueIds('room', 'commitment', f.command.clientRequestId)
    expect(await f.h.data.roomStore.get('collaboration_event', ids.eventId)).toBeNull()
    expect(await f.h.data.roomStore.getRequest(ids.action)).toBeNull()
  })

  it('stages only an explicit feature-enabled HTTP request through the fenced remote client', async () => {
    const f = await setup(() => true)
    const held = f.h.scope.arbitration
    f.h.state.endResourceCommit(held.fence, held.commitId)
    f.h.state.releaseResource(held.fence)
    const remote = new RemoteRoomStore(f.h.connection, { getFence: () => f.args.fence })
    let enabled = false
    const wake = vi.fn()
    const manualFollowUp: NonNullable<RoomRuntimeDeps['manualFollowUp']> = {
      stage: (agentId, commitmentId, command) => remote.stageManualFollowUp(agentId, commitmentId, command),
      claim: (attemptId) => remote.claimManualFollowUp(attemptId),
      issue: (attemptId, claimToken) => remote.issueManualFollowUpPermit(attemptId, claimToken),
      beginDispatch: (attemptId, claimToken) => remote.beginManualFollowUpDispatch(attemptId, claimToken),
      reconcile: (attemptId) => remote.reconcileManualFollowUp(attemptId)
    }
    const service = new FollowUpService({ store: remote, assertOwnership: async () => undefined, manualFollowUp
    } as unknown as RoomRuntimeDeps, { features: () => ({ enabled, auto: false, github: false }), wake })
    const routes = new Map<string, Parameters<typeof registerAgentWorkRoutes>[0] extends
      (method: string, path: string, handle: infer H) => void ? H : never>()
    registerAgentWorkRoutes((method, path, handler) => routes.set(`${method} ${path}`, handler))
    const path = '/v1/agents/:agentId/commitments/:commitmentId/follow-up/continue'
    const handler = routes.get(`POST ${path}`)!
    const rooms = { followUp: service, exclusive: async (run: () => Promise<unknown>) => run() } as RoomRuntime
    const invoke = (value: unknown) => handler(rooms, new Request('http://localhost/follow-up/continue', {
      method: 'POST', body: JSON.stringify(value) }), { params: { agentId: 'agent', commitmentId: 'commitment' } })
    await expect(invoke(f.command)).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
    const ids = manualContinueIds('room', 'commitment', f.command.clientRequestId)
    expect(await f.h.data.roomStore.get('collaboration_event', ids.eventId)).toBeNull()
    enabled = true
    const result = ContinueCommitmentResult.parse(await invoke(f.command))
    expect(result).toMatchObject({ requestId: ids.requestId, status: 'pending' })
    expect(await invoke(f.command)).toEqual(result)
    expect(wake).toHaveBeenCalledTimes(2)
    const claim = await remote.claimManualFollowUp(result.attemptId)
    const permit = await remote.issueManualFollowUpPermit(result.attemptId, claim.token)
    expect(permit.native?.manualEventId).toBe(ids.eventId)
    expect(await remote.reconcileManualFollowUp(result.attemptId)).toMatchObject({ state: 'unknown', reason: 'native_request_not_proven' })
    await expect(remote.claimManualFollowUp(result.attemptId)).rejects.toMatchObject({ name: 'RoomStoreConflictError' })
    expect((await f.h.data.roomStore.events('room')).some(event => event.kind === 'agent.commitment.updated')).toBe(true)
    expect((await f.h.data.threadStore.get('thread'))?.turns).toHaveLength(0)
  })

  it('keeps a missing receiver outcome unknown and never reclaims it as an automatic retry', async () => {
    const f = await setup(), { staged } = await prepareAdmission(f)
    const args = { ...f.args, attemptId: staged.attemptId, sessions: f.h.data.sessionStore }
    const receipt = await reconcileManualFollowUp(args)
    expect(receipt).toMatchObject({ state: 'unknown', reason: 'native_request_not_proven' })
    expect((await f.h.data.roomStore.get('commitment_effect', staged.effectId))?.value)
      .toMatchObject({ status: 'outcome_unknown', retryAt: null, receipt: { state: 'unknown' } })
    expect((await f.h.data.roomStore.get('commitment_execution', staged.attemptId))?.value)
      .toMatchObject({ phase: 'reconciling', receipt: { state: 'unknown' } })
    await expect(claimManualFollowUp(args)).rejects.toMatchObject({ code: 'native_followup_permit_required' })
    expect((await f.h.data.threadStore.get('thread'))?.turns).toHaveLength(0)
  })

  it('records accepted and terminal receipts only from the durable native receiver', async () => {
    const f = await setup(), { staged, admission, next } = await prepareAdmission(f)
    const scope = { ...f.h.scope, admission }
    await f.h.send(next, scope)
    const prepared = (await f.h.data.threadStore.get('thread'))!
    const surface = resolveThreadAgentSurface(prepared)
    const item = makeUserItem({ id: f.h.row.userMessageItemId, threadId: prepared.id, turnId: f.h.row.turnId,
      text: f.message.body, workspace: prepared.workspace, historyRefId: prepared.historyRefId,
      threadAgentSurface: surface, agentSurface: prepared.turns[0].agentSurface })
    await f.h.data.executeSession('appendItem', { threadId: 'thread', item })
    const { admissionPending: _pending, ...turn } = prepared.turns[0]
    await f.h.send({ ...prepared, turns: [{ ...turn, admissionCompletedAt: new Date().toISOString() }] }, scope)
    const args = { ...f.args, attemptId: staged.attemptId, sessions: f.h.data.sessionStore }
    expect(await reconcileManualFollowUp(args)).toMatchObject({ state: 'accepted', targetRefId: 'turn' })
    expect((await f.h.data.roomStore.get('commitment_effect', staged.effectId))?.value)
      .toMatchObject({ status: 'succeeded', receipt: { state: 'accepted', targetRefId: 'turn' } })
    const ids = manualContinueIds('room', 'commitment', f.command.clientRequestId)
    expect((await f.h.data.roomStore.get('commitment_event_binding', ids.bindingId))?.value).toMatchObject({ consumption: 'consumed' })
    const unavailable = { get: async () => null, getMetadata: async () => null } as unknown as ThreadStore
    expect(await reconcileManualFollowUp({ ...args, threads: unavailable })).toMatchObject({
      state: 'unknown', reason: 'native_thread_unavailable' })
    expect((await f.h.data.roomStore.get('commitment_effect', staged.effectId))?.value)
      .toMatchObject({ status: 'succeeded', receipt: { state: 'accepted', targetRefId: 'turn' }, error: { code: 'OUTCOME_UNKNOWN' } })

    const queued = (await f.h.data.threadStore.get('thread'))!
    await f.h.send({ ...queued, turns: [{ ...queued.turns[0], status: 'running', startedAt: time }] }, { ...scope, stage: 'promote' })
    const running = (await f.h.data.threadStore.get('thread'))!
    await f.h.send({ ...running, turns: [{ ...running.turns[0], status: 'completed', finishedAt: time }] })
    expect(await reconcileManualFollowUp(args)).toMatchObject({ state: 'accepted', reason: 'native_terminal_boundary_unwinding' })
    const lease = f.h.state.lease('thread')!
    expect(f.h.state.releaseLease(lease)).toBe(true)
    expect(await reconcileManualFollowUp(args)).toMatchObject({ state: 'terminal', targetRefId: 'turn', terminalStatus: 'completed' })
    expect((await f.h.data.roomStore.get('commitment_execution', staged.attemptId))?.value)
      .toMatchObject({ phase: 'terminal', receipt: { state: 'terminal', terminalStatus: 'completed' } })
  })

  it('keeps the Manager route disabled by default', async () => {
    const f = await setup()
    const body = { participantAgentId: 'agent', commitmentId: 'commitment', command: f.command,
      fence: f.args.fence, arbitration: f.args.arbitration }
    await expect(requestManagerJson(f.h.connection, '/v1/data/room/stageManualFollowUp', { method: 'POST', body }))
      .rejects.toMatchObject({ status: 409 })
    const ids = manualContinueIds('room', 'commitment', f.command.clientRequestId)
    expect(await f.h.data.roomStore.get('collaboration_event', ids.eventId)).toBeNull()
  })

  it('requires a current fence and records and issues the same action through Manager RPC', async () => {
    const f = await setup(() => true)
    const body = { participantAgentId: 'agent', commitmentId: 'commitment', command: f.command,
      fence: f.args.fence, arbitration: f.args.arbitration }
    await expect(requestManagerJson(f.h.connection, '/v1/data/room/stageManualFollowUp', { method: 'POST',
      body: { ...body, arbitration: { ...body.arbitration, commitId: 'stale' } } })).rejects.toMatchObject({ status: 409 })
    const response = await requestManagerJson(f.h.connection, '/v1/data/room/stageManualFollowUp', { method: 'POST', body }) as { result: unknown }
    const staged = ContinueCommitmentResult.parse(response.result)
    const replay = await requestManagerJson(f.h.connection, '/v1/data/room/stageManualFollowUp', { method: 'POST', body }) as { result: unknown }
    expect(replay.result).toEqual(staged)
    const claimBody = { attemptId: staged.attemptId, fence: body.fence, arbitration: body.arbitration }
    const claimed = await requestManagerJson(f.h.connection, '/v1/data/room/claimManualFollowUp',
      { method: 'POST', body: claimBody }) as { result: unknown }
    const claim = ManualFollowUpClaim.parse(claimed.result)
    const replayClaim = await requestManagerJson(f.h.connection, '/v1/data/room/claimManualFollowUp',
      { method: 'POST', body: claimBody }) as { result: unknown }
    expect(replayClaim.result).toEqual(claim)
    const issue = { attemptId: staged.attemptId, claimToken: claim.token, fence: body.fence, arbitration: body.arbitration }
    const permit = await requestManagerJson(f.h.connection, '/v1/data/room/issueManualFollowUpPermit', { method: 'POST', body: issue }) as { result: unknown }
    expect(permit.result).toMatchObject({ native: { threadId: 'thread', manualEventId: manualContinueIds('room', 'commitment', f.command.clientRequestId).eventId } })
    const replayPermit = await requestManagerJson(f.h.connection, '/v1/data/room/issueManualFollowUpPermit', { method: 'POST', body: issue }) as { result: unknown }
    expect(replayPermit.result).toEqual(permit.result)
    const effectRow = (await f.h.data.roomStore.get('commitment_effect', staged.effectId))!
    const executionRow = (await f.h.data.roomStore.get('commitment_execution', staged.attemptId))!
    const effect = CommitmentEffectSchema.parse(effectRow.value), execution = CommitmentExecutionSchema.parse(executionRow.value)
    const receipt = { receiver: 'native' as const, requestId: staged.requestId, fingerprint: effect.fingerprint,
      state: 'accepted' as const, observedAt: time, targetRefId: 'forged-turn' }
    for (const [kind, row, value] of [
      ['commitment_effect', effectRow, { ...effect, status: 'succeeded', receipt }],
      ['commitment_execution', executionRow, { ...execution, phase: 'accepted', receipt }]
    ] as const) {
      await expect(requestManagerJson(f.h.connection, '/v1/data/room/commit', { method: 'POST', body: {
        input: { requestId: `forged-receipt-${kind}`, checks: [{ kind, id: row.id, expectedRevision: row.revision }],
          puts: [{ kind, id: row.id, value }] }, fence: body.fence, arbitration: body.arbitration } }))
        .rejects.toMatchObject({ status: 409, code: 'native_followup_permit_required' })
    }
    const ids = manualContinueIds('room', 'commitment', f.command.clientRequestId)
    for (const [kind, id] of [['collaboration_event', ids.eventId], ['commitment_event_binding', ids.bindingId],
      ['commitment_effect', ids.effectId], ['commitment_execution', ids.attemptId]] as const) {
      await expect(requestManagerJson(f.h.connection, '/v1/data/room/commit', { method: 'POST', body: {
        input: { requestId: `delete-manual-${kind}`, deletes: [{ kind, id }] }, fence: body.fence, arbitration: body.arbitration } }))
        .rejects.toMatchObject({ status: 400, code: 'validation_error' })
    }
    expect(await f.h.data.roomStore.get('commitment_effect', staged.effectId)).toEqual(effectRow)
    expect(await f.h.data.roomStore.get('commitment_execution', staged.attemptId)).toEqual(executionRow)
  })

  it('rejects changed replay input and a second action while the first outcome is unsettled', async () => {
    const f = await setup()
    await stageManualFollowUp(f.args)
    await expect(stageManualFollowUp({ ...f.args, command: { ...f.command, expectedPolicyRevision: 2 } }))
      .rejects.toMatchObject({ code: 'native_followup_permit_required' })
    await expect(stageManualFollowUp({ ...f.args, command: { ...f.command, clientRequestId: 'another-click' } }))
      .rejects.toMatchObject({ code: 'native_followup_permit_required' })
  })

  it('does not replay a previously recorded action after tracking stops or its evidence disappears', async () => {
    const f = await setup()
    await stageManualFollowUp(f.args)
    await f.writes.run(() => f.h.put('commitment_control', 'commitment', { ...control(), trackingEnabled: false,
      paused: true, generation: 1, authorizationEpoch: 1, stoppedAt: time }))
    await expect(stageManualFollowUp(f.args)).rejects.toMatchObject({ code: 'native_followup_permit_required' })
  })
})
