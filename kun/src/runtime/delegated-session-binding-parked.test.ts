import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import {
  DelegatedSessionCoordinator,
  FileDelegatedSessionBindingStore,
  delegatedCapabilityFingerprint,
  delegatedCredentialIdentity,
  delegatedHistoryDigest,
  delegatedRouteKey,
  type DelegatedSessionBinding,
  type DelegatedSessionRoute,
  type ParkedSession
} from './delegated-session-binding.js'

function user(turnId: string, text: string): Extract<TurnItem, { kind: 'user_message' }> {
  return {
    id: `item_${turnId}`,
    threadId: 'thread_1',
    turnId,
    role: 'user',
    kind: 'user_message',
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    text
  }
}

function route(overrides: Partial<DelegatedSessionRoute> = {}): DelegatedSessionRoute {
  return {
    providerKind: 'cursor-sdk',
    providerId: 'cursor-subscription',
    credentialIdentity: delegatedCredentialIdentity({
      providerId: 'cursor-subscription',
      accountId: 'account-1'
    }),
    workspace: '/tmp/work',
    model: 'auto',
    capabilityFingerprint: delegatedCapabilityFingerprint({
      policy: 'auto',
      tools: []
    }),
    continuationMode: 'native',
    ...overrides
  }
}

const parkedOf = (
  parkedRoute: DelegatedSessionRoute,
  parkedAt: string
): ParkedSession => ({
  key: delegatedRouteKey(parkedRoute),
  ...parkedRoute,
  nativeSessionId: `sess_${parkedRoute.providerId}`,
  synchronizedHistoryDigest: delegatedHistoryDigest([user('turn_x', 'x')]),
  priorItemCount: 1,
  lastCommittedTurnId: 'turn_x',
  parkedAt
})

const bindingOf = (
  active: DelegatedSessionRoute,
  parked: ParkedSession[]
): DelegatedSessionBinding => ({
  schemaVersion: 2,
  threadId: 'thread_1',
  generation: 1,
  ...active,
  nativeSessionId: 'sess_active',
  synchronizedHistoryDigest: delegatedHistoryDigest([user('turn_x', 'x')]),
  priorItemCount: 1,
  lastCommittedTurnId: 'turn_x',
  parked,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
})

