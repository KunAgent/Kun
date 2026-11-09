import { CollaborationEventSchema, type CollaborationEvent, type CollaborationSource,
  type CollaborationSourceGrant } from '../../contracts/collaboration-events.js'
import { FollowUpEndpointCheckpointSchema, type CommitmentSubscription,
  type FollowUpEndpointCheckpoint, type FollowUpReadKind } from '../../contracts/collaboration-followup.js'
import { FollowUpError } from './state.js'
import { assertGrantLive } from './sources.js'

/** The reader never receives token material; it names a credential the host resolves. */
export type FollowUpHttpRequest = { url: string; headers: Record<string, string>; credentialRef: string }
export type FollowUpHttpResponse = { status: number; headers: Record<string, string>; body: unknown }
export type FollowUpHttpFetcher = (request: FollowUpHttpRequest) => Promise<FollowUpHttpResponse>

/** Every bound here is a hard refusal, not a truncation: partial data is never "good enough". */
export const READER_LIMITS = { maxPages: 3, maxItemsPerPage: 100, maxEndpoints: 6 } as const

export type ReaderResult = {
  events: CollaborationEvent[]
  checkpoints: FollowUpEndpointCheckpoint[]
  baselineComplete: boolean
  incomplete: FollowUpReadKind[]
}

const clamp = (value: string, max: number) => value.length > max ? value.slice(0, max) : value
const resourceKey = (grant: CollaborationSourceGrant) =>
  `${grant.resource.owner}/${grant.resource.repository}#${grant.resource.number}`

/** A source must still be the same authorization the consent was granted against. */
export function assertSourceCurrent(source: CollaborationSource, grant: CollaborationSourceGrant): void {
  if (source.authorizationBarrier !== 'open') {
    throw new FollowUpError('AUTHORIZATION_CHANGED', 'the source authorization is blocked')
  }
  if (source.health === 'authorization_required' || source.health === 'disconnected') {
    throw new FollowUpError('AUTHORIZATION_CHANGED', 'the source needs attention before it can be read')
  }
  if (source.accountRef !== grant.accountRef || source.authorizationEpoch !== grant.authorizationEpoch) {
    throw new FollowUpError('AUTHORIZATION_CHANGED', 'the source authorization changed since consent')
  }
}

function endpointPath(endpoint: FollowUpReadKind, grant: CollaborationSourceGrant, headSha?: string): string {
  const base = `/repos/${grant.resource.owner}/${grant.resource.repository}`
  switch (endpoint) {
    case 'head': case 'state': return `${base}/pulls/${grant.resource.number}`
    case 'checks': return headSha ? `${base}/commits/${headSha}/check-runs` : ''
    case 'reviews': return `${base}/pulls/${grant.resource.number}/reviews`
    case 'review_comments': return `${base}/pulls/${grant.resource.number}/comments`
    case 'comments': return `${base}/issues/${grant.resource.number}/comments`
    default: return ''
  }
}

const nextLink = (link: string | undefined): string | undefined => {
  if (!link) return undefined
  const match = /<([^>]+)>\s*;\s*rel="next"/.exec(link)
  return match?.[1]
}

type Item = Record<string, unknown>
const items = (body: unknown): Item[] => {
  if (Array.isArray(body)) return body as Item[]
  if (body && typeof body === 'object') {
    const list = (body as { items?: unknown }).items
    if (Array.isArray(list)) return list as Item[]
    return [body as Item]
  }
  return []
}

const text = (item: Item, key: string): string | undefined => {
  const value = item[key]
  return typeof value === 'string' && value ? value : undefined
}

function eventFor(endpoint: FollowUpReadKind, item: Item, grant: CollaborationSourceGrant,
  source: CollaborationSource, now: string): CollaborationEvent | null {
  const id = text(item, 'id') ?? text(item, 'sha') ?? text(item, 'node_id')
  if (!id) return null
  const headSha = text((item.head ?? {}) as Item, 'sha') ?? text(item, 'sha')
  const revision = endpoint === 'head' ? headSha
    : endpoint === 'state' ? `${text(item, 'state') ?? 'unknown'}:${text(item, 'merged_at') ?? 'open'}`
    : endpoint === 'checks' ? `${text(item, 'name') ?? id}:${text(item, 'status') ?? ''}:${text(item, 'conclusion') ?? ''}`
    : `${id}:${text(item, 'updated_at') ?? text(item, 'submitted_at') ?? text(item, 'created_at') ?? ''}`
  if (!revision) return null
  const kind = endpoint === 'head' ? 'head_changed' : endpoint === 'state' ? 'state_changed'
    : endpoint === 'checks' ? 'check_changed'
    : endpoint === 'reviews' ? 'review_changed' : 'comment_changed'
  const occurredAt = text(item, 'updated_at') ?? text(item, 'submitted_at') ?? text(item, 'created_at') ?? now
  const actor = (item.user ?? {}) as Item
  const login = typeof actor.login === 'string' ? actor.login : undefined
  return CollaborationEventSchema.parse({
    schemaVersion: 1, id: clamp(`${endpoint}:${resourceKey(grant)}:${id}`, 512),
    createdAt: now, updatedAt: now, sourceId: source.id,
    nativeKey: clamp(`${endpoint}:${resourceKey(grant)}:${id}`, 1024),
    objectRevision: clamp(revision, 512), kind, resourceKey: resourceKey(grant),
    ...(login ? { actor: { id: clamp(login, 100), login: clamp(login, 100) } } : {}),
    occurredAt, receivedAt: now,
    provenance: { kind: 'github', sourceGeneration: source.sourceGeneration,
      credentialEpoch: source.credentialEpoch, authorizationEpoch: source.authorizationEpoch,
      resource: grant.resource, endpoint },
    summary: clamp(`${endpoint} ${kind} ${clamp(revision, 200)}`, 1000), contextOnly: true
  })
}

