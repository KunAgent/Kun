import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MemoryFeedbackEvent } from '../contracts/memory-feedback.js'
import { MemoryRecord } from '../contracts/memory.js'
import { MemoryFeedbackTiebreakerFixtureFile } from './memory-feedback-tiebreaker-contracts.js'

const fixturePath = fileURLToPath(new URL(
  './fixtures/memory-feedback-tiebreaker-fixtures.v1.json',
  import.meta.url
))

describe('memory feedback tiebreaker fixtures', () => {
  it('uses only production-valid synthetic records and feedback events', async () => {
    const fixture = MemoryFeedbackTiebreakerFixtureFile.parse(
      JSON.parse(await readFile(fixturePath, 'utf8'))
    )

    expect(fixture.records).toHaveLength(19)
    expect(fixture.events).toHaveLength(13)
    expect(fixture.records.every((record) => MemoryRecord.safeParse(record).success)).toBe(true)
    expect(fixture.events.every((event) => MemoryFeedbackEvent.safeParse(event).success)).toBe(true)
  })

  it('freezes balanced development and holdout labels for every stratum', async () => {
    const fixture = MemoryFeedbackTiebreakerFixtureFile.parse(
      JSON.parse(await readFile(fixturePath, 'utf8'))
    )
    const counts = new Map<string, number>()

    for (const item of fixture.cases) {
      const key = `${item.partition}:${item.stratum}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
      expect(item.rationale.length).toBeGreaterThan(0)
      for (const pair of item.preferredPairs) expect(pair.rationale.length).toBeGreaterThan(0)
    }

    expect(fixture.cases).toHaveLength(36)
    expect([...counts.values()]).toEqual(Array.from({ length: 18 }, () => 2))
  })
})
