import { describe, expect, it } from 'vitest'
import { artifactId, summarizeForModel } from './artifact-summary.js'

describe('artifactId', () => {
  it('is content-addressed and stable', () => {
    expect(artifactId('hello')).toBe(artifactId('hello'))
    expect(artifactId('hello')).not.toBe(artifactId('world'))
    expect(artifactId('hello')).toMatch(/^art_[0-9a-f]{24}$/)
  })
})

describe('summarizeForModel', () => {
  it('returns content verbatim when within budget', () => {
    const result = summarizeForModel({ content: 'short output', maxInlineChars: 100 })
    expect(result.truncated).toBe(false)
    expect(result.inline).toBe('short output')
    expect(result.lineCount).toBe(1)
  })

  it('truncates with head + tail + reference marker when oversized', () => {
    const content = `${'H'.repeat(500)}\n${'T'.repeat(500)}`
    const result = summarizeForModel({ content, maxInlineChars: 200 })
    expect(result.truncated).toBe(true)
    expect(result.inline).toContain(`[artifact ${result.artifactId}:`)
    expect(result.inline).toContain('elided')
    // Keeps a head and a tail excerpt.
    expect(result.inline.startsWith('H')).toBe(true)
    expect(result.inline.trimEnd().endsWith('T')).toBe(true)
    // The byte size reflects the full content, not the preview.
    expect(result.byteSize).toBe(Buffer.byteLength(content, 'utf8'))
  })

  it('keeps the preview within roughly the requested budget', () => {
    const result = summarizeForModel({ content: 'x'.repeat(10_000), maxInlineChars: 300 })
    // head + marker + tail; allow the marker line + newlines as overhead.
    expect(result.inline.length).toBeLessThanOrEqual(400)
  })

  it('counts lines on the full content', () => {
    expect(summarizeForModel({ content: 'a\nb\nc', maxInlineChars: 100 }).lineCount).toBe(3)
  })
})
