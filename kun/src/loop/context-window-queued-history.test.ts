import { describe, expect, it, vi } from 'vitest'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { makeToolCallItem, makeToolResultItem, makeUserItem } from '../domain/item.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord, startTurn } from '../domain/turn.js'
import type { ContextWindowMode } from '../contracts/context-windows.js'
import type { Turn } from '../contracts/turns.js'
import { ContextWindowBudget } from './context-window-budget.js'
import { ContextWindowStrategyCoordinator, type ContextWindowStrategyDeps } from './context-window-strategy.js'
import { executableHistory } from './executable-history.js'

const threadId = 'thread'
const turnId = 'active'

async function fixture(mode: ContextWindowMode) {
  const sessionStore = new InMemorySessionStore()
  const threadStore = new InMemoryThreadStore()
  const hidden: Turn[] = [
    createTurnRecord({ id: 'queued', threadId, prompt: 'Queued', status: 'queued' }),
    { ...createTurnRecord({ id: 'pending', threadId, prompt: 'Pending', status: 'queued' }), admissionPending: true },
    { ...createTurnRecord({ id: 'steered', threadId, prompt: 'Steered', status: 'aborted' }), steeredToTurnId: turnId },
    { ...createTurnRecord({ id: 'cancelled', threadId, prompt: 'Cancelled', status: 'aborted' }), terminalCode: 'queue_cancelled' },
    { ...createTurnRecord({ id: 'rejected', threadId, prompt: 'Rejected', status: 'failed' }), terminalCode: 'queue_admission_failed' }
  ]
  await threadStore.upsert({
    ...createThreadRecord({ id: threadId, title: 'Test', workspace: '/tmp', model: 'test' }),
    turns: [startTurn(createTurnRecord({ id: turnId, threadId, prompt: 'Active' })), ...hidden]
  })
  const activeUser = makeUserItem({ id: 'active-user', threadId, turnId, text: 'Active' })
  const pendingUsers = hidden.map((turn) => makeUserItem({
    id: `${turn.id}-user`, threadId, turnId: turn.id, text: `DO_NOT_EXECUTE_${turn.id}`
  }))
  const call = makeToolCallItem({ id: 'call', threadId, turnId, callId: 'read', toolName: 'read', arguments: {}, status: 'completed' })
  const result = makeToolResultItem({ id: 'result', threadId, turnId, callId: 'read', toolName: 'read', output: 'Read result' })
  for (const item of [activeUser, ...pendingUsers, call, result]) await sessionStore.appendItem(threadId, item)
  const canonical = await sessionStore.loadItems(threadId)
  const input = {
    items: executableHistory(canonical, await threadStore.get(threadId)),
    threadId, turnId, model: 'test', signal: new AbortController().signal,
    requestInputTokens: 1_000, outputBudgetTokens: 1_000
  }
  const summary = { compactIfNeeded: vi.fn() } as unknown as ContextWindowStrategyDeps['summary']
  const deps: ContextWindowStrategyDeps = {
    summary, sessionStore, threadStore, mode: () => mode, capacityTokens: () => 100_000,
    budget: new ContextWindowBudget({ nowIso: () => new Date().toISOString() })
  }
  return { sessionStore, threadStore, canonical, input, deps,
    strategy: new ContextWindowStrategyCoordinator(deps) }
}

describe('context window queued-history projection', () => {
  for (const mode of ['windows', 'model_compact'] as const) {
    it.each([
      ['normal request', {}],
      ['soft budget notice', { requestInputTokens: 60_000 }],
      ['unrecoverable overhead', { requestOverheadTokens: 90_000 }]
    ])(`excludes unexecuted history from %s in ${mode} mode`, async (_name, overrides) => {
      const f = await fixture(mode)
      const outcome = await f.strategy.compactIfNeeded({ ...f.input, ...overrides })
      expect(JSON.stringify(outcome.history)).not.toContain('DO_NOT_EXECUTE_')
      expect(outcome.history.map((item) => item.id)).toEqual(['active-user', 'call', 'result'])
      expect(await f.sessionStore.loadItems(threadId)).toEqual(f.canonical)
    })
  }

  it('keeps the queue hidden when a hard-pressure transition is deferred', async () => {
    const f = await fixture('windows')
    const outcome = await f.strategy.compactIfNeeded({ ...f.input, force: { reason: 'overflow' } })
    expect(outcome.notice).toContain('transition deferred')
    expect(JSON.stringify(outcome.history)).not.toContain('DO_NOT_EXECUTE_')
  })

  it('reprojects the fresh post-transition snapshot, including concurrent queue admission', async () => {
    const f = await fixture('windows')
    f.deps.transition = {
      transition: vi.fn(async () => {
        const thread = (await f.threadStore.get(threadId))!
        await f.threadStore.upsert({ ...thread, turns: [...thread.turns,
          createTurnRecord({ id: 'late', threadId, prompt: 'Late', status: 'queued' })] })
        await f.sessionStore.appendItem(threadId, makeUserItem({
          id: 'late-user', threadId, turnId: 'late', text: 'DO_NOT_EXECUTE_late'
        }))
        return { status: 'committed', windowId: 'window-1', windowSeq: 1, itemId: 'boundary' }
      })
    } as unknown as ContextWindowStrategyDeps['transition']
    const strategy = new ContextWindowStrategyCoordinator(f.deps)
    const outcome = await strategy.compactIfNeeded({ ...f.input, force: { reason: 'overflow' } })
    expect(outcome.windowTransition?.windowId).toBe('window-1')
    expect(JSON.stringify(outcome.history)).not.toContain('DO_NOT_EXECUTE_')
    expect(await f.sessionStore.loadItems(threadId)).toContainEqual(expect.objectContaining({ id: 'late-user' }))
  })

  it('fails closed if the thread disappears while refreshing canonical history', async () => {
    const f = await fixture('windows')
    await f.threadStore.delete(threadId)
    await expect(f.strategy.compactIfNeeded(f.input)).rejects.toThrow('thread not found')
  })
})
