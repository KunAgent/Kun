import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import { needsHandoff } from '../handoff/handoff-plan.js'
import {
  DelegatedSessionCoordinator,
  FileDelegatedSessionBindingStore,
  delegatedCapabilityFingerprint,
  delegatedCredentialIdentity,
  delegatedRouteKey,
  type DelegatedSessionRoute
} from './delegated-session-binding.js'

function user(turnId: string, text: string): Extract<TurnItem, { kind: 'user_message' }> {
  return { id: `item_${turnId}`, threadId: 'thread_1', turnId, role: 'user', kind: 'user_message', status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z', text }
}

function codexRoute(overrides: Partial<DelegatedSessionRoute> = {}): DelegatedSessionRoute {
  return {
    providerKind: 'codex-app-server', providerId: 'codex',
    credentialIdentity: delegatedCredentialIdentity({ providerId: 'native-login:codex' }),
    workspace: '/work/project', model: 'deepseek-flash', modelScope: 'session',
    capabilityFingerprint: delegatedCapabilityFingerprint({ protocol: 'codex-app-server', version: 'v2' }),
    continuationMode: 'native', ...overrides
  }
}

async function committed(route: DelegatedSessionRoute) {
  const coordinator = new DelegatedSessionCoordinator(new FileDelegatedSessionBindingStore(await mkdtemp(join(tmpdir(), 'kun-model-scope-'))))
  const items = [user('turn_1', 'first question'), user('turn_2', 'second question')]
  const prepared = await coordinator.prepare({ threadId: 'thread_1', route, priorItems: [] })
  await coordinator.commit({ preparation: prepared, committedItems: items, lastCommittedTurnId: 'turn_2', nativeSessionId: 'codex_thread_1' })
  return { coordinator, items }
}

describe('model changes within one Agent session', () => {
  test('continue the native session instead of rebasing with a handoff brief', async () => {
    const { coordinator, items } = await committed(codexRoute())
    const next = await coordinator.prepare({ threadId: 'thread_1', route: codexRoute({ model: 'auto_tmkz6q781c' }), priorItems: items })
    expect(next).toMatchObject({ resumed: true, nativeSessionId: 'codex_thread_1', generation: 1 })
    expect(next.rebaseReason).toBeUndefined()
    expect(next.rebasedFrom).toBeUndefined()
    // A resumed session without a parked delta carries no handoff at all.
    expect(needsHandoff(next, items)).toBeNull()
  })

  test('record the new model on commit and keep the one session across later switches', async () => {
    const { coordinator, items } = await committed(codexRoute())
    const second = await coordinator.prepare({ threadId: 'thread_1', route: codexRoute({ model: 'model-b' }), priorItems: items })
    const more = [...items, user('turn_3', 'third question')]
    const binding = await coordinator.commit({ preparation: second, committedItems: more, lastCommittedTurnId: 'turn_3', nativeSessionId: 'codex_thread_1' })
    expect(binding).toMatchObject({ model: 'model-b', modelScope: 'session', nativeSessionId: 'codex_thread_1', generation: 1 })
    expect(binding.parked ?? []).toEqual([])
    const third = await coordinator.prepare({ threadId: 'thread_1', route: codexRoute({ model: 'model-a' }), priorItems: more })
    expect(third).toMatchObject({ resumed: true, nativeSessionId: 'codex_thread_1', generation: 1 })
  })

  test('also resume a binding stored before the model scope existed', async () => {
    const legacy = codexRoute({ modelScope: undefined })
    const { coordinator, items } = await committed(legacy)
    const next = await coordinator.prepare({ threadId: 'thread_1', route: codexRoute({ model: 'model-b' }), priorItems: items })
    expect(next).toMatchObject({ resumed: true, nativeSessionId: 'codex_thread_1' })
  })

  test('still rebase when anything else about the session changes', async () => {
    const { coordinator, items } = await committed(codexRoute())
    for (const [name, change, reason] of [
      ['workspace', { workspace: '/work/other' }, 'route_changed'],
      ['account', { credentialIdentity: delegatedCredentialIdentity({ providerId: 'native-login:codex', accountId: 'b' }) }, 'route_changed'],
      ['gateway route', { credentialIdentity: delegatedCredentialIdentity({ providerId: 'kun-gateway:codex:deepseek:deepseek-flash' }) }, 'route_changed'],
      ['capabilities', { capabilityFingerprint: delegatedCapabilityFingerprint('changed') }, 'capabilities_changed']
    ] as const) {
      const next = await coordinator.prepare({ threadId: 'thread_1', route: codexRoute({ model: 'model-b', ...change }), priorItems: items })
      expect(next.resumed, name).toBe(false)
      expect(next.rebaseReason, name).toBe(reason)
    }
  })

  test('start fresh when going back to the Agent default, which a live session cannot be given', async () => {
    const { coordinator, items } = await committed(codexRoute({ model: 'model-b' }))
    const next = await coordinator.prepare({ threadId: 'thread_1', route: codexRoute({ model: 'default' }), priorItems: items })
    expect(next).toMatchObject({ resumed: false, rebaseReason: 'route_changed', rebasedFrom: { model: 'model-b' } })
    // Going back to an explicit model continues the session that ran on the default, which has the newest turns.
    const defaultItems = [...items, user('turn_3', 'asked on the default model')]
    await coordinator.commit({ preparation: next, committedItems: defaultItems, lastCommittedTurnId: 'turn_3', nativeSessionId: 'codex_thread_2' })
    const back = await coordinator.prepare({ threadId: 'thread_1', route: codexRoute({ model: 'model-c' }), priorItems: defaultItems })
    expect(back).toMatchObject({ resumed: true, nativeSessionId: 'codex_thread_2' })
    // From the default to an explicit model is a plain model change.
    const fresh = await committed(codexRoute({ model: 'default' }))
    expect(await fresh.coordinator.prepare({ threadId: 'thread_1', route: codexRoute({ model: 'model-b' }), priorItems: fresh.items }))
      .toMatchObject({ resumed: true, nativeSessionId: 'codex_thread_1' })
  })

  test('pinned routes (Claude, Cursor, Antigravity) keep treating a model change as a new session', async () => {
    const pinned = codexRoute({ providerKind: 'cursor-sdk', providerId: 'cursor', modelScope: undefined })
    const { coordinator, items } = await committed(pinned)
    const next = await coordinator.prepare({ threadId: 'thread_1', route: { ...pinned, model: 'model-b' }, priorItems: items })
    expect(next).toMatchObject({ resumed: false, rebaseReason: 'route_changed', rebasedFrom: { model: 'deepseek-flash' } })
  })

  test('the route key ignores the model only for session-scoped routes', () => {
    const base = codexRoute()
    expect(delegatedRouteKey({ ...base, model: 'a' })).toBe(delegatedRouteKey({ ...base, model: 'b' }))
    expect(delegatedRouteKey({ ...base, model: 'default' })).not.toBe(delegatedRouteKey({ ...base, model: 'a' }))
    expect(delegatedRouteKey({ ...base, workspace: '/work/other' })).not.toBe(delegatedRouteKey(base))
    const pinned = { ...base, modelScope: undefined }
    expect(delegatedRouteKey({ ...pinned, model: 'a' })).not.toBe(delegatedRouteKey({ ...pinned, model: 'b' }))
    expect(delegatedRouteKey(pinned)).not.toBe(delegatedRouteKey(base))
  })
})
