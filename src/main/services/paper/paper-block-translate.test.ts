import { describe, expect, it } from 'vitest'
import {
  buildBlockBatchPrompt,
  groupBlocksIntoBatches,
  parseBlockBatchReply
} from './paper-block-translate'

describe('groupBlocksIntoBatches', () => {
  const blocks = (sizes: number[]) =>
    sizes.map((size, i) => ({ id: `b${i}`, text: 'x'.repeat(size) }))

  it('packs blocks sequentially under the char cap', () => {
    const batches = groupBlocksIntoBatches(blocks([2000, 2000, 2000]), 4500)
    expect(batches.map((b) => b.length)).toEqual([2, 1])
  })

  it('keeps an oversized block in its own batch', () => {
    const batches = groupBlocksIntoBatches(blocks([100, 9000, 100]), 4500)
    expect(batches.map((b) => b.length)).toEqual([1, 1, 1])
  })
})

describe('buildBlockBatchPrompt + parseBlockBatchReply', () => {
  const batch = [
    { id: 'a', text: 'Hello world' },
    { id: 'b', text: 'Second block' }
  ]

  it('round-trips a well-formed reply', () => {
    const prompt = buildBlockBatchPrompt(batch)
    expect(prompt).toBe('[[0]]\nHello world\n\n[[1]]\nSecond block')
    const reply = '[[0]]\n你好世界\n\n[[1]]\n第二段'
    expect(parseBlockBatchReply(reply, batch)).toEqual({ a: '你好世界', b: '第二段' })
  })

  it('tolerates whitespace inside markers', () => {
    const reply = '[[ 0 ]]你好\n\n[[1]] 第二段'
    expect(parseBlockBatchReply(reply, batch)).toEqual({ a: '你好', b: '第二段' })
  })

  it('returns null when a marker is missing (fallback to per-block)', () => {
    expect(parseBlockBatchReply('[[0]]\n你好', batch)).toBeNull()
    expect(parseBlockBatchReply('no markers at all', batch)).toBeNull()
  })
})
