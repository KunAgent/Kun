import { describe, expect, it } from 'vitest'
import { parsePdfByteRange } from './remote-file-range'

describe('PDF preview byte ranges', () => {
  it('bounds prefix, open-ended and suffix ranges', () => {
    expect(parsePdfByteRange('bytes=0-7', 100)).toEqual({ start: 0, end: 7 })
    expect(parsePdfByteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 })
    expect(parsePdfByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parsePdfByteRange('bytes=95-200', 100)).toEqual({ start: 95, end: 99 })
    expect(parsePdfByteRange(undefined, 100)).toBeNull()
  })
  it('rejects unsatisfiable/multiple/invalid ranges', () => {
    for (const value of ['bytes=200-', 'bytes=8-3', 'bytes=-0', 'bytes=1-2,4-5', 'bytes=foo-bar']) {
      expect(parsePdfByteRange(value, 100)).toBe('invalid')
    }
  })
})
