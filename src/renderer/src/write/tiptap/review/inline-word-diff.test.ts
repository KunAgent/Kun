import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { buildWriteRichExtensions } from '../markdown-manager'
import { computeInlineWordDiff, reviewTextSegments } from './inline-word-diff'
const schema = getSchema(buildWriteRichExtensions())
const paragraph = (text: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined)
describe('inline word review', () => {
  it('compares text across strong, link and code marks with correct UTF-16 positions', () => {
    const prev = schema.nodes.paragraph.create(null, [schema.text('旧的'), schema.text('文字', [schema.marks.bold.create()]), schema.text('😀链接', [schema.marks.link.create({ href: 'https://example.com' })])])
    const next = schema.nodes.paragraph.create(null, [schema.text('新的文字'), schema.text('😀网址', [schema.marks.code.create()])])
    const diff = computeInlineWordDiff(prev, next, 20)!
    expect(diff.hunks).toBe(1)
    expect(diff.deletes).toEqual([{ pos: 21, text: prev.textContent }])
    expect(diff.inserts).toEqual([{ from: 21, to: 21 + next.textContent.length }])
  })
  it('merges equal islands of four characters but not five', () => {
    expect(reviewTextSegments('old abcd old', 'new abcd new').filter((part) => !('equal' in part))).toHaveLength(2)
    expect(reviewTextSegments('旧甲乙丙丁旧', '新甲乙丙丁新').filter((part) => !('equal' in part))).toHaveLength(1)
    expect(reviewTextSegments('旧甲乙丙丁戊旧', '新甲乙丙丁戊新').filter((part) => !('equal' in part))).toHaveLength(2)
  })
  it('handles identical, empty and English text', () => {
    expect(computeInlineWordDiff(paragraph('same'), paragraph('same'), 0)?.hunks).toBe(0)
    expect(computeInlineWordDiff(paragraph(''), paragraph('added'), 0)?.hunks).toBe(1)
    expect(computeInlineWordDiff(paragraph('removed'), paragraph(''), 0)?.deletes[0].text).toBe('removed')
    expect(computeInlineWordDiff(paragraph('The old sentence reads slowly.'), paragraph('The new sentence reads clearly.'), 0)?.hunks).toBe(2)
  })
  it('falls back for non-text inline nodes and large blocks', () => {
    const mixed = schema.nodes.paragraph.create(null, [schema.text('Before'), schema.nodes.hardBreak.create(), schema.text('After')])
    expect(computeInlineWordDiff(mixed, paragraph('Changed'), 0)).toBeNull()
    expect(computeInlineWordDiff(paragraph('x'.repeat(5001)), paragraph('Changed'), 0)).toBeNull()
  })
})
