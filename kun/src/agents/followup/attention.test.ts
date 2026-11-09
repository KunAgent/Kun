import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommitmentAttentionSchema, type CommitmentAttention } from '../../contracts/collaboration-attention.js'
import { followUpFixture, type FollowUpFixture } from './followup-test-support.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanups.splice(0).reverse()) await close() })
async function fixture() { const f = await followUpFixture(); cleanups.push(f.cleanup); await f.followUp.enable('agent-1', f.commitment.id, f.enable); return f }

const HEAD = 'a'.repeat(40)
const decision = (clientRequestId: string, expectedControlRevision = 0) => ({ clientRequestId,
  expectedControlRevision, kind: 'decision' as const, priority: 60, title: 'Which branch should ship?',
  summary: 'The linked work matches two candidate branches.', question: 'Which branch is authoritative?',
  choices: [{ id: 'main', label: 'main' }, { id: 'release', label: 'release' }] })
const acceptance = (clientRequestId: string, observationRevision = 0, headSha = HEAD) => ({ clientRequestId,
  expectedControlRevision: 0, kind: 'acceptance' as const, priority: 80, title: 'Accept the current head',
  summary: 'Head passed tests and review.', choices: [{ id: 'accept', label: 'accept' }, { id: 'reject', label: 'reject' }],
  artifactVersion: { resourceKey: 'pr-1', headSha, observationRevision } })
const resolution = (clientRequestId: string, expectedAttentionRevision: number, choiceId: string) => ({ clientRequestId,
  expectedControlRevision: 0, expectedAttentionRevision, choiceId, surface: 'gui' as const })

async function row(f: FollowUpFixture, id: string) {
  const stored = await f.store.get<CommitmentAttention>('commitment_attention', id)
  return stored ? { revision: stored.revision, value: CommitmentAttentionSchema.parse(stored.value) } : null
}

