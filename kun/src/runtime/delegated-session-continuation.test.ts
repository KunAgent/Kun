import { sessionInstructions } from '../session/session-instructions.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import { makeAssistantTextItem, makeUserInputItem, makeUserItem } from '../domain/item.js'
import { DelegatedSessionCoordinator, FileDelegatedSessionBindingStore, delegatedCapabilityFingerprint,
  priorItemsForDelegatedTurn, type DelegatedProviderKind } from './delegated-session-binding.js'
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

const nativeRoute = { providerKind: 'acp' as const, providerId: 'devin', workspace: '/fixture', model: 'swe-2-high',
  credentialIdentity: 'account', capabilityFingerprint: delegatedCapabilityFingerprint({ version: 'one' }),
  continuationMode: 'native' as const }

it('resumes the same native session when the next message was queued while the turn ran', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-continuation-queued-'))
  try {
    const coordinator = new DelegatedSessionCoordinator(new FileDelegatedSessionBindingStore(root))
    const first = await coordinator.prepare({ threadId: 'thread', route: nativeRoute, priorItems: [] })
    // Raw store order: the queued second message lands before the first reply.
    const items = [
      makeUserItem({ id: 'user-1', threadId: 'thread', turnId: 'turn-1', text: 'Revert that commit' }),
      makeUserItem({ id: 'user-2', threadId: 'thread', turnId: 'turn-2', text: 'Also clean the docs' }),
      makeAssistantTextItem({ id: 'reply-1', threadId: 'thread', turnId: 'turn-1', text: 'Reverted', status: 'completed' })
    ]
    await coordinator.commit({ preparation: first, committedItems: items, lastCommittedTurnId: 'turn-1', nativeSessionId: 'leaf-season' })
    const second = await coordinator.prepare({ threadId: 'thread', route: nativeRoute, priorItems: priorItemsForDelegatedTurn(items, 'turn-2') })
    expect(second).toMatchObject({ resumed: true, nativeSessionId: 'leaf-season' })
    expect(second.rebaseReason).toBeUndefined()
    expect(buildTurnHandoff({ preparation: second, currentTurnId: 'turn-2', items })).toBeNull()
    expect(priorItemsForDelegatedTurn(items, 'turn-1')).toEqual([])
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('resumes after an aborted turn rewrites item status, but rebases when the user edits history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-continuation-abort-'))
  try {
    const coordinator = new DelegatedSessionCoordinator(new FileDelegatedSessionBindingStore(root))
    const first = await coordinator.prepare({ threadId: 'thread', route: nativeRoute, priorItems: [] })
    const user = makeUserItem({ id: 'user-1', threadId: 'thread', turnId: 'turn-1', text: 'Clean up' })
    const question = makeUserInputItem({ id: 'question-1', threadId: 'thread', turnId: 'turn-1', inputId: 'input-1',
      prompt: 'Delete local files too?', questions: [] } as Parameters<typeof makeUserInputItem>[0])
    await coordinator.commit({ preparation: first, committedItems: [user, question], lastCommittedTurnId: 'turn-1', nativeSessionId: 'leaf-season' })
    // The abort settles after commit and cancels the pending question.
    const afterAbort = [user, { ...question, status: 'cancelled' } as TurnItem]
    expect(await coordinator.prepare({ threadId: 'thread', route: nativeRoute, priorItems: afterAbort }))
      .toMatchObject({ resumed: true, nativeSessionId: 'leaf-season' })
    const edited = [{ ...user, text: 'Clean up everything' } as TurnItem, question]
    expect(await coordinator.prepare({ threadId: 'thread', route: nativeRoute, priorItems: edited }))
      .toMatchObject({ resumed: false, rebaseReason: 'history_changed' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('labels a same-Agent session restart with the Agent name on both sides', () => {
  const handoff = buildTurnHandoff({ currentTurnId: 'turn-2', harnessName: 'Devin', items: [
    makeUserItem({ id: 'user-1', threadId: 'thread', turnId: 'turn-1', text: 'Revert that commit' })
  ], preparation: { threadId: 'thread', generation: 2, resumed: false, priorHistoryDigest: 'digest', route: nativeRoute,
    rebaseReason: 'native_state_unavailable', rebasedFrom: { providerKind: 'acp', providerId: 'devin', model: 'swe-2-high' } } })
  expect(handoff?.event).toMatchObject({ reason: 'rebase', from: { harnessName: 'Devin' }, to: { harnessName: 'Devin' } })
})
