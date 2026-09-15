import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  MEMORY_FEEDBACK_DEFAULT_SEGMENT_BYTES,
  MEMORY_FEEDBACK_DEFAULT_TOTAL_BYTES,
  MEMORY_FEEDBACK_MAX_ID_CHARS,
  MemoryConfirmRequest,
  MemoryConfirmResult,
  MemoryCorrectRequest,
  MemoryCorrectResult,
  MemoryFeedbackAggregate,
  MemoryFeedbackConfig,
  MemoryFeedbackDiagnostics,
  MemoryFeedbackEvent,
  MemoryFeedbackOperationError,
  classifyMemoryFeedbackReplay
} from '../contracts/memory-feedback.js'
import {
  DEFAULT_MEMORY_FEEDBACK_FIXTURE_PATHS,
  loadMemoryFeedbackFixtures,
  memoryFeedbackFixtureSha256
} from './memory-feedback-fixtures.js'

const RETRIEVED = MemoryFeedbackEvent.parse({
  schemaVersion: 1,
  id: 'evt_retrieved_1',
  kind: 'retrieved',
  memoryId: 'mem_1',
  occurredAt: '2026-09-15T00:00:00.000Z',
  threadId: 'thread_1',
  turnId: 'turn_1'
})

describe('memory feedback contracts', () => {
  it('keeps event payloads strict, bounded, and free of private fields', () => {
    expect(MemoryFeedbackEvent.parse(RETRIEVED)).toEqual(RETRIEVED)
    for (const forbidden of ['query', 'content', 'modelOutput', 'path', 'apiKey', 'password']) {
      expect(MemoryFeedbackEvent.safeParse({ ...RETRIEVED, [forbidden]: 'private' }).success).toBe(false)
    }
    expect(MemoryFeedbackEvent.safeParse({ ...RETRIEVED, id: '../event' }).success).toBe(false)
    expect(MemoryFeedbackEvent.safeParse({
      ...RETRIEVED,
      id: 'x'.repeat(MEMORY_FEEDBACK_MAX_ID_CHARS + 1)
    }).success).toBe(false)
  })

  it('classifies idempotent and conflicting event replays', () => {
    expect(classifyMemoryFeedbackReplay(RETRIEVED, { ...RETRIEVED })).toBe('replay')
    expect(classifyMemoryFeedbackReplay(RETRIEVED, { ...RETRIEVED, occurredAt: '2026-09-15T00:00:01.000Z' }))
      .toBe('conflict')
    expect(classifyMemoryFeedbackReplay(RETRIEVED, { ...RETRIEVED, id: 'evt_retrieved_2' })).toBe('new')
  })

  it('defaults collection off and validates bounded storage settings', () => {
    expect(MemoryFeedbackConfig.parse({})).toEqual({
      enabled: false,
      maxSegmentBytes: MEMORY_FEEDBACK_DEFAULT_SEGMENT_BYTES,
      maxTotalBytes: MEMORY_FEEDBACK_DEFAULT_TOTAL_BYTES
    })
    expect(MemoryFeedbackConfig.safeParse({
      maxSegmentBytes: 128 * 1024,
      maxTotalBytes: 64 * 1024
    }).success).toBe(false)
  })

  it('validates rebuildable aggregate and bounded diagnostic shapes', () => {
    expect(MemoryFeedbackAggregate.parse({
      schemaVersion: 1,
      memoryId: 'mem_1',
      retrievalCount: 3,
      confirmationCount: 1,
      correctionCount: 0,
      lastRetrievedAt: '2026-09-15T00:00:00.000Z'
    }).retrievalCount).toBe(3)
    expect(MemoryFeedbackDiagnostics.safeParse({
      enabled: true,
      state: 'degraded',
      projection: 'degraded',
      eventCount: 1,
      aggregateCount: 1,
      duplicateCount: 0,
      malformedCount: 1,
      degradedReason: 'x'.repeat(513)
    }).success).toBe(false)
  })

  it('accepts stable confirm/correct operations and rejects scope overrides', () => {
    const confirm = MemoryConfirmRequest.parse({ operationId: 'confirm_1', memoryId: 'mem_1' })
    expect(confirm.access).toEqual({})
    expect(MemoryConfirmRequest.parse(confirm)).toEqual(confirm)
    expect(MemoryConfirmRequest.safeParse({ ...confirm, scope: 'user' }).success).toBe(false)
    expect(MemoryConfirmResult.parse({
      memoryId: 'mem_1',
      eventId: 'confirm_1',
      confirmedAt: '2026-09-15T00:00:00.000Z',
      replayed: true
    }).replayed).toBe(true)

    const correction = MemoryCorrectRequest.parse({
      operationId: 'correct_1',
      memoryId: 'mem_1',
      access: { workspace: 'fixture-workspace-a' },
      replacement: { content: 'Corrected fixture content.', confidence: 1 }
    })
    expect(MemoryCorrectRequest.parse(correction)).toEqual(correction)
    expect(MemoryCorrectResult.parse({
      previousMemoryId: 'mem_1',
      replacementMemoryId: 'mem_2',
      eventId: 'correct_1',
      correctedAt: '2026-09-15T00:00:00.000Z',
      replayed: false
    }).replacementMemoryId).toBe('mem_2')
    expect(MemoryCorrectRequest.safeParse({
      ...correction,
      replacement: { ...correction.replacement, scope: 'project' }
    }).success).toBe(false)
    expect(MemoryCorrectRequest.safeParse({
      ...correction,
      replacement: {
        ...correction.replacement,
        validFrom: '2026-09-16T00:00:00.000Z',
        validTo: '2026-09-15T00:00:00.000Z'
      }
    }).success).toBe(false)
  })

  it('keeps operation errors bounded and enumerable', () => {
    for (const code of ['unauthorized', 'inactive', 'cross-scope', 'id-conflict'] as const) {
      expect(MemoryFeedbackOperationError.parse({ code, message: 'bounded failure' }).code).toBe(code)
    }
    expect(MemoryFeedbackOperationError.safeParse({ code: 'unknown', message: 'failure' }).success).toBe(false)
  })
})

describe('anonymous memory feedback fixtures', () => {
  it('validates frozen references, lifecycle controls, and stable checksums', async () => {
    const dataset = await loadMemoryFeedbackFixtures()
    const byId = new Map(dataset.records.map((record) => [record.id, record]))
    const fixtureText = await readFile(DEFAULT_MEMORY_FEEDBACK_FIXTURE_PATHS.fixture, 'utf8')

    expect(dataset.fixtureSha256).toBe('a1268bfbfaa364c5b5d920a100b54edeedd5dbda67c0f525ae340ca5d436f21a')
    const crlfFixtureText = fixtureText.replace(/\r\n?/gu, '\n').replace(/\n/gu, '\r\n')
    expect(memoryFeedbackFixtureSha256(crlfFixtureText)).toBe(dataset.fixtureSha256)
    expect(dataset.events.filter((event) => event.kind === 'retrieved')).toHaveLength(5)
    expect(dataset.events.some((event) => event.kind === 'confirmed')).toBe(true)
    expect(dataset.events.some((event) => event.kind === 'corrected')).toBe(true)
    expect(byId.get('mem_feedback_disabled')?.disabledAt).toBeDefined()
    expect(byId.get('mem_feedback_replacement')?.supersedes).toBe('mem_feedback_old')
    expect(byId.get('mem_feedback_cross_scope')?.workspace).toBe('fixture-workspace-b')
  })
})
