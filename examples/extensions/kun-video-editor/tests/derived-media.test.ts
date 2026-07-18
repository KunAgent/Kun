import { describe, expect, it } from 'vitest'
import {
  DerivedMediaStore,
  DerivedWorkCoordinator,
  MemoryDerivedMediaPersistence,
  buildDerivedJobPlan,
  type DerivedMediaKind,
  type DerivedMediaRecord,
  type DerivedRequest,
  type SourceFingerprint
} from '../src/engine/index.js'

const OWNER = Object.freeze({
  extensionId: 'kun-examples.kun-video-editor',
  extensionVersion: '0.4.0',
  workspaceId: 'workspace-derived-tests',
  projectId: 'project-derived-tests',
  assetId: 'asset-derived-tests'
})

const SOURCE_A: SourceFingerprint = Object.freeze({
  algorithm: 'sha256',
  value: 'a'.repeat(64),
  sizeBytes: 1_000
})

const SOURCE_B: SourceFingerprint = Object.freeze({
  algorithm: 'sha256',
  value: 'b'.repeat(64),
  sizeBytes: 2_000
})

function request(
  kind: DerivedMediaKind,
  overrides: Partial<DerivedRequest> = {}
): DerivedRequest {
  return {
    kind,
    owner: OWNER,
    sourceFingerprint: SOURCE_A,
    normalizedParameters: { width: 640 },
    producer: { id: `kun.${kind}`, version: '1.0.0' },
    ...overrides
  }
}

async function ready(
  store: DerivedMediaStore,
  derivedRequest: DerivedRequest,
  bytes: number,
  handle = 'media_handle_ready_0001'
): Promise<DerivedMediaRecord> {
  const requested = await store.request(derivedRequest)
  await store.markRunning(requested.record.id, `job-${requested.record.id}`)
  return await store.complete(requested.record.id, { bytes, artifactHandleIds: [handle] })
}

