import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadStore } from '../ports/thread-store.js'
import type { TurnService } from '../services/turn-service.js'
import { DetachedChildHandoffCoordinator } from './delegation-detached-handoff.js'
import { ChildRunRecord } from './delegation-runtime-contracts.js'
import { DetachedChildHandoffStore } from './detached-child-handoff-store.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('detached child handoff', () => {
  it('replays a durable obligation after coordinator restart', async () => {
    const fixture = await createFixture()
    await fixture.first.prepare(childRecord())
    expect(await fixture.store.list()).toHaveLength(1)

    await expect(fixture.second.replayPending()).resolves.toBe(1)

    expect(fixture.startTurn).toHaveBeenCalledOnce()
    expect(fixture.runTurn).toHaveBeenCalledWith('parent-thread', 'handoff-turn')
    expect(await fixture.store.list()).toEqual([])
  })

  it('keeps the obligation across a running-parent conflict and retries when idle', async () => {
    let status: 'running' | 'idle' = 'running'
    const fixture = await createFixture(() => status)
    await fixture.first.prepare(childRecord())

    await fixture.second.replayPending()
    expect(fixture.startTurn).not.toHaveBeenCalled()
    expect(await fixture.store.list()).toHaveLength(1)

    status = 'idle'
    await fixture.second.replayPending()
    expect(fixture.startTurn).toHaveBeenCalledOnce()
    expect(await fixture.store.list()).toEqual([])
  })

  it('uses one clientRequestId when ack fails after durable admission', async () => {
    const fixture = await createFixture()
    const originalAck = fixture.store.ack.bind(fixture.store)
    let failAck = true
    fixture.store.ack = async (id: string) => {
      if (failAck) {
        failAck = false
        throw new Error('ack unavailable')
      }
      await originalAck(id)
    }
    await fixture.first.prepare(childRecord())

    await fixture.second.replayPending()
    expect(await fixture.store.list()).toHaveLength(1)
    await fixture.second.replayPending()

    expect(fixture.startTurn).toHaveBeenCalledTimes(2)
    const requestIds = fixture.startTurn.mock.calls.map((call) => call[0].request.clientRequestId)
    expect(new Set(requestIds).size).toBe(1)
    expect(fixture.runTurn).toHaveBeenCalledOnce()
    expect(await fixture.store.list()).toEqual([])
  })
})

async function createFixture(status: () => 'running' | 'idle' = () => 'idle') {
  const root = await mkdtemp(join(tmpdir(), 'kun-child-handoff-'))
  roots.push(root)
  const store = new DetachedChildHandoffStore(root)
  const runTurn = vi.fn(async () => undefined)
  const admitted = new Map<string, { threadId: string; turnId: string }>()
  const startTurn = vi.fn(async (input: {
    threadId: string
    request: { clientRequestId?: string }
  }, options?: { onAdmitted?: (response: { threadId: string; turnId: string }) => void }) => {
    const key = input.request.clientRequestId ?? 'missing'
    const existing = admitted.get(key)
    if (existing) return existing
    const response = { threadId: input.threadId, turnId: 'handoff-turn' }
    admitted.set(key, response)
    options?.onAdmitted?.(response)
    return response
  })
  const threadStore = {
    get: vi.fn(async () => ({
      id: 'parent-thread',
      status: status(),
      turns: []
    }))
  } as unknown as ThreadStore
  const options = {
    store,
    threadStore,
    turns: { startTurn } as unknown as TurnService,
    runTurn: () => runTurn,
    proactiveRetry: () => ({ enabled: true, maxAttempts: 3 }),
    nowIso: () => '2026-08-30T00:00:00.000Z'
  }
  return {
    store,
    runTurn,
    startTurn,
    first: new DetachedChildHandoffCoordinator(options),
    second: new DetachedChildHandoffCoordinator(options)
  }
}

function childRecord() {
  return ChildRunRecord.parse({
    id: 'child-1',
    parentThreadId: 'parent-thread',
    parentTurnId: 'parent-turn',
    label: 'research',
    prompt: 'research task',
    status: 'completed',
    detached: true,
    summary: 'done',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    returnFormat: 'summary',
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:01:00.000Z'
  })
}
