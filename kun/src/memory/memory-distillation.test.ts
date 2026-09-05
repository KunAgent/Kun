import { describe, expect, it } from 'vitest'
import { MemoryRecord, type MemorySourceEvidence } from '../contracts/memory.js'
import {
  MEMORY_CANDIDATE_MAX_CONTENT_CHARS,
  MemoryCandidate,
  MemoryCandidateAssessment,
  MemoryCandidateDraft
} from '../contracts/memory-distillation.js'
import {
  evaluateMemoryDistillation,
  formatMemoryDistillationEvaluation
} from './memory-distillation-evaluation.js'
import { MEMORY_DISTILLATION_FIXTURES } from './memory-distillation-fixtures.js'
import {
  decideMemoryCandidate,
  memoryCandidateFingerprint
} from './memory-distillation.js'

const NOW = Date.parse('2026-09-03T12:00:00.000Z')

describe('memory distillation candidate contract', () => {
  it('normalizes bounded candidate fields deterministically', () => {
    const draft = MemoryCandidateDraft.parse({
      ...candidateDraftInput(),
      tags: [' Workspace ', 'workspace', 'PACKAGE-MANAGER'],
      sourceIds: [' source-b ', 'source-a']
    })
    const candidate = MemoryCandidate.parse({
      content: '  Use\r\n  ＰＮＰＭ   for installs.  ',
      type: 'decision',
      confidence: 0.9,
      importance: 0.8,
      observedAt: '2026-09-03T00:00:00.000Z',
      tags: [' Workspace ', 'workspace', 'PACKAGE-MANAGER'],
      sources: [
        source('source-b', ' second evidence '),
        source('source-a', ' first\r\nevidence ')
      ]
    })

    expect(candidate).toEqual({
      content: 'Use PNPM for installs.',
      type: 'decision',
      confidence: 0.9,
      importance: 0.8,
      observedAt: '2026-09-03T00:00:00.000Z',
      tags: ['package-manager', 'workspace'],
      sources: [
        source('source-a', 'first\nevidence'),
        source('source-b', 'second evidence')
      ]
    })
    expect(draft.tags).toEqual(['package-manager', 'workspace'])
    expect(draft.sourceIds).toEqual(['source-a', 'source-b'])
  })

  it('rejects unknown fields and every strict boundary violation', () => {
    const valid = candidateDraftInput()
    const invalid = [
      { ...valid, scope: 'user' },
      { ...valid, authority: 'reference' },
      { ...valid, observedAt: '2026-09-03T00:00:00.000Z' },
      { ...valid, sources: [source('source-candidate', 'evidence')] },
      { ...valid, content: 'x'.repeat(MEMORY_CANDIDATE_MAX_CONTENT_CHARS + 1) },
      { ...valid, confidence: -0.1 },
      { ...valid, importance: 1.1 },
      { ...valid, sourceIds: [] },
      { ...valid, sourceIds: Array.from({ length: 9 }, (_, index) => `source-${index}`) },
      { ...valid, sourceIds: ['same', ' same '] },
      { ...valid, tags: ['x'.repeat(65)] },
      { ...valid, tags: Array.from({ length: 17 }, (_, index) => `tag-${index}`) }
    ]

    for (const value of invalid) expect(MemoryCandidateDraft.safeParse(value).success).toBe(false)
  })

  it('rejects duplicate comparison targets after normalization', () => {
    expect(MemoryCandidateAssessment.safeParse({
      candidate: candidateDraftInput(),
      durability: 'durable',
      comparisons: [
        { memoryId: 'mem-a', relation: 'update' },
        { memoryId: ' mem-a ', relation: 'supersede' }
      ]
    }).success).toBe(false)
  })
})