describe('quota-managed derived media graph', () => {
  it('deduplicates work and emits monotonic record and status generations', async () => {
    const persistence = new MemoryDerivedMediaPersistence()
    const store = await DerivedMediaStore.open(persistence, { quotaBytes: 10_000 })
    const created = await store.request(request('waveform'))
    expect(created).toMatchObject({ deduplicated: false, backoffActive: false })
    expect(created.record).toMatchObject({ generation: 1, statusGeneration: 1, status: 'queued' })

    const running = await store.markRunning(created.record.id, 'job-waveform-0001')
    expect(running.generation).toBeGreaterThan(created.record.generation)
    expect(running.statusGeneration).toBe(running.generation)

    const progressed = await store.reportProgress(created.record.id, {
      completed: 1,
      total: 3,
      unit: 'phase',
      message: 'Decoded source'
    })
    expect(progressed.generation).toBeGreaterThan(running.generation)
    expect(progressed.statusGeneration).toBe(running.statusGeneration)

    const partial = await store.reportProgress(created.record.id, {
      completed: 2,
      total: 3,
      unit: 'phase',
      partialArtifactHandleIds: ['media_partial_waveform_0001']
    })
    expect(partial).toMatchObject({ status: 'partial', statusGeneration: partial.generation })

    const completed = await store.complete(created.record.id, {
      bytes: 500,
      artifactHandleIds: ['media_waveform_ready_0001']
    })
    expect(completed).toMatchObject({ status: 'ready', bytes: 500, statusGeneration: completed.generation })

    const duplicate = await store.request(request('waveform'))
    expect(duplicate).toMatchObject({ deduplicated: true, backoffActive: false })
    expect(duplicate.record.generation).toBeGreaterThan(completed.generation)
    expect(duplicate.record.statusGeneration).toBe(completed.statusGeneration)
    expect(persistence.snapshot?.generation).toBe(duplicate.record.generation)
  })

  it('invalidates dependency descendants and recovers interrupted work without inventing outputs', async () => {
    const persistence = new MemoryDerivedMediaPersistence()
    const store = await DerivedMediaStore.open(persistence)
    const source = await ready(store, request('thumbnail'), 200, 'media_thumbnail_ready_0001')
    const dependent = await ready(store, request('analysis', {
      sourceFingerprint: SOURCE_B,
      dependencies: [source.id],
      normalizedParameters: { model: 'local-analysis-v1' }
    }), 100, 'media_analysis_ready_0001')
    const invalidated = await store.invalidateSource(SOURCE_A)
    expect(invalidated.map(({ id }) => id).sort()).toEqual([dependent.id, source.id].sort())
    expect(invalidated.every(({ status, error }) => status === 'invalid' && error?.code === 'source_changed')).toBe(true)
    expect(new Set(invalidated.map(({ generation }) => generation)).size).toBe(2)

    const queued = await store.request(request('proxy', {
      sourceFingerprint: SOURCE_B,
      normalizedParameters: { width: 960 }
    }))
    await store.markRunning(queued.record.id, 'job-proxy-interrupted')
    const reopened = await DerivedMediaStore.open(persistence)
    const recovered = await reopened.recoverInterrupted()
    expect(recovered).toEqual([
      expect.objectContaining({
        id: queued.record.id,
        status: 'interrupted',
        artifactHandleIds: [],
        partialArtifactHandleIds: [],
        error: expect.objectContaining({ code: 'interrupted', retryable: true })
      })
    ])
  })

  it('scopes relink invalidation to the changed asset, clears artifacts, and persists descendants', async () => {
    const persistence = new MemoryDerivedMediaPersistence()
    const store = await DerivedMediaStore.open(persistence)
    const source = await ready(store, request('thumbnail'), 200, 'media_thumbnail_relink_0001')
    const dependent = await ready(store, request('analysis', {
      dependencies: [source.id],
      normalizedParameters: { model: 'dependent-local-v1' }
    }), 100, 'media_analysis_relink_0001')
    const peer = await ready(store, request('thumbnail', {
      owner: { ...OWNER, assetId: 'asset-peer' },
      normalizedParameters: { frame: 2 }
    }), 150, 'media_thumbnail_peer_0001')

    const invalidated = await store.invalidateOwnerSourceChange(OWNER, SOURCE_B)
    expect(invalidated.map(({ id }) => id).sort()).toEqual([source.id, dependent.id].sort())
    expect((await store.get(peer.id, false))?.status).toBe('ready')
    for (const record of invalidated) await store.discardArtifacts(record.id)

    const restarted = await DerivedMediaStore.open(persistence)
    expect(await restarted.get(source.id, false)).toMatchObject({
      status: 'invalid', bytes: 0, artifactHandleIds: [], error: { code: 'source_changed' }
    })
    expect(await restarted.get(dependent.id, false)).toMatchObject({
      status: 'invalid', bytes: 0, artifactHandleIds: [], error: { code: 'source_changed' }
    })
    expect(await restarted.get(peer.id, false)).toMatchObject({ status: 'ready', bytes: 150 })
  })

  it('uses LRU eviction under quota, preserves pinned results, and supports explicit cleanup', async () => {
    let tick = 0
    const evicted: string[] = []
    const persistence = new MemoryDerivedMediaPersistence()
    const store = await DerivedMediaStore.open(persistence, {
      quotaBytes: 500,
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
      onEvict: async (record) => { evicted.push(record.id) }
    })
    const first = await ready(store, request('thumbnail', {
      normalizedParameters: { frame: 1 }
    }), 300, 'media_thumbnail_first_0001')
    const second = await ready(store, request('thumbnail', {
      normalizedParameters: { frame: 2 }
    }), 300, 'media_thumbnail_second_0001')
    expect(evicted).toEqual([first.id])
    expect(await store.get(first.id, false)).toBeUndefined()
    expect((await store.usage()).usedBytes).toBe(300)

    await store.setPinned(second.id, true)
    await expect(ready(store, request('filmstrip'), 300, 'media_filmstrip_ready_0001'))
      .rejects.toThrowError(/quota is full/u)
    await store.setPinned(second.id, false)
    const removed = await store.cleanup({ includeReady: true })
    expect(removed.map(({ id }) => id)).toContain(second.id)
    expect((await store.usage()).usedBytes).toBe(0)
  })

  it('uses an explicit consumer touch to protect an opened result from LRU eviction', async () => {
    let nowMs = Date.parse('2026-01-01T00:00:00.000Z')
    const evicted: string[] = []
    const store = await DerivedMediaStore.open(new MemoryDerivedMediaPersistence(), {
      quotaBytes: 250,
      now: () => new Date(nowMs),
      onEvict: async ({ id }) => { evicted.push(id) }
    })
    const first = await ready(store, request('thumbnail', {
      normalizedParameters: { frame: 1 }
    }), 100, 'media_thumbnail_opened_0001')
    nowMs += 1_000
    const second = await ready(store, request('thumbnail', {
      normalizedParameters: { frame: 2 }
    }), 100, 'media_thumbnail_idle_00001')
    nowMs += 1_000
    await store.touch(first.id, new Date(nowMs).toISOString())
    nowMs += 1_000
    const third = await ready(store, request('thumbnail', {
      normalizedParameters: { frame: 3 }
    }), 100, 'media_thumbnail_new_000001')

    expect(evicted).toEqual([second.id])
    expect(await store.get(first.id, false)).toMatchObject({ status: 'ready' })
    expect(await store.get(second.id, false)).toBeUndefined()
    expect(await store.get(third.id, false)).toMatchObject({ status: 'ready' })
  })

  it('honors bounded retry backoff and explicit retry after the clock advances', async () => {
    let nowMs = Date.UTC(2026, 0, 1)
    const store = await DerivedMediaStore.open(new MemoryDerivedMediaPersistence(), {
      now: () => new Date(nowMs)
    })
    const queued = await store.request(request('embedding'))
    await store.fail(queued.record.id, { code: 'model_busy', message: 'Local model is busy', retryable: true })
    const backedOff = await store.request(request('embedding'))
    expect(backedOff).toMatchObject({ deduplicated: true, backoffActive: true })
    nowMs += 2_000
    const retried = await store.request(request('embedding'))
    expect(retried).toMatchObject({ deduplicated: false, backoffActive: false })
    expect(retried.record).toMatchObject({ status: 'queued', attempt: 2, error: undefined })
  })
})