/**
 * Reads only what the grant allows, honouring per-endpoint ETags. An endpoint whose pages
 * do not all arrive contributes nothing, and a first observation is only "baseline
 * complete" when every granted endpoint finished: no partial-green baseline.
 */
export async function readPullRequest(input: {
  fetcher: FollowUpHttpFetcher; grant: CollaborationSourceGrant; source: CollaborationSource
  subscription: CommitmentSubscription; now: string; apiBase?: string
}): Promise<ReaderResult> {
  const { grant, source, subscription, now } = input
  assertGrantLive(grant, now)
  assertSourceCurrent(source, grant)
  const endpoints = grant.allowedReads.slice(0, READER_LIMITS.maxEndpoints)
  const prior = subscription.checkpoint
  const events: CollaborationEvent[] = []
  const checkpoints: FollowUpEndpointCheckpoint[] = []
  const incomplete: FollowUpReadKind[] = []
  let observedHead = prior.observedHead?.headSha
  const apiBase = input.apiBase ?? 'https://api.github.com'

  // Head first: check runs are addressed by the current head sha.
  const ordered = [...endpoints].sort((left, right) =>
    (left === 'head' ? 0 : left === 'state' ? 1 : 2) - (right === 'head' ? 0 : right === 'state' ? 1 : 2))
  for (const endpoint of ordered) {
    const before = prior.endpoints.find((row) => row.endpoint === endpoint)
    const path = endpointPath(endpoint, grant, observedHead)
    if (!path) { incomplete.push(endpoint); continue }
    const pageEvents: CollaborationEvent[] = []
    let url: string | undefined = apiBase + path
    let etag = before?.etag
    let pages = 0, complete = false, next: string | undefined
    while (url && pages < READER_LIMITS.maxPages) {
      const response = await input.fetcher({ url, credentialRef: source.credentialRef,
        headers: { accept: 'application/vnd.github+json', ...(etag ? { 'if-none-match': etag } : {}) } })
      pages += 1
      if (response.status === 304) { complete = true; url = undefined; break }
      if (response.status === 401 || response.status === 403) {
        throw new FollowUpError('AUTHORIZATION_CHANGED', 'the source rejected its credential')
      }
      if (response.status === 404) {
        throw new FollowUpError('CAPABILITY_UNAVAILABLE', 'the granted resource is no longer readable')
      }
      if (response.status === 429 || response.status >= 500) {
        throw new FollowUpError('CAPABILITY_UNAVAILABLE', 'the source is temporarily unavailable')
      }
      if (response.status < 200 || response.status >= 300) {
        throw new FollowUpError('CAPABILITY_UNAVAILABLE', 'unexpected source response')
      }
      const page = items(response.body)
      if (page.length > READER_LIMITS.maxItemsPerPage) break // bound hit: stay incomplete
      for (const item of page) {
        if (endpoint === 'head' || endpoint === 'state') {
          observedHead = text((item.head ?? {}) as Item, 'sha') ?? text(item, 'sha') ?? observedHead
        }
        const event = eventFor(endpoint, item, grant, source, now)
        if (event) pageEvents.push(event)
      }
      etag = response.headers.etag ?? response.headers.ETag ?? etag
      next = nextLink(response.headers.link ?? response.headers.Link)
      url = next
      if (!next) complete = true
    }
    if (!complete) { incomplete.push(endpoint); continue }
    checkpoints.push(FollowUpEndpointCheckpointSchema.parse({ endpoint,
      ...(etag ? { etag } : {}), ...(next ? { cursor: clamp(next, 2048) } : {}), completedAt: now }))
    events.push(...pageEvents)
  }

  // A first observation must be whole; otherwise nothing is emitted for this poll.
  const baselineComplete = prior.baselineComplete || incomplete.length === 0
  return { events: baselineComplete ? events : [], checkpoints, baselineComplete, incomplete }
}
