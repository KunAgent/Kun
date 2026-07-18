import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JobEventSchema, JobSnapshotSchema } from '@kun/extension-api'
import { extensionWorkspaceKey } from '../extensions/paths.js'
import { ExtensionJobStore } from './extension-job-store.js'
import {
  ExtensionJobService,
  ExtensionJobServiceError,
  type ExtensionJobCoreExecutor,
  type ExtensionJobCreateInput,
  type ExtensionJobExecutionContext
} from './extension-job-service.js'
import type { ExtensionJobResult } from './extension-job-types.js'

const roots: string[] = []
const WORKSPACE_ROOT = '/private/workspaces/one'
const OTHER_WORKSPACE_ROOT = '/private/workspaces/two'
const WORKSPACE_ID = extensionWorkspaceKey(WORKSPACE_ROOT)
const OTHER_WORKSPACE_ID = extensionWorkspaceKey(OTHER_WORKSPACE_ROOT)

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ExtensionJobService state machine', () => {
  it('runs one core executor through durable progress and one completed fence', async () => {
    const { store, service } = await createService({ progressIntervalMs: 0 })
    const execution = controllableExecutor('media.ffmpeg')
    service.registerCoreExecutor(execution.executor)
    const created = await service.createAndDispatch(jobInput())
    const context = await execution.context()
    await context.reportProgress({ phase: 'encode', completed: 4, total: 10, message: 'working' })
    await context.reportProgress({ phase: 'encode', completed: 3, total: 10 })
    execution.resolve({ schemaVersion: 1, data: { output: 'artifact-1' }, generatedArtifacts: [] })
    await service.waitForIdle(created.snapshot.id)

    expect(await store.get(created.snapshot.id)).toMatchObject({
      state: 'completed',
      executionAttempt: 1,
      progress: { phase: 'encode', completed: 4, percentage: 40 },
      result: { data: { output: 'artifact-1' } }
    })
    const replay = await store.replay(created.snapshot.id)
    expect(replay?.events.map((event) => event.type)).toEqual([
      'created',
      'state',
      'progress',
      'progress',
      'completed'
    ])
    expect(replay?.events.filter((event) => event.type === 'completed')).toHaveLength(1)
  })

  it('fences late executor outcomes after the first terminal transition', async () => {
    const { store, service } = await createService()
    const execution = controllableExecutor('media.ffmpeg')
    service.registerCoreExecutor(execution.executor)
    const created = await service.createAndDispatch(jobInput())
    const running = await store.get(created.snapshot.id)
    expect(running?.executionAttempt).toBe(1)

    await service.complete(created.snapshot.id, 1, {
      schemaVersion: 1,
      data: { winner: true },
      generatedArtifacts: []
    })
    await service.fail(created.snapshot.id, 1, new Error('late failure'))
    execution.resolve({ schemaVersion: 1, data: { late: true }, generatedArtifacts: [] })
    await service.waitForIdle(created.snapshot.id)

    expect(await store.get(created.snapshot.id)).toMatchObject({
      state: 'completed',
      result: { data: { winner: true } }
    })
    expect((await store.replay(created.snapshot.id))?.events.filter((event) =>
      event.type === 'completed' || event.type === 'failed')).toHaveLength(1)
  })

  it('coalesces a progress flood while retaining the latest snapshot before completion', async () => {
    vi.useFakeTimers()
    const { store, service } = await createService({ progressIntervalMs: 100 })
    const execution = controllableExecutor('media.ffmpeg')
    service.registerCoreExecutor(execution.executor)
    const created = await service.createAndDispatch(jobInput())
    const context = await execution.context()
    for (let completed = 1; completed <= 50; completed += 1) {
      await context.reportProgress({ phase: 'encode', completed, total: 50 })
    }
    execution.resolve({ schemaVersion: 1, generatedArtifacts: [] })
    await service.waitForIdle(created.snapshot.id)

    expect(await store.get(created.snapshot.id)).toMatchObject({
      state: 'completed',
      progress: { completed: 50, percentage: 100 }
    })
    expect((await store.replay(created.snapshot.id))?.events.filter((event) =>
      event.type === 'progress').length).toBeLessThan(50)
  })

  it('enforces scoped quotas before creating a durable job but preserves idempotent retry', async () => {
    const { store, service } = await createService({
      quotas: { maxActivePerExtension: 1 }
    })
    const first = await service.createJob(jobInput({ idempotencyKey: 'same-request' }))
    const retried = await service.createJob(jobInput({ idempotencyKey: 'same-request' }))
    expect(retried).toEqual({ snapshot: first.snapshot, created: false })

    await expect(service.createJob(jobInput({ idempotencyKey: 'new-request' }))).rejects.toMatchObject({
      code: 'quota_exceeded',
      details: { quota: 'extension_active' }
    })
    expect(await store.list()).toHaveLength(1)
  })

  it('rejects oversized results without corrupting the running snapshot', async () => {
    const { store, service } = await createService({ maxResultBytes: 128 })
    const execution = controllableExecutor('media.ffmpeg')
    service.registerCoreExecutor(execution.executor)
    const created = await service.createAndDispatch(jobInput())

    await expect(service.complete(created.snapshot.id, 1, {
      schemaVersion: 1,
      data: { value: 'x'.repeat(512) },
      generatedArtifacts: []
    })).rejects.toBeInstanceOf(ExtensionJobServiceError)
    expect(await store.get(created.snapshot.id)).toMatchObject({ state: 'running' })
    execution.reject(new Error('bounded failure'))
    await service.waitForIdle(created.snapshot.id)
    expect(await store.get(created.snapshot.id)).toMatchObject({ state: 'failed' })
  })

  it('keeps the authoritative workspace root out of get, list, and subscription projections', async () => {
    const { store, service } = await createService()
    const created = await service.createJob(jobInput())
    const snapshot = await service.getOwned(caller(), created.snapshot.id)
    const page = await service.listOwned(caller())
    const subscription = await service.subscribe(caller(), created.snapshot.id)

    expect(snapshot.workspaceId).toBe(WORKSPACE_ID)
    expect((await store.getStored(created.snapshot.id))?.workspaceRoot).toBe(WORKSPACE_ROOT)
    expect(JSON.stringify({
      snapshot,
      page,
      subscriptionSnapshot: subscription.snapshot,
      replay: subscription.replay
    })).not.toContain(WORKSPACE_ROOT)
    subscription.close()

    await expect(service.createJob(jobInput({
      owner: { ...jobInput().owner, workspaceId: OTHER_WORKSPACE_ID }
    }))).rejects.toMatchObject({ code: 'invalid_request' })
  })
})

