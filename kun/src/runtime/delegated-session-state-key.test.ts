import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { makeUserItem } from '../domain/item.js'
import { DelegatedSessionCoordinator, FileDelegatedSessionBindingStore,
  delegatedRouteKey, delegatedProviderStateKey, delegatedCapabilityFingerprint,
  type DelegatedSessionRoute } from './delegated-session-binding.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true }))) })
const user = (turnId: string) => makeUserItem({ id: turnId, turnId, threadId: 'thread', text: turnId })
const route = (providerKind: 'agent-sdk' | 'cursor-sdk'): DelegatedSessionRoute => ({
  providerKind, providerId: providerKind, credentialIdentity: 'same-account', workspace: '/work',
  model: 'a', capabilityFingerprint: delegatedCapabilityFingerprint({ protocol: providerKind }), continuationMode: 'native'
})

test.each(['agent-sdk', 'cursor-sdk'] as const)('retains %s state across scope upgrade, restart and parked restore without moving directories', async (kind) => {
  const root = await mkdtemp(join(tmpdir(), 'kun-session-state-')); roots.push(root)
  const store = new FileDelegatedSessionBindingStore(root)
  const coordinator = new DelegatedSessionCoordinator(store)
  const original = route(kind)
  const oldKey = delegatedRouteKey(original)
  const oldDir = store.providerStateDir(kind, 'thread', oldKey)
  await mkdir(oldDir, { recursive: true })
  await writeFile(join(oldDir, 'transcript'), 'original')
  const first = await coordinator.prepare({ threadId: 'thread', route: original, priorItems: [] })
  await coordinator.commit({ preparation: first, committedItems: [user('one')], lastCommittedTurnId: 'one', nativeSessionId: 'session-a' })
  const nextRoute: DelegatedSessionRoute = { ...original, model: 'b', modelScope: 'session' }
  const newDir = store.providerStateDir(kind, 'thread', delegatedRouteKey(nextRoute))
  await mkdir(newDir, { recursive: true })
  await writeFile(join(newDir, 'transcript'), 'unrelated')
  const next = await coordinator.prepare({ threadId: 'thread', route: nextRoute, priorItems: [user('one')] })
  expect(next).toMatchObject({ resumed: true, nativeSessionId: 'session-a', route: { providerStateKey: oldKey } })
  expect(delegatedProviderStateKey(next.route)).toBe(oldKey)
  expect(nextRoute).not.toHaveProperty('providerStateKey')
  await coordinator.commit({ preparation: next, committedItems: [user('one'), user('two')], lastCommittedTurnId: 'two', nativeSessionId: 'session-a' })
  const restarted = new DelegatedSessionCoordinator(new FileDelegatedSessionBindingStore(root))
  const third = await restarted.prepare({ threadId: 'thread', route: { ...nextRoute, model: 'c' }, priorItems: [user('one'), user('two')] })
  expect(third).toMatchObject({ resumed: true, route: { providerStateKey: oldKey } })
  const other = await restarted.prepare({ threadId: 'thread', route: { ...nextRoute, providerId: 'other' }, priorItems: [user('one'), user('two')] })
  await restarted.commit({ preparation: other, committedItems: [user('one'), user('two'), user('three')], lastCommittedTurnId: 'three', nativeSessionId: 'other-session' })
  const back = await restarted.prepare({ threadId: 'thread', route: nextRoute, priorItems: [user('one'), user('two'), user('three')] })
  expect(back).toMatchObject({ resumed: true, nativeSessionId: 'session-a', route: { providerStateKey: oldKey } })
  expect(await readFile(join(oldDir, 'transcript'), 'utf8')).toBe('original')
  expect(await readFile(join(newDir, 'transcript'), 'utf8')).toBe('unrelated')
  await restarted.rejectResume(back)
  await expect(access(join(oldDir, 'transcript'))).rejects.toThrow()
  expect(await readFile(join(newDir, 'transcript'), 'utf8')).toBe('unrelated')
})

test('rejects a path-like physical state key before touching a directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-session-invalid-key-')); roots.push(root)
  const store = new FileDelegatedSessionBindingStore(root)
  expect(() => store.providerStateDir('agent-sdk', 'thread', '../outside')).toThrow('invalid provider state key')
  const coordinator = new DelegatedSessionCoordinator(store)
  const prep = await coordinator.prepare({ threadId: 'thread', route: route('agent-sdk'), priorItems: [] })
  const binding = await coordinator.commit({ preparation: prep, committedItems: [user('one')], lastCommittedTurnId: 'one', nativeSessionId: 'session-a' })
  await expect(store.save({ ...binding, providerStateKey: '../outside' })).rejects.toThrow('invalid delegated session binding')
})
