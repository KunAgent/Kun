import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  capabilitiesV2FromLegacy,
  intersectCapabilities,
  type HarnessCapabilities
} from './harness-capabilities'

type FixtureCase = {
  name: string
  legacy: Parameters<typeof capabilitiesV2FromLegacy>[0]
  base: HarnessCapabilities
  expected: HarnessCapabilities
}

const loadFixture = (file: string): FixtureCase[] => {
  const url = new URL(`../../kun/src/harness/__fixtures__/${file}`, import.meta.url)
  return (JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as {
    cases: FixtureCase[]
  }).cases
}
const FIXTURES = {
  cases: [
    ...loadFixture('capability-fixtures.json'),
    ...loadFixture('capability-fixtures-delegated.json')
  ]
}

describe('shared harness capabilities', () => {
  it('loads the shared fixture', () => {
    expect(FIXTURES.cases.length).toBeGreaterThan(0)
  })

  it.each(FIXTURES.cases.map((c) => [c.name, c] as const))(
    '%s derivation matches the kun-side expected output',
    (_name, c) => {
      expect(capabilitiesV2FromLegacy(c.legacy, c.base)).toEqual(c.expected)
    }
  )

  it('intersectCapabilities keeps the first unsupported layer', () => {
    const base = FIXTURES.cases[0]!.base
    const narrowed: HarnessCapabilities = {
      statuses: {
        ...base.statuses,
        abort: { supported: false, reason: 'platform', message: 'x' }
      },
      facts: base.facts
    }
    const result = intersectCapabilities(base, narrowed)
    expect(result.statuses.abort).toEqual({
      supported: false,
      reason: 'platform',
      message: 'x'
    })
  })
})
