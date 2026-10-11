import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import type { WorkbenchLink } from '../contracts/workbench-links.js'
import { AgentDispatchService } from '../delegation/agent-dispatch-service.js'
import { requestWorkbenchCancel } from './actions.js'
import { projectWorkbenchDispatches } from './dispatch.js'
import { dispatchFixture as fixture } from './dispatch-test-support.js'
import { reconcileWorkbench } from './reconcile.js'

vi.mock('../rooms/room-continuation-service.js', () => ({ enqueuePrivateContinuation: vi.fn(async () => 'queued') }))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function replacementFixture(mode: 'full-access' | 'approve-for-me' = 'approve-for-me') {
  const f = await fixture(mode)
  await promisify(execFile)('git', ['init', '-q'], { cwd: f.project })
  f.bridge.attach({ harnesses: {
    resolve: async (request: WorkbenchLink['request']) => request.execution?.model ??
      { harnessId: 'codex', model: 'original-model', credentialMode: 'native-login' },
    permissionCeiling: (_request: unknown, policy: unknown) => policy,
    assertCapabilityCeiling: () => undefined,
    list: async () => ({ agents: [{ harnessId: 'kun', displayName: 'Kun', available: true,
      models: [{ harnessId: 'kun', model: 'replacement-model', providerId: 'p1', credentialMode: 'provider' }] }] })
  } as never })
  f.deps.proveStopped = vi.fn(async () => true)
  const created = await f.create({ agentSelection: 'auto' })
  if (mode === 'full-access') f.clock.now += 60_000
  await f.start()
  const original = (await f.link(created.linkId)).value
  const turn = f.stub.threads.get(original.threadId!)!.turns[0]
  turn.status = 'failed'; turn.error = 'Agent transport failed'
  return { ...f, created, original }
}

const resetsReplacement = (value: unknown): boolean => {
  const link = value as WorkbenchLink
  return link.status === 'awaiting_confirmation' && link.dispatchReplacementCount === 1
}

