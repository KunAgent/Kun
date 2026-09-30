import { describe, expect, it } from 'vitest'
import { paperResourceKey } from './paper-resource-key'

describe('mobile paper URL identifiers', () => {
  it('isolates units across libraries without exposing paths in the URL', () => {
    const first = paperResourceKey('/host/library-a', 'papers/foo')
    expect(first).toMatch(/^p-[a-z0-9]+$/)
    expect(first).not.toContain('papers')
    expect(first).not.toEqual(paperResourceKey('/host/library-b', 'papers/foo'))
    expect(first).not.toEqual(paperResourceKey('/host/library-a', 'papers/bar'))
  })
})
