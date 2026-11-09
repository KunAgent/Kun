import { afterEach, describe, expect, it } from 'vitest'
import { CollaborationSourceSchema, type CollaborationSourceGrant } from '../../contracts/collaboration-events.js'
import { putRoomDocument } from '../../rooms/room-service.js'
import { liveSourceGrant } from './sources.js'
import { followUpFixture, type FollowUpFixture } from './followup-test-support.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function fixture() { const f = await followUpFixture(); cleanups.push(f.cleanup); return f }

/** A ready GitHub source. Nothing here performs a network call. */
async function source(f: FollowUpFixture, overrides: Partial<{ health: string; authorizationBarrier: string }> = {}) {
  const now = new Date().toISOString()
  const value = CollaborationSourceSchema.parse({ schemaVersion: 1, id: 'source-1', createdAt: now, updatedAt: now,
    provider: 'github', accountRef: 'account-1', credentialRef: 'credential-1', sourceGeneration: 0,
    credentialEpoch: 0, authorizationEpoch: 0, authorizationBarrier: 'open', health: 'ready', retryAt: null,
    ...overrides })
  await putRoomDocument(f.store, 'collaboration_source', value.id, f.room.id, value, null)
  return value
}

const resource = (number = 7, repository = 'deepseek-gui') => ({ kind: 'github_pull_request' as const,
  repositoryId: 'repo-1', owner: 'deepseek', repository, number })

const grant = (f: FollowUpFixture, overrides: Record<string, unknown> = {}) => ({
  clientRequestId: 'grant-' + Math.random().toString(36).slice(2), expectedControlRevision: 0,
  sourceId: 'source-1', resource: resource(), allowedReads: ['head', 'checks'],
  modelShare: { allowed: false, threadId: 'thread-1', providers: [] },
  continuationAllowed: false, expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  userEvidence: f.userEvidence, ...overrides })

async function enabled(f: FollowUpFixture) {
  await f.followUp.enable('agent-1', f.commitment.id, f.enable)
  f.features.github = true
}

