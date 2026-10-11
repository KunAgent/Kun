import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import { filterGoalContextsForGoalKey } from '../loop/continuation-instructions.js'
import {
  DelegatedSessionCoordinator,
  FileDelegatedSessionBindingStore,
  delegatedCapabilityFingerprint,
  delegatedCredentialIdentity,
  delegatedHistoryDigest,
  delegatedRouteKey,
  priorItemsForDelegatedTurn,
  type DelegatedSessionRoute
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

describe('DelegatedSessionCoordinator', () => {
  test('persists a secret-free binding and resumes it after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-delegated-'))
    const store = new FileDelegatedSessionBindingStore(root)
    const first = new DelegatedSessionCoordinator(store, () => '2026-01-01T00:00:00.000Z')
    const prior = [user('turn_1', 'hello')]
    const prepared = await first.prepare({ threadId: 'thread_1', route: route(), priorItems: [] })
    await first.commit({
      preparation: prepared,
      committedItems: prior,
      lastCommittedTurnId: 'turn_1',
      nativeSessionId: 'agent_1'
    })

    const restarted = new DelegatedSessionCoordinator(
      new FileDelegatedSessionBindingStore(root)
    )
    const next = await restarted.prepare({
      threadId: 'thread_1',
      route: route(),
      priorItems: prior
    })
    expect(next).toMatchObject({
      generation: 1,
      resumed: true,
      nativeSessionId: 'agent_1'
    })
    const serialized = JSON.stringify(await store.load('thread_1'))
    expect(serialized).not.toContain('hello')
    expect(serialized).not.toContain('apiKey')
    expect(serialized).not.toContain('account-1')
  })

  test('rebases on route, capability, or canonical-history mismatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-delegated-'))
    const coordinator = new DelegatedSessionCoordinator(
      new FileDelegatedSessionBindingStore(root)
    )
    const prepared = await coordinator.prepare({
      threadId: 'thread_1',
      route: route(),
      priorItems: []
    })
    await coordinator.commit({
      preparation: prepared,
      committedItems: [user('turn_1', 'first')],
      lastCommittedTurnId: 'turn_1',
      nativeSessionId: 'agent_1'
    })

    await expect(coordinator.prepare({
      threadId: 'thread_1',
      route: route({
        credentialIdentity: delegatedCredentialIdentity({
          providerId: 'cursor-subscription',
          accountId: 'account-2'
        })
      }),
      priorItems: [user('turn_1', 'first')]
    })).resolves.toMatchObject({ resumed: false, rebaseReason: 'route_changed' })
    await expect(coordinator.prepare({
      threadId: 'thread_1',
      route: route({ capabilityFingerprint: delegatedCapabilityFingerprint('changed') }),
      priorItems: [user('turn_1', 'first')]
    })).resolves.toMatchObject({ resumed: false, rebaseReason: 'capabilities_changed' })
    await expect(coordinator.prepare({
      threadId: 'thread_1',
      route: route(),
      priorItems: [user('turn_1', 'changed')]
    })).resolves.toMatchObject({ resumed: false, rebaseReason: 'history_changed' })
  })

  test('excludes private runtime context from delegated history identity', () => {
    const publicItems = [user('turn_1', 'hello')]
    const withPrivateSource: TurnItem[] = [
      ...publicItems,
      {
        id: 'item-private', threadId: 'thread_1', turnId: 'turn_1',
        role: 'system', kind: 'runtime_context_source', status: 'completed',
        createdAt: '2026-01-01T00:00:00.000Z', contextKind: 'host-control',
        content: 'private host control'
      }
    ]
    expect(delegatedHistoryDigest(withPrivateSource)).toBe(
      delegatedHistoryDigest(publicItems)
    )
    expect(priorItemsForDelegatedTurn(withPrivateSource, 'turn_2')).toEqual(publicItems)
  })

  test('rebases a native session when this turn introduces goal context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-delegated-goal-rebase-'))
    const coordinator = new DelegatedSessionCoordinator(
      new FileDelegatedSessionBindingStore(root)
    )
    const committed = [user('turn_1', 'previous native context')]
    const prepared = await coordinator.prepare({
      threadId: 'thread_1',
      route: route(),
      priorItems: []
    })
    await coordinator.commit({
      preparation: prepared,
      committedItems: committed,
      lastCommittedTurnId: 'turn_1',
      nativeSessionId: 'agent_1'
    })
    const currentUser = user('turn_2', 'continue the goal')
    const currentGoal: TurnItem = {
      id: 'item_turn_2_goal_context',
      threadId: 'thread_1',
      turnId: 'turn_2',
      role: 'system',
      status: 'completed',
      createdAt: '2026-08-06T00:00:00.000Z',
      kind: 'goal_context',
      goalKey: 'goal_current',
      text: 'Continue working toward the active thread goal.'
    }
    const priorItems = priorItemsForDelegatedTurn(
      [...committed, currentUser, currentGoal],
      'turn_2'
    )

    expect(priorItems).toEqual([...committed, currentGoal])
    await expect(coordinator.prepare({
      threadId: 'thread_1',
      route: route(),
      priorItems
    })).resolves.toMatchObject({ resumed: false, rebaseReason: 'history_changed' })
  })

  test('resumes a native session on later turns of the same goal generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-delegated-goal-resume-'))
    const coordinator = new DelegatedSessionCoordinator(
      new FileDelegatedSessionBindingStore(root)
    )
    const initialGoal: TurnItem = {
      id: 'item_turn_1_goal_context',
      threadId: 'thread_1',
      turnId: 'turn_1',
      role: 'system',
      status: 'completed',
      createdAt: '2026-08-06T00:00:00.000Z',
      kind: 'goal_context',
      goalKey: 'goal_current',
      text: 'Continue working toward the active thread goal.'
    }
    const committed = [user('turn_1', 'start the goal'), initialGoal]
    const first = await coordinator.prepare({
      threadId: 'thread_1',
      route: route(),
      priorItems: []
    })
    await coordinator.commit({
      preparation: first,
      committedItems: committed,
      lastCommittedTurnId: 'turn_1',
      nativeSessionId: 'agent_1'
    })

    const laterItems = [...committed, user('turn_2', 'continue the same goal')]
    const priorItems = priorItemsForDelegatedTurn(laterItems, 'turn_2')

    expect(priorItems).toEqual(committed)
    await expect(coordinator.prepare({
      threadId: 'thread_1',
      route: route(),
      priorItems
    })).resolves.toMatchObject({
      resumed: true,
      nativeSessionId: 'agent_1'
    })
  })

  test('checkpoints the request goal projection so a goal replacement rebases only once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-delegated-goal-generation-'))
    const coordinator = new DelegatedSessionCoordinator(
      new FileDelegatedSessionBindingStore(root)
    )
    const oldGoal: TurnItem = {
      id: 'item_goal_old',
      threadId: 'thread_1',
      turnId: 'turn_old',
      role: 'system',
      status: 'completed',
      createdAt: '2026-08-06T00:00:00.000Z',
      kind: 'goal_context',
      goalKey: 'goal_old',
      text: 'Finished old goal.'
    }
    const currentGoal: TurnItem = {
      ...oldGoal,
      id: 'item_goal_current',
      turnId: 'turn_current',
      goalKey: 'goal_current',
      text: 'Continue the replacement goal.'
    }
    const rawCommittedItems = [
      user('turn_old', 'start'),
      oldGoal,
      user('turn_current', 'continue'),
      currentGoal
    ]
    const preparation = await coordinator.prepare({
      threadId: 'thread_1',
      route: route(),
      priorItems: []
    })

    // The provider only received the current generation. Checkpointing the
    // raw stream would retain goal_old and make every later native prepare
    // look like a history mismatch.
    const requestProjection = filterGoalContextsForGoalKey(rawCommittedItems, 'goal_current')
    await coordinator.commit({
      preparation,
      committedItems: requestProjection,
      lastCommittedTurnId: 'turn_current',
      nativeSessionId: 'agent_current'
    })

    await expect(coordinator.prepare({
      threadId: 'thread_1',
      route: route(),
      priorItems: requestProjection
    })).resolves.toMatchObject({
      resumed: true,
      nativeSessionId: 'agent_current'
    })
  })

  test('does not advance a binding until commit and serializes one thread', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-delegated-'))
    const coordinator = new DelegatedSessionCoordinator(
      new FileDelegatedSessionBindingStore(root)
    )
    const order: string[] = []
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const first = coordinator.runExclusive('thread_1', async () => {
      order.push('first-start')
      await blocked
      order.push('first-end')
    })
    const second = coordinator.runExclusive('thread_1', async () => {
      order.push('second')
    })
    await vi.waitFor(() => expect(order).toEqual(['first-start']))
    release()
    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second'])
    expect(await coordinator.store.load('thread_1')).toBeNull()
  })

  test('clears stale provider checkpoints when rebasing or rejecting resume', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-delegated-'))
    const store = new FileDelegatedSessionBindingStore(root)
    const coordinator = new DelegatedSessionCoordinator(store)
    const prepared = await coordinator.prepare({
      threadId: 'thread_1',
      route: route(),
      priorItems: []
    })
    await coordinator.commit({
      preparation: prepared,
      committedItems: [user('turn_1', 'first')],
      lastCommittedTurnId: 'turn_1',
      nativeSessionId: 'agent_1'
    })
    const stateDir = store.providerStateDir('cursor-sdk', 'thread_1', delegatedRouteKey(route()))
    await mkdir(stateDir, { recursive: true })
    const checkpoint = join(stateDir, 'checkpoint')
    await writeFile(checkpoint, 'stale')

    const resumed = await coordinator.prepare({
      threadId: 'thread_1',
      route: route(),
      priorItems: [user('turn_1', 'first')]
    })
    expect(resumed.resumed).toBe(true)
    const rejected = await coordinator.rejectResume(resumed)
    expect(rejected).toMatchObject({
      generation: 2,
      resumed: false,
      rebaseReason: 'native_state_unavailable'
    })
    await expect(access(checkpoint)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('parks the displaced provider state on a provider switch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-delegated-'))
    const store = new FileDelegatedSessionBindingStore(root)
    const coordinator = new DelegatedSessionCoordinator(store)
    const routeA = route({ providerKind: 'agent-sdk' })
    const prepared = await coordinator.prepare({
      threadId: 'thread_1',
      route: routeA,
      priorItems: []
    })
    await coordinator.commit({
      preparation: prepared,
      committedItems: [user('turn_1', 'first')],
      lastCommittedTurnId: 'turn_1',
      nativeSessionId: 'session_1'
    })
    const parkedDir = store.providerStateDir('agent-sdk', 'thread_1', delegatedRouteKey(routeA))
    const parkedCheckpoint = join(parkedDir, 'checkpoint')
    await mkdir(parkedDir, { recursive: true })
    await writeFile(parkedCheckpoint, 'old')

    const next = await coordinator.prepare({
      threadId: 'thread_1',
      route: route({ providerKind: 'cursor-sdk' }),
      priorItems: [user('turn_1', 'first')]
    })

    // The displaced agent-sdk session is parked with its provider state intact
    // so a later A -> B -> A switch can resume it natively.
    expect(next).toMatchObject({ resumed: false, rebaseReason: 'route_changed' })
    await expect(access(parkedCheckpoint)).resolves.toBeUndefined()
    expect((await store.load('thread_1'))?.parked).toMatchObject([
      { providerKind: 'agent-sdk', nativeSessionId: 'session_1' }
    ])
  })

  test('removes malformed records and writes complete atomic JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-delegated-'))
    const store = new FileDelegatedSessionBindingStore(root)
    const coordinator = new DelegatedSessionCoordinator(store)
    const prepared = await coordinator.prepare({
      threadId: 'thread_1',
      route: route(),
      priorItems: []
    })
    const saved = await coordinator.commit({
      preparation: prepared,
      committedItems: [user('turn_1', 'one')],
      lastCommittedTurnId: 'turn_1',
      nativeSessionId: 'agent_1'
    })
    const bindingDir = join(root, 'bindings')
    const files = (await import('node:fs/promises')).readdir(bindingDir)
    const [name] = await files
    expect(name).toMatch(/\.json$/)
    expect(JSON.parse(await readFile(join(bindingDir, name!), 'utf8'))).toEqual(saved)
    await writeFile(join(bindingDir, name!), '{broken', 'utf8')
    await expect(store.load('thread_1')).resolves.toBeNull()
  })

  test('history digest ignores timestamps but changes after compaction or content changes', () => {
    const original = user('turn_1', 'same')
    expect(delegatedHistoryDigest([original])).toBe(delegatedHistoryDigest([
      { ...original, createdAt: '2027-01-01T00:00:00.000Z' }
    ]))
    expect(delegatedHistoryDigest([original])).not.toBe(delegatedHistoryDigest([
      { ...original, text: 'different' }
    ]))
    const compacted: TurnItem = {
      id: 'compact_1',
      threadId: 'thread_1',
      turnId: 'turn_2',
      role: 'system',
      status: 'completed',
      createdAt: '2026-01-01T00:01:00.000Z',
      kind: 'compaction',
      summary: 'new portable baseline',
      replacedTokens: 100,
      pinnedConstraints: []
    }
    expect(delegatedHistoryDigest([original])).not.toBe(
      delegatedHistoryDigest([original, compacted])
    )
  })

  test('credential identity rotates on secret changes without persisting the secret', () => {
    const first = delegatedCredentialIdentity({
      providerId: 'cursor-subscription',
      credentialSecret: 'cursor-secret-one'
    })
    const second = delegatedCredentialIdentity({
      providerId: 'cursor-subscription',
      credentialSecret: 'cursor-secret-two'
    })
    expect(first).not.toBe(second)
    expect(first).not.toContain('cursor-secret-one')
    expect(first).toMatch(/^scrypt-v1:[a-f0-9]{64}$/u)
  })

  test('keeps an aligned portable generation without claiming native resume failed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-delegated-'))
    const coordinator = new DelegatedSessionCoordinator(
      new FileDelegatedSessionBindingStore(root)
    )
    const portableRoute = route({
      providerKind: 'antigravity-cli',
      continuationMode: 'portable'
    })
    const prepared = await coordinator.prepare({
      threadId: 'thread_1',
      route: portableRoute,
      priorItems: []
    })
    const committedItems = [user('turn_1', 'portable')]
    await coordinator.commit({
      preparation: prepared,
      committedItems,
      lastCommittedTurnId: 'turn_1'
    })
    await expect(coordinator.prepare({
      threadId: 'thread_1',
      route: portableRoute,
      priorItems: committedItems
    })).resolves.toMatchObject({
      generation: 1,
      resumed: false
    })
    expect((await coordinator.prepare({
      threadId: 'thread_1',
      route: portableRoute,
      priorItems: committedItems
    })).rebaseReason).toBeUndefined()
  })

  test('keeps fork ids unbound and deletes one thread binding plus provider state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-delegated-'))
    const store = new FileDelegatedSessionBindingStore(root)
    const coordinator = new DelegatedSessionCoordinator(store)
    const prepared = await coordinator.prepare({
      threadId: 'thread_source',
      route: route(),
      priorItems: []
    })
    await coordinator.commit({
      preparation: prepared,
      committedItems: [],
      lastCommittedTurnId: 'turn_1',
      nativeSessionId: 'agent_1'
    })
    const stateDir = store.providerStateDir('cursor-sdk', 'thread_source', delegatedRouteKey(route()))
    await mkdir(stateDir, { recursive: true })
    await writeFile(join(stateDir, 'checkpoint'), 'opaque')

    expect(await store.load('thread_fork')).toBeNull()
    await coordinator.invalidate('thread_source')
    expect(await store.load('thread_source')).toBeNull()
    await expect(access(stateDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})