describe('ExtensionJobService subscriptions', () => {
  it('replays strictly after a cursor and then delivers live events without a gap', async () => {
    const { service } = await createService({ progressIntervalMs: 0 })
    const execution = controllableExecutor('media.ffmpeg')
    service.registerCoreExecutor(execution.executor)
    const created = await service.createJob(jobInput())
    await service.dispatch(created.snapshot.id)
    const context = await execution.context()
    const subscription = await service.subscribe(caller(), created.snapshot.id, created.snapshot.latestCursor)

    expect(subscription.gap).toBe(false)
    expect(subscription.replay.map((event) => event.type)).toEqual(['state'])
    await context.reportProgress({ completed: 1, total: 2 })
    const iterator = subscription[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'event', event: { type: 'progress', sequence: 3 } }
    })
    execution.resolve({ schemaVersion: 1, generatedArtifacts: [] })
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'event', event: { type: 'completed' } }
    })
    await expect(iterator.next()).resolves.toMatchObject({ done: true })
  })

  it('turns subscriber backpressure into one resumable overflow and cleans up', async () => {
    const { service } = await createService({
      progressIntervalMs: 0,
      maxSubscriberEvents: 2,
      maxSubscriberBytes: 64 * 1024
    })
    const execution = controllableExecutor('media.ffmpeg')
    service.registerCoreExecutor(execution.executor)
    const created = await service.createAndDispatch(jobInput())
    const context = await execution.context()
    const running = await service.getOwned(caller(), created.snapshot.id)
    const subscription = await service.subscribe(caller(), created.snapshot.id, running.latestCursor)
    for (let index = 1; index <= 4; index += 1) {
      await context.reportProgress({ completed: index, total: 4 })
    }

    expect(service.subscriptionCount).toBe(1)
    const iterator = subscription[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: {
        type: 'overflow',
        gap: true,
        snapshot: { progress: { completed: 3 } }
      }
    })
    await expect(iterator.next()).resolves.toMatchObject({ done: true })
    expect(service.subscriptionCount).toBe(0)
    execution.resolve({ schemaVersion: 1, generatedArtifacts: [] })
    await service.waitForIdle(created.snapshot.id)
  })

  it('returns a safe gap snapshot when the requested replay cursor expired', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-job-service-'))
    roots.push(root)
    const store = new ExtensionJobStore({ path: join(root, 'jobs.json'), maxEventsPerJob: 2 })
    const service = new ExtensionJobService({ store, progressIntervalMs: 0 })
    const execution = controllableExecutor('media.ffmpeg')
    service.registerCoreExecutor(execution.executor)
    const created = await service.createAndDispatch(jobInput())
    const context = await execution.context()
    for (let index = 1; index <= 4; index += 1) {
      await context.reportProgress({ completed: index, total: 4 })
    }
    const subscription = await service.subscribe(caller(), created.snapshot.id, created.snapshot.latestCursor)

    expect(subscription).toMatchObject({ gap: true, replay: [], snapshot: { progress: { completed: 4 } } })
    expect(subscription.cursor).toBe(subscription.snapshot.latestCursor)
    subscription.close()
    execution.resolve({ schemaVersion: 1, generatedArtifacts: [] })
    await service.waitForIdle(created.snapshot.id)
  })
})

