import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { RoomStoreConflictError, type RoomDocumentKind } from './room-store.js'
import { followUpTargetKey } from '../contracts/collaboration-followup.js'
import { base, control, effect, execution, event, later, link, scope, subscription, time } from './room-collaboration-test-fixtures.js'

const roots: string[] = [], stores: SqliteRoomStore[] = []
let sequence = 0
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-collaboration-'))
  roots.push(root)
  const path = join(root, 'rooms.sqlite'), store = new SqliteRoomStore({ path })
  stores.push(store)
  await store.assertOwnership()
  return { store, path }
}
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close()
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true })
})
function put<T extends { id: string }>(store: SqliteRoomStore, kind: RoomDocumentKind, value: T, expectedRevision: number | null = null) {
  return store.commit({ requestId: `test:${++sequence}`, checks: [{ kind, id: value.id, expectedRevision }],
    puts: [{ kind, id: value.id, value }] })
}

describe('collaboration transactional storage', () => {
  it('requires CAS and preserves durable idempotency across reopen', async () => {
    const { store, path } = await fixture(), value = control()
    const input = { requestId: 'stable', checks: [{ kind: 'commitment_control' as const, id: value.id, expectedRevision: null }],
      puts: [{ kind: 'commitment_control' as const, id: value.id, value }], result: { generation: 0 } }
    expect(await store.commit(input)).toMatchObject({ duplicate: false })
    await expect(store.commit({ requestId: 'no-cas', puts: input.puts })).rejects.toThrow('revision check')
    await expect(put(store, 'commitment_control', value)).rejects.toBeInstanceOf(RoomStoreConflictError)
    await store.close()
    const reopened = new SqliteRoomStore({ path }); stores.push(reopened)
    expect(await reopened.commit(input)).toMatchObject({ duplicate: true, result: { generation: 0 } })
    await expect(reopened.commit({ ...input, result: { generation: 1 } })).rejects.toThrow('different content')
    expect(await reopened.get('commitment_control', value.id)).toMatchObject({ revision: 0, roomId: 'room', value })
  })

  it('rolls back an entire batch, its events and receipt when any sidecar is malformed', async () => {
    const { store } = await fixture(), first = control(), second = { ...link(), stage: 'running' }
    await expect(store.commit({ requestId: 'bad-batch',
      checks: [{ kind: 'commitment_control', id: first.id, expectedRevision: null }, { kind: 'commitment_link', id: second.id, expectedRevision: null }],
      puts: [{ kind: 'commitment_control', id: first.id, value: first }, { kind: 'commitment_link', id: second.id, value: second }],
      events: [{ roomId: 'room', kind: 'collaboration.updated', payload: {} }] })).rejects.toThrow()
    expect(await store.get('commitment_control', first.id)).toBeNull()
    expect(await store.getRequest('bad-batch')).toBeNull()
    expect(await store.events('room')).toEqual([])
  })

  it('forbids changing scope, physical ownership, identity or epochs backwards', async () => {
    const { store } = await fixture(), value = { ...control(), generation: 2 }
    await put(store, 'commitment_control', value)
    await expect(put(store, 'commitment_control', { ...value, participantAgentId: 'other' }, 0)).rejects.toThrow('identity')
    await expect(put(store, 'commitment_control', { ...value, generation: 1 }, 0)).rejects.toThrow('epoch')
    await expect(store.commit({ requestId: 'wrong-room', checks: [{ kind: 'commitment_control', id: value.id, expectedRevision: 0 }],
      puts: [{ kind: 'commitment_control', id: value.id, roomId: 'other', value }] })).rejects.toThrow('source room mismatch')
    await expect(store.commit({ requestId: 'wrong-task', checks: [{ kind: 'commitment_control', id: value.id, expectedRevision: 0 }],
      puts: [{ kind: 'commitment_control', id: value.id, taskId: 'task', value }] })).rejects.toThrow('task ownership')
    expect((await store.get('commitment_control', value.id))?.revision).toBe(0)
  })

  it('has only one winner for simultaneous CAS updates', async () => {
    const { store } = await fixture(), value = control()
    await put(store, 'commitment_control', value)
    const results = await Promise.allSettled([
      put(store, 'commitment_control', { ...value, paused: true }, 0),
      put(store, 'commitment_control', { ...value, trackingEnabled: false }, 0)
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

  it('enforces active ownership across thread/Workbench aliases while allowing read-only references and explicit release', async () => {
    const { store, path } = await fixture(), owner = link()
    await put(store, 'commitment_link', owner)
    const alias = { ...link('alias', { kind: 'workbench_link', linkId: 'workbench', threadId: 'thread' }), commitmentId: 'other' }
    await expect(put(store, 'commitment_link', alias)).rejects.toThrow('active owner')
    await put(store, 'commitment_link', { ...alias, id: 'reference', ownership: 'referenced' })
    expect(await store.collaborationQuery({ kind: 'owned_target', targetKey: followUpTargetKey(alias.target) }))
      .toMatchObject([{ id: 'link' }])
    // The uniqueness rule also exists at the database boundary, not only in a preflight query.
    const db = new DatabaseSync(path)
    try {
      expect(() => db.prepare('INSERT INTO room_documents(kind,id,room_id,revision,document) VALUES(?,?,?,?,?)')
        .run('commitment_link', alias.id, 'room', 0, JSON.stringify(alias))).toThrow(/UNIQUE/)
    } finally { db.close() }
    await store.commit({ requestId: 'transfer', checks: [
      { kind: 'commitment_link', id: owner.id, expectedRevision: 0 }, { kind: 'commitment_link', id: alias.id, expectedRevision: null }
    ], puts: [{ kind: 'commitment_link', id: owner.id, value: { ...owner, active: false } },
      { kind: 'commitment_link', id: alias.id, value: alias }] })
    expect(await store.collaborationQuery({ kind: 'owned_target', targetKey: followUpTargetKey(owner.target) }))
      .toMatchObject([{ id: 'alias' }])
    await expect(put(store, 'commitment_link', { ...owner, target: { kind: 'thread', threadId: 'different' } }, 1))
      .rejects.toThrow('identity')
  })

  it('keeps events immutable and rejects duplicate provider identity even with a new document ID', async () => {
    const { store } = await fixture(), value = event()
    await put(store, 'collaboration_event', value)
    await expect(put(store, 'collaboration_event', { ...value, summary: 'changed' }, 0)).rejects.toThrow('immutable')
    await expect(put(store, 'collaboration_event', { ...value, id: 'duplicate' })).rejects.toThrow('already exists')
    await put(store, 'collaboration_event', { ...value, id: 'new-observation', nativeKey: 'head:3', objectRevision: '3' })
    expect(await store.list('collaboration_event')).toHaveLength(2)
  })

  it('freezes effect semantics and requires reconciliation instead of recycling an unknown effect', async () => {
    const { store } = await fixture(), value = effect()
    await put(store, 'commitment_effect', value)
    await expect(put(store, 'commitment_effect', { ...value, fingerprint: 'b'.repeat(64) }, 0)).rejects.toThrow('identity')
    const dispatched = { ...value, status: 'dispatching' as const, retryAt: null,
      claim: { ownerId: 'runtime', token: 1, expiresAt: time, generation: 0, authorizationEpoch: 0 } }
    await put(store, 'commitment_effect', dispatched, 0)
    await expect(put(store, 'commitment_effect', { ...dispatched, status: 'pending' }, 1)).rejects.toThrow('proof of non-admission')
    const unknown = { ...dispatched, status: 'outcome_unknown' as const, nextReconcileAt: time }
    await put(store, 'commitment_effect', unknown, 1)
    await expect(put(store, 'commitment_effect', { ...unknown, status: 'pending' }, 2)).rejects.toThrow('reconciliation')
    await expect(put(store, 'commitment_effect', { ...unknown, status: 'dispatching' }, 2)).rejects.toThrow('reconciliation')
    expect(await store.collaborationQuery({ kind: 'due_effects', status: 'pending', before: later })).toEqual([])
    expect(await store.collaborationQuery({ kind: 'due_effects', status: 'outcome_unknown', before: later })).toMatchObject([{ id: value.id }])
  })

  it.each(['failed', 'cancelled'] as const)('cannot hide an unknown outcome as %s without authoritative reconciliation', async (status) => {
    const { store } = await fixture(), value = { ...effect(), status: 'outcome_unknown' as const,
      retryAt: null, nextReconcileAt: time,
      claim: { ownerId: 'runtime', token: 1, expiresAt: time, generation: 0, authorizationEpoch: 0 } }
    await put(store, 'commitment_effect', value)
    await expect(put(store, 'commitment_effect', { ...value, status }, 0)).rejects.toThrow('reconciliation')
    expect((await store.get('commitment_effect', value.id))?.value).toMatchObject({ status: 'outcome_unknown' })
  })

  it('cannot redispatch a failed effect without re-entering pending through proven non-admission', async () => {
    const { store } = await fixture(), value = { ...effect(), status: 'failed' as const, retryAt: null,
      claim: { ownerId: 'runtime', token: 1, expiresAt: time, generation: 0, authorizationEpoch: 0 } }
    await put(store, 'commitment_effect', value)
    await expect(put(store, 'commitment_effect', { ...value, status: 'dispatching' }, 0)).rejects.toThrow('pending')
  })

  it('retains claim fencing and authoritative receipt facts through a known non-admission retry', async () => {
    const { store } = await fixture(), initial = effect(), value = { ...initial, status: 'outcome_unknown' as const,
      retryAt: null, nextReconcileAt: time,
      claim: { ownerId: 'runtime', token: 1, expiresAt: time, generation: 0, authorizationEpoch: 0 } }
    await put(store, 'commitment_effect', value)
    const receipt = { receiver: 'native' as const, requestId: value.requestId, fingerprint: value.fingerprint,
      state: 'known_not_admitted' as const, observedAt: time }
    const failed = { ...value, status: 'failed' as const, receipt }
    await put(store, 'commitment_effect', failed, 0)
    const pending = { ...failed, status: 'pending' as const, retryAt: time, nextReconcileAt: null }
    await put(store, 'commitment_effect', pending, 1)
    await expect(put(store, 'commitment_effect', { ...pending, claim: undefined }, 2)).rejects.toThrow('claim')
    await expect(put(store, 'commitment_effect', { ...pending, status: 'dispatching' }, 2)).rejects.toThrow('token')
    const dispatched = { ...pending, status: 'dispatching' as const, retryAt: null, claim: { ...pending.claim, token: 2 } }
    await put(store, 'commitment_effect', dispatched, 2)
    const accepted = { ...dispatched, status: 'succeeded' as const,
      receipt: { ...receipt, state: 'accepted' as const, targetRefId: 'native-turn', threadId: 'thread', turnId: 'native-turn' } }
    await put(store, 'commitment_effect', accepted, 3)
    await expect(put(store, 'commitment_effect', { ...accepted, receipt }, 4)).rejects.toThrow('admission receipt')
  })

  it('keeps receiver request IDs unique and permits/revocations durable', async () => {
    const { store } = await fixture(), value = execution()
    await put(store, 'commitment_execution', value)
    const permit = { admissionKey: 'key', controlRevision: 0, claimToken: 1, issuedAt: time }
    const admitted = { ...value, phase: 'admitted' as const, permit, nextReconcileAt: time }
    await put(store, 'commitment_execution', admitted, 0)
    await expect(put(store, 'commitment_execution', { ...admitted, permit: undefined, phase: 'reserved' }, 1)).rejects.toThrow('erased')
    await put(store, 'commitment_execution', { ...admitted, permit: { ...permit, revokedAt: time } }, 1)
    await expect(put(store, 'commitment_execution', admitted, 2)).rejects.toThrow('revocation')
    const other = execution('different')
    other.requestId = value.requestId; other.envelope.requestId = value.requestId
    await expect(put(store, 'commitment_execution', other)).rejects.toThrow(/UNIQUE/)
    expect(await store.collaborationQuery({ kind: 'due_executions', phase: 'admitted', before: later })).toHaveLength(1)
  })

  it('uses bounded due-time keyset queries and observes updates to old insertion sequences', async () => {
    const { store, path } = await fixture()
    for (const id of ['c', 'a', 'b']) await put(store, 'commitment_subscription', subscription(id))
    await put(store, 'commitment_subscription', { ...subscription('disabled'), enabled: false })
    await put(store, 'commitment_subscription', { ...subscription('future'), nextPollAt: later })
    const first = await store.collaborationQuery({ kind: 'due_subscriptions', before: time, limit: 2 })
    expect(first.map((row) => row.id)).toEqual(['a', 'b'])
    expect((await store.collaborationQuery({ kind: 'due_subscriptions', before: time, cursor: { at: time, id: 'b' }, limit: 2 }))
      .map((row) => row.id)).toEqual(['c'])
    await put(store, 'commitment_subscription', { ...subscription('a'), nextPollAt: later }, 0)
    expect((await store.collaborationQuery({ kind: 'due_subscriptions', before: time })).map((row) => row.id)).toEqual(['b', 'c'])
    await expect(store.collaborationQuery({ kind: 'due_subscriptions', before: later, limit: 101 })).rejects.toThrow()
    expect(await store.collaborationQuery({ kind: 'by_commitment', ...scope, sourceRoomId: 'other', documentKind: 'commitment_subscription' })).toEqual([])
    expect(await store.collaborationQuery({ kind: 'source_subscriptions', sourceId: 'source' })).toHaveLength(5)
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM room_documents WHERE kind='commitment_subscription'
        AND json_extract(document,'$.enabled')=1 AND json_extract(document,'$.nextPollAt')<=?
        ORDER BY json_extract(document,'$.nextPollAt'),id LIMIT ?`).all(time, 2)
      expect(JSON.stringify(plan)).toContain('collaboration_subscription_due')
      expect(JSON.stringify(plan)).not.toContain('TEMP B-TREE')
    } finally { db.close() }
  })

  it('orders scoped attention by priority and protects one-shot business resolutions', async () => {
    const { store } = await fixture()
    const make = (id: string, priority: number) => ({ ...base(id), ...scope, kind: 'decision', status: 'open', priority,
      title: 'Scope decision', summary: 'Keep or expand scope', question: 'Keep current scope?',
      choices: [{ id: 'keep', label: 'Keep scope' }], evidenceRefs: [] })
    for (const [id, priority] of [['a', 1], ['b', 5], ['c', 5]] as const) await put(store, 'commitment_attention', make(id, priority))
    const query = { kind: 'attention' as const, participantAgentId: 'agent', sourceRoomId: 'room', status: 'open' as const, limit: 1 }
    expect((await store.collaborationQuery(query)).map((row) => row.id)).toEqual(['c'])
    expect((await store.collaborationQuery({ ...query, cursor: { priority: 5, at: time, id: 'c' } })).map((row) => row.id)).toEqual(['b'])
    const resolved = { ...make('c', 5), status: 'resolved', resolution: { clientRequestId: 'answer', choiceId: 'keep', resolvedAt: time, surface: 'gui' } }
    await put(store, 'commitment_attention', resolved, 0)
    await expect(put(store, 'commitment_attention', { ...resolved, resolution: { ...resolved.resolution, clientRequestId: 'again' } }, 1))
      .rejects.toThrow('closed attention')
    expect(await store.collaborationQuery({ ...query, sourceRoomId: 'another' })).toEqual([])
  })
})
