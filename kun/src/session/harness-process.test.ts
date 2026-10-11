import { describe, expect, it } from 'vitest'
import { stripTerminalEscapes } from './harness-process.js'

describe('stripTerminalEscapes', () => {
  it('removes colour, cursor and OSC sequences from captured CLI output', () => {
    const banner = '\u001b[91m\u001b[1mError: \u001b[0mUnexpected error\u001b[2K\u001b]0;opencode\u0007 done'
    expect(stripTerminalEscapes(banner)).toBe('Error: Unexpected error done')
    expect(stripTerminalEscapes('plain text')).toBe('plain text')
  })
})