describe('ExtensionJobService cancellation', () => {
  it('cancels a queued job idempotently without dispatching an executor', async () => {
    const { store, service } = await createService()
    const created = await service.createJob(jobInput())
    const first = await service.cancel(caller(), created.snapshot.id, 'user_request')
    const second = await service.cancel(caller(), created.snapshot.id, 'user_request')

    expect(first).toMatchObject({ accepted: true, snapshot: { state: 'cancelled' } })
    expect(second).toMatchObject({ accepted: false, snapshot: { state: 'cancelled' } })
    expect((await store.replay(created.snapshot.id))?.events.filter((event) =>
      event.type === 'cancelled')).toHaveLength(1)
    await expect(service.dispatch(created.snapshot.id)).rejects.toMatchObject({ code: 'executor_unavailable' })
  })

  it('propagates one logical running cancellation and fences late success', async () => {
    const { store, service } = await createService()
    const execution = controllableExecutor('media.ffmpeg')
    const cancel = vi.fn(async () => {
      execution.resolve({ schemaVersion: 1, generatedArtifacts: [] })
    })
    execution.executor.cancel = cancel
    service.registerCoreExecutor(execution.executor)
    const created = await service.createAndDispatch(jobInput())
    await execution.context()

    const [first, second] = await Promise.all([
      service.cancel(caller(), created.snapshot.id, 'user_request'),
      service.cancel(caller(), created.snapshot.id, 'user_request')
    ])
    expect(first.snapshot).toEqual(second.snapshot)
    expect(first.snapshot.state).toBe('cancelled')
    expect(cancel).toHaveBeenCalledTimes(1)
    await service.complete(created.snapshot.id, 1, {
      schemaVersion: 1,
      data: { late: true },
      generatedArtifacts: []
    })
    await service.waitForIdle(created.snapshot.id)

    expect(await store.get(created.snapshot.id)).toMatchObject({ state: 'cancelled' })
    expect((await store.replay(created.snapshot.id))?.events.filter((event) =>
      event.type === 'cancelled')).toHaveLength(1)
  })

  it('does not persist cancellation before an active executor finishes abort cleanup', async () => {
    const { store, service } = await createService()
    const execution = controllableExecutor('media.ffmpeg')
    service.registerCoreExecutor(execution.executor)
    const created = await service.createAndDispatch(jobInput())
    const context = await execution.context()

    let cancellationSettled = false
    const cancellation = service.cancel(caller(), created.snapshot.id, 'user_request')
      .finally(() => {
        cancellationSettled = true
      })
    await expect.poll(() => context.signal.aborted).toBe(true)
    expect(cancellationSettled).toBe(false)
    expect(await store.get(created.snapshot.id)).toMatchObject({
      state: 'running',
      cancelRequestedAt: expect.any(String)
    })

    execution.resolve({ schemaVersion: 1, generatedArtifacts: [] })
    await expect(cancellation).resolves.toMatchObject({ snapshot: { state: 'cancelled' } })
    expect(await store.get(created.snapshot.id)).toMatchObject({ state: 'cancelled' })
  })

  it('preserves completion when cancellation loses the terminal race', async () => {
    const { service } = await createService()
    const execution = controllableExecutor('media.ffmpeg')
    service.registerCoreExecutor(execution.executor)
    const created = await service.createAndDispatch(jobInput())
    await service.complete(created.snapshot.id, 1, { schemaVersion: 1, generatedArtifacts: [] })

    await expect(service.cancel(caller(), created.snapshot.id)).resolves.toMatchObject({
      accepted: false,
      snapshot: { state: 'completed' }
    })
    execution.resolve({ schemaVersion: 1, generatedArtifacts: [] })
    await service.waitForIdle(created.snapshot.id)
  })

  it('interrupts when a core cancellation adapter misses its bounded deadline', async () => {
    const { service } = await createService({ cancellationDeadlineMs: 5 })
    const execution = controllableExecutor('media.ffmpeg')
    let cleanupSignal: AbortSignal | undefined
    execution.executor.cancel = async (_snapshot, context) => {
      cleanupSignal = context.signal
      return new Promise<void>(() => undefined)
    }
    service.registerCoreExecutor(execution.executor)
    const created = await service.createAndDispatch(jobInput())
    await execution.context()

    await expect(service.cancel(caller(), created.snapshot.id)).resolves.toMatchObject({
      accepted: true,
      snapshot: {
        state: 'interrupted',
        error: { code: 'CANCELLATION_CLEANUP_INCOMPLETE' }
      }
    })
    expect(cleanupSignal?.aborted).toBe(true)
    execution.resolve({ schemaVersion: 1, generatedArtifacts: [] })
    await service.waitForIdle(created.snapshot.id)
  })

  it('uses the same opaque not-found policy for foreign cancellation', async () => {
    const { service } = await createService()
    const created = await service.createJob(jobInput())
    await expect(service.cancel({
      extensionId: 'other.extension',
      workspaceIds: [WORKSPACE_ID]
    }, created.snapshot.id)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('ExtensionJobService restart recovery', () => {
  it('makes a persisted queued job eligible for bounded dispatch with the same ID', async () => {
    const { store, service: firstRuntime } = await createService()
    const created = await firstRuntime.createJob(jobInput({
      checkpoint: { schemaVersion: 1, data: { source: 'durable-input' } }
    }))
    const reauthorize = vi.fn(async (_snapshot, workspaceRoot: string) =>
      workspaceRoot === WORKSPACE_ROOT)
    const recovered = new ExtensionJobService({ store, reauthorize })
    const execution = controllableExecutor('media.ffmpeg')
    recovered.registerCoreExecutor(execution.executor)

    await expect(recovered.initialize()).resolves.toMatchObject({ queued: 1, interrupted: 0 })
    expect(await store.get(created.snapshot.id)).toMatchObject({
      id: created.snapshot.id,
      state: 'running',
      executionAttempt: 1
    })
    const context = await execution.context()
    expect(context.checkpoint).toEqual({
      schemaVersion: 1,
      data: { source: 'durable-input' }
    })
    expect(context.workspaceRoot).toBe(WORKSPACE_ROOT)
    expect(reauthorize).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WORKSPACE_ID }),
      WORKSPACE_ROOT
    )
    execution.resolve({ schemaVersion: 1, generatedArtifacts: [] })
    await recovered.waitForIdle(created.snapshot.id)
  })

  it('interrupts a formerly running job unless its core adapter proves recovery is safe', async () => {
    const { store, service: firstRuntime } = await createService()
    const created = await firstRuntime.createJob(jobInput())
    await persistRunning(store, created.snapshot.id)
    const recovered = new ExtensionJobService({ store })
    const execute = vi.fn(async () => ({ schemaVersion: 1 as const, generatedArtifacts: [] }))
    recovered.registerCoreExecutor({ kind: 'media.ffmpeg', execute })

    await expect(recovered.initialize()).resolves.toMatchObject({ interrupted: 1 })
    expect(execute).not.toHaveBeenCalled()
    expect(await store.get(created.snapshot.id)).toMatchObject({
      state: 'interrupted',
      error: { code: 'JOB_RECOVERY_UNSAFE' }
    })
  })

  it('reauthorizes recovery with the private root and interrupts a denied workspace', async () => {
    const { store, service: firstRuntime } = await createService()
    const created = await firstRuntime.createJob(jobInput())
    const reauthorize = vi.fn(async (_snapshot, workspaceRoot: string) => {
      expect(workspaceRoot).toBe(WORKSPACE_ROOT)
      return false
    })
    const recovered = new ExtensionJobService({ store, reauthorize })
    const execute = vi.fn(async () => ({ schemaVersion: 1 as const, generatedArtifacts: [] }))
    recovered.registerCoreExecutor({ kind: 'media.ffmpeg', execute })

    await expect(recovered.initialize()).resolves.toMatchObject({ interrupted: 1 })
    expect(reauthorize).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WORKSPACE_ID }),
      WORKSPACE_ROOT
    )
    expect(execute).not.toHaveBeenCalled()
    expect(await store.get(created.snapshot.id)).toMatchObject({
      state: 'interrupted',
      error: { code: 'JOB_RECOVERY_UNAUTHORIZED' }
    })
  })

  it('records a new attempt when a recovery adapter explicitly resumes', async () => {
    const { store, service: firstRuntime } = await createService()
    const created = await firstRuntime.createJob(jobInput({
      checkpoint: { schemaVersion: 1, data: { frame: 120 } }
    }))
    await persistRunning(store, created.snapshot.id)
    const recovered = new ExtensionJobService({ store })
    const execution = controllableExecutor('media.ffmpeg')
    execution.executor.recover = async (_snapshot, checkpoint, context) => {
      expect(context.workspaceRoot).toBe(WORKSPACE_ROOT)
      return checkpoint?.data !== undefined ? 'resume' : 'interrupt'
    }
    recovered.registerCoreExecutor(execution.executor)

    await expect(recovered.initialize()).resolves.toMatchObject({ resumed: 1 })
    expect(await store.get(created.snapshot.id)).toMatchObject({ state: 'running', executionAttempt: 2 })
    expect((await store.replay(created.snapshot.id))?.events.at(-1)).toMatchObject({
      type: 'recovery',
      executionAttempt: 2
    })
    execution.resolve({ schemaVersion: 1, generatedArtifacts: [] })
    await recovered.waitForIdle(created.snapshot.id)
  })

  it('gives durable cancellation intent priority over normal restart', async () => {
    const { store, service: firstRuntime } = await createService()
    const created = await firstRuntime.createJob(jobInput())
    await persistRunning(store, created.snapshot.id, true)
    const recovered = new ExtensionJobService({ store })
    const cancel = vi.fn(async () => undefined)
    const execute = vi.fn(async () => ({ schemaVersion: 1 as const, generatedArtifacts: [] }))
    recovered.registerCoreExecutor({ kind: 'media.ffmpeg', execute, cancel, recover: () => 'resume' })

    await expect(recovered.initialize()).resolves.toMatchObject({ cancelled: 1 })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
    expect(await store.get(created.snapshot.id)).toMatchObject({ state: 'cancelled' })
  })

  it('defers excess queued recovery when the current concurrency policy is stricter', async () => {
    const { store, service: firstRuntime } = await createService()
    await firstRuntime.createJob(jobInput())
    await firstRuntime.createJob(jobInput())
    const recovered = new ExtensionJobService({
      store,
      quotas: { maxActivePerExtension: 1 }
    })
    const execution = controllableExecutor('media.ffmpeg')
    recovered.registerCoreExecutor(execution.executor)

    await expect(recovered.initialize()).resolves.toMatchObject({ queued: 1, deferred: 1 })
    const snapshots = await store.list()
    expect(snapshots.filter((snapshot) => snapshot.state === 'running')).toHaveLength(1)
    expect(snapshots.filter((snapshot) => snapshot.state === 'queued')).toHaveLength(1)
    execution.resolve({ schemaVersion: 1, generatedArtifacts: [] })
    await recovered.waitForIdle(snapshots.find((snapshot) => snapshot.state === 'running')!.id)
  })
})