describe('DelegatedSessionCoordinator parked sessions', () => {
  test('A -> B -> A restores the parked native session with a delta', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-delegated-'))
    const store = new FileDelegatedSessionBindingStore(root)
    const coordinator = new DelegatedSessionCoordinator(store)
    const routeA = route({ providerKind: 'agent-sdk' })
    const routeB = route({ providerKind: 'cursor-sdk' })
    const first = [user('turn_1', 'first')]
    const second = [...first, user('turn_2', 'second')]

    const prepA = await coordinator.prepare({
      threadId: 'thread_1', route: routeA, priorItems: []
    })
    await coordinator.commit({
      preparation: prepA, committedItems: first,
      lastCommittedTurnId: 'turn_1', nativeSessionId: 'sess_A'
    })
    const parkedDir = store.providerStateDir('agent-sdk', 'thread_1', delegatedRouteKey(routeA))
    await mkdir(parkedDir, { recursive: true })
    await writeFile(join(parkedDir, 'checkpoint'), 'A')

    const prepB = await coordinator.prepare({
      threadId: 'thread_1', route: routeB, priorItems: first
    })
    expect(prepB).toMatchObject({ resumed: false, rebaseReason: 'route_changed' })
    await coordinator.commit({
      preparation: prepB, committedItems: second,
      lastCommittedTurnId: 'turn_2', nativeSessionId: 'sess_B'
    })

    const restored = await coordinator.prepare({
      threadId: 'thread_1', route: routeA, priorItems: second
    })
    expect(restored).toMatchObject({
      resumed: true,
      nativeSessionId: 'sess_A',
      generation: 3,
      parkedDelta: {
        lastCommittedTurnId: 'turn_1',
        fromRoute: { providerKind: 'cursor-sdk' }
      }
    })
    // A's provider state survived the detour; B is now the parked session.
    await expect(access(join(parkedDir, 'checkpoint'))).resolves.toBeUndefined()
    expect((await store.load('thread_1'))?.parked).toMatchObject([
      { providerKind: 'cursor-sdk', nativeSessionId: 'sess_B' }
    ])
  })

  test('A -> B -> A after history deletion fails prefix validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-delegated-'))
    const store = new FileDelegatedSessionBindingStore(root)
    const coordinator = new DelegatedSessionCoordinator(store)
    const routeA = route({ providerKind: 'agent-sdk' })
    const routeB = route({ providerKind: 'cursor-sdk' })
    const first = [user('turn_1', 'first')]
    const second = [...first, user('turn_2', 'second')]

    const prepA = await coordinator.prepare({
      threadId: 'thread_1', route: routeA, priorItems: []
    })
    await coordinator.commit({
      preparation: prepA, committedItems: first,
      lastCommittedTurnId: 'turn_1', nativeSessionId: 'sess_A'
    })
    const parkedDir = store.providerStateDir('agent-sdk', 'thread_1', delegatedRouteKey(routeA))
    await mkdir(parkedDir, { recursive: true })
    await writeFile(join(parkedDir, 'checkpoint'), 'A')

    const prepB = await coordinator.prepare({
      threadId: 'thread_1', route: routeB, priorItems: first
    })
    await coordinator.commit({
      preparation: prepB, committedItems: second,
      lastCommittedTurnId: 'turn_2', nativeSessionId: 'sess_B'
    })

    // turn_1 was deleted upstream: the parked prefix no longer matches.
    const rewritten = [user('turn_2', 'second')]
    const rebased = await coordinator.prepare({
      threadId: 'thread_1', route: routeA, priorItems: rewritten
    })
    expect(rebased).toMatchObject({
      resumed: false,
      rebaseReason: 'route_changed'
    })
    expect(rebased.nativeSessionId).toBeUndefined()
    expect(rebased.parkedDelta).toBeUndefined()
    // The unrestorable entry is dropped and its stale state reset, not parked.
    await expect(access(join(parkedDir, 'checkpoint')))
      .rejects.toMatchObject({ code: 'ENOENT' })
    expect((await store.load('thread_1'))?.parked).toMatchObject([
      { providerKind: 'cursor-sdk', nativeSessionId: 'sess_B' }
    ])
  })

  test('keeps at most three parked sessions and removes evicted state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-delegated-'))
    const store = new FileDelegatedSessionBindingStore(root)
    const coordinator = new DelegatedSessionCoordinator(
      store,
      () => '2026-01-02T00:00:00.000Z'
    )
    const routes = ['p_a', 'p_b', 'p_c', 'p_d', 'p_e'].map((providerId) =>
      route({ providerId }))
    const dirOf = (r: DelegatedSessionRoute) =>
      store.providerStateDir(r.providerKind, 'thread_1', delegatedRouteKey(r))
    const parked = await Promise.all(routes.slice(0, 3).map(async (r) => {
      const dir = dirOf(r)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'checkpoint'), r.providerId)
      return parkedOf(r, '2026-01-01T00:00:00.000Z')
    }))
    await store.save(bindingOf(routes[3]!, parked))
    await mkdir(dirOf(routes[3]!), { recursive: true })
    await writeFile(join(dirOf(routes[3]!), 'checkpoint'), 'p_d')

    const next = await coordinator.prepare({
      threadId: 'thread_1', route: routes[4]!, priorItems: [user('turn_x', 'x')]
    })
    expect(next).toMatchObject({ resumed: false, rebaseReason: 'route_changed' })
    const binding = await store.load('thread_1')
    expect(binding?.parked?.map((entry) => entry.providerId)).toEqual([
      'p_b', 'p_c', 'p_d'
    ])
    await expect(access(dirOf(routes[0]!))).rejects.toMatchObject({ code: 'ENOENT' })
    for (const kept of routes.slice(1, 4)) {
      await expect(access(dirOf(kept))).resolves.toBeUndefined()
    }
  })

  test('expires parked sessions older than seven days', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-delegated-'))
    const store = new FileDelegatedSessionBindingStore(root)
    const coordinator = new DelegatedSessionCoordinator(
      store,
      () => '2026-01-08T00:00:00.000Z'
    )
    const staleRoute = route({ providerId: 'p_stale' })
    const freshRoute = route({ providerId: 'p_fresh' })
    const activeRoute = route({ providerId: 'p_active' })
    const dirOf = (r: DelegatedSessionRoute) =>
      store.providerStateDir(r.providerKind, 'thread_1', delegatedRouteKey(r))
    for (const r of [staleRoute, freshRoute]) {
      await mkdir(dirOf(r), { recursive: true })
      await writeFile(join(dirOf(r), 'checkpoint'), 'x')
    }
    await store.save(bindingOf(activeRoute, [
      parkedOf(staleRoute, '2025-12-31T23:59:59.999Z'),
      parkedOf(freshRoute, '2026-01-01T00:00:00.000Z')
    ]))

    await coordinator.prepare({
      threadId: 'thread_1',
      route: route({ providerId: 'p_next' }),
      priorItems: [user('turn_x', 'x')]
    })

    expect((await store.load('thread_1'))?.parked?.map((e) => e.providerId))
      .toEqual(['p_fresh', 'p_active'])
    await expect(access(dirOf(staleRoute))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(dirOf(freshRoute))).resolves.toBeUndefined()
  })

  test('migrates a v1 binding and its unkeyed provider state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-delegated-'))
    const store = new FileDelegatedSessionBindingStore(root)
    const coordinator = new DelegatedSessionCoordinator(store)
    const v1Route = route()
    const threadDir = createHash('sha256').update('thread_1').digest('hex')
    const legacyDir = join(root, 'provider-state', threadDir, 'cursor-sdk')
    await mkdir(legacyDir, { recursive: true })
    await writeFile(join(legacyDir, 'checkpoint'), 'legacy')
    const bindingDir = join(root, 'bindings')
    await mkdir(bindingDir, { recursive: true })
    await writeFile(
      join(bindingDir, `${threadDir}.json`),
      JSON.stringify({
        schemaVersion: 1,
        threadId: 'thread_1',
        generation: 4,
        ...v1Route,
        nativeSessionId: 'sess_v1',
        synchronizedHistoryDigest: delegatedHistoryDigest([user('turn_1', 'first')]),
        lastCommittedTurnId: 'turn_1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      })
    )

    const loaded = await store.load('thread_1')
    expect(loaded).toMatchObject({
      schemaVersion: 2,
      generation: 4,
      nativeSessionId: 'sess_v1'
    })
    expect(loaded?.parked).toBeUndefined()
    expect(loaded?.priorItemCount).toBeUndefined()
    // Legacy unkeyed state moved under the route-key subdirectory.
    const migrated = join(
      legacyDir,
      delegatedRouteKey(v1Route),
      'checkpoint'
    )
    await expect(access(migrated)).resolves.toBeUndefined()
    await expect(access(join(legacyDir, 'checkpoint')))
      .rejects.toMatchObject({ code: 'ENOENT' })
    // A v1 binding still resumes its native session on a matching route.
    await expect(coordinator.prepare({
      threadId: 'thread_1',
      route: v1Route,
      priorItems: [user('turn_1', 'first')]
    })).resolves.toMatchObject({ resumed: true, nativeSessionId: 'sess_v1' })
  })

  test('serializes concurrent preparations through runExclusive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-delegated-'))
    const store = new FileDelegatedSessionBindingStore(root)
    const coordinator = new DelegatedSessionCoordinator(store)
    const routeA = route({ providerKind: 'agent-sdk' })
    const routeB = route({ providerKind: 'cursor-sdk' })
    const items = [user('turn_1', 'first')]

    const [prepA, prepB] = await Promise.all([
      coordinator.runExclusive('thread_1', async () => {
        const preparation = await coordinator.prepare({
          threadId: 'thread_1', route: routeA, priorItems: []
        })
        await coordinator.commit({
          preparation, committedItems: items,
          lastCommittedTurnId: 'turn_1', nativeSessionId: 'sess_A'
        })
        return preparation
      }),
      coordinator.runExclusive('thread_1', async () => {
        const preparation = await coordinator.prepare({
          threadId: 'thread_1', route: routeB, priorItems: items
        })
        await coordinator.commit({
          preparation, committedItems: items,
          lastCommittedTurnId: 'turn_1', nativeSessionId: 'sess_B'
        })
        return preparation
      })
    ])

    expect(prepA.generation).toBe(1)
    // The second turn observed the committed A binding and parked it.
    expect(prepB).toMatchObject({ resumed: false, rebaseReason: 'route_changed' })
    const binding = await store.load('thread_1')
    expect(binding?.providerKind).toBe('cursor-sdk')
    expect(binding?.parked).toMatchObject([
      { providerKind: 'agent-sdk', nativeSessionId: 'sess_A' }
    ])
  })
})