describe('workbench replacement generation recovery', () => {
  it('admits a fast automatic approval while a stale link projection is delayed', async () => {
    const f = await replacementFixture()
    const reviewing = deferred(), projectEntered = deferred(), releaseProject = deferred()
    f.review.mockImplementationOnce(async () => {
      await reviewing.promise
      return { decision: 'allow', reason: 'Replacement is allowed' }
    })
    const commit = f.store.commit.bind(f.store)
    let held = false
    const spy = vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (!held && input.puts?.some((put) => put.kind === 'workbench_link' && resetsReplacement(put.value))) {
        held = true; projectEntered.resolve(); await releaseProject.promise
      }
      return commit(input)
    })
    const replacing = reconcileWorkbench(f.bridge)
    try {
      await projectEntered.promise
      reviewing.resolve()
      await f.service.reconcile()
      expect(await f.intent(f.created.dispatchIntentId)).toMatchObject({ state: 'queued', replacementCount: 1 })
      expect((await f.link(f.created.linkId)).value).toMatchObject({ status: 'queued', dispatchReplacementCount: 1 })
      releaseProject.resolve()
      await replacing
    } finally {
      reviewing.resolve(); releaseProject.resolve(); await replacing; spy.mockRestore()
    }
    await f.start()
    const link = (await f.link(f.created.linkId)).value
    expect(link.threadId).not.toBe(f.original.threadId)
    expect(link.clientRequestId).toBe(`${f.created.dispatchIntentId}:start:replacement:1`)
    expect(f.stub.calls.enqueued).toHaveLength(2)
    expect(f.stub.calls.enqueued[1].request).toMatchObject({ harnessId: 'kun', model: 'replacement-model' })
    expect(f.review).toHaveBeenCalledTimes(2)
  })

  it('recovers a committed countdown after restart before the link reset was persisted', async () => {
    const f = await replacementFixture('full-access')
    const commit = f.store.commit.bind(f.store)
    const spy = vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (input.puts?.some((put) => put.kind === 'workbench_link' && resetsReplacement(put.value))) {
        throw new Error('Simulated unavailable link store after intent commit')
      }
      return commit(input)
    })
    try { await reconcileWorkbench(f.bridge) } finally { spy.mockRestore() }
    const before = await f.intent(f.created.dispatchIntentId)
    expect(before).toMatchObject({ state: 'countdown', replacementCount: 1 })
    expect((await f.link(f.created.linkId)).value).toMatchObject({ status: 'failed', threadId: f.original.threadId })
    await f.service.stop()
    const resumed = new AgentDispatchService({ store: f.intentStore, applicationSessionId: 'app-session', now: () => f.clock.now })
    f.bridge.attach({ agentDispatch: resumed })
    try {
      await resumed.start()
      await reconcileWorkbench(f.bridge)
      expect((await resumed.get(f.created.dispatchIntentId))?.deadline).toBe(before.deadline)
      expect((await f.link(f.created.linkId)).value).toMatchObject({ status: 'awaiting_confirmation', dispatchReplacementCount: 1 })
      expect(f.stub.calls.enqueued).toHaveLength(1)
      f.clock.now += 60_000
      await resumed.reconcile()
      await reconcileWorkbench(f.bridge); await reconcileWorkbench(f.bridge)
      expect(f.stub.calls.enqueued).toHaveLength(2)
      expect((await f.link(f.created.linkId)).value.threadId).not.toBe(f.original.threadId)
    } finally { await resumed.stop() }
  })

  it('does not reset a cancelled replacement or admit it during repeated projection', async () => {
    const f = await replacementFixture('full-access')
    await reconcileWorkbench(f.bridge)
    await requestWorkbenchCancel(f.bridge, f.room.id, f.created.linkId)
    await projectWorkbenchDispatches(f.bridge)
    await projectWorkbenchDispatches(f.bridge)
    f.clock.now += 60_000
    await f.start()
    expect(await f.intent(f.created.dispatchIntentId)).toMatchObject({ state: 'cancelled', replacementCount: 1 })
    expect((await f.link(f.created.linkId)).value).toMatchObject({ status: 'cancelled', cancelRequested: true })
    expect(f.stub.calls.enqueued).toHaveLength(1)
  })

  it('keeps validation read-only when a replacement cannot pass admission', async () => {
    const f = await replacementFixture()
    await f.service.updateTarget(f.created.dispatchIntentId, { state: 'failed', error: 'Original failure' })
    const before = await f.intent(f.created.dispatchIntentId)
    await expect(f.service.replace(before.intentId, {
      expectedRevision: before.revision,
      recommendation: { ...before.recommendation, agentId: 'kun', workspace: '/missing/replacement/project' },
      payload: { ...before.payload, request: { ...f.original.request, workspaceRoot: '/missing/replacement/project' } }
    })).rejects.toThrow('Code project is unavailable')
    expect((await f.link(f.created.linkId)).value).toMatchObject({ threadId: f.original.threadId, turnId: f.original.turnId })
    expect((await f.link(f.created.linkId)).value.dispatchReplacementCount).toBeUndefined()
    expect(await f.intent(before.intentId)).toMatchObject({ replacementCount: 0, state: 'failed' })
  })

  it('projects a refused replacement without reusing the previous failure after interrupted persistence', async () => {
    const f = await replacementFixture()
    f.review.mockImplementationOnce(async () => ({ decision: 'deny', reason: 'Replacement exceeds the task scope' }))
    const commit = f.store.commit.bind(f.store)
    const spy = vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (input.puts?.some((put) => put.kind === 'workbench_link' && resetsReplacement(put.value))) {
        throw new Error('Simulated interrupted replacement projection')
      }
      return commit(input)
    })
    try {
      await reconcileWorkbench(f.bridge)
      await f.service.reconcile()
    } finally { spy.mockRestore() }
    expect(await f.intent(f.created.dispatchIntentId)).toMatchObject({ state: 'failed', replacementCount: 1,
      decision: { decision: 'deny', reason: 'Replacement exceeds the task scope' } })
    await projectWorkbenchDispatches(f.bridge)
    expect((await f.link(f.created.linkId)).value).toMatchObject({ status: 'failed', dispatchReplacementCount: 1,
      request: { execution: { model: { harnessId: 'kun' } } }, error: 'Replacement exceeds the task scope' })
    expect((await f.link(f.created.linkId)).value.threadId).toBeUndefined()
    expect(f.stub.calls.enqueued).toHaveLength(1)
  })

  it('continues dispatching when an unrelated historical replacement link no longer exists', async () => {
    const f = await fixture()
    const created = await f.create()
    const intent = await f.intent(created.dispatchIntentId)
    await f.intentStore.transaction((file) => file.intents.push({ ...intent, intentId: 'missing-historical-intent',
      state: 'failed', replacementCount: 1, payload: { ...intent.payload, linkId: 'removed-historical-link' } }))
    await expect(projectWorkbenchDispatches(f.bridge)).resolves.toBe(true)
    f.clock.now += 60_000
    await f.start()
    expect(f.stub.calls.enqueued).toHaveLength(1)
  })

  it('cancels a committed replacement before its failed link projection is recovered', async () => {
    const f = await replacementFixture('full-access')
    const commit = f.store.commit.bind(f.store)
    const spy = vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (input.puts?.some((put) => put.kind === 'workbench_link' && resetsReplacement(put.value))) {
        throw new Error('Link projection unavailable')
      }
      return commit(input)
    })
    try { await reconcileWorkbench(f.bridge) } finally { spy.mockRestore() }
    expect(await f.intent(f.created.dispatchIntentId)).toMatchObject({ state: 'countdown', replacementCount: 1 })
    expect((await f.link(f.created.linkId)).value).toMatchObject({ status: 'failed', threadId: f.original.threadId })
    await expect(requestWorkbenchCancel(f.bridge, f.room.id, f.created.linkId)).resolves.toMatchObject({ status: 'cancelled' })
    await projectWorkbenchDispatches(f.bridge)
    expect(await f.intent(f.created.dispatchIntentId)).toMatchObject({ state: 'cancelled' })
    expect(f.stub.calls.enqueued).toHaveLength(1)
  })
})