describe('brokered and progressive derived work', () => {
  it('builds path-free broker plans for every supported waveform/thumbnail/filmstrip/proxy/proof/preview kind', async () => {
    const store = await DerivedMediaStore.open(new MemoryDerivedMediaPersistence())
    for (const kind of ['waveform', 'thumbnail', 'filmstrip', 'proxy', 'proof', 'preview'] as const) {
      const record = (await store.request(request(kind, {
        normalizedParameters: { width: 800, kind }
      }))).record
      const plan = buildDerivedJobPlan({
        record,
        sourceHandleId: 'media_source_handle_0001',
        outputHandleId: `media_output_${kind}_0001`,
        pinnedRevision: 7,
        seekUs: 1_000_000,
        durationUs: 5_000_000,
        width: 800,
        height: 450
      })
      expect(plan).toMatchObject({
        kind,
        inputs: { source: 'media_source_handle_0001' },
        outputs: { derived: `media_output_${kind}_0001` },
        metadata: {
          derivedId: record.id,
          derivedKind: kind,
          sourceFingerprint: SOURCE_A.value,
          projectId: OWNER.projectId,
          assetId: OWNER.assetId,
          pinnedRevision: 7
        },
        scheduling: { priority: record.priority, maxAttempts: 3, retryBaseDelayMs: 250 }
      })
      expect(plan.arguments).toContain('{{input:source}}')
      expect(plan.arguments).toContain('{{output:derived}}')
      expect(JSON.stringify(plan)).not.toMatch(/\/(?:Users|tmp|private)\//u)
      expect(plan.phases.at(-1)).toEqual(expect.objectContaining({ fraction: 1, partial: false }))
    }
  })

  it('prioritizes export work, pauses background work, deduplicates in-flight requests, and cancels cleanly', async () => {
    const store = await DerivedMediaStore.open(new MemoryDerivedMediaPersistence())
    const coordinator = new DerivedWorkCoordinator(store, 1)
    coordinator.setExportActive(true)
    const order: string[] = []
    const backgroundRequest = request('waveform', { priority: 'background' })
    const background = await coordinator.request(backgroundRequest, async (_record, context) => {
      order.push('background')
      await context.report({
        completed: 1,
        total: 2,
        unit: 'phase',
        partialArtifactHandleIds: ['media_waveform_partial_0001']
      })
      return { bytes: 10, artifactHandleIds: ['media_waveform_ready_0001'] }
    })
    const duplicate = await coordinator.request(backgroundRequest, async () => {
      throw new Error('deduplicated runner must not execute')
    })
    expect(duplicate.deduplicated).toBe(true)
    expect(duplicate.completion).toBe(background.completion)

    const exporting = await coordinator.request(request('proof', {
      priority: 'export',
      normalizedParameters: { frame: 12 }
    }), async () => {
      order.push('export')
      return { bytes: 20, artifactHandleIds: ['media_proof_ready_0001'] }
    })
    expect((await exporting.completion).status).toBe('ready')
    expect(order).toEqual(['export'])
    coordinator.setExportActive(false)
    expect((await background.completion).status).toBe('ready')
    expect(order).toEqual(['export', 'background'])

    const cancelling = await coordinator.request(request('preview', {
      normalizedParameters: { durationUs: 2_000_000 }
    }), async (_record, context) => {
      await new Promise<void>((_resolve, reject) => {
        context.signal.addEventListener('abort', () => {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
      return { bytes: 1, artifactHandleIds: ['media_never_created_0001'] }
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const cancelled = await coordinator.cancel(cancelling.record.id)
    expect(cancelled.status).toBe('cancelled')
    expect((await cancelling.completion).status).toBe('cancelled')
  })
})
