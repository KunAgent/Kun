import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { parseWorkDocument, serializeWorkDocument } from './document-codec'

function lines(doc: JSONContent): Array<{ text: string; softLine: boolean }> {
  return (doc.content ?? []).map((node) => ({
    text: (node.content ?? []).map((child) => child.text ?? `<${child.type}>`).join(''),
    softLine: node.attrs?.softLine === true
  }))
}

function roundTrip(markdown: string): string {
  const { doc, ctx } = parseWorkDocument(markdown)
  return serializeWorkDocument(doc, ctx)
}

function editBlock(markdown: string, index: number, text: string | null): string {
  const { doc, ctx } = parseWorkDocument(markdown)
  const edited = JSON.parse(JSON.stringify(doc)) as JSONContent
  if (text === null) edited.content!.splice(index, 1)
  else edited.content![index].content = [{ type: 'text', text }]
  return serializeWorkDocument(edited, ctx)
}

describe('line-per-block paragraphs', () => {
  it('splits a multi-line paragraph into one block per line', () => {
    const md = '【讲什么】结合第 6 页演示结果。\n【时间】3 分钟\n'
    expect(lines(parseWorkDocument(md).doc)).toEqual([
      { text: '【讲什么】结合第 6 页演示结果。', softLine: false },
      { text: '【时间】3 分钟', softLine: true }
    ])
    expect(roundTrip(md)).toBe(md)
  })

  it('keeps CRLF files byte-identical and strips the carriage return from the text', () => {
    const md = 'line one\r\nline two\r\n\r\n- a\r\n'
    expect(lines(parseWorkDocument(md).doc).slice(0, 2).map((line) => line.text)).toEqual(['line one', 'line two'])
    expect(roundTrip(md)).toBe(md)
    expect(editBlock(md, 1, 'line 2')).toBe('line one\r\nline 2\r\n\r\n- a\r\n')
  })

  it('splits at hard breaks and keeps their markers when unedited', () => {
    const md = 'a  \nb\\\nc\n'
    expect(lines(parseWorkDocument(md).doc).map((line) => line.text)).toEqual(['a', 'b', 'c'])
    expect(roundTrip(md)).toBe(md)
  })

  it('does not split inside inline containers that span lines', () => {
    const md = 'c **x\ny** d\n'
    expect(lines(parseWorkDocument(md).doc)).toHaveLength(1)
    expect(roundTrip(md)).toBe(md)
  })

  it('preserves continuation-line indentation verbatim', () => {
    const md = 'first\n   second\n'
    expect(lines(parseWorkDocument(md).doc).map((line) => line.text)).toEqual(['first', 'second'])
    expect(roundTrip(md)).toBe(md)
  })

  it('rejoins an edited line with a single newline', () => {
    expect(editBlock('L1\nL2\nL3\n', 1, 'L2 edited')).toBe('L1\nL2 edited\nL3\n')
  })

  it('uses a blank line when a soft line would otherwise glue onto a list', () => {
    expect(editBlock('- item\n\nL1\nL2\n', 1, null)).toBe('- item\n\nL2\n')
  })

  it('never lets an edited line turn its neighbour into a heading or table', () => {
    for (const [markdown, text] of [['L1\nL2\n', '==='], ['L1\nL2\n', '---'], ['a | b\nL2\n', '| --- | --- |']]) {
      const out = editBlock(markdown, 1, text)
      const types = (parseWorkDocument(out).doc.content ?? []).map((node) => node.type)
      expect(types).toEqual(['paragraph', 'paragraph'])
    }
  })
})
