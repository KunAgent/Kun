import { describe, expect, it } from 'vitest'
import { toggleWriteInlineFormat } from './inline-format'

describe('toggleWriteInlineFormat', () => {
  it('wraps plain text with bold markers', () => {
    expect(toggleWriteInlineFormat('hello world', 'bold')).toBe('**hello world**')
  })

  it('unwraps already-bold text', () => {
    expect(toggleWriteInlineFormat('**hello world**', 'bold')).toBe('hello world')
  })

  it('keeps surrounding whitespace outside the markers', () => {
    expect(toggleWriteInlineFormat('  hello ', 'bold')).toBe('  **hello** ')
  })

  it('wraps italic without confusing bold markers', () => {
    expect(toggleWriteInlineFormat('hello', 'italic')).toBe('*hello*')
    expect(toggleWriteInlineFormat('**hello**', 'italic')).toBe('***hello***')
  })

  it('unwraps italic but not bold when toggling italic', () => {
    expect(toggleWriteInlineFormat('*hello*', 'italic')).toBe('hello')
    expect(toggleWriteInlineFormat('***hello***', 'italic')).toBe('**hello**')
  })

  it('toggles strikethrough', () => {
    expect(toggleWriteInlineFormat('hello', 'strikethrough')).toBe('~~hello~~')
    expect(toggleWriteInlineFormat('~~hello~~', 'strikethrough')).toBe('hello')
  })

  it('toggles inline code', () => {
    expect(toggleWriteInlineFormat('const a = 1', 'code')).toBe('`const a = 1`')
    expect(toggleWriteInlineFormat('`const a = 1`', 'code')).toBe('const a = 1')
  })

  it('uses double backticks when the selection contains a backtick', () => {
    expect(toggleWriteInlineFormat('a `b` c', 'code')).toBe('`` a `b` c ``')
  })

  it('wraps each paragraph separately for bold', () => {
    expect(toggleWriteInlineFormat('first\n\nsecond', 'bold')).toBe('**first**\n\n**second**')
  })

  it('keeps soft line breaks inside one bold wrap', () => {
    expect(toggleWriteInlineFormat('first\nsecond', 'bold')).toBe('**first\nsecond**')
  })

  it('wraps each line separately for inline code', () => {
    expect(toggleWriteInlineFormat('a\nb', 'code')).toBe('`a`\n`b`')
  })

  it('unwraps only when every paragraph is wrapped', () => {
    expect(toggleWriteInlineFormat('**a**\n\nb', 'bold')).toBe('**a**\n\n**b**')
    expect(toggleWriteInlineFormat('**a**\n\n**b**', 'bold')).toBe('a\n\nb')
  })

  it('returns null for whitespace-only selections', () => {
    expect(toggleWriteInlineFormat('   ', 'bold')).toBeNull()
    expect(toggleWriteInlineFormat('\n\n', 'italic')).toBeNull()
  })
})

describe('clear inline formatting', () => {
  it('removes inline wrappers while preserving headings, lists, images and literal punctuation', () => {
    expect(toggleWriteInlineFormat('# **Title**\n\n- *Text* and ~~old~~ with `code` and [link](https://example.com)\n\n![image](a.png)\n\n2 * 3 = 6', 'clear'))
      .toBe('# Title\n\n- Text and old with code and link\n\n![image](a.png)\n\n2 * 3 = 6')
  })
})
