import { describe, expect, it } from 'vitest'
import { CollaborationSourceSchema, CollaborationSourceGrantSchema,
  type CollaborationSourceGrant } from '../../contracts/collaboration-events.js'
import { CommitmentSubscriptionSchema,
  type CommitmentSubscription, type FollowUpReadKind } from '../../contracts/collaboration-followup.js'
import { READER_LIMITS, readPullRequest, type FollowUpHttpFetcher } from './github-reader.js'

const now = '2026-02-01T00:00:00.000Z'
const sha = 'a'.repeat(40)
const resource = { kind: 'github_pull_request' as const, repositoryId: 'repo-1',
  owner: 'acme', repository: 'widget', number: 7 }

const source = CollaborationSourceSchema.parse({ schemaVersion: 1, id: 'source-1',
  createdAt: now, updatedAt: now, provider: 'github', accountRef: 'account-1',
  credentialRef: 'credential-1', sourceGeneration: 3, credentialEpoch: 2, authorizationEpoch: 1,
  authorizationBarrier: 'open', health: 'ready', retryAt: null })

const grantOf = (reads: FollowUpReadKind[]): CollaborationSourceGrant =>
  CollaborationSourceGrantSchema.parse({ schemaVersion: 1, id: 'grant-1', createdAt: now, updatedAt: now,
    sourceId: 'source-1', accountRef: 'account-1', participantAgentId: 'agent-1', sourceRoomId: 'room-1',
    commitmentId: 'commitment-1', resource, allowedReads: reads,
    modelShare: { allowed: false, threadId: 'thread-1', providers: [] },
    continuationAllowed: true, expiresAt: '2026-02-02T00:00:00.000Z', authorizationEpoch: 1,
    userEvidence: { kind: 'user_message', sourceRoomId: 'room-1', sourceMessageId: 'message-1', messageRevision: 0 } })

const subscriptionOf = (options: { reads?: { endpoint: FollowUpReadKind; etag?: string }[],
  baselineComplete?: boolean, observedHead?: { resourceKey: string; headSha: string; observationRevision: number } } = {}) =>
  CommitmentSubscriptionSchema.parse({ schemaVersion: 1, id: 'subscription-1', createdAt: now, updatedAt: now,
    commitmentId: 'commitment-1', participantAgentId: 'agent-1', sourceRoomId: 'room-1', sourceId: 'source-1',
    grantRef: 'grant-1', resource, enabled: true, eventKinds: ['head_changed', 'state_changed', 'check_changed',
      'review_changed', 'comment_changed'],
    checkpoint: { baselineComplete: options.baselineComplete ?? false, endpoints: options.reads ?? [],
      ...(options.observedHead ? { observedHead: options.observedHead } : {}) }, nextPollAt: null }) as CommitmentSubscription

type Reply = { status: number; headers?: Record<string, string>; body?: unknown }
function fetcher(routes: Record<string, Reply>) {
  const requests: { url: string; headers: Record<string, string>; credentialRef: string }[] = []
  const suffixes = Object.keys(routes).sort((left, right) => right.length - left.length)
  const fn: FollowUpHttpFetcher = async (request) => {
    requests.push(request)
    const suffix = suffixes.find((candidate) => request.url.includes(candidate))
    if (!suffix) throw new Error('unexpected url ' + request.url)
    const reply = routes[suffix]!
    return { status: reply.status, headers: reply.headers ?? {}, body: reply.body }
  }
  return { fn, requests }
}

const pull = { id: 11, node_id: 'PR_11', state: 'open', merged_at: null,
  head: { sha }, updated_at: '2026-01-31T10:00:00.000Z' }

