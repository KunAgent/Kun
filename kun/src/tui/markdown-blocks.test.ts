import { describe, expect, it } from 'vitest'
import { classifyMarkdownBlock, splitStableMarkdown } from './markdown-blocks.js'

describe('splitStableMarkdown', () => {
  it('splits at blank lines and keeps the growing tail unstable while streaming', () => {
    expect(splitStableMarkdown('Intro\n\nSecond para', true)).toEqual({ blocks: ['Intro', 'Second para'], stable: 1 })
    expect(splitStableMarkdown('Intro\n\nSecond para', false)).toEqual({ blocks: ['Intro', 'Second para'], stable: 2 })
  })

  it('does not close a block on a trailing newline, so a list can keep growing', () => {
    const partial = splitStableMarkdown('1. one\n2. two\n', true)
    expect(partial).toEqual({ blocks: ['1. one\n2. two'], stable: 0 })
    expect(splitStableMarkdown('1. one\n2. two\n3. three', true).blocks).toEqual(['1. one\n2. two\n3. three'])
  })

  it('treats a real blank line as the end of the block', () => {
    expect(splitStableMarkdown('1. one\n2. two\n\n', true)).toEqual({ blocks: ['1. one\n2. two'], stable: 1 })
  })

  it('keeps fenced code (including blank lines) in one block and closes it at the fence', () => {
    const text = 'Before\n```ts\nconst a = 1\n\nconst b = 2\n```\nAfter'
    const { blocks, stable } = splitStableMarkdown(text, true)
    expect(blocks).toEqual(['Before', '```ts\nconst a = 1\n\nconst b = 2\n```', 'After'])
    expect(stable).toBe(2)
  })

  it('keeps an unclosed fence open while streaming', () => {
    expect(splitStableMarkdown('```py\nprint(1)\n', true)).toEqual({ blocks: ['```py\nprint(1)'], stable: 0 })
  })
})

describe('classifyMarkdownBlock', () => {
  it('extracts language and code for fenced blocks', () => {
    expect(classifyMarkdownBlock('```ts\nconst a = 1\n```')).toEqual({ kind: 'code', language: 'ts', code: 'const a = 1', closed: true })
    expect(classifyMarkdownBlock('```\nopen')).toEqual({ kind: 'code', language: '', code: 'open', closed: false })
    expect(classifyMarkdownBlock('plain **text**')).toEqual({ kind: 'markdown', text: 'plain **text**' })
  })
})