describe('external source grants', () => {
  it('records an account-level consent and bumps the control generation', async () => {
    const f = await fixture(); await enabled(f); await source(f)
    const created = await f.followUp.grantSource('agent-1', f.commitment.id, grant(f))
    expect(created).toMatchObject({ grantRevision: 0, controlRevision: 1 })
    const row = await f.store.get('collaboration_source_grant', created.grantId)
    expect(row!.value).toMatchObject({ accountRef: 'account-1', authorizationEpoch: 0,
      continuationAllowed: false, allowedReads: ['head', 'checks'] })
    // Account-level: the grant carries no repository credential of its own.
    expect(JSON.stringify(row!.value)).not.toContain('credentialRef')
  })

  it('refuses to mint consent when external tracking is off or the source needs attention', async () => {
    const f = await fixture(); await enabled(f); await source(f)
    f.features.github = false
    await expect(f.followUp.grantSource('agent-1', f.commitment.id, grant(f)))
      .rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
  })

  it('refuses a blocked or unhealthy source', async () => {
    const f = await fixture(); await enabled(f)
    await source(f, { authorizationBarrier: 'blocked' })
    await expect(f.followUp.grantSource('agent-1', f.commitment.id, grant(f)))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_CHANGED' })
    const g = await fixture(); await enabled(g)
    await source(g, { health: 'authorization_required' })
    await expect(g.followUp.grantSource('agent-1', g.commitment.id, grant(g)))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_CHANGED' })
  })

  it('bounds the consent lifetime in both directions', async () => {
    const f = await fixture(); await enabled(f); await source(f)
    await expect(f.followUp.grantSource('agent-1', f.commitment.id,
      grant(f, { expiresAt: new Date(Date.now() - 1000).toISOString() })))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_CHANGED' })
    await expect(f.followUp.grantSource('agent-1', f.commitment.id,
      grant(f, { expiresAt: new Date(Date.now() + 25 * 3_600_000).toISOString() })))
      .rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
  })

  it('replaces the previous consent for the same resource instead of stacking', async () => {
    const f = await fixture(); await enabled(f); await source(f)
    const first = await f.followUp.grantSource('agent-1', f.commitment.id, grant(f))
    const second = await f.followUp.grantSource('agent-1', f.commitment.id,
      grant(f, { expectedControlRevision: first.controlRevision, allowedReads: ['head', 'checks', 'reviews'] }))
    const before = await f.store.get('collaboration_source_grant', first.grantId)
    expect(before!.value).toMatchObject({ revokedAt: expect.any(String) })
    const live = await liveSourceGrant(f.followUp.state, f.commitment,
      `deepseek/deepseek-gui#7`)
    expect(live.id).toBe(second.grantId)
    expect(live.allowedReads).toEqual(['head', 'checks', 'reviews'])
  })

  it('keeps a bounded number of live consents per commitment', async () => {
    const f = await fixture(); await enabled(f); await source(f)
    let controlRevision = 0
    for (let index = 0; index < 20; index += 1) {
      const created = await f.followUp.grantSource('agent-1', f.commitment.id,
        grant(f, { expectedControlRevision: controlRevision, resource: resource(index + 1) }))
      controlRevision = created.controlRevision
    }
    await expect(f.followUp.grantSource('agent-1', f.commitment.id,
      grant(f, { expectedControlRevision: controlRevision, resource: resource(99) })))
      .rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
  })

  it('revokes once, then reports the same revocation instead of revoking again', async () => {
    const f = await fixture(); await enabled(f); await source(f)
    const created = await f.followUp.grantSource('agent-1', f.commitment.id, grant(f))
    const revoked = await f.followUp.revokeSourceGrant('agent-1', f.commitment.id,
      { clientRequestId: 'revoke', expectedControlRevision: created.controlRevision,
        grantId: created.grantId, expectedGrantRevision: created.grantRevision })
    expect(revoked.revokedAt).toBeTruthy()
    const again = await f.followUp.revokeSourceGrant('agent-1', f.commitment.id,
      { clientRequestId: 'revoke-2', expectedControlRevision: revoked.controlRevision,
        grantId: created.grantId, expectedGrantRevision: revoked.grantRevision })
    expect(again.revokedAt).toBe(revoked.revokedAt)
    await expect(liveSourceGrant(f.followUp.state, f.commitment, 'deepseek/deepseek-gui#7'))
      .rejects.toMatchObject({ code: 'SOURCE_GRANT_EXPIRED' })
  })

  it('refuses a stale grant revision', async () => {
    const f = await fixture(); await enabled(f); await source(f)
    const created = await f.followUp.grantSource('agent-1', f.commitment.id, grant(f))
    await expect(f.followUp.revokeSourceGrant('agent-1', f.commitment.id,
      { clientRequestId: 'revoke', expectedControlRevision: created.controlRevision,
        grantId: created.grantId, expectedGrantRevision: created.grantRevision + 5 }))
      .rejects.toMatchObject({ code: 'STALE_REVISION' })
  })

  it('shares with a model only inside a thread of this commitment', async () => {
    const f = await fixture(); await enabled(f); await source(f)
    const target = f.addTarget('share-thread', 'completed')
    const shared = await f.followUp.grantSource('agent-1', f.commitment.id, grant(f, {
      modelShare: { allowed: true, threadId: target.threadId, providers: [{ providerId: 'p', model: 'm' }] } }))
    expect((await f.store.get<CollaborationSourceGrant>('collaboration_source_grant', shared.grantId))!.value.modelShare)
      .toMatchObject({ allowed: true })
    await expect(f.followUp.grantSource('agent-1', f.commitment.id, grant(f, {
      expectedControlRevision: shared.controlRevision,
      modelShare: { allowed: true, threadId: 'some-other-thread', providers: [{ providerId: 'p', model: 'm' }] } })))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_CHANGED' })
  })
})
