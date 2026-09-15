import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import {
  MemoryFeedbackConfig,
  MemoryFeedbackCheckpoint,
  MemoryFeedbackEvent,
  MemoryFeedbackProjection,
  type MemoryFeedbackEvent as MemoryFeedbackEventValue
} from '../contracts/memory-feedback.js'
import { FileMemoryFeedbackStore } from './memory-feedback-store.js'
import { FileMemoryStore } from './memory-store.js'

const roots: string[] = []
const feedbackConfig = MemoryFeedbackConfig.parse({ enabled: true })
const memoryConfig = MemoryCapabilityConfig.parse({ enabled: true })
const compactingConfig = {
  ...feedbackConfig,
  maxSegmentBytes: 1_000,
  maxTotalBytes: 8_000
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('FileMemoryFeedbackStore', () => {
  it('serializes concurrent appends and preserves replay identity across restart', async () => {
    const root = await temporaryRoot()
    const store = new FileMemoryFeedbackStore({ dataDir: root, config: feedbackConfig })
    const events = Array.from({ length: 12 }, (_, index) => retrieved(index))

    await Promise.all(events.map((event) => store.append(event)))
    expect(await store.append(events[0]!)).toBe('replayed')
    await expect(store.append({ ...events[0]!, occurredAt: '2026-09-15T01:00:00.000Z' }))
      .rejects.toThrow(/event id conflict/u)

    const restarted = new FileMemoryFeedbackStore({ dataDir: root, config: feedbackConfig })
    await restarted.ready()
    expect(await restarted.aggregate('mem_1')).toMatchObject({
      retrievalCount: 12,
      confirmationCount: 0,
      correctionCount: 0,
      lastRetrievedAt: '2026-09-15T00:00:11.000Z'
    })
    expect(await restarted.diagnostics()).toMatchObject({
      state: 'ready', eventCount: 12, aggregateCount: 1, duplicateCount: 0, malformedCount: 0
    })
  })

  it('rebuilds aggregates without rewriting canonical Memory records', async () => {
    const root = await temporaryRoot()
    const memories = new FileMemoryStore({ rootDir: join(root, 'memory'), config: memoryConfig })
    await memories.createWithId('mem_1', {
      content: 'Stable canonical memory content',
      scope: 'workspace',
      workspace: 'fixture-workspace-a'
    })
    const canonicalPath = join(root, 'memory', 'mem_1.json')
    const before = await readFile(canonicalPath, 'utf8')
    const store = new FileMemoryFeedbackStore({ dataDir: root, config: feedbackConfig })
    await store.append(retrieved(0))
    await store.append(MemoryFeedbackEvent.parse({
      schemaVersion: 1,
      id: 'evt_confirmed_1',
      kind: 'confirmed',
      memoryId: 'mem_1',
      occurredAt: '2026-09-15T00:01:00.000Z'
    }))
    const projectionPath = join(root, 'memory-feedback', 'aggregates.json')
    await rm(projectionPath)

    const restarted = new FileMemoryFeedbackStore({ dataDir: root, config: feedbackConfig })
    await restarted.ready()
    expect(await restarted.aggregate('mem_1')).toMatchObject({ retrievalCount: 1, confirmationCount: 1 })
    expect(await readFile(canonicalPath, 'utf8')).toBe(before)
    expect(MemoryFeedbackProjection.parse(JSON.parse(
      await readFile(projectionPath, 'utf8')
    )).eventCount).toBe(2)

    await writeFile(projectionPath, '{corrupt', 'utf8')
    const afterCorruption = new FileMemoryFeedbackStore({ dataDir: root, config: feedbackConfig })
    await afterCorruption.ready()
    expect(MemoryFeedbackProjection.parse(JSON.parse(await readFile(projectionPath, 'utf8'))).eventCount).toBe(2)
    expect(await readFile(canonicalPath, 'utf8')).toBe(before)
  })

  it('keeps a valid prefix and diagnoses a malformed final event', async () => {
    const root = await temporaryRoot()
    const store = new FileMemoryFeedbackStore({ dataDir: root, config: feedbackConfig })
    await store.append(retrieved(0))
    await appendFile(join(root, 'memory-feedback', 'events-000001.jsonl'), '{"schemaVersion":1')

    const restarted = new FileMemoryFeedbackStore({ dataDir: root, config: feedbackConfig })
    await restarted.ready()
    expect(await restarted.aggregate('mem_1')).toMatchObject({ retrievalCount: 1 })
    expect(await restarted.diagnostics()).toMatchObject({
      state: 'degraded', eventCount: 1, malformedCount: 1
    })
    await expect(restarted.append(retrieved(1))).rejects.toThrow(/must be repaired/u)
  })

  it('fails an interior corruption without disabling canonical Memory operations', async () => {
    const root = await temporaryRoot()
    const path = join(root, 'memory-feedback', 'events-000001.jsonl')
    await mkdir(join(root, 'memory-feedback'), { recursive: true })
    const first = JSON.stringify(retrieved(0))
    const second = JSON.stringify(retrieved(1))
    await writeFile(path, `${first}\n{broken}\n${second}\n`, { encoding: 'utf8', flag: 'w' })
    const store = new FileMemoryFeedbackStore({ dataDir: root, config: feedbackConfig })

    await expect(store.ready()).rejects.toThrow(/malformed interior/u)
    expect(await store.diagnostics()).toMatchObject({ state: 'degraded', projection: 'degraded' })

    const memories = new FileMemoryStore({ rootDir: join(root, 'memory'), config: memoryConfig })
    await memories.createWithId('mem_healthy', {
      content: 'Canonical memory remains available', scope: 'user'
    })
    expect((await memories.retrieve({ query: 'canonical memory available', limit: 3 }))[0]?.id)
      .toBe('mem_healthy')
  })

  it('reports bounded redacted diagnostics after a projection write failure', async () => {
    const root = await temporaryRoot()
    const store = new FileMemoryFeedbackStore({
      dataDir: root,
      config: feedbackConfig,
      writeProjection: async () => {
        throw new Error('EACCES C:\\Users\\Fixture\\secret.db password=fixture-value')
      }
    })
    await expect(store.append(retrieved(0))).rejects.toThrow(/EACCES/u)
    const diagnostics = await store.diagnostics()
    expect(diagnostics.state).toBe('degraded')
    expect(diagnostics.degradedReason).toContain('[local-path]/secret.db')
    expect(diagnostics.degradedReason).toContain('password=[redacted]')
    expect(diagnostics.degradedReason).not.toContain('Fixture')
    expect(diagnostics.degradedReason?.length).toBeLessThanOrEqual(512)
  })

  it('checkpoints bounded segments while retaining exact replay and explicit audit', async () => {
    const root = await temporaryRoot()
    const store = new FileMemoryFeedbackStore({
      dataDir: root,
      config: compactingConfig,
      nowIso: () => '2026-09-15T02:00:00.000Z'
    })
    await store.append(MemoryFeedbackEvent.parse({
      schemaVersion: 1,
      id: 'evt_confirmed_compacted',
      kind: 'confirmed',
      memoryId: 'mem_1',
      occurredAt: '2026-09-15T01:00:00.000Z'
    }))
    const events = Array.from({ length: 5 }, (_, index) => largeRetrieved(index))
    for (const event of events) await store.append(event)

    const checkpoint = MemoryFeedbackCheckpoint.parse(JSON.parse(
      await readFile(join(root, 'memory-feedback', 'checkpoint.json'), 'utf8')
    ))
    expect(checkpoint.explicitEvents).toMatchObject([{ id: 'evt_confirmed_compacted', kind: 'confirmed' }])
    expect(checkpoint.eventReceipts.some((receipt) => receipt.id === events[0]!.id)).toBe(true)
    expect((await readdir(join(root, 'memory-feedback'))).some((entry) => entry === 'events-000001.jsonl'))
      .toBe(false)

    const restarted = new FileMemoryFeedbackStore({ dataDir: root, config: compactingConfig })
    await restarted.ready()
    expect(await restarted.aggregate('mem_1')).toMatchObject({ retrievalCount: 5, confirmationCount: 1 })
    expect(await restarted.append(events[0]!)).toBe('replayed')
  })

  it('recovers equivalently when compaction stops before or after checkpoint commit', async () => {
    const beforeRoot = await temporaryRoot()
    const before = new FileMemoryFeedbackStore({
      dataDir: beforeRoot,
      config: compactingConfig,
      writeCheckpoint: async () => { throw new Error('before checkpoint commit') }
    })
    const beforeEvents = [largeRetrieved(0), largeRetrieved(1)]
    await before.append(beforeEvents[0]!)
    await expect(before.append(beforeEvents[1]!)).rejects.toThrow(/before checkpoint/u)
    const beforeRestart = new FileMemoryFeedbackStore({ dataDir: beforeRoot, config: compactingConfig })
    await beforeRestart.ready()
    expect((await beforeRestart.aggregate('mem_1'))?.retrievalCount).toBe(2)

    const afterRoot = await temporaryRoot()
    let interrupted = false
    const after = new FileMemoryFeedbackStore({
      dataDir: afterRoot,
      config: compactingConfig,
      afterCheckpointWrite: async () => {
        if (!interrupted) {
          interrupted = true
          throw new Error('after checkpoint commit')
        }
      }
    })
    const afterEvents = [largeRetrieved(0), largeRetrieved(1)]
    await after.append(afterEvents[0]!)
    await expect(after.append(afterEvents[1]!)).rejects.toThrow(/after checkpoint/u)
    const afterRestart = new FileMemoryFeedbackStore({ dataDir: afterRoot, config: compactingConfig })
    await afterRestart.ready()
    expect((await afterRestart.aggregate('mem_1'))?.retrievalCount).toBe(2)
    expect(await afterRestart.append(afterEvents[1]!)).toBe('replayed')
  })

  it('stops feedback growth at the configured hard capacity', async () => {
    const root = await temporaryRoot()
    const store = new FileMemoryFeedbackStore({
      dataDir: root,
      config: { ...compactingConfig, maxTotalBytes: 1_600 }
    })
    let rejected = false
    for (let index = 0; index < 12; index += 1) {
      try {
        await store.append(largeRetrieved(index))
      } catch (error) {
        expect(String(error)).toMatch(/storage capacity|checkpoint exceeds/u)
        rejected = true
        break
      }
    }
    expect(rejected).toBe(true)
    expect(await store.diagnostics()).toMatchObject({ state: 'degraded' })
  })
})

function retrieved(index: number): MemoryFeedbackEventValue {
  return MemoryFeedbackEvent.parse({
    schemaVersion: 1,
    id: `evt_retrieved_${index}`,
    kind: 'retrieved',
    memoryId: 'mem_1',
    occurredAt: `2026-09-15T00:00:${String(index).padStart(2, '0')}.000Z`,
    threadId: 'thread_1',
    turnId: `turn_${index}`
  })
}

function largeRetrieved(index: number): MemoryFeedbackEventValue {
  return MemoryFeedbackEvent.parse({
    ...retrieved(index),
    threadId: `thread_${'x'.repeat(220)}`,
    turnId: `turn_${index}_${'y'.repeat(210)}`
  })
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-memory-feedback-'))
  roots.push(root)
  return root
}