describe('business attention and versioned acceptance', () => {
  it('opens a deterministic business question, replays it, and refuses a changed payload', async () => {
    const f = await fixture()
    const opened = await f.followUp.openAttention('agent-1', f.commitment.id, decision('ask-1'))
    expect(opened).toMatchObject({ status: 'open', attentionRevision: 0 })
    expect(await f.followUp.openAttention('agent-1', f.commitment.id, decision('ask-1'))).toEqual(opened)
    await expect(f.followUp.openAttention('agent-1', f.commitment.id,
      { ...decision('ask-1'), title: 'Rewritten question' })).rejects.toThrow('content changed')
    const stored = (await row(f, opened.attentionId))!
    expect(stored.value).toMatchObject({ kind: 'decision', status: 'open', commitmentId: f.commitment.id,
      participantAgentId: 'agent-1', sourceRoomId: f.room.id })
  })

  it('never mints or answers a protected native gate', async () => {
    const f = await fixture()
    for (const kind of ['approval', 'input']) {
      await expect(f.followUp.openAttention('agent-1', f.commitment.id,
        { ...decision('gate-' + kind), kind })).rejects.toThrow()
    }
    // A gate row written by nobody else still cannot be answered through this surface.
    await expect(f.followUp.resolveAttention('agent-1', f.commitment.id, 'missing-attention',
      resolution('resolve-missing', 0, 'main'))).rejects.toMatchObject({ code: 'STALE_ATTENTION' })
  })

  it('binds each answer to the exact revision and a declared choice, and answers once', async () => {
    const f = await fixture()
    const opened = await f.followUp.openAttention('agent-1', f.commitment.id, decision('ask-2'))
    await expect(f.followUp.resolveAttention('agent-1', f.commitment.id, opened.attentionId,
      resolution('resolve-stale', 7, 'main'))).rejects.toMatchObject({ code: 'STALE_ATTENTION' })
    await expect(f.followUp.resolveAttention('agent-1', f.commitment.id, opened.attentionId,
      resolution('resolve-undeclared', 0, 'hotfix'))).rejects.toMatchObject({ code: 'STALE_ATTENTION' })
    const resolved = await f.followUp.resolveAttention('agent-1', f.commitment.id, opened.attentionId,
      resolution('resolve-ok', 0, 'main'))
    expect(resolved).toMatchObject({ status: 'resolved', choiceId: 'main', attentionRevision: 1 })
    expect(resolved.commitmentRevision).toBeUndefined()
    // The same answer replays; a different one cannot overwrite a settled decision.
    expect(await f.followUp.resolveAttention('agent-1', f.commitment.id, opened.attentionId,
      resolution('resolve-ok', 0, 'main'))).toEqual(resolved)
    await expect(f.followUp.resolveAttention('agent-1', f.commitment.id, opened.attentionId,
      resolution('resolve-again', 1, 'release'))).rejects.toMatchObject({ code: 'STALE_ATTENTION' })
    expect((await f.commitments.get('agent-1', f.commitment.id)).status).toBe('open')
  })

  it('fails acceptance closed without an authoritative head reader', async () => {
    const f = await fixture()
    const opened = await f.followUp.openAttention('agent-1', f.commitment.id, acceptance('accept-no-reader'))
    await expect(f.followUp.resolveAttention('agent-1', f.commitment.id, opened.attentionId,
      { ...resolution('accept-no-reader-r', 0, 'accept'), expectedArtifact: acceptance('x').artifactVersion }))
      .rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
    expect((await row(f, opened.attentionId))!.value.status).toBe('open')
    expect((await f.commitments.get('agent-1', f.commitment.id)).status).toBe('open')
  })

  it('requires acceptance to restate the exact judged version', async () => {
    const f = await fixture()
    const opened = await f.followUp.openAttention('agent-1', f.commitment.id, acceptance('accept-restate'))
    f.deps.observedHead = async () => ({ headSha: HEAD, observationRevision: 0 })
    await expect(f.followUp.resolveAttention('agent-1', f.commitment.id, opened.attentionId,
      resolution('accept-no-version', 0, 'accept'))).rejects.toMatchObject({ code: 'STALE_ATTENTION' })
    await expect(f.followUp.resolveAttention('agent-1', f.commitment.id, opened.attentionId,
      { ...resolution('accept-wrong-version', 0, 'accept'),
        expectedArtifact: { resourceKey: 'pr-1', headSha: 'b'.repeat(40), observationRevision: 0 } }))
      .rejects.toMatchObject({ code: 'STALE_ATTENTION' })
    expect((await row(f, opened.attentionId))!.value.status).toBe('open')
  })

  it('supersedes instead of accepting when the head moved, including A to B to A', async () => {
    const f = await fixture()
    const moved = await f.followUp.openAttention('agent-1', f.commitment.id, acceptance('accept-moved'))
    f.deps.observedHead = async () => ({ headSha: 'b'.repeat(40), observationRevision: 1 })
    await expect(f.followUp.resolveAttention('agent-1', f.commitment.id, moved.attentionId,
      { ...resolution('accept-moved-r', 0, 'accept'), expectedArtifact: acceptance('x').artifactVersion }))
      .rejects.toMatchObject({ code: 'STALE_ATTENTION' })
    const superseded = (await row(f, moved.attentionId))!
    expect(superseded.value).toMatchObject({ status: 'superseded' })
    expect(superseded.value).not.toHaveProperty('resolution')

    // Same SHA as the judged version, but an intervening observation: A -> B -> A.
    const aba = await f.followUp.openAttention('agent-1', f.commitment.id, acceptance('accept-aba'))
    f.deps.observedHead = async () => ({ headSha: HEAD, observationRevision: 4 })
    await expect(f.followUp.resolveAttention('agent-1', f.commitment.id, aba.attentionId,
      { ...resolution('accept-aba-r', 0, 'accept'), expectedArtifact: acceptance('x').artifactVersion }))
      .rejects.toMatchObject({ code: 'STALE_ATTENTION' })
    expect((await row(f, aba.attentionId))!.value.status).toBe('superseded')
    expect((await f.commitments.get('agent-1', f.commitment.id)).status).toBe('open')
  })

  it('completes the commitment atomically when the judged version is still current', async () => {
    const f = await fixture()
    const opened = await f.followUp.openAttention('agent-1', f.commitment.id, acceptance('accept-ok'))
    f.deps.observedHead = async () => ({ headSha: HEAD, observationRevision: 0 })
    const resolved = await f.followUp.resolveAttention('agent-1', f.commitment.id, opened.attentionId,
      { ...resolution('accept-ok-r', 0, 'accept'), expectedArtifact: acceptance('x').artifactVersion })
    expect(resolved).toMatchObject({ status: 'resolved', choiceId: 'accept' })
    expect(resolved.commitmentRevision).toBe(1)
    const commitment = await f.commitments.get('agent-1', f.commitment.id)
    expect(commitment.status).toBe('completed')
    expect(commitment.acceptanceEvidence).toEqual([{ summary: 'Accepted accept at ' + HEAD,
      reference: 'attention:' + opened.attentionId }])
    // Resolving the same attention again cannot add a second acceptance record.
    expect(await f.followUp.resolveAttention('agent-1', f.commitment.id, opened.attentionId,
      { ...resolution('accept-ok-r', 0, 'accept'), expectedArtifact: acceptance('x').artifactVersion })).toEqual(resolved)
    expect((await f.commitments.get('agent-1', f.commitment.id)).acceptanceEvidence).toHaveLength(1)
  })

  it('refuses new questions once tracking stopped and bounds the open inbox', async () => {
    const f = await fixture()
    for (let index = 0; index < 50; index++) {
      await f.followUp.openAttention('agent-1', f.commitment.id, decision('bulk-' + index))
    }
    await expect(f.followUp.openAttention('agent-1', f.commitment.id, decision('bulk-overflow')))
      .rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })

    const g = await fixture()
    const control = await g.store.get('commitment_control', g.commitment.id)
    await g.followUp.stop('agent-1', g.commitment.id, { clientRequestId: 'stop', expectedControlRevision: 0,
      scope: 'commitment', targetId: g.commitment.id })
    const stopped = await g.store.get('commitment_control', g.commitment.id)
    expect(stopped!.revision).toBe((control?.revision ?? 0) + 1)
    // Stop invalidates the old revision first, then refuses the question outright.
    await expect(g.followUp.openAttention('agent-1', g.commitment.id, decision('after-stop-stale')))
      .rejects.toMatchObject({ code: 'STALE_REVISION' })
    await expect(g.followUp.openAttention('agent-1', g.commitment.id, decision('after-stop', stopped!.revision)))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_CHANGED' })
  })
})
