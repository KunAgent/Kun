import { describe, expect, it } from 'vitest'
import { computeWriteDocumentStats } from './write-workspace-view-utils'

describe('computeWriteDocumentStats', () => {
  it('counts visible markdown text instead of syntax markers', () => {
    const stats = computeWriteDocumentStats('# 标题\n\n- 第一项\n- 第二项 **加粗**\n', true)

    expect(stats).toEqual({ characterCount: 10, wordCount: 6 })
  })

  it('counts non-whitespace characters for plain text files', () => {
    const stats = computeWriteDocumentStats('Hello world\n  2026  ', false)

    expect(stats).toEqual({ characterCount: 14, wordCount: 3 })
  })

  it('does not merge words across Markdown node boundaries', () => {
    const stats = computeWriteDocumentStats('first paragraph\n\nsecond paragraph', true)

    expect(stats.wordCount).toBe(4)
  })
})
