import { access, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { base, link, control, time, userEvidence } from '../rooms/room-collaboration-test-fixtures.js'
import { TurnSchema } from '../contracts/turns.js'
import { makeUserItem } from '../domain/item.js'
import { resolveThreadAgentSurface } from '../domain/thread.js'
import { nativeManagerFixture, type NativeManagerFixture } from './followup-thread-test-support.js'

const fixtures: NativeManagerFixture[] = []
async function fixture(prompt?: string, model?: string) { const h = await nativeManagerFixture(prompt, model); fixtures.push(h); return h }
afterEach(async () => { for (const h of fixtures.splice(0)) await h.close() })
const get = async (h: NativeManagerFixture) => (await h.data.executeThread('get', { threadId: 'thread' })) as typeof h.thread
const committed = async (h: NativeManagerFixture, thread: typeof h.thread) => {
  const turn = thread.turns.find((candidate) => candidate.id === h.row.turnId)!
  const item = makeUserItem({ id: h.row.userMessageItemId, threadId: thread.id, turnId: h.row.turnId,
    text: h.exec.nativeRequest.request.prompt, workspace: thread.workspace, historyRefId: thread.historyRefId,
    threadAgentSurface: resolveThreadAgentSurface(thread), agentSurface: turn.agentSurface })
  await h.data.executeSession('appendItem', { threadId: thread.id, item })
  return { ...thread, turns: thread.turns.map(({ admissionPending: _pending, ...turn }) => ({ ...turn, admissionCompletedAt: time })) }
}

describe('native admission at the physical Manager ThreadStore boundary', () => {
  it.each(['thread', 'workbench_link', 'room_task'] as const)('rejects flag-free start and enqueue through %s ownership aliases', async (kind) => {
    const h = await fixture()
    if (kind === 'room_task') await h.put('task', 'task', { task: { executionThreadId: 'thread' } })
    await h.put('commitment_link', 'link', link('link', kind === 'thread' ? { kind, threadId: 'thread' }
      : kind === 'workbench_link' ? { kind, threadId: 'thread', linkId: 'workbench' } : { kind, taskId: 'task' }))
    expect(await h.data.roomStore.collaborationQuery({ kind: 'owned_thread', threadId: 'thread' })).toMatchObject([{ id: 'link' }])
    for (const conditional of [true, false]) for (const status of ['queued', 'running'] as const) {
      const raw = { ...h.thread, turns: [TurnSchema.parse({ id: 'raw', threadId: 'thread', status,
        prompt: 'Bypass without native fields', createdAt: time })] }
      await expect(h.send(raw, undefined, conditional)).rejects.toMatchObject({ status: 409 })
      expect((await get(h)).turns).toHaveLength(0)
    }
  })

  it('does not give referenced links execution authority or change ordinary unowned admission', async () => {
    const h = await fixture()
    await h.put('commitment_link', 'reference', { ...link('reference'), ownership: 'referenced' })
    const next = { ...h.thread, turns: [TurnSchema.parse({ id: 'ordinary', threadId: 'thread', status: 'running',
      prompt: 'Ordinary user task', createdAt: time })] }
    await expect(h.send(next)).resolves.toHaveProperty('result')
    expect((await get(h)).turns[0].id).toBe('ordinary')
  })

  it('rejects a raw queued-to-running promotion, not only new turn creation', async () => {
    const h = await fixture()
    await h.put('commitment_link', 'link', link())
    const { nativeFollowUpRequests: _rows, ...raw } = h.next
    await h.data.executeThread('upsert', { thread: raw })
    const before = await get(h)
    await expect(h.send({ ...before, turns: [{ ...before.turns[0], status: 'running', startedAt: time }] }))
      .rejects.toMatchObject({ status: 409 })
    expect(await get(h)).toEqual(before)
  })

  it('allows a preissued immutable native permission, durable acknowledgement and current-owner progress', async () => {
    const h = await fixture(); await h.seed()
    await expect(h.send(h.next, h.scope)).resolves.toHaveProperty('result')
    const prepared = await get(h)
    const acknowledged = await committed(h, prepared)
    await expect(h.send(acknowledged)).rejects.toMatchObject({ status: 409 })
    expect((await get(h)).nativeFollowUpRequests?.[0].phase).toBe('preparing')
    await expect(h.send(acknowledged, h.scope)).resolves.toHaveProperty('result')
    const accepted = await get(h)
    expect(accepted.nativeFollowUpRequests?.[0].phase).toBe('admitted')
    await expect(h.send({ ...accepted, turns: [{ ...accepted.turns[0], status: 'running', startedAt: time }] },
      { ...h.scope, stage: 'promote' })).resolves.toHaveProperty('result')
    const running = await get(h)
    expect(running.nativeFollowUpRequests?.[0].executionStartedAt).toBe(time)
    await expect(h.send({ ...running, turns: [{ ...running.turns[0], error: 'progress note' }] }))
      .resolves.toHaveProperty('result')
  })

  it('rejects changing the linked model through an otherwise valid native request', async () => {
    const h = await fixture(undefined, 'different-model'); await h.seed()
    await expect(h.send(h.next, h.scope)).rejects.toMatchObject({ status: 409 })
    expect((await get(h)).turns).toHaveLength(0)
  })

  it('rejects extra canonical user-message context, even when its prompt matches', async () => {
    const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
    await h.send(await committed(h, await get(h)), h.scope)
    await h.data.executeSession('updateItem', { threadId: h.thread.id, itemId: h.row.userMessageItemId,
      patch: { fileReferences: [{ path: '/private/file', relativePath: 'private/file', name: 'file' }] } })
    const queued = await get(h)
    await expect(h.send({ ...queued, turns: [{ ...queued.turns[0], status: 'running', startedAt: time }] },
      { ...h.scope, stage: 'promote' })).rejects.toMatchObject({ status: 409 })
    expect((await get(h)).turns[0].status).toBe('queued')
  })

  it('rejects another durable item injected into the queued native turn', async () => {
    const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
    await h.send(await committed(h, await get(h)), h.scope)
    const extra = makeUserItem({ id: 'extra-user-item', threadId: h.thread.id, turnId: h.row.turnId,
      text: 'Unapproved extra instructions' })
    await h.data.executeSession('appendItem', { threadId: h.thread.id, item: extra })
    const queued = await get(h)
    await expect(h.send({ ...queued, turns: [{ ...queued.turns[0], status: 'running', startedAt: time }] },
      { ...h.scope, stage: 'promote' })).rejects.toMatchObject({ status: 409 })
    expect((await get(h)).turns[0].status).toBe('queued')
  })

  it('fails closed rather than trusting a truncated item with oversized hidden metadata', async () => {
    const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
    await h.send(await committed(h, await get(h)), h.scope)
    await h.data.executeSession('updateItem', { threadId: h.thread.id, itemId: h.row.userMessageItemId,
      patch: { displayText: 'x'.repeat(1024 * 1024) } })
    const queued = await get(h)
    await expect(h.send({ ...queued, turns: [{ ...queued.turns[0], status: 'running', startedAt: time }] },
      { ...h.scope, stage: 'promote' })).rejects.toMatchObject({ status: 409 })
    expect((await get(h)).turns[0].status).toBe('queued')
  })

  it('requires a live native turn lease before promotion', async () => {
    const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
    await h.send(await committed(h, await get(h)), h.scope)
    const queued = await get(h)
    await expect(h.send({ ...queued, turns: [{ ...queued.turns[0], status: 'running', startedAt: time }] },
      { ...h.scope, stage: 'promote' }, true, false, false)).rejects.toMatchObject({ status: 409 })
    expect((await get(h)).turns[0].status).toBe('queued')
  })

  it('rejects a lease for a different turn or runtime owner', async () => {
    for (const variant of ['turn', 'owner'] as const) {
      const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
      await h.send(await committed(h, await get(h)), h.scope)
      if (variant === 'owner') h.state.register({ flavor: 'development', instanceId: 'other-runtime', pid: process.pid,
        startedAt: new Date().toISOString(), host: '127.0.0.1', port: 18900,
        baseUrl: 'http://127.0.0.1:18900', runtimeToken: 'other-token' })
      h.state.acquireLease({ threadId: h.thread.id, turnId: variant === 'turn' ? 'other-turn' : h.row.turnId,
        ownerFlavor: variant === 'owner' ? 'development' : 'production',
        ownerInstanceId: variant === 'owner' ? 'other-runtime' : 'runtime' })
      const queued = await get(h)
      await expect(h.send({ ...queued, turns: [{ ...queued.turns[0], status: 'running', startedAt: time }] },
        { ...h.scope, stage: 'promote' }, true, false, false)).rejects.toMatchObject({ status: 409 })
      expect((await get(h)).turns[0].status).toBe('queued')
    }
  })

  it('rechecks the turn lease after asynchronous durable-input proof', async () => {
    const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
    await h.send(await committed(h, await get(h)), h.scope)
    const original = h.data.sessionStore.loadDurableItemPage!.bind(h.data.sessionStore)
    vi.spyOn(h.data.sessionStore, 'loadDurableItemPage').mockImplementation(async (...args) => {
      const result = await original(...args)
      const lease = h.state.lease(h.thread.id)!
      h.state.releaseLease(lease)
      return result
    })
    const queued = await get(h)
    await expect(h.send({ ...queued, turns: [{ ...queued.turns[0], status: 'running', startedAt: time }] },
      { ...h.scope, stage: 'promote' })).rejects.toMatchObject({ status: 409 })
    expect((await get(h)).turns[0].status).toBe('queued')
  })

  it('rejects a target change made together with native enqueue', async () => {
    const h = await fixture(); await h.seed()
    const before = await get(h)
    await expect(h.send({ ...h.next, workspace: '/different-workspace' }, h.scope)).rejects.toMatchObject({ status: 409 })
    expect(await get(h)).toEqual(before)
  })

  it('rejects a target that changed after linking but before native enqueue', async () => {
    const h = await fixture(); await h.seed()
    await h.send({ ...h.thread, workspace: '/different-workspace' })
    const changed = await get(h)
    await expect(h.send({ ...h.next, workspace: changed.workspace, revision: changed.revision }, h.scope))
      .rejects.toMatchObject({ status: 409 })
    expect(await get(h)).toEqual(changed)
  })

  it('protects active native target scope even if its receipt rows are omitted', async () => {
    const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
    const queued = await get(h)
    await h.send({ ...queued, title: 'A presentation-only change' })
    const renamed = await get(h)
    const { nativeFollowUpRequests: _rows, ...withoutRows } = renamed
    await expect(h.send({ ...withoutRows, workspace: '/different-workspace' })).rejects.toMatchObject({ status: 409 })
    await expect(h.send({ ...renamed, turns: [] })).rejects.toMatchObject({ status: 409 })
    expect(await get(h)).toEqual(renamed)
    await h.send({ ...renamed, turns: [{ ...renamed.turns[0], status: 'aborted', finishedAt: time }] })
    const settled = await get(h)
    await expect(h.send({ ...settled, workspace: '/different-workspace' })).resolves.toHaveProperty('result')
  })

  it.each(['claim', 'fingerprint', 'request', 'revoked', 'scope', 'policy'] as const)('fails closed for stale or mismatched %s without changing native state', async (kind) => {
    const h = await fixture(); await h.seed()
    if (kind === 'claim') await h.put('commitment_effect', h.e.id, { ...h.e, claim: { ...h.e.claim, token: 2 } })
    if (kind === 'revoked') await h.put('commitment_execution', h.exec.id, { ...h.exec,
      permit: { ...h.exec.permit, revokedAt: time } })
    if (kind === 'scope') await h.put('commitment_control', 'commitment', { ...control(), authorizationEpoch: 1 })
    if (kind === 'policy') await h.put('collaboration_policy', 'policy', { ...h.policy, expiresAt: time })
    const scope = kind === 'fingerprint' ? { ...h.scope, admission: { ...h.scope.admission, fingerprint: 'b'.repeat(64) } }
      : kind === 'request' ? { ...h.scope, admission: { ...h.scope.admission, requestId: 'different' } } : h.scope
    const before = await get(h)
    await expect(h.send(h.next, scope)).rejects.toMatchObject({ status: 409 })
    expect(await get(h)).toEqual(before)
  })

  it('requires live arbitration even for replayed native writes', async () => {
    const h = await fixture(); await h.seed()
    const { fence, commitId } = h.scope.arbitration
    expect(h.state.endResourceCommit(fence, commitId)).toBe(true)
    await expect(h.send(h.next, h.scope)).rejects.toMatchObject({ status: 409 })
    expect((await get(h)).turns).toHaveLength(0)
  })

  it('rejects an issued permit when stop commits before native enqueue', async () => {
    const h = await fixture(); await h.seed()
    const before = await get(h)
    await h.put('commitment_control', 'commitment', { ...control(), generation: 1, authorizationEpoch: 1,
      paused: true, trackingEnabled: false, stoppedAt: time })
    await expect(h.send(h.next, h.scope)).rejects.toMatchObject({ status: 409, code: 'native_followup_permit_required' })
    expect(await get(h)).toEqual(before)
  })

  it('does not allow a queued native request or its row to forge a completed receipt', async () => {
    const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
    await h.send(await committed(h, await get(h)), h.scope)
    const queued = await get(h)
    await expect(h.send({ ...queued, nativeFollowUpRequests: queued.nativeFollowUpRequests!.map(row =>
      ({ ...row, terminalStatus: 'completed' as const })) })).rejects.toMatchObject({ status: 409 })
    await expect(h.send({ ...queued, turns: [{ ...queued.turns[0], status: 'completed', finishedAt: time }] }))
      .rejects.toMatchObject({ status: 409 })
    expect((await get(h)).nativeFollowUpRequests?.[0].terminalStatus).toBeUndefined()
  })

  it('accepts native completion only from the current executing turn fence', async () => {
    const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
    await h.send(await committed(h, await get(h)), h.scope)
    const queued = await get(h)
    await h.send({ ...queued, turns: [{ ...queued.turns[0], status: 'running', startedAt: time }] },
      { ...h.scope, stage: 'promote' })
    const running = await get(h), lease = h.state.lease('thread')!
    const complete = { ...running, turns: [{ ...running.turns[0], status: 'completed' as const, finishedAt: time }] }
    await expect(h.send(complete)).resolves.toHaveProperty('result')
    expect((await get(h)).nativeFollowUpRequests?.[0].terminalStatus).toBe('completed')

    const stale = await fixture(); await stale.seed(); await stale.send(stale.next, stale.scope)
    await stale.send(await committed(stale, await get(stale)), stale.scope)
    const otherQueued = await get(stale)
    await stale.send({ ...otherQueued, turns: [{ ...otherQueued.turns[0], status: 'running', startedAt: time }] },
      { ...stale.scope, stage: 'promote' })
    const otherRunning = await get(stale), otherLease = stale.state.lease('thread')!
    expect(stale.state.releaseLease(otherLease)).toBe(true)
    await expect(stale.send({ ...otherRunning, turns: [{ ...otherRunning.turns[0], status: 'completed', finishedAt: time }] }))
      .rejects.toMatchObject({ status: 409 })
    expect(lease.turnId).toBe('turn')
  })

  it('rejects native enqueue after the rooms coordinator fence is released', async () => {
    const h = await fixture(); await h.seed()
    h.state.releaseResource(h.scope.coordinatorFence)
    await expect(h.send(h.next, h.scope)).rejects.toMatchObject({ status: 409 })
    expect((await get(h)).turns).toHaveLength(0)
  })

  it('rejects coordinator loss during durable-session proof before native promotion', async () => {
    const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
    await h.send(await committed(h, await get(h)), h.scope)
    const queued = await get(h), reader = h.data.sessionStore!.loadDurableItemPage!.bind(h.data.sessionStore!)
    const spy = vi.spyOn(h.data.sessionStore!, 'loadDurableItemPage').mockImplementationOnce(async (...args) => {
      const result = await reader(...args)
      h.state.releaseResource(h.scope.coordinatorFence)
      return result
    })
    try {
      await expect(h.send({ ...queued, turns: [{ ...queued.turns[0], status: 'running', startedAt: time }] },
        { ...h.scope, stage: 'promote' })).rejects.toMatchObject({ status: 409 })
      expect((await get(h)).turns[0].status).toBe('queued')
    } finally { spy.mockRestore() }
  })

  it('preserves an admitted queue across pause/disable while stopping prevents its promotion', async () => {
    const h = await fixture(); await h.seed()
    await h.send(h.next, h.scope)
    await h.put('commitment_control', 'commitment', { ...control(), generation: 1, paused: true, trackingEnabled: false })
    await h.send(await committed(h, await get(h)), h.scope)
    const queued = await get(h)
    await expect(h.send({ ...queued, turns: [{ ...queued.turns[0], status: 'running', startedAt: time }] },
      { ...h.scope, stage: 'promote' })).resolves.toHaveProperty('result')
  })

  it('allows stop-time acknowledgement and cancellation without granting a new execution', async () => {
    const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
    await h.send(await committed(h, await get(h)), h.scope)
    await h.put('commitment_control', 'commitment', { ...control(), generation: 1, authorizationEpoch: 1,
      paused: true, trackingEnabled: false, stoppedAt: time })
    const queued = await get(h)
    await expect(h.send({ ...queued, turns: [{ ...queued.turns[0], status: 'running', startedAt: time }] },
      { ...h.scope, stage: 'promote' })).rejects.toMatchObject({ status: 409 })
    await expect(h.send({ ...queued, turns: [{ ...queued.turns[0], status: 'aborted', finishedAt: time }] }))
      .resolves.toHaveProperty('result')
    expect((await get(h)).nativeFollowUpRequests?.[0].terminalStatus).toBe('cancelled')
  })

  it('does not acknowledge a preparation when stop wins before its durable commit', async () => {
    const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
    const candidate = await committed(h, await get(h))
    await h.put('commitment_control', 'commitment', { ...control(), generation: 1, authorizationEpoch: 1,
      paused: true, trackingEnabled: false, stoppedAt: time })
    await expect(h.send(candidate, h.scope)).rejects.toMatchObject({ status: 409 })
    const stillPending = await get(h)
    expect(stillPending.nativeFollowUpRequests?.[0].phase).toBe('preparing')
    expect(stillPending.turns[0].admissionPending).toBe(true)
  })

  it.each(['prompt', 'clientRequestFingerprint'] as const)('rejects forged initial native %s despite a valid receipt identity', async (field) => {
    const h = await fixture(); await h.seed()
    const next = { ...h.next, turns: [{ ...h.next.turns[0], [field]: field === 'clientRequestFingerprint' ? 'b'.repeat(64) : 'forged-value' }] }
    await expect(h.send(next, h.scope)).rejects.toMatchObject({ status: 409 })
    expect((await get(h)).turns).toHaveLength(0)
  })

  it.each([
    ['persona', 'unrequested instructions'], ['imContext', true],
    ['workspaceCheckpointId', 'unrequested-checkpoint'], ['workspaceCheckpointRequestId', 'unrequested-request']
  ] as const)('rejects an added %s when it is absent from the reserved request', async (field, value) => {
    const h = await fixture(); await h.seed()
    const forged = { ...h.next, turns: [{ ...h.next.turns[0], [field]: value }] }
    await expect(h.send(forged, h.scope)).rejects.toMatchObject({ status: 409 })
    expect((await get(h)).turns).toHaveLength(0)
  })

  it.each([
    ['activeSkillIds', ['unrequested-skill']],
    ['gatewayAliasGrants', [{ routeId: 'route', alias: 'alias', role: 'main', targets: [{ providerId: 'p', modelId: 'm' }] }]],
    ['attachmentAliases', []]
  ] as const)('rejects injected runtime-derived %s during enqueue', async (field, value) => {
    const h = await fixture(); await h.seed()
    const forged = { ...h.next, turns: [{ ...h.next.turns[0], [field]: value }] }
    await expect(h.send(forged, h.scope)).rejects.toMatchObject({ status: 409 })
    expect((await get(h)).turns).toHaveLength(0)
  })

  it.each([
    ['model', 'another-model'], ['providerId', 'other-provider'], ['harnessId', 'codex'],
    ['credentialMode', 'native-login'], ['accountId', 'different-account'], ['approvalPolicy', 'auto'],
    ['sandboxMode', 'danger-full-access'], ['approvalReviewer', 'agent'], ['mode', 'plan'],
    ['collaborationEnabled', true], ['agentSurface', 'write'],
    ['designDocumentTarget', { documentId: 'doc', boardArtifactId: 'board' }]
  ] as const)('rejects forged inherited %s when the request does not override it', async (field, value) => {
    const h = await fixture(); await h.seed()
    const forged = { ...h.next, turns: [{ ...h.next.turns[0], [field]: value }] }
    await expect(h.send(forged, h.scope)).rejects.toMatchObject({ status: 409 })
    expect((await get(h)).turns).toHaveLength(0)
  })

  it.each([
    ['approvalPolicy', { approvalPolicy: 'auto' }],
    ['sandboxMode', { sandboxMode: 'danger-full-access' }],
    ['approvalReviewer', { approvalReviewer: 'agent' }]
  ] as const)('rejects a reserved request that changes linked %s', async (_field, permissions) => {
    const h = await nativeManagerFixture(undefined, undefined, permissions)
    fixtures.push(h); await h.seed()
    await expect(h.send(h.next, h.scope)).rejects.toMatchObject({ status: 409 })
    expect((await get(h)).turns).toHaveLength(0)
  })

  it('accepts an explicit permission snapshot identical to the linked thread', async () => {
    const h = await nativeManagerFixture(undefined, undefined, {
      approvalPolicy: 'on-request', sandboxMode: 'workspace-write', approvalReviewer: 'user'
    })
    fixtures.push(h); await h.seed()
    await expect(h.send(h.next, h.scope)).resolves.toHaveProperty('result')
  })

  it('rejects a forged model even when the original request fingerprint is retained', async () => {
    const h = await fixture(undefined, 'test'); await h.seed()
    const forged = { ...h.next, turns: [{ ...h.next.turns[0], model: 'another-model' }] }
    await expect(h.send(forged, h.scope)).rejects.toMatchObject({ status: 409 })
    expect((await get(h)).turns).toHaveLength(0)
    await expect(h.send(h.next, h.scope)).resolves.toHaveProperty('result')
  })

  it.each(['kind', 'workbench-id'] as const)('requires the exact owned target identity, not only a shared thread: %s', async (mismatch) => {
    const h = await fixture()
    const actual = { kind: 'workbench_link' as const, linkId: 'actual-workbench', threadId: 'thread' }
    if (mismatch === 'workbench-id') {
      const claimed = { ...actual, linkId: 'different-workbench' }
      h.e.envelope.target = claimed
      h.exec.envelope.target = claimed
    }
    await h.seed(actual)
    expect(await h.data.roomStore.collaborationQuery({ kind: 'owned_thread', threadId: 'thread' })).toMatchObject([{ id: 'link' }])
    await expect(h.send(h.next, h.scope)).rejects.toMatchObject({ status: 409, code: 'native_followup_permit_required' })
    expect((await get(h)).turns).toHaveLength(0)
  })

  it('does not rewind admitted preparation or running native work to queued', async () => {
    const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
    await h.send(await committed(h, await get(h)), h.scope)
    const queued = await get(h)
    await expect(h.send({ ...queued, turns: [{ ...queued.turns[0], admissionPending: true }] })).rejects.toMatchObject({ status: 409 })
    await h.send({ ...queued, turns: [{ ...queued.turns[0], status: 'running', startedAt: time }] }, { ...h.scope, stage: 'promote' })
    const running = await get(h)
    await expect(h.send({ ...running, turns: [{ ...running.turns[0], status: 'queued' }] })).rejects.toMatchObject({ status: 409 })
  })

  it('reclaims dispatch with a new ephemeral claim while retaining the original native permit', async () => {
    const h = await fixture(); await h.seed()
    await h.put('commitment_effect', h.e.id, { ...h.e, claim: { ...h.e.claim, token: 2 } })
    await expect(h.send(h.next, h.scope)).rejects.toMatchObject({ status: 409 })
    await expect(h.send(h.next, { ...h.scope, claimToken: 2 })).resolves.toHaveProperty('result')
    const execution = await h.data.roomStore.get('commitment_execution', h.exec.id)
    expect((execution!.value as typeof h.exec).permit).toEqual(h.exec.permit)
  })

  it.each([[true, false], [false, false], [true, true], [false, true]])(
    'rejects changed canonical user content for conditional=%s metadataOnly=%s', async (conditional, metadataOnly) => {
      const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
      await h.send(await committed(h, await get(h)), h.scope)
      const queued = await get(h)
      await h.data.executeSession('updateItem', { threadId: 'thread', itemId: h.row.userMessageItemId,
        patch: { text: 'a different canonical user message' } })
      const before = await h.data.executeThread('getMetadata', { threadId: 'thread' })
      // A raw caller supplies the original text to try to bypass canonical SessionStore content.
      const forged = { ...queued, turns: [{ ...queued.turns[0], status: 'running' as const,
        startedAt: time, prompt: h.exec.nativeRequest.request.prompt }] }
      await expect(h.send(forged, { ...h.scope, stage: 'promote' }, conditional, metadataOnly))
        .rejects.toMatchObject({ status: 409 })
      expect(await h.data.executeThread('getMetadata', { threadId: 'thread' })).toEqual(before)
    }
  )

  it('cannot start a queued native request without its durable user message', async () => {
    const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
    const prepared = await get(h)
    const { admissionPending: _pending, ...turn } = prepared.turns[0]
    await expect(h.send({ ...prepared, turns: [{ ...turn, admissionCompletedAt: time }] }, h.scope))
      .rejects.toMatchObject({ status: 409 })
    const queued = await get(h)
    expect(queued.nativeFollowUpRequests?.[0].phase).toBe('preparing')
    expect(queued.turns[0].admissionPending).toBe(true)
    await expect(h.send({ ...queued, turns: [{ ...queued.turns[0], status: 'running', startedAt: time,
      prompt: h.exec.nativeRequest.request.prompt }] }, { ...h.scope, stage: 'promote' })).rejects.toMatchObject({ status: 409 })
    expect((await get(h)).turns[0].status).toBe('queued')
  })

  it.each(['missing', 'changed'] as const)('does not accept a live-only user item as durable proof when the stored item is %s', async (durable) => {
    const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
    const prepared = await get(h)
    if (durable === 'changed') {
      await h.send(await committed(h, prepared), h.scope)
      await h.data.executeSession('updateItem', { threadId: 'thread', itemId: h.row.userMessageItemId,
        patch: { text: 'different durable message' } })
    }
    const prompt = h.exec.nativeRequest.request.prompt
    await h.data.executeSession('checkpointLiveItem', { threadId: 'thread', representedSeq: 1,
      item: { id: h.row.userMessageItemId, threadId: 'thread', turnId: h.row.turnId, seq: 1,
        kind: 'user_message', role: 'user', status: 'completed', createdAt: time, text: prompt } })
    const livePage = await h.data.sessionStore.loadItemPage!('thread', { turnId: h.row.turnId,
      itemId: h.row.userMessageItemId, maxItems: 1, maxBytes: 4096 })
    expect(livePage.content?.text).toBe(prompt)
    const queued = await h.data.threadStore.getMetadata!('thread')
    if (durable === 'missing') {
      const { admissionPending: _pending, ...turn } = queued!.turns[0]
      await expect(h.send({ ...queued!, turns: [{ ...turn, admissionCompletedAt: time }] }, h.scope))
        .rejects.toMatchObject({ status: 409 })
      expect((await h.data.threadStore.getMetadata!('thread'))?.nativeFollowUpRequests?.[0].phase).toBe('preparing')
    } else {
      await expect(h.send({ ...queued!, turns: [{ ...queued!.turns[0], status: 'running', startedAt: time, prompt }] },
        { ...h.scope, stage: 'promote' })).rejects.toMatchObject({ status: 409 })
    }
    expect((await h.data.threadStore.getMetadata!('thread'))?.turns[0].status).toBe('queued')
  })

  it('rejects a live-only extra item before promoting a native turn', async () => {
    const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
    await h.send(await committed(h, await get(h)), h.scope)
    const extra = makeUserItem({ id: 'extra-live-item', threadId: h.thread.id, turnId: h.row.turnId,
      text: 'Unapproved live instructions' })
    await h.data.executeSession('checkpointLiveItem', { threadId: h.thread.id, item: extra, representedSeq: 1 })
    expect((await h.data.sessionStore.loadItems(h.thread.id)).some((item) => item.id === extra.id)).toBe(true)
    const queued = await get(h)
    await expect(h.send({ ...queued, turns: [{ ...queued.turns[0], status: 'running', startedAt: time }] },
      { ...h.scope, stage: 'promote' })).rejects.toMatchObject({ status: 409 })
    expect((await get(h)).turns[0].status).toBe('queued')
  })

  it('fails closed when the durable index is unavailable, then admits the same request after rebuild', async () => {
    const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
    await h.send(await committed(h, await get(h)), h.scope)
    const queued = await get(h)
    const statePath = join(h.root, 'data', 'threads', 'thread', 'messages-index.state.json')
    await access(statePath)
    await rm(statePath)
    const running = { ...queued, turns: [{ ...queued.turns[0], status: 'running' as const, startedAt: time }] }
    await expect(h.send(running, { ...h.scope, stage: 'promote' })).rejects.toMatchObject({
      status: 409, code: 'native_followup_permit_required',
      detail: expect.stringContaining('durable native user input could not be verified')
    })
    expect((await h.data.threadStore.getMetadata!('thread'))?.turns[0].status).toBe('queued')
    await vi.waitFor(async () => { await access(statePath) }, { timeout: 5000, interval: 10 })
    await expect(h.send(running, { ...h.scope, stage: 'promote' })).resolves.toHaveProperty('result')
  })

  it('checks every canonical content fragment, not just the first 8 KiB', async () => {
    const h = await fixture('x'.repeat(16_383) + '🌲 trailing user request')
    await h.seed(); await h.send(h.next, h.scope); await h.send(await committed(h, await get(h)), h.scope)
    const queued = await get(h)
    await expect(h.send({ ...queued, turns: [{ ...queued.turns[0], status: 'running', startedAt: time }] },
      { ...h.scope, stage: 'promote' })).resolves.toHaveProperty('result')
  })

  it('rejects a changed canonical fragment after an identical first 8 KiB', async () => {
    const prefix = 'x'.repeat(16_383), prompt = prefix + '🌲 original'
    const h = await fixture(prompt)
    await h.seed(); await h.send(h.next, h.scope); await h.send(await committed(h, await get(h)), h.scope)
    const queued = await get(h)
    await h.data.executeSession('updateItem', { threadId: 'thread', itemId: h.row.userMessageItemId,
      patch: { text: prefix + '🌲 modified' } })
    await expect(h.send({ ...queued, turns: [{ ...queued.turns[0], status: 'running', startedAt: time, prompt }] },
      { ...h.scope, stage: 'promote' })).rejects.toMatchObject({ status: 409 })
    expect((await get(h)).turns[0].status).toBe('queued')
  })

  it('rejects queued payload edits and restored executable native snapshots after settlement', async () => {
    const h = await fixture(); await h.seed(); await h.send(h.next, h.scope)
    await h.send(await committed(h, await get(h)), h.scope)
    const queued = await get(h)
    await expect(h.send({ ...queued, turns: [{ ...queued.turns[0], model: 'different-model' }] }))
      .rejects.toMatchObject({ status: 409 })
    await h.send({ ...queued, turns: [{ ...queued.turns[0], status: 'running', startedAt: time }] },
      { ...h.scope, stage: 'promote' })
    const running = await get(h)
    await h.send({ ...running, turns: [{ ...running.turns[0], status: 'completed', finishedAt: time }] })
    const terminal = await get(h)
    const owner = await h.data.roomStore.get('commitment_link', 'link')
    await h.put('commitment_link', 'link', { ...(owner!.value as object), active: false })
    await expect(h.send({ ...queued, revision: terminal.revision, nativeFollowUpRequests: undefined }, h.scope))
      .rejects.toMatchObject({ status: 409 })
    expect(await get(h)).toEqual(terminal)
  })

  it('does not let generic fenced RoomStore writes undo native permit revocation', async () => {
    const h = await fixture(); await h.seed()
    const revoked = { ...h.exec, permit: { ...h.exec.permit, revokedAt: time } }
    await h.put('commitment_execution', h.exec.id, revoked)
    const storedRevoked = await h.data.roomStore.get('commitment_execution', h.exec.id)
    expect(storedRevoked?.value).toMatchObject({ permit: { revokedAt: time } })
    const fence = h.state.acquireResource({ resource: 'rooms-coordinator', ownerFlavor: 'production', ownerInstanceId: 'runtime' }).lease
    const { requestManagerJson } = await import('./manager-client.js')
    await expect(requestManagerJson(h.connection, '/v1/data/room/commit', { method: 'POST', body: {
      input: { requestId: 'undo-revocation', checks: [{ kind: 'commitment_execution', id: h.exec.id, expectedRevision: 1 }],
        puts: [{ kind: 'commitment_execution', id: h.exec.id, value: h.exec }] }, fence: { resource: fence.resource,
        ownerFlavor: fence.ownerFlavor, ownerInstanceId: fence.ownerInstanceId, fencingToken: fence.fencingToken },
      arbitration: h.scope.arbitration } })).rejects.toMatchObject({ status: 409, code: 'room_store_conflict',
      detail: expect.stringContaining('execution revocation cannot be undone') })
    expect(await h.data.roomStore.get('commitment_execution', h.exec.id)).toEqual(storedRevoked)
    expect(await h.data.roomStore.getRequest('undo-revocation')).toBeNull()
  })

  it('rejects a generic RoomStore attempt to forge Manager user-action provenance', async () => {
    const h = await fixture()
    const fence = h.state.acquireResource({ resource: 'rooms-coordinator', ownerFlavor: 'production', ownerInstanceId: 'runtime' }).lease
    const { requestManagerJson } = await import('./manager-client.js')
    const event = { ...base('forged-action-event'), sourceId: 'forged-source', nativeKey: 'request', objectRevision: '0',
      kind: 'user_continue', resourceKey: 'commitment', occurredAt: time, receivedAt: time,
      provenance: { kind: 'user_message', evidence: userEvidence }, userAction: { actionId: 'request', issuedAt: time },
      summary: 'Pretend this is an explicit action', contextOnly: false }
    await expect(requestManagerJson(h.connection, '/v1/data/room/commit', { method: 'POST', body: {
      input: { requestId: 'forged-action', checks: [{ kind: 'collaboration_event', id: event.id, expectedRevision: null }],
        puts: [{ kind: 'collaboration_event', id: event.id, value: event }] }, fence: { resource: fence.resource,
        ownerFlavor: fence.ownerFlavor, ownerInstanceId: fence.ownerInstanceId, fencingToken: fence.fencingToken },
      arbitration: h.scope.arbitration } })).rejects.toMatchObject({ status: 409, code: 'native_followup_permit_required' })
    expect(await h.data.roomStore.get('collaboration_event', event.id)).toBeNull()
    expect(await h.data.roomStore.getRequest('forged-action')).toBeNull()
  })

  it('does not allow a fenced generic RoomStore commit to mint native authority', async () => {
    const h = await fixture(); await h.seed()
    const fence = h.state.acquireResource({ resource: 'rooms-coordinator', ownerFlavor: 'production', ownerInstanceId: 'runtime' }).lease
    const { requestManagerJson } = await import('./manager-client.js')
    const value = { ...h.exec, id: 'forged-attempt', attemptId: 'forged-attempt', requestId: 'forged-request',
      nativeRequest: { ...h.exec.nativeRequest, request: { ...h.exec.nativeRequest.request, clientRequestId: 'forged-request' } },
      envelope: { ...h.exec.envelope, attemptId: 'forged-attempt', requestId: 'forged-request' } }
    await expect(requestManagerJson(h.connection, '/v1/data/room/commit', { method: 'POST', body: {
      input: { requestId: 'forged', checks: [{ kind: 'commitment_execution', id: value.id, expectedRevision: null }],
        puts: [{ kind: 'commitment_execution', id: value.id, value }] }, fence: { resource: fence.resource,
        ownerFlavor: fence.ownerFlavor, ownerInstanceId: fence.ownerInstanceId, fencingToken: fence.fencingToken },
      arbitration: h.scope.arbitration } })).rejects.toMatchObject({ status: 409 })
    expect(await h.data.roomStore.get('commitment_execution', value.id)).toBeNull()
    expect(await h.data.roomStore.getRequest('forged')).toBeNull()
  })
})
