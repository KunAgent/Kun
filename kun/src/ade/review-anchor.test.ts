import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { reanchorComment, type ReanchorResult } from './review-anchor.js'

type FixtureCase = {
  name: string
  line: number
  anchor: { lineText: string; before: string[]; after: string[] }
  file: string
  expected: ReanchorResult
}

const FIXTURES = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./__fixtures__/review-anchor.json', import.meta.url)),
    'utf8'
  )
) as { cases: FixtureCase[] }

describe('kun review reanchor (shared fixture)', () => {
  it('loads the shared fixture', () => {
    expect(FIXTURES.cases.length).toBeGreaterThan(0)
  })

  it.each(FIXTURES.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const result = reanchorComment(
      { line: c.line, anchor: c.anchor },
      c.file.split('\n')
    )
    expect(result).toEqual(c.expected)
  })
})