describe('ExtensionJobService lifecycle fencing', () => {
  it('fences disablement before cleanup, revokes subscriptions, and never publishes late success', async () => {
    const { store, service } = await createService()
    const execution = controllableExecutor('media.ffmpeg')
    execution.executor.cancel = vi.fn(async () => {
      execution.resolve({
        schemaVersion: 1,
        data: { mustNotPublish: true },
        generatedArtifacts: []
      })
    })
    service.registerCoreExecutor(execution.executor)
    const created = await service.createAndDispatch(jobInput())
    await execution.context()
    const running = await service.getOwned(caller(), created.snapshot.id)
    await service.subscribe(caller(), created.snapshot.id, running.latestCursor)

    await expect(service.handleExtensionDisabled('video.editor')).resolves.toMatchObject({
      matched: 1,
      cancelled: 1
    })
    expect(service.subscriptionCount).toBe(0)
    await expect(service.createJob(jobInput())).rejects.toMatchObject({ code: 'lifecycle_fenced' })
    await service.waitForIdle(created.snapshot.id)
    expect(await store.get(created.snapshot.id)).toMatchObject({ state: 'cancelled' })

    service.clearExtensionFence('video.editor')
    await expect(service.createJob(jobInput())).resolves.toMatchObject({ created: true })
    expect(await store.get(created.snapshot.id)).toMatchObject({ state: 'cancelled' })
  })

  it('lets independently supervised work survive a Node Host crash but cancels connection-bound work', async () => {
    const { store, service } = await createService()
    const independent = controllableExecutor('media.ffmpeg')
    service.registerCoreExecutor(independent.executor)
    const first = await service.createAndDispatch(jobInput())
    await independent.context()
    await service.subscribe(caller(), first.snapshot.id)

    await expect(service.handleExtensionHostCrash('video.editor')).resolves.toMatchObject({ matched: 0 })
    expect(service.subscriptionCount).toBe(0)
    expect(await store.get(first.snapshot.id)).toMatchObject({ state: 'running' })
    independent.resolve({ schemaVersion: 1, generatedArtifacts: [] })
    await service.waitForIdle(first.snapshot.id)

    const connectionBound = controllableExecutor('media.connection-bound')
    connectionBound.executor.connectionBound = true
    connectionBound.executor.cancel = vi.fn(async () => {
      connectionBound.resolve({ schemaVersion: 1, generatedArtifacts: [] })
    })
    service.registerCoreExecutor(connectionBound.executor)
    const second = await service.createAndDispatch(jobInput({ kind: 'media.connection-bound' }))
    await connectionBound.context()
    await expect(service.handleExtensionHostCrash('video.editor')).resolves.toMatchObject({
      matched: 1,
      cancelled: 1
    })
    await service.waitForIdle(second.snapshot.id)
    expect(await store.get(second.snapshot.id)).toMatchObject({ state: 'cancelled' })
  })

  it('fences a crashed workspace Host without cancelling a peer workspace job', async () => {
    const { store, service } = await createService()
    service.registerCoreExecutor({
      kind: 'media.connection-bound',
      connectionBound: true,
      async execute() {
        return { schemaVersion: 1, generatedArtifacts: [] }
      }
    })
    const first = await service.createJob(jobInput({ kind: 'media.connection-bound' }))
    const second = await service.createJob(jobInput({
      kind: 'media.connection-bound',
      owner: { ...jobInput().owner, workspaceId: OTHER_WORKSPACE_ID },
      workspaceRoot: OTHER_WORKSPACE_ROOT
    }))

    await expect(service.handleExtensionHostCrash('video.editor', [WORKSPACE_ID]))
      .resolves.toMatchObject({ matched: 1, cancelled: 1 })

    expect(await store.get(first.snapshot.id)).toMatchObject({ state: 'cancelled' })
    expect(await store.get(second.snapshot.id)).toMatchObject({ state: 'queued' })
  })

  it('scopes workspace revocation without affecting another authorized workspace', async () => {
    const { store, service } = await createService()
    const first = await service.createJob(jobInput())
    const second = await service.createJob(jobInput({
      owner: { ...jobInput().owner, workspaceId: OTHER_WORKSPACE_ID },
      workspaceRoot: OTHER_WORKSPACE_ROOT
    }))

    await expect(service.handleWorkspaceRevoked('video.editor', WORKSPACE_ID)).resolves.toMatchObject({
      matched: 1,
      cancelled: 1
    })
    expect(await store.get(first.snapshot.id)).toMatchObject({ state: 'cancelled' })
    expect(await store.get(second.snapshot.id)).toMatchObject({ state: 'queued' })
    await expect(service.createJob(jobInput())).rejects.toMatchObject({ code: 'lifecycle_fenced' })
    await expect(service.createJob(jobInput({
      owner: { ...jobInput().owner, workspaceId: OTHER_WORKSPACE_ID },
      workspaceRoot: OTHER_WORKSPACE_ROOT
    }))).resolves.toMatchObject({ created: true })
  })

  it('fences every active job during runtime shutdown', async () => {
    const { store, service } = await createService()
    const execution = controllableExecutor('media.ffmpeg')
    service.registerCoreExecutor(execution.executor)
    const running = await service.createAndDispatch(jobInput())
    const context = await execution.context()
    await service.createJob(jobInput({
      owner: { ...jobInput().owner, workspaceId: OTHER_WORKSPACE_ID },
      workspaceRoot: OTHER_WORKSPACE_ROOT
    }))

    let shutdownSettled = false
    const shutdown = service.handleRuntimeShutdown().finally(() => {
      shutdownSettled = true
    })
    await expect.poll(() => context.signal.aborted).toBe(true)
    expect(shutdownSettled).toBe(false)
    expect(await store.get(running.snapshot.id)).toMatchObject({
      state: 'running',
      cancelRequestedAt: expect.any(String)
    })
    execution.resolve({ schemaVersion: 1, generatedArtifacts: [] })
    await expect(shutdown).resolves.toMatchObject({ matched: 2, cancelled: 2 })
    await expect(service.createJob(jobInput())).rejects.toMatchObject({ code: 'lifecycle_fenced' })
  })

  it('allows a compatible upgraded version to read retained jobs without rewriting creator audit metadata', async () => {
    const { service } = await createService()
    const created = await service.createJob(jobInput())
    await service.cancel(caller(), created.snapshot.id)

    await expect(service.getOwned({
      extensionId: 'video.editor',
      workspaceIds: [WORKSPACE_ID]
    }, created.snapshot.id)).resolves.toMatchObject({
      ownerExtensionVersion: '1.1.0',
      state: 'cancelled'
    })
  })
})

