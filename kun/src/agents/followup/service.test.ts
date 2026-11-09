import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentCommitmentSchema } from '../../contracts/agent-commitments.js'
import type { CommitmentControl } from '../../contracts/collaboration-followup.js'
import { putRoomDocument } from '../../rooms/room-service.js'
import { followUpFixture, type FollowUpFixture } from './followup-test-support.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanups.splice(0).reverse()) await close() })
async function fixture() { const f = await followUpFixture(); cleanups.push(f.cleanup); return f }
const action = (clientRequestId: string, expectedControlRevision: number) => ({ clientRequestId, expectedControlRevision })
async function enable(f: FollowUpFixture) { return f.followUp.enable('agent-1', f.commitment.id, f.enable) }

describe('follow-up controls and legacy boundaries', () => {
  it('keeps strict v1 commitments unchanged, replays identical enable, and rejects changed content', async () => {
    const f = await fixture(), first = await enable(f)
    expect(first.controlRevision).toBe(0)
    expect(await enable(f)).toEqual(first)
    expect(f.wakes.count).toBe(1)
    expect(await f.commitments.get('agent-1', f.commitment.id)).toEqual(f.commitment)
    const { revision: _revision, ...value } = await f.commitments.get('agent-1', f.commitment.id)
    expect(AgentCommitmentSchema.parse(value)).toEqual(value)
    await expect(f.followUp.enable('agent-1', f.commitment.id, { ...f.enable,
      policy: { ...f.enable.policy, limits: { ...f.enable.policy.limits, attemptsPerDay: 4 } } })).rejects.toThrow('content changed')
    await expect(f.followUp.enable('agent-foreign', f.commitment.id, f.enable)).rejects.toThrow('not found')
  })

  it('distinguishes pause, resume, disable and stop without starting or cancelling work in the service', async () => {
    const f = await fixture(); await enable(f)
    const paused = await f.followUp.action('agent-1', f.commitment.id, 'pause', action('pause', 0))
    expect(paused.control).toMatchObject({ paused: true, trackingEnabled: true, generation: 1 })
    const resumed = await f.followUp.action('agent-1', f.commitment.id, 'resume', action('resume', 1))
    expect(resumed.control).toMatchObject({ paused: false, trackingEnabled: true })
    const disabled = await f.followUp.action('agent-1', f.commitment.id, 'disable', action('disable', 2))
    expect(disabled.control).toMatchObject({ trackingEnabled: false })
    expect(disabled.control.stoppedAt).toBeUndefined()
    expect((await f.commitments.get('agent-1', f.commitment.id)).status).toBe('open')
    await expect(f.followUp.action('agent-1', f.commitment.id, 'resume', action('invalid-resume', 3))).rejects.toThrow('enable tracking explicitly')
    const stopped = await f.followUp.stop('agent-1', f.commitment.id, { ...action('stop', 3), scope: 'commitment', targetId: f.commitment.id })
    expect(stopped.control.stoppedAt).toBeTruthy()
    expect((await f.commitments.get('agent-1', f.commitment.id)).status).toBe('cancelled')
    expect(f.stub.calls.enqueued).toEqual([])
    expect(f.stub.calls.interrupted).toEqual([])
    await expect(f.followUp.action('agent-1', f.commitment.id, 'resume', action('resume-stopped', 4))).rejects.toThrow('explicit reopen')
  })

  it('requires a fresh revision and actual user evidence, never a model body or other room', async () => {
    const f = await fixture()
    const bad = (userEvidence: object) => f.followUp.enable('agent-1', f.commitment.id, { ...f.enable, userEvidence })
    await expect(bad({ ...f.userEvidence, messageRevision: 1 })).rejects.toThrow('actual user message')
    await expect(bad({ ...f.userEvidence, sourceRoomId: 'foreign' })).rejects.toThrow('another room')
    await putRoomDocument(f.store, 'message', 'model-message', f.room.id, { ...f.source, id: 'model-message', authorKind: 'member' }, null)
    await expect(bad({ ...f.userEvidence, sourceMessageId: 'model-message' })).rejects.toThrow('actual user message')
    await enable(f)
    await expect(f.followUp.action('agent-1', f.commitment.id, 'pause', action('stale', 9))).rejects.toMatchObject({ code: 'STALE_REVISION' })
  })

  it('requires explicit renewal after legacy scope changes and rejects string-only completion', async () => {
    const f = await fixture(); await enable(f)
    await expect(f.commitments.update('agent-1', f.commitment.id, { clientRequestId: 'complete', expectedRevision: 0,
      status: 'completed', acceptanceEvidence: [{ summary: 'The model said it is done' }] })).rejects.toMatchObject({ code: 'STALE_ATTENTION' })
    const updated = await f.commitments.update('agent-1', f.commitment.id, { clientRequestId: 'scope', expectedRevision: 0,
      acceptance: 'New review scope' })
    const control = (await f.store.get<CommitmentControl>('commitment_control', f.commitment.id))!
    expect(control.value).toMatchObject({ paused: true, generation: 1, authorizationEpoch: 1 })
    await expect(f.followUp.action('agent-1', f.commitment.id, 'resume', action('resume', 1))).rejects.toThrow('renew authorization')
    await f.followUp.update('agent-1', f.commitment.id, { ...f.enable, expectedControlRevision: 1, clientRequestId: 'renew' })
    await expect(f.followUp.action('agent-1', f.commitment.id, 'resume', action('resumed', 2))).resolves.toMatchObject({ control: { paused: false } })
    expect(updated.status).toBe('open')
  })

  it('legacy cancelled writes durable stop intent and cannot reopen through legacy PATCH', async () => {
    const f = await fixture(); await enable(f)
    await f.commitments.update('agent-1', f.commitment.id, { clientRequestId: 'cancel', expectedRevision: 0, status: 'cancelled' })
    expect((await f.store.get<CommitmentControl>('commitment_control', f.commitment.id))!.value)
      .toMatchObject({ generation: 1, trackingEnabled: false, paused: true, stoppedAt: expect.any(String) })
    await expect(f.commitments.update('agent-1', f.commitment.id, { clientRequestId: 'revive', expectedRevision: 1, status: 'open' }))
      .rejects.toThrow('explicit reopen')
    await f.followUp.reopen('agent-1', f.commitment.id, { ...f.enable, clientRequestId: 'reopen',
      expectedControlRevision: 1, expectedCommitmentRevision: 1 })
    expect((await f.commitments.get('agent-1', f.commitment.id)).status).toBe('open')
  })

  it('checks ownership before even a service receipt replay', async () => {
    const f = await fixture(); await enable(f)
    f.deps.assertOwnership = async () => { throw new Error('lease lost') }
    await expect(enable(f)).rejects.toThrow('lease lost')
    await expect(f.commitments.create('agent-1', f.create)).rejects.toThrow('lease lost')
    expect((await f.followUp.get('agent-1', f.commitment.id)).controlRevision).toBe(0)
  })

  it('arbitrates enable against an old untracked update in the same store transaction', async () => {
    const f = await fixture(), original = f.store.commit.bind(f.store)
    let injected = false
    vi.spyOn(f.store, 'commit').mockImplementation(async (input, fence) => {
      if (!injected && input.requestId.endsWith(':update:race')) { injected = true; await enable(f) }
      return original(input, fence)
    })
    await expect(f.commitments.update('agent-1', f.commitment.id, { clientRequestId: 'race', expectedRevision: 0,
      status: 'completed', acceptanceEvidence: [{ summary: 'Old untracked shortcut' }] })).rejects.toThrow()
    expect((await f.commitments.get('agent-1', f.commitment.id)).status).toBe('open')
  })

  it('keeps reads, pause, disable and stop available when the release switch is off', async () => {
    const f = await fixture(); await enable(f); f.features.enabled = false
    await f.followUp.action('agent-1', f.commitment.id, 'pause', action('pause', 0))
    await expect(f.followUp.action('agent-1', f.commitment.id, 'resume', action('resume', 1))).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
    await f.followUp.stop('agent-1', f.commitment.id, { ...action('stop', 1), scope: 'commitment', targetId: f.commitment.id })
    expect((await f.followUp.get('agent-1', f.commitment.id)).stage).toBe('stopped')
  })

  it.each(['scope', 'expired', 'auto-disabled'] as const)('does not advertise Resume when %s authorization cannot resume', async (reason) => {
    const f = await fixture()
    f.features.auto = true
    const input = reason === 'auto-disabled'
      ? { ...f.enable, policy: { ...f.enable.policy, continuationMode: 'auto' } } : f.enable
    await f.followUp.enable('agent-1', f.commitment.id, input)
    if (reason === 'scope') {
      await f.commitments.update('agent-1', f.commitment.id, { clientRequestId: 'changed-scope', expectedRevision: 0,
        acceptance: 'Changed acceptance needs explicit renewal' })
    } else {
      await f.followUp.action('agent-1', f.commitment.id, 'pause', action('pause', 0))
      if (reason === 'expired') vi.spyOn(f.followUp.state, 'now').mockReturnValue(new Date(Date.parse(f.enable.policy.expiresAt) + 1).toISOString())
      else f.features.auto = false
    }
    expect((await f.followUp.get('agent-1', f.commitment.id)).actions.resume).toBe(false)
    await expect(f.followUp.action('agent-1', f.commitment.id, 'resume', action('resume', 1))).rejects.toMatchObject({
      code: reason === 'auto-disabled' ? 'CAPABILITY_UNAVAILABLE' : 'AUTHORIZATION_CHANGED'
    })
  })

  it('does not enable automatic continuation or automatic new work by accident', async () => {
    const f = await fixture()
    await expect(f.followUp.enable('agent-1', f.commitment.id, { ...f.enable,
      policy: { ...f.enable.policy, continuationMode: 'auto' } })).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
    await expect(f.followUp.enable('agent-1', f.commitment.id, { ...f.enable,
      policy: { ...f.enable.policy, newWorkMode: 'auto' } })).rejects.toThrow()
  })
})
