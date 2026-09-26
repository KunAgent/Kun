import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import { MemoryFeedbackCheckpoint, MemoryFeedbackConfig, MemoryFeedbackEvent } from '../contracts/memory-feedback.js'
import { FileMemoryStore } from './memory-store.js'
import { MemoryFeedbackService } from './memory-feedback-service.js'
import { FileMemoryFeedbackStore } from './memory-feedback-store.js'
import type { MemoryFeedbackTiebreakerFixture } from './memory-feedback-tiebreaker-contracts.js'
import { evaluateMemoryFeedbackTiebreakerCase } from './memory-feedback-tiebreaker-evaluator.js'

const roots: string[] = []
const NOW = '2026-09-16T00:00:00.000Z'
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it('preserves replacement evidence through real correction, replay, compaction and restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-tiebreaker-correction-'))
  roots.push(root)
  // Small internal test segment forces compaction without thousands of writes.
  const config = { ...MemoryFeedbackConfig.parse({ enabled: true }), maxSegmentBytes: 1000 }
  const memories = new FileMemoryStore({
    rootDir: join(root, 'memory'), config: MemoryCapabilityConfig.parse({ enabled: true }), nowIso: () => NOW
  })
  const feedback = new FileMemoryFeedbackStore({ dataDir: root, config, nowIso: () => NOW })
  const service = new MemoryFeedbackService({
    dataDir: root, memoryStore: memories, feedbackStore: feedback, config, nowIso: () => NOW
  })
  await memories.createWithId('mem_old', {
    content: 'Use twenty second batch timeout', scope: 'workspace', workspace: 'fixture-workspace-a'
  })
  const request = {
    operationId: 'fixture-correction', memoryId: 'mem_old', access: { workspace: 'fixture-workspace-a' },
    replacement: { content: 'Use forty five second batch timeout' }
  }
  const result = await service.correct(request)
  expect((await service.correct(request)).replayed).toBe(true)
  const event = MemoryFeedbackEvent.parse(await feedback.event(result.eventId))
  expect(event).toMatchObject({ kind: 'corrected', memoryId: 'mem_old', replacementMemoryId: result.replacementMemoryId })
  expect(await feedback.aggregate('mem_old')).toMatchObject({ correctionCount: 1 })
  expect(await feedback.aggregate(result.replacementMemoryId)).toBeUndefined()

  const records = await memories.list({ workspace: request.access.workspace, includeDeleted: true })
  const item: MemoryFeedbackTiebreakerFixture['cases'][number] = {
    id: 'case_dev_correction_replay', partition: 'development', stratum: 'corrected-replacement-near-tie',
    query: 'batch timeout', workspace: request.access.workspace, candidateIds: records.map((record) => record.id),
    expectedIds: [result.replacementMemoryId], forbiddenIds: ['mem_old'], preferredPairs: [],
    rationale: 'Integration-only replay probe, not frozen decision data.', limit: 1, promptCharacterBudget: 512
  }
  const fixture: MemoryFeedbackTiebreakerFixture = {
    schemaVersion: 1, datasetId: 'kun-memory-feedback-tiebreaker-anonymous-v1', status: 'frozen',
    evaluationNow: NOW, records, events: [event], cases: [item]
  }
  const before = evaluateMemoryFeedbackTiebreakerCase({ fixture, item, signalRule: 'confirmation-correction', maximumGap: 0 })
  expect(before.selectedIds).toEqual([result.replacementMemoryId])
  expect(before.rankings).toHaveLength(1)
  expect(before.rankings[0]).toMatchObject({ memoryId: result.replacementMemoryId, correctionCount: 1 })

  for (let index = 0; index < 8; index += 1) {
    await feedback.append(MemoryFeedbackEvent.parse({
      schemaVersion: 1, id: `fixture-retrieved-${index}`, kind: 'retrieved', memoryId: 'mem_old',
      occurredAt: NOW, threadId: 'fixture-thread', turnId: `fixture-turn-${index}`
    }))
  }
  const checkpoint = MemoryFeedbackCheckpoint.parse(JSON.parse(
    await readFile(join(root, 'memory-feedback', 'checkpoint.json'), 'utf8')
  ))
  expect(checkpoint.explicitEvents).toContainEqual(event)
  const restarted = new FileMemoryFeedbackStore({ dataDir: root, config })
  await restarted.ready()
  expect(await restarted.append(event)).toBe('replayed')
  expect(await restarted.aggregate('mem_old')).toMatchObject({ correctionCount: 1 })
  expect(await restarted.aggregate(result.replacementMemoryId)).toBeUndefined()
  const replayed = MemoryFeedbackEvent.parse(await restarted.event(result.eventId))
  const after = evaluateMemoryFeedbackTiebreakerCase({
    fixture: { ...fixture, events: [replayed] }, item, signalRule: 'confirmation-correction', maximumGap: 0
  })
  expect(after).toEqual(before)
})