describe('pure memory distillation decisions', () => {
  for (const fixture of MEMORY_DISTILLATION_FIXTURES) {
    it(`decides anonymous fixture: ${fixture.id}`, () => {
      const decision = decideMemoryCandidate(
        fixture.assessment,
        fixture.existing,
        fixture.evidence,
        NOW
      )
      expect(decision.action).toBe(fixture.expected.action)
      if (decision.action === 'skip') expect(decision.reason).toBe(fixture.expected.reason)
      else if (decision.action !== 'create') expect(decision.memoryId).toBe(fixture.expected.memoryId)
    })
  }

  it('gives sensitive detection precedence over confidence and durability skips', () => {
    const decision = decideMemoryCandidate({
      candidate: {
        ...candidateDraftInput(),
        content: 'password = example-secret-value',
        confidence: 0.1
      },
      durability: 'transient',
      comparisons: []
    }, [], evidenceInput(), NOW)

    expect(decision).toEqual({ action: 'skip', reason: 'sensitive' })
  })

  it('detects sensitive source evidence even when candidate content is clean', () => {
    const decision = decideMemoryCandidate({
      candidate: {
        ...candidateDraftInput(),
        sourceIds: ['source-sensitive']
      },
      durability: 'durable',
      comparisons: []
    }, [], evidenceInput([
      source('source-sensitive', 'Bearer abcdefghijklmnopqrstuvwxyz')
    ]), NOW)

    expect(decision).toEqual({ action: 'skip', reason: 'sensitive' })
  })

  it('detects quoted passwords and basic authorization credentials', () => {
    const sensitiveValues = [
      'password = "correct horse battery staple"',
      "密码为'这是 一段 带空格的口令'",
      'Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=='
    ]

    for (const content of sensitiveValues) {
      const decision = decideMemoryCandidate({
        candidate: candidateDraftInput({ content }),
        durability: 'durable',
        comparisons: []
      }, [], evidenceInput(), NOW)
      expect(decision).toEqual({ action: 'skip', reason: 'sensitive' })
    }
  })

  it('recognizes common response-scoped transient wording', () => {
    const transientValues = [
      'For this response only, summarize the first section.',
      'For now, summarize the first section.',
      '本次回答只总结第一节。'
    ]

    for (const content of transientValues) {
      const decision = decideMemoryCandidate({
        candidate: candidateDraftInput({ content }),
        durability: 'durable',
        comparisons: []
      }, [], evidenceInput(), NOW)
      expect(decision).toEqual({ action: 'skip', reason: 'non-durable' })
    }
  })

  it('binds provenance from host evidence and rejects untrusted source ids', () => {
    const hostSource = {
      ...source('source-host', 'Host-owned evidence.'),
      kind: 'inference' as const,
      trust: 'inferred' as const
    }
    const decision = decideMemoryCandidate({
      candidate: candidateDraftInput({ sourceIds: [hostSource.id] }),
      durability: 'durable',
      comparisons: []
    }, [], evidenceInput([hostSource]), NOW)

    expect(decision).toMatchObject({
      action: 'create',
      candidate: {
        observedAt: '2026-09-03T00:00:00.000Z',
        sources: [hostSource]
      }
    })
    expect(() => decideMemoryCandidate({
      candidate: candidateDraftInput({ sourceIds: ['source-forged'] }),
      durability: 'durable',
      comparisons: []
    }, [], evidenceInput([hostSource]), NOW)).toThrow(/source is not authorized/i)
  })

  it('rejects invalid or future host observation times', () => {
    const assessment = {
      candidate: candidateDraftInput(),
      durability: 'durable' as const,
      comparisons: []
    }

    expect(() => decideMemoryCandidate(
      assessment,
      [],
      evidenceInput(undefined, '9999-01-01T00:00:00.000Z'),
      NOW
    )).toThrow(/future/i)
    expect(() => decideMemoryCandidate(
      assessment,
      [],
      evidenceInput(),
      Number.NaN
    )).toThrow(/finite/i)
  })

  it('honors an explicit transient assessment without relying on wording', () => {
    const decision = decideMemoryCandidate({
      candidate: candidateDraftInput(),
      durability: 'transient',
      comparisons: []
    }, [], evidenceInput(), NOW)

    expect(decision).toEqual({ action: 'skip', reason: 'non-durable' })
  })

  it('honors a validated duplicate relation without creating another record', () => {
    const existing = existingRecord('mem-related', 'Equivalent wording from an earlier turn.')
    const decision = decideMemoryCandidate({
      candidate: candidateDraftInput(),
      durability: 'durable',
      comparisons: [{ memoryId: existing.id, relation: 'duplicate' }]
    }, [existing], evidenceInput(), NOW)

    expect(decision).toEqual({ action: 'skip', reason: 'duplicate' })
  })

  it('does not treat benign credential policy discussion as a secret', () => {
    const decision = decideMemoryCandidate({
      candidate: {
        ...candidateDraftInput(),
        content: 'Never store API keys or passwords in Memory.'
      },
      durability: 'durable',
      comparisons: []
    }, [], evidenceInput(), NOW)

    expect(decision.action).toBe('create')
  })

  it('fails closed when a relation targets a missing or inactive record', () => {
    const active = existingRecord('mem-active')
    const disabled = MemoryRecord.parse({
      ...existingRecord('mem-disabled'),
      disabledAt: '2026-09-03T01:00:00.000Z'
    })
    const assessment = {
      candidate: candidateDraftInput(),
      durability: 'durable' as const,
      comparisons: [{ memoryId: 'mem-missing', relation: 'update' as const }]
    }

    expect(() => decideMemoryCandidate(
      assessment,
      [active],
      evidenceInput(),
      NOW
    )).toThrow(/authorized active memory/i)
    expect(() => decideMemoryCandidate({
      ...assessment,
      comparisons: [{ memoryId: disabled.id, relation: 'update' as const }]
    }, [disabled], evidenceInput(), NOW)).toThrow(/authorized active memory/i)
  })

  it('uses stable relation priority and ids regardless of input order', () => {
    const memA = existingRecord('mem-a', 'Existing A')
    const memB = existingRecord('mem-b', 'Existing B')
    const assessment = {
      candidate: candidateDraftInput(),
      durability: 'durable' as const,
      comparisons: [
        { memoryId: memB.id, relation: 'update' as const },
        { memoryId: memA.id, relation: 'supersede' as const }
      ]
    }

    const forward = decideMemoryCandidate(assessment, [memB, memA], evidenceInput(), NOW)
    const reverse = decideMemoryCandidate({
      ...assessment,
      comparisons: [...assessment.comparisons].reverse()
    }, [memA, memB], evidenceInput(), NOW)

    expect(forward).toEqual(reverse)
    expect(forward).toMatchObject({ action: 'supersede', memoryId: 'mem-a' })
  })

  it('preserves complete normalized sources for update and supersede proposals', () => {
    for (const relation of ['update', 'supersede'] as const) {
      const existing = existingRecord(`mem-${relation}`)
      const decision = decideMemoryCandidate({
        candidate: candidateDraftInput(),
        durability: 'durable',
        comparisons: [{ memoryId: existing.id, relation }]
      }, [existing], evidenceInput(), NOW)

      expect(decision).toMatchObject({ action: relation, memoryId: existing.id })
      if (decision.action !== 'skip') {
        expect(decision.candidate.sources).toEqual(evidenceInput().sources)
      }
    }
  })

  it('fingerprints normalized candidates rather than input ordering', () => {
    const left = candidateValue({
      tags: ['Workspace', 'Testing'],
      sources: [source('source-b', 'two'), source('source-a', 'one')]
    })
    const right = candidateValue({
      tags: ['testing', 'workspace'],
      sources: [source('source-a', 'one'), source('source-b', 'two')]
    })

    expect(memoryCandidateFingerprint(left)).toBe(memoryCandidateFingerprint(right))
    expect(memoryCandidateFingerprint(left)).not.toBe(memoryCandidateFingerprint({
      ...right,
      content: 'A different durable fact.'
    }))
  })
})

