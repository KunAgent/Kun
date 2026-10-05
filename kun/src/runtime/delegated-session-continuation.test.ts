import { sessionInstructions } from '../session/session-instructions.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { makeAssistantTextItem, makeUserItem } from '../domain/item.js'
import { DelegatedSessionCoordinator, FileDelegatedSessionBindingStore, delegatedCapabilityFingerprint,
  type DelegatedProviderKind } from './delegated-session-binding.js'
import { buildTurnHandoff, recordHandoffInjected } from '../handoff/turn-handoff.js'

it.each<DelegatedProviderKind>(['codex-app-server', 'pi-rpc', 'acp', 'agent-sdk', 'cursor-sdk', 'antigravity-cli'])(
  'persists and resumes %s across consecutive turns and a coordinator restart', async (providerKind) => {
    const root = await mkdtemp(join(tmpdir(), 'kun-continuation-'))
    try {
      const store = new FileDelegatedSessionBindingStore(root)
      const coordinator = new DelegatedSessionCoordinator(store)
      const route = { providerKind, providerId: 'test-agent', workspace: '/fixture', model: 'native-model',
        credentialIdentity: 'test-account', capabilityFingerprint: delegatedCapabilityFingerprint({ version: 'one' }),
        continuationMode: 'native' as const }
      const preparation = await coordinator.prepare({ threadId: 'thread', route, priorItems: [] })
      expect(sessionInstructions(preparation, ['Host policy'])).toEqual(['Host policy'])
      const firstUser = makeUserItem({ id: 'user-1', threadId: 'thread', turnId: 'turn-1', text: 'Remember blue' })
      expect(buildTurnHandoff({ preparation, currentTurnId: 'turn-1', items: [firstUser] })).toBeNull()
      const items = [firstUser, makeAssistantTextItem({ id: 'reply-1', threadId: 'thread', turnId: 'turn-1', text: 'Remembered', status: 'completed' })]
      await coordinator.commit({ preparation, committedItems: items, lastCommittedTurnId: 'turn-1', nativeSessionId: 'native-thread' })
      expect(await store.load('thread')).toMatchObject({ providerKind, nativeSessionId: 'native-thread' })
      const restored = new DelegatedSessionCoordinator(new FileDelegatedSessionBindingStore(root))
      const second = await restored.prepare({ threadId: 'thread', route, priorItems: items })
      expect(second).toMatchObject({ resumed: true, generation: 1, nativeSessionId: 'native-thread' })
      expect(sessionInstructions(second, ['Host policy'])).toEqual([])
      expect(sessionInstructions(second, ['Updated policy']).join('\n')).toContain('Updated policy')
      expect(sessionInstructions(second, []).join('\n')).toContain('No additional Kun instructions')
      expect(buildTurnHandoff({ preparation: second, currentTurnId: 'turn-2', items })).toBeNull()
    } finally { await rm(root, { recursive: true, force: true }) }
  })

it('keeps portable same-Agent history replay in the background', async () => {
  const handoff = buildTurnHandoff({ currentTurnId: 'second', items: [
    makeUserItem({ id: 'first-input', threadId: 'thread', turnId: 'first', text: 'Remember blue' })
  ], preparation: { threadId: 'thread', generation: 1, resumed: false, priorHistoryDigest: 'digest',
    route: { providerKind: 'acp', providerId: 'deepseek-harness', workspace: '/fixture', model: 'default',
      credentialIdentity: 'account', capabilityFingerprint: 'fingerprint', continuationMode: 'portable' } } })
  expect(handoff?.brief.text).toContain('Remember blue')
  expect(handoff?.background).toBe(true)
  const events: unknown[] = []
  await recordHandoffInjected((event) => { events.push(event) }, { threadId: 'thread', turnId: 'second', harnessId: 'deepseek-harness' }, handoff!)
  expect(events).toEqual([])
})
