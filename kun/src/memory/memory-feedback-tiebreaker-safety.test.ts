import { describe, expect, it } from 'vitest'
import { MemoryRecord } from '../contracts/memory.js'
import { loadMemoryFeedbackTiebreakerDataset } from './memory-feedback-tiebreaker-fixture-loader.js'
import { evaluateMemoryFeedbackTiebreakerCase } from './memory-feedback-tiebreaker-evaluator.js'

describe('memory feedback tiebreaker safety boundaries', () => {
  it('never admits out-of-scope, inactive, or superseded hard negatives', async () => {
    const { fixture } = await loadMemoryFeedbackTiebreakerDataset()
    for (const stratum of ['scope-safety', 'lifecycle-safety'] as const) {
      const item = fixture.cases.find((candidate) =>
        candidate.partition === 'development' && candidate.stratum === stratum)!
      const result = evaluateMemoryFeedbackTiebreakerCase({
        fixture,
        item,
        signalRule: 'confirmation-correction',
        maximumGap: 1
      })

      expect(result.rankings.every((ranking) => !item.forbiddenIds.includes(ranking.memoryId))).toBe(true)
      expect(result.forbiddenSelectedIds).toEqual([])
      expect(result.rankings.every((ranking) =>
        fixture.records.find((record) => record.id === ranking.memoryId)?.authority === 'reference')).toBe(true)
    }

    const corrected = fixture.cases.find((candidate) =>
      candidate.partition === 'development' && candidate.stratum === 'corrected-replacement-near-tie')!
    const correctedResult = evaluateMemoryFeedbackTiebreakerCase({
      fixture,
      item: corrected,
      signalRule: 'confirmation-correction',
      maximumGap: 1
    })
    expect(correctedResult.rankings.map((ranking) => ranking.memoryId)).not.toContain('mem_corr_old')
  })

  it.each([
    ['disabled', { disabledAt: '2026-09-01T00:00:00.000Z' }],
    ['deleted', { deletedAt: '2026-09-01T00:00:00.000Z' }],
    ['expired', { expiresAt: '2026-09-01T00:00:00.000Z' }],
    ['future-valid', { validFrom: '2026-10-01T00:00:00.000Z' }],
    ['superseded', { supersededAt: '2026-09-01T00:00:00.000Z' }]
  ])('excludes a %s record before feedback ordering', async (_label, lifecycle) => {
    const { fixture } = await loadMemoryFeedbackTiebreakerDataset()
    const item = fixture.cases.find((candidate) =>
      candidate.partition === 'development' && candidate.stratum === 'lifecycle-safety')!
    const records = fixture.records.map((record) => record.id === 'mem_disabled_timeline'
      ? withLifecycle(record, lifecycle)
      : record)
    const result = evaluateMemoryFeedbackTiebreakerCase({
      fixture: { ...fixture, records },
      item,
      signalRule: 'confirmation-correction',
      maximumGap: 1
    })

    expect(result.rankings.map((ranking) => ranking.memoryId)).not.toContain('mem_disabled_timeline')
    expect(result.selectedIds).toEqual(['mem_active_timeline'])
  })

  it('preserves positive-relevance abstention despite explicit feedback', async () => {
    const { fixture } = await loadMemoryFeedbackTiebreakerDataset()
    const cases = fixture.cases.filter((candidate) =>
      candidate.partition === 'development' && candidate.stratum === 'no-result-control')

    for (const item of cases) {
      for (const signalRule of ['confirmation', 'confirmation-correction'] as const) {
        const result = evaluateMemoryFeedbackTiebreakerCase({ fixture, item, signalRule, maximumGap: 1 })
        expect(result.rankings).toEqual([])
        expect(result.selectedIds).toEqual([])
      }
    }
  })
})

function withLifecycle(
  record: MemoryRecord,
  lifecycle: Record<string, string>
): MemoryRecord {
  const copy = { ...record }
  delete copy.disabledAt
  delete copy.deletedAt
  delete copy.expiresAt
  delete copy.validFrom
  delete copy.supersededAt
  return MemoryRecord.parse({ ...copy, ...lifecycle })
}
