import { describe, expect, it } from 'vitest'
import {
  containsAsciiControlCharacters,
  containsNullOrLineBreak,
  replaceAsciiControlCharacters,
  replaceNullOrLineBreaks
} from './text-safety.js'

describe('video editor text safety', () => {
  it('detects the exact ASCII control sets used by host validation', () => {
    expect(containsAsciiControlCharacters(`alpha${String.fromCharCode(0x1f)}beta`)).toBe(true)
    expect(containsAsciiControlCharacters(`alpha${String.fromCharCode(0x7f)}beta`)).toBe(true)
    expect(containsAsciiControlCharacters('alpha beta')).toBe(false)
    expect(containsNullOrLineBreak('alpha\nbeta')).toBe(true)
    expect(containsNullOrLineBreak(`alpha${String.fromCharCode(0x1f)}beta`)).toBe(false)
  })

  it('replaces controls without changing surrounding Unicode text', () => {
    expect(replaceAsciiControlCharacters(`昆${String.fromCharCode(0x1f)}video`, ' ')).toBe('昆 video')
    expect(replaceNullOrLineBreaks('alpha\r\nbeta', '')).toBe('alphabeta')
  })
})
