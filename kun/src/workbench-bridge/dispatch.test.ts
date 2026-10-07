import { describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { kunToolPermissionModeSettings } from '../contracts/policy.js'
import type { WorkbenchLink } from '../contracts/workbench-links.js'
import { confirmWorkbenchLink, requestWorkbenchCancel } from './actions.js'
import { reconcileWorkbench } from './reconcile.js'
import { dispatchFixture as fixture } from './dispatch-test-support.js'

vi.mock('../rooms/room-continuation-service.js', () => ({ enqueuePrivateContinuation: vi.fn(async () => 'queued') }))

describe('private conversation Code dispatch', () => {
  it('uses the accepted source authority rather than the independent Code auto policy', async () => {
    const f = await fixture('ask-for-approval', { policy: 'auto' })
    const created = await f.create()
    expect(await f.intent(created.dispatchIntentId)).toMatchObject({ state: 'pending_confirmation',
      source: { actingModelRoute: { providerId: 'source-provider', model: 'source-model', accountId: 'source-account' } } })
    await f.start()
    expect(f.stub.calls.created).toHaveLength(0)
    const decision = await f.intent(created.dispatchIntentId)
    await f.service.act(decision.intentId, { action: 'start_now', expectedRevision: decision.revision, requestId: 'confirm' })
    await f.start()
    expect(f.stub.calls.created[0].request).toMatchObject(kunToolPermissionModeSettings('ask-for-approval'))
    expect(f.stub.calls.enqueued).toHaveLength(1)
    expect(f.stub.calls.enqueued[0].request).toMatchObject(kunToolPermissionModeSettings('ask-for-approval'))
  })

  it('automatically reviews and admits without requiring a card click', async () => {
    const f = await fixture('approve-for-me')
    const created = await f.create()
    await f.start()
    expect(f.review).toHaveBeenCalledTimes(1)
    expect(f.stub.calls.enqueued).toHaveLength(1)
    expect(await f.link(created.linkId)).toMatchObject({ value: { status: 'queued', dispatchAuthority: kunToolPermissionModeSettings('approve-for-me') } })
    expect(f.stub.calls.enqueued[0].request).toMatchObject(kunToolPermissionModeSettings('approve-for-me'))
  })

  it('shows a refusal on the same card when automatic review rejects the task', async () => {
    const f = await fixture('approve-for-me', { review: 'deny' })
    const created = await f.create()
    await f.start()
    expect(await f.link(created.linkId)).toMatchObject({ value: { status: 'failed', error: expect.stringContaining('Reviewed source intent') } })
    expect(f.stub.calls.created).toHaveLength(0)
    expect((await f.store.list('message', { roomId: f.room.id })).filter((row) =>
      (row.value as { workbenchLinkId?: string }).workbenchLinkId === created.linkId)).toHaveLength(1)
  })

  it('saves a full-access proposal without creating a task or workspace before 60 seconds', async () => {
    const f = await fixture()
    const created = await f.create({ isolation: 'worktree' })
    const before = await f.intent(created.dispatchIntentId)
    expect(before.state).toBe('countdown')
    expect(Date.parse(before.deadline!) - f.clock.now).toBe(60_000)
    f.clock.now += 59_000
    await f.start()
    expect(f.stub.calls.created).toHaveLength(0)
    expect((await f.link(created.linkId)).value.taskWorkspaceId).toBeUndefined()
    f.clock.now += 1000
    await f.service.reconcile()
    await reconcileWorkbench(f.bridge)
    expect(f.stub.calls.created).toHaveLength(1)
  })

  it('cancels at 59 seconds and cannot later start from the expired countdown', async () => {
    const f = await fixture()
    const created = await f.create()
    f.clock.now += 59_000
    await requestWorkbenchCancel(f.bridge, f.room.id, created.linkId)
    f.clock.now += 2000
    await f.start()
    expect((await f.intent(created.dispatchIntentId)).state).toBe('cancelled')
    expect((await f.link(created.linkId)).value.cancelRequested).toBe(true)
    expect(f.stub.calls.enqueued).toHaveLength(0)
  })

  it('pauses before editing, resets the host deadline on save and rejects stale options', async () => {
    const f = await fixture()
    const created = await f.create()
    f.clock.now += 59_000
    const initial = await f.intent(created.dispatchIntentId)
    await f.service.act(initial.intentId, { action: 'pause', expectedRevision: initial.revision, requestId: 'pause' })
    f.clock.now += 5000
    await f.start()
    expect(f.stub.calls.created).toHaveLength(0)
    const row = await f.link(created.linkId)
    await expect(confirmWorkbenchLink(f.bridge, f.room.id, row.id, { expectedRevision: row.revision + 1,
      clientRequestId: 'stale-save', edits: { goal: 'Changed' } })).rejects.toThrow('changed since')
    await confirmWorkbenchLink(f.bridge, f.room.id, row.id, { expectedRevision: row.revision,
      clientRequestId: 'save', edits: { goal: 'Changed' } })
    const saved = await f.intent(created.dispatchIntentId)
    expect(saved.state).toBe('countdown')
    expect(Date.parse(saved.deadline!) - f.clock.now).toBe(60_000)
    expect((await f.link(created.linkId)).value.request.goal).toBe('Changed')
    f.clock.now += 60_000
    await f.start()
    expect(f.stub.calls.enqueued[0].request.prompt).toContain('Changed')
  })

  it('rechecks live revocation and never starts a disabled source Agent', async () => {
    const f = await fixture()
    const created = await f.create()
    const row = (await f.store.get('agent_identity', 'agent-1'))!
    await f.store.commit({ requestId: 'disable-code', checks: [{ kind: 'agent_identity', id: row.id, expectedRevision: row.revision }],
      puts: [{ kind: 'agent_identity', id: row.id, value: { ...row.value as object, workbench: { code: 'off', work: 'read', maxActiveTasks: 3 } } }] })
    f.clock.now += 60_000
    await f.start()
    expect((await f.intent(created.dispatchIntentId)).state).toBe('failed')
    expect(f.stub.calls.created).toHaveLength(0)
  })

  it('narrows a pending full-access task when the live room permission is reduced', async () => {
    const f = await fixture()
    const created = await f.create()
    const room = (await f.store.get('room', f.room.id))!
    await f.store.commit({ requestId: 'narrow-permissions', checks: [{ kind: 'room', id: room.id, expectedRevision: room.revision }],
      puts: [{ kind: 'room', id: room.id, value: { ...room.value as object, privateExecutionPolicy: kunToolPermissionModeSettings('ask-for-approval') } }] })
    f.clock.now += 60_000
    await f.start()
    expect(f.stub.calls.created[0].request).toMatchObject(kunToolPermissionModeSettings('ask-for-approval'))
    expect(f.stub.calls.enqueued[0].request).toMatchObject(kunToolPermissionModeSettings('ask-for-approval'))
    expect((await f.intent(created.dispatchIntentId)).policySnapshot).toEqual(kunToolPermissionModeSettings('full-access'))
  })

  it('replaces an automatically selected failed Agent once after verified stop and repository inspection', async () => {
    const f = await fixture()
    await promisify(execFile)('git', ['init', '-q'], { cwd: f.project })
    const resolve = vi.fn(async (request: WorkbenchLink['request']) => request.execution?.model ??
      { harnessId: 'codex', model: 'original-model', credentialMode: 'native-login' })
    f.bridge.attach({ harnesses: { resolve, permissionCeiling: (_request: unknown, policy: unknown) => policy, assertCapabilityCeiling: () => undefined,
      list: async () => ({ agents: [{ harnessId: 'kun', displayName: 'Kun', available: true,
        models: [{ harnessId: 'kun', model: 'replacement-model', providerId: 'p1', credentialMode: 'provider' }] }] }) } as never })
    f.deps.proveStopped = vi.fn(async () => true)
    const created = await f.create({ agentSelection: 'auto' })
    f.clock.now += 60_000
    await f.start()
    const original = (await f.link(created.linkId)).value
    const oldThread = f.stub.threads.get(original.threadId!)!
    oldThread.turns[0].status = 'failed'
    oldThread.turns[0].error = 'Agent transport failed'
    await reconcileWorkbench(f.bridge)
    const replacement = await f.intent(created.dispatchIntentId)
    expect(replacement).toMatchObject({ intentId: created.dispatchIntentId, state: 'countdown', replacementCount: 1,
      recommendation: { agentId: 'kun', agentSelection: 'auto' } })
    expect(f.deps.proveStopped).toHaveBeenCalledWith(original.threadId, original.turnId)
    expect((await f.link(created.linkId)).value).toMatchObject({ status: 'awaiting_confirmation', dispatchReplacementCount: 1 })
    f.clock.now += 60_000
    await f.start()
    const current = (await f.link(created.linkId)).value
    expect(current.threadId).not.toBe(original.threadId)
    expect(f.stub.calls.enqueued).toHaveLength(2)
    expect(f.stub.calls.enqueued[1].request).toMatchObject({ harnessId: 'kun', model: 'replacement-model' })
    f.stub.threads.get(current.threadId!)!.turns[0].status = 'failed'
    await reconcileWorkbench(f.bridge)
    expect((await f.link(created.linkId)).value.status).toBe('failed')
    expect((await f.intent(created.dispatchIntentId)).replacementCount).toBe(1)
    expect((await f.store.list('message', { roomId: f.room.id })).filter((row) =>
      (row.value as { workbenchLinkId?: string }).workbenchLinkId === created.linkId)).toHaveLength(1)
  })

  it('preserves a user-selected Agent and stops autonomous follow-up after takeover', async () => {
    const f = await fixture()
    const created = await f.create()
    f.clock.now += 60_000
    await f.start()
    const task = (await f.link(created.linkId)).value
    const thread = f.stub.threads.get(task.threadId!)!
    thread.turns[0].status = 'running'
    thread.turns.push({ ...thread.turns[0], id: 'user-turn', clientRequestId: 'user-owned', status: 'completed',
      createdAt: new Date(Date.now() + 1000).toISOString() })
    await reconcileWorkbench(f.bridge)
    expect((await f.intent(created.dispatchIntentId)).takenOver).toBe(true)
    thread.turns[0].status = 'failed'
    await reconcileWorkbench(f.bridge)
    const result = (await f.link(created.linkId)).value
    expect(result.userTookOver).toBe(true)
    expect(result.reported).toBeUndefined()
    expect(result.dispatchReplacementCount).toBeUndefined()
  })

  it('keeps the card awaiting its parent review and cancels only that continuation', async () => {
    const f = await fixture()
    const created = await f.create()
    f.clock.now += 60_000
    await f.start()
    const task = (await f.link(created.linkId)).value
    f.stub.threads.get(task.threadId!)!.turns[0].status = 'completed'
    await reconcileWorkbench(f.bridge)
    const done = (await f.link(created.linkId)).value
    expect(done.outcomeRequestId).toBeTruthy()
    await f.store.commit({ requestId: 'pending-parent-review', checks: [{ kind: 'request', id: done.outcomeRequestId!, expectedRevision: null }],
      puts: [{ kind: 'request', id: done.outcomeRequestId!, roomId: f.room.id, value: {
        id: done.outcomeRequestId, roomId: f.room.id, threadId: f.thread.id, privateProtocol: 'direct-v1', status: 'pending',
        privateContinuation: { sourceTurnId: 'turn-1', kind: 'workbench_task' }
      } }] })
    await f.service.reconcile()
    const review = await f.intent(created.dispatchIntentId)
    expect(review.state).toBe('awaiting_parent')
    await f.service.act(review.intentId, { action: 'cancel', expectedRevision: review.revision, requestId: 'cancel-review' })
    await f.service.reconcile()
    expect((await f.intent(created.dispatchIntentId)).state).toBe('cancelled')
    expect((await f.store.get<{ status: string; cancellationRequested: boolean }>('request', done.outcomeRequestId!))!.value)
      .toMatchObject({ status: 'cancelled', cancellationRequested: true })
    expect(f.stub.calls.interrupted).toHaveLength(0)
  })

  it('carries explicit source capabilities into a normal Code thread and narrows live tool revocation', async () => {
    const f = await fixture()
    Object.assign(f.thread.roomContext!, { allowedToolNames: ['read', 'write'], blockedProviderIds: ['private'],
      blockedSkillIds: ['secret-skill'], skillsEnabled: false })
    await f.deps.threadStore.upsert(f.thread)
    const created = await f.create()
    const identity = (await f.store.get('agent_identity', 'agent-1'))!
    await f.store.commit({ requestId: 'deny-write', checks: [{ kind: 'agent_identity', id: identity.id, expectedRevision: identity.revision }],
      puts: [{ kind: 'agent_identity', id: identity.id, value: { ...identity.value as object, capabilityOverrides: { blockedTools: ['write'] } } }] })
    f.clock.now += 60_000
    await f.start()
    const link = (await f.link(created.linkId)).value
    const target = f.stub.threads.get(link.threadId!)!
    expect(target.roomContext).toBeUndefined()
    expect(target.workbenchOrigin?.capabilityCeiling).toMatchObject({ allowedToolNames: ['read', 'write'],
      blockedToolNames: expect.arrayContaining(['write']), blockedProviderIds: ['private'], blockedSkillIds: ['secret-skill'], skillsEnabled: false })
  })

  it('does not add dispatch decisions to scheduling and unlimited goals', async () => {
    const f = await fixture()
    const created = await f.create({ schedule: { kind: 'once', runAt: new Date(f.clock.now + 120_000).toISOString(), timeZone: 'UTC' } })
    expect(created.dispatchIntentId).toBeUndefined()
    expect(created.status).toBe('awaiting_confirmation')
    expect(await f.service.list()).toHaveLength(0)
  })
})