test('resumes compatible native capability upgrades while retaining account and history boundaries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-native-upgrade-'))
  const coordinator = new DelegatedSessionCoordinator(new FileDelegatedSessionBindingStore(root))
  const original = route({ providerKind: 'codex-app-server', capabilityFingerprint: delegatedCapabilityFingerprint('old-version') })
  const prior = [user('turn_1', 'remember this')]
  const prepared = await coordinator.prepare({ threadId: 'thread_1', route: original, priorItems: [] })
  await coordinator.commit({ preparation: prepared, committedItems: prior, lastCommittedTurnId: 'turn_1', nativeSessionId: 'codex-native-1' })
  const updated = { ...original, capabilityFingerprint: delegatedCapabilityFingerprint('stable-v2') }
  await expect(coordinator.prepare({ threadId: 'thread_1', route: updated, priorItems: prior, allowNativeCapabilityResume: true }))
    .resolves.toMatchObject({ resumed: true, nativeSessionId: 'codex-native-1' })
  await expect(coordinator.prepare({ threadId: 'thread_1', route: { ...updated, credentialIdentity: 'different-account' }, priorItems: prior, allowNativeCapabilityResume: true }))
    .resolves.toMatchObject({ resumed: false, rebaseReason: 'route_changed' })
  await expect(coordinator.prepare({ threadId: 'thread_1', route: updated, priorItems: [user('turn_1', 'edited')], allowNativeCapabilityResume: true }))
    .resolves.toMatchObject({ resumed: false, rebaseReason: 'history_changed' })
})
