import { describe, expect, it } from 'vitest'
import { workFileResourceKey, workWhiteboardResourceKey } from './work-resource-key'

describe('mobile Work resource keys', () => {
  it('is stable without revealing an absolute path', () => {
    const key = workFileResourceKey('/Users/alice/private', '/Users/alice/private/report.md')
    expect(key).toBe(workFileResourceKey('/Users/alice/private', '/Users/alice/private/report.md'))
    expect(key).not.toContain('alice')
    expect(key).not.toContain('report')
    expect(key).toMatch(/^f-[a-z0-9]+$/)
  })

  it('separates workspaces, files and whiteboards', () => {
    expect(workFileResourceKey('/one', '/same.md')).not.toBe(workFileResourceKey('/two', '/same.md'))
    expect(workFileResourceKey('/one', '/a.md')).not.toBe(workFileResourceKey('/one', '/b.md'))
    expect(workWhiteboardResourceKey('a')).not.toBe(workWhiteboardResourceKey('b'))
    expect(workWhiteboardResourceKey('a')).toMatch(/^b-[a-z0-9]+$/)
  })
})