describe('ExtensionJobService conformance', () => {
  it('lists only owned jobs with deterministic filters and cursors', async () => {
    const { service } = await createService()
    await service.createJob(jobInput())
    await service.createJob(jobInput({
      kind: 'media.ffprobe',
      owner: { ...jobInput().owner, workspaceId: OTHER_WORKSPACE_ID },
      workspaceRoot: OTHER_WORKSPACE_ROOT
    }))
    await service.createJob(jobInput({
      owner: { ...jobInput().owner, extensionId: 'other.extension' }
    }))

    const firstPage = await service.listOwned({
      extensionId: 'video.editor',
      workspaceIds: [WORKSPACE_ID, OTHER_WORKSPACE_ID]
    }, { limit: 1 })
    expect(firstPage.items).toHaveLength(1)
    expect(firstPage.page).toMatchObject({ hasMore: true })
    const secondPage = await service.listOwned({
      extensionId: 'video.editor',
      workspaceIds: [WORKSPACE_ID, OTHER_WORKSPACE_ID]
    }, { limit: 1, cursor: firstPage.page.nextCursor })
    expect(secondPage.items).toHaveLength(1)
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id)

    const filtered = await service.listOwned(caller(), {
      filter: { kinds: ['media.ffmpeg'], workspaceId: WORKSPACE_ID }
    })
    expect(filtered.items).toHaveLength(1)
    expect(filtered.items[0]).toMatchObject({
      ownerExtensionId: 'video.editor',
      workspaceId: WORKSPACE_ID,
      kind: 'media.ffmpeg'
    })
  })

  it('returns the opaque not-found policy for foreign reads and subscriptions', async () => {
    const { service } = await createService()
    const created = await service.createJob(jobInput())
    const foreign = { extensionId: 'other.extension', workspaceIds: [WORKSPACE_ID] }

    await expect(service.getOwned(foreign, created.snapshot.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(service.subscribe(foreign, created.snapshot.id)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rejects an invalid state transition without mutating the queued job', async () => {
    const { store, service } = await createService()
    const created = await service.createJob(jobInput())

    await expect(service.complete(created.snapshot.id, 0)).rejects.toMatchObject({
      code: 'invalid_transition'
    })
    expect(await store.get(created.snapshot.id)).toEqual(created.snapshot)
  })

  it('persists public-schema-valid snapshots and events', async () => {
    const { store, service } = await createService()
    const execution = controllableExecutor('media.ffmpeg')
    service.registerCoreExecutor(execution.executor)
    const created = await service.createAndDispatch(jobInput())
    execution.resolve({ schemaVersion: 1, generatedArtifacts: [] })
    await service.waitForIdle(created.snapshot.id)

    const snapshot = await store.get(created.snapshot.id)
    expect(() => JobSnapshotSchema.parse(snapshot)).not.toThrow()
    for (const event of (await store.replay(created.snapshot.id))?.events ?? []) {
      expect(() => JobEventSchema.parse(event)).not.toThrow()
    }
  })

  it('redacts credentials, media URLs, and local paths before durable failure storage', async () => {
    const { store, service } = await createService()
    const execution = controllableExecutor('media.ffmpeg')
    service.registerCoreExecutor(execution.executor)
    const created = await service.createAndDispatch(jobInput())
    const error = Object.assign(
      new Error('Authorization: Bearer abc123 /Users/alice/private.mov kun-media://lease-secret'),
      {
        code: 'oauth failure',
        category: 'internal',
        details: {
          apiKey: 'hidden-key',
          nested: { token: 'nested-secret' },
          path: '/home/alice/project/private.mov'
        }
      }
    )
    execution.reject(error)
    await service.waitForIdle(created.snapshot.id)

    const persisted = JSON.stringify({
      snapshot: await store.get(created.snapshot.id),
      replay: await store.replay(created.snapshot.id)
    })
    expect(persisted).not.toContain('abc123')
    expect(persisted).not.toContain('hidden-key')
    expect(persisted).not.toContain('nested-secret')
    expect(persisted).not.toContain('/Users/alice')
    expect(persisted).not.toContain('/home/alice')
    expect(persisted).not.toContain('lease-secret')
    expect(persisted).toContain('OAUTH_FAILURE')
    expect(persisted).toContain('<redacted>')
  })

  it('runs through the same durable API in a headless process with no renderer dependencies', async () => {
    const { store, service } = await createService()
    service.registerCoreExecutor({
      kind: 'media.ffmpeg',
      async execute() {
        return { schemaVersion: 1, data: { mode: 'headless' }, generatedArtifacts: [] }
      }
    })
    const created = await service.createAndDispatch(jobInput())
    await service.waitForIdle(created.snapshot.id)

    expect(await store.get(created.snapshot.id)).toMatchObject({
      state: 'completed',
      result: { data: { mode: 'headless' } }
    })
  })
})

async function createService(
  options: Omit<ConstructorParameters<typeof ExtensionJobService>[0], 'store'> = {}
): Promise<{ store: ExtensionJobStore; service: ExtensionJobService }> {
  const root = await mkdtemp(join(tmpdir(), 'kun-extension-job-service-'))
  roots.push(root)
  const store = new ExtensionJobStore({ path: join(root, 'jobs.json') })
  return { store, service: new ExtensionJobService({ store, ...options }) }
}

function jobInput(overrides: Partial<ExtensionJobCreateInput> = {}): ExtensionJobCreateInput {
  return {
    owner: {
      extensionId: 'video.editor',
      extensionVersion: '1.1.0',
      workspaceId: WORKSPACE_ID
    },
    workspaceRoot: WORKSPACE_ROOT,
    kind: 'media.ffmpeg',
    kindSchemaVersion: 1,
    initiatingOperation: 'media.startFfmpegJob',
    permissionsSnapshot: ['jobs.manage', 'media.process'],
    ...overrides
  }
}

function caller() {
  return { extensionId: 'video.editor', workspaceIds: [WORKSPACE_ID] }
}

async function persistRunning(
  store: ExtensionJobStore,
  jobId: string,
  cancelRequested = false
): Promise<void> {
  const timestamp = new Date().toISOString()
  await store.mutate(jobId, (record) => ({
    snapshot: {
      ...record.snapshot,
      state: 'running',
      executionAttempt: 1,
      startedAt: timestamp,
      updatedAt: timestamp,
      ...(cancelRequested ? { cancelRequestedAt: timestamp } : {})
    },
    ...(cancelRequested ? { cancellationReason: 'shutdown_request' } : {}),
    event: { type: cancelRequested ? 'cancellation-requested' : 'state' }
  }))
}

function controllableExecutor(kind: string): {
  executor: ExtensionJobCoreExecutor
  context(): Promise<ExtensionJobExecutionContext>
  resolve(value: ExtensionJobResult): void
  reject(error: unknown): void
} {
  let resolveContext!: (context: ExtensionJobExecutionContext) => void
  const contextPromise = new Promise<ExtensionJobExecutionContext>((resolve) => {
    resolveContext = resolve
  })
  let resolveExecution!: (value: ExtensionJobResult) => void
  let rejectExecution!: (error: unknown) => void
  const execution = new Promise<ExtensionJobResult>((resolve, reject) => {
    resolveExecution = resolve
    rejectExecution = reject
  })
  return {
    executor: {
      kind,
      async execute(_snapshot, context) {
        resolveContext(context)
        return execution
      }
    },
    context: () => contextPromise,
    resolve: resolveExecution,
    reject: rejectExecution
  }
}