describe('anonymous memory distillation evaluation', () => {
  it('reports deterministic safe fixture metrics without production data', () => {
    const first = evaluateMemoryDistillation(MEMORY_DISTILLATION_FIXTURES, NOW)
    const second = evaluateMemoryDistillation(MEMORY_DISTILLATION_FIXTURES, NOW)

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      decisionAccuracy: 1,
      unsafeNonSkipCount: 0,
      duplicateCreateCount: 0,
      sourceCompleteness: 1,
      caseCount: MEMORY_DISTILLATION_FIXTURES.length
    })
    expect(formatMemoryDistillationEvaluation(first)).toContain('checked-in-anonymous-fixtures')
  })

  it('rejects an empty fixture set instead of reporting perfect accuracy', () => {
    expect(() => evaluateMemoryDistillation([], NOW)).toThrow(/requires fixtures/i)
  })
})

function candidateDraftInput(overrides: Record<string, unknown> = {}) {
  return {
    content: 'Use the workspace test command before committing.',
    type: 'decision' as const,
    confidence: 0.9,
    importance: 0.8,
    tags: ['testing', 'workspace'],
    sourceIds: ['source-candidate'],
    ...overrides
  }
}

function candidateValue(overrides: Record<string, unknown> = {}) {
  return {
    content: 'Use the workspace test command before committing.',
    type: 'decision' as const,
    confidence: 0.9,
    importance: 0.8,
    observedAt: '2026-09-03T00:00:00.000Z',
    tags: ['testing', 'workspace'],
    sources: [source('source-candidate', 'Use the workspace test command before committing.')],
    ...overrides
  }
}

function evidenceInput(
  sources: MemorySourceEvidence[] = [
    source('source-candidate', 'Use the workspace test command before committing.')
  ],
  observedAt = '2026-09-03T00:00:00.000Z'
) {
  return { observedAt, sources }
}

function source(id: string, excerpt: string) {
  return {
    id,
    kind: 'user' as const,
    threadId: 'thread-anonymous',
    turnId: 'turn-anonymous',
    excerpt,
    trust: 'explicit-user' as const
  }
}

function existingRecord(id: string, content = 'An existing durable fact.') {
  return MemoryRecord.parse({
    id,
    content,
    scope: 'workspace',
    workspace: 'C:/anonymous/workspace',
    tags: ['fixture'],
    confidence: 0.9,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    schemaVersion: 2,
    type: 'fact',
    authority: 'reference',
    importance: 0.7,
    observedAt: '2026-09-01T00:00:00.000Z',
    sources: [source(`source-${id}`, content)]
  })
}
