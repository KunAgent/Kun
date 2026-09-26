import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { rollupState } from './activity-rollup.js'
import type { ActivityState } from '../contracts/activity.js'

type FixtureCase = {
  name: string
  main: ActivityState
  children: { working: number; waiting: number; done: number; failed: number }
  expected: ActivityState
}

const FIXTURES = JSON.parse(
  readFileSync(fileURLToPath(new URL('./__fixtures__/activity-rollup.json', import.meta.url)), 'utf8')
) as { cases: FixtureCase[] }

describe('kun activity rollup (shared fixture)', () => {
  it('loads the shared fixture', () => {
    expect(FIXTURES.cases.length).toBeGreaterThan(0)
  })

  it.each(FIXTURES.cases.map((c) => [c.name, c] as const))(
    '%s',
    (_name, c) => {
      expect(rollupState(c.main, c.children)).toBe(c.expected)
    }
  )
})