describe('bounded github reader', () => {
  it('emits context-only github events for a complete baseline', async () => {
    const { fn } = fetcher({
      '/pulls/7/reviews': { status: 200, body: [{ id: 101, node_id: 'R_101', state: 'APPROVED',
        submitted_at: '2026-01-30T09:00:00.000Z', user: { login: 'octocat' } }] },
      '/pulls/7': { status: 200, body: pull }
    })
    const result = await readPullRequest({ fetcher: fn, grant: grantOf(['head', 'state', 'reviews']),
      source, subscription: subscriptionOf(), now })
    expect(result.baselineComplete).toBe(true)
    expect(result.incomplete).toEqual([])
    expect(result.events.map((event) => event.kind).sort())
      .toEqual(['head_changed', 'review_changed', 'state_changed'])
    for (const event of result.events) {
      expect(event.contextOnly).toBe(true)
      expect(event.provenance.kind).toBe('github')
      expect(event.sourceId).toBe('source-1')
    }
    expect(result.events.find((event) => event.kind === 'review_changed')!.actor)
      .toEqual({ id: 'octocat', login: 'octocat' })
  })

  it('never emits a partial baseline when one endpoint cannot finish', async () => {
    const { fn } = fetcher({
      '/pulls/7/reviews': { status: 200, headers: { link: '<https://api.github.com/repos/acme/widget/pulls/7/reviews?page=2>; rel="next"' },
        body: [{ id: 1, node_id: 'R_1', state: 'COMMENTED', submitted_at: '2026-01-30T09:00:00.000Z' }] },
      '/pulls/7': { status: 200, body: pull }
    })
    const result = await readPullRequest({ fetcher: fn, grant: grantOf(['head', 'state', 'reviews']),
      source, subscription: subscriptionOf(), now })
    expect(result.baselineComplete).toBe(false)
    expect(result.incomplete).toEqual(['reviews'])
    // The finished endpoints keep their checkpoints, but nothing is handed to the model.
    expect(result.events).toEqual([])
    expect(result.checkpoints.map((row) => row.endpoint).sort()).toEqual(['head', 'state'])
  })

  it('reuses an etag, sends it as a precondition and emits nothing on 304', async () => {
    const { fn, requests } = fetcher({ '/pulls/7': { status: 304, headers: { etag: '"e1"' } } })
    const result = await readPullRequest({ fetcher: fn, grant: grantOf(['head']), source,
      subscription: subscriptionOf({ baselineComplete: true, reads: [{ endpoint: 'head', etag: '"e1"' }] }), now })
    expect(requests[0]!.headers['if-none-match']).toBe('"e1"')
    expect(result.events).toEqual([])
    expect(result.baselineComplete).toBe(true)
    expect(result.checkpoints[0]!.etag).toBe('"e1"')
  })

  it('addresses check runs by the observed head', async () => {
    const { fn, requests } = fetcher({ [`/commits/${sha}/check-runs`]: { status: 200, body: [
      { id: 501, node_id: 'CR_501', name: 'build', status: 'completed', conclusion: 'success' }] } })
    const result = await readPullRequest({ fetcher: fn, grant: grantOf(['checks']), source,
      subscription: subscriptionOf({ observedHead: { resourceKey: 'acme/widget#7', headSha: sha, observationRevision: 2 } }), now })
    expect(requests[0]!.url).toBe(`https://api.github.com/repos/acme/widget/commits/${sha}/check-runs`)
    expect(result.events[0]!.kind).toBe('check_changed')
    expect(result.events[0]!.objectRevision).toBe('build:completed:success')
  })

  it('treats an oversized page as incomplete rather than truncating it', async () => {
    const many = Array.from({ length: READER_LIMITS.maxItemsPerPage + 1 }, (_, index) =>
      ({ id: index, node_id: 'R_' + index, state: 'COMMENTED', submitted_at: '2026-01-30T09:00:00.000Z' }))
    const { fn } = fetcher({ '/pulls/7/reviews': { status: 200, body: many } })
    const result = await readPullRequest({ fetcher: fn, grant: grantOf(['reviews']), source,
      subscription: subscriptionOf({ baselineComplete: true }), now })
    expect(result.incomplete).toEqual(['reviews'])
    expect(result.events).toEqual([])
  })

  it('refuses an expired grant, a moved authorization and a rejected credential', async () => {
    const { fn } = fetcher({ '/pulls/7': { status: 200, body: pull } })
    await expect(readPullRequest({ fetcher: fn,
      grant: { ...grantOf(['head']), expiresAt: '2026-01-01T00:00:00.000Z' }, source,
      subscription: subscriptionOf(), now })).rejects.toMatchObject({ code: 'SOURCE_GRANT_EXPIRED' })
    await expect(readPullRequest({ fetcher: fn, grant: grantOf(['head']),
      source: { ...source, authorizationEpoch: 5 }, subscription: subscriptionOf(), now }))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_CHANGED' })
    const rejected = fetcher({ '/pulls/7': { status: 401 } })
    await expect(readPullRequest({ fetcher: rejected.fn, grant: grantOf(['head']), source,
      subscription: subscriptionOf(), now })).rejects.toMatchObject({ code: 'AUTHORIZATION_CHANGED' })
  })
})
