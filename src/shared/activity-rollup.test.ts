import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { rollupState, type ActivityRollupState } from './activity-rollup'

type FixtureCase = {
  name: string
  main: ActivityRollupState
  children: { working: number; waiting: number; done: number; failed: number }
  expected: ActivityRollupState
}

const FIXTURES = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../kun/src/services/__fixtures__/activity-rollup.json', import.meta.url)
    ),
    'utf8'
  )
) as { cases: FixtureCase[] }

describe('shared activity rollup (shared fixture)', () => {
  it('loads the shared fixture', () => {
    expect(FIXTURES.cases.length).toBeGreaterThan(0)
  })

  it.each(FIXTURES.cases.map((c) => [c.name, c] as const))(
    '%s derivation matches the kun-side expected output',
    (_name, c) => {
      expect(rollupState(c.main, c.children)).toBe(c.expected)
    }
  )
})
