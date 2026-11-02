import { afterEach, describe, expect, it, vi } from 'vitest'
import { setup } from './manager-worker-dispatch-fixtures.js'
import { AgentDispatchService } from '../delegation/agent-dispatch-service.js'
import { FileAgentDispatchIntentStore } from '../delegation/agent-dispatch-intent-store.js'
import { FileTeamStore } from './team-store.js'
import { FileDispatchStore } from './dispatch-store.js'
import { FileWorkerNoticeStore } from './worker-notice-store.js'
import { DispatchDeliverer } from './dispatch-deliverer.js'
import { ManagerRuntime } from './manager-runtime.js'
import { WorkerNoticeCoordinator } from './worker-notice-coordinator.js'
import { workerDispatchIds } from './worker-dispatch-ids.js'
import type { TurnService } from '../services/turn-service.js'

const close: Array<() => Promise<void>> = []
afterEach(async () => { for (const stop of close.splice(0)) await stop() })

async function failedIntent() {
  const f = await setup('ask-for-approval')
  const result = await f.runtime.createWorker(f.ctx, f.assignment, f.context)
  await f.service.stop()
  await f.store.transaction(file => {
    const intent = file.intents.find(i => i.intentId === result.dispatchIntentId)!
    intent.state = 'failed'
    intent.error = 'Admission rejected before worker creation'
  })
  return { ...f, intentId: result.dispatchIntentId! }
}

async function restart(f: Awaited<ReturnType<typeof failedIntent>>, failEnqueue = false) {
  const store = new FileAgentDispatchIntentStore(f.root)
  const review = vi.fn(async () => ({ decision: 'allow' as const, reason: 'unexpected review' }))
  const service = new AgentDispatchService({ store, applicationSessionId: 'app', review })
  const teams = new FileTeamStore(f.root)
  const dispatches = new FileDispatchStore(f.root)
  const notices = new FileWorkerNoticeStore(f.root)
  const runTurn = vi.fn(async () => undefined)
  const startTurn = vi.fn<TurnService['startTurn']>(async (_input, options) => {
    const response = { threadId: 'parent', turnId: 'notice-turn', userMessageItemId: 'notice-item', status: 'queued' as const }
    await options?.onAdmitted?.(response)
    return response
  })
  const coordinator = new WorkerNoticeCoordinator({ notices, teams, dispatches, threads: f.threads,
    agentDispatchService: service, turns: { startTurn }, runTurn: () => runTurn,
    nowIso: () => new Date().toISOString(), mergeWindowMs: () => 60_000 })
  const sink = failEnqueue ? { enqueue: vi.fn(async () => { throw new Error('temporary enqueue failure') }) } : coordinator
  const deliverer = new DispatchDeliverer({ ...f.delivererDeps, teams, dispatches, notices: sink })
  const runtime = new ManagerRuntime({ ...f.runtimeDeps, teams, dispatches, notices: sink, deliverer,
    agentDispatchService: service })
  close.push(async () => { coordinator.clearManager('parent'); await service.stop() })
  await service.start()
  await runtime.reconcileOnStartup()
  await coordinator.deliverForManager('parent')
  coordinator.clearManager('parent')
  expect(review).not.toHaveBeenCalled()
  expect(f.runChild).not.toHaveBeenCalled()
  return { notices, teams, dispatches, startTurn, runTurn }
}

describe('failed worker intent startup recovery', () => {
  it('recovers the missing notice from disk and preserves ACK across another restart', async () => {
    const f = await failedIntent()
    expect(await f.notices.list('parent')).toEqual([])
    expect(await f.dispatches.list('parent')).toEqual([])
    const first = await restart(f)
    expect(first.startTurn).toHaveBeenCalledTimes(1)
    expect(first.runTurn).toHaveBeenCalledExactlyOnceWith('parent', 'notice-turn')
    expect(await first.notices.list('parent')).toEqual([expect.objectContaining({
      noticeId: `${f.intentId}:failed:0`, ackedAt: expect.any(String)
    })])
    expect((await first.teams.get('parent'))?.workers).toEqual([])
    expect(await first.dispatches.list('parent')).toEqual([])
    const second = await restart(f)
    expect(second.startTurn).not.toHaveBeenCalled()
    expect(second.runTurn).not.toHaveBeenCalled()
  })

  it('retries after a temporary enqueue failure on the next startup', async () => {
    const f = await failedIntent()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const first = await restart(f, true)
      expect(first.startTurn).not.toHaveBeenCalled()
      expect(await first.notices.list('parent')).toEqual([])
      expect((await restart(f)).startTurn).toHaveBeenCalledTimes(1)
    } finally { warning.mockRestore() }
  })

  it.each(['aborted', 'cancelled', 'takenOver', 'archived', 'deleted'] as const)(
    'does not wake the manager for %s', async state => {
      const f = await failedIntent()
      if (state === 'cancelled' || state === 'takenOver') {
        await f.store.transaction(file => {
          const intent = file.intents[0]
          if (state === 'cancelled') intent.cancellationRequested = true
          else intent.takenOver = true
        })
      } else {
        const source = (await f.threads.get('parent'))!
        if (state === 'aborted') source.turns[0].status = 'aborted'
        else source.status = state
        await f.threads.upsert(source)
      }
      const result = await restart(f)
      expect(result.startTurn).not.toHaveBeenCalled()
      expect(result.runTurn).not.toHaveBeenCalled()
      expect(await result.notices.list('parent')).toEqual([])
    })

  it('does not revive the failure notice of an automatically replaced intent', async () => {
    const f = await failedIntent()
    const original = (await f.store.get(f.intentId))!
    const ids = workerDispatchIds(original, 0)
    await f.teams.ensure('parent')
    await f.notices.enqueue({ noticeId: `${f.intentId}:failed:0`, teamId: 'parent',
      workerId: ids.workerId, dispatchIntentId: f.intentId, parentTurnId: 'source-turn',
      kind: 'dispatch_failed', title: 'Old failure', createdAt: f.runtimeDeps.nowIso(), attempts: 0 })
    await f.store.transaction(file => {
      const intent = file.intents[0]
      intent.state = 'completed'
      intent.replacementCount = 1
      intent.previousTarget = { workerIds: [ids.workerId], dispatchIds: [ids.dispatchId] }
    })
    const result = await restart(f)
    expect(result.startTurn).not.toHaveBeenCalled()
    expect(await result.notices.pending('parent')).toEqual([])
  })

  it('reuses the dispatch notice when an individual failure was already persisted', async () => {
    const f = await failedIntent()
    const intent = (await f.store.get(f.intentId))!
    const ids = workerDispatchIds(intent, 0)
    await f.teams.ensure('parent')
    await f.dispatches.create({ ...ids, teamId: 'parent', parentTurnId: 'source-turn',
      state: 'failed', title: 'Failed assignment', task: 'Task', mode: 'queue',
      createdAt: f.runtimeDeps.nowIso(), updatedAt: f.runtimeDeps.nowIso(),
      failureReason: 'Rejected' })
    await f.notices.enqueue({ noticeId: `ntc_${ids.dispatchId}`, ...ids, teamId: 'parent',
      parentTurnId: 'source-turn', dispatchIntentId: f.intentId, kind: 'dispatch_failed',
      title: 'Failed assignment', createdAt: f.runtimeDeps.nowIso(), attempts: 0 })
    const result = await restart(f)
    expect(result.startTurn).toHaveBeenCalledTimes(1)
    expect(await result.notices.list('parent')).toHaveLength(1)
    expect((await restart(f)).startTurn).not.toHaveBeenCalled()
  })
})
