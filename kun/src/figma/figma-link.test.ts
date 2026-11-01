import { describe, expect, it } from 'vitest'
import { parseFigmaNodeId, parseFigmaNodeIds, parseFigmaReference } from './figma-link.js'

const KEY = 'AbCdEf123456'

describe('Figmalink parsing', () => {
  for (const section of ['file', 'design', 'board', 'slides', 'proto']) {
    it(`reads the file key from a /${section}/ link`, () => {
      expect(parseFigmaReference(`https://www.figma.com/${section}/${KEY}/Checkout-Flow`))
        .toEqual({ fileKey: KEY })
    })
  }

  it('reads the node id Figma puts in the query string', () => {
    expect(parseFigmaReference(`https://www.figma.com/design/${KEY}/Checkout?node-id=12-34&t=abc123`))
      .toEqual({ fileKey: KEY, nodeId: '12:34' })
  })

  it('accepts a colon node id and the bare figma.com host', () => {
    expect(parseFigmaReference(`https://figma.com/file/${KEY}/Spec?node-id=12%3A34`))
      .toEqual({ fileKey: KEY, nodeId: '12:34' })
  })

  for (const [label, link] of [
    ['an http link', `http://www.figma.com/file/${KEY}/Spec`],
    ['a lookalike host', `https://figma.com.evil.example/file/${KEY}/Spec`],
    ['the REST API host', `https://api.figma.com/v1/files/${KEY}`],
    ['embedded credentials', `https://user:secret@www.figma.com/file/${KEY}/Spec`],
    ['a community link', 'https://www.figma.com/community/file/1234567890'],
    ['a short file key', 'https://www.figma.com/file/short/Spec'],
    ['a missing file key', 'https://www.figma.com/file/'],
    ['a scheme-less paste', `www.figma.com/file/${KEY}/Spec`],
    ['an empty string', '']
  ] as const) {
    it(`rejects ${label}`, () => {
      expect(() => parseFigmaReference(link)).toThrowError(expect.objectContaining({ code: 'invalid_link' }))
    })
  }

  it('rejects a malformed node id instead of reading the whole file', () => {
    expect(() => parseFigmaReference(`https://www.figma.com/design/${KEY}/Spec?node-id=12-34-56`))
      .toThrowError(expect.objectContaining({ code: 'invalid_input' }))
  })
})

describe('node id normalization', () => {
  it('normalizes both separators to the REST form', () => {
    expect(parseFigmaNodeId('1-2')).toBe('1:2')
    expect(parseFigmaNodeId(' 1:2 ')).toBe('1:2')
  })

  it('rejects ids that are not two numeric segments', () => {
    for (const value of ['', 'abc', '1:2:3', '1', 'I123:456;789:12']) {
      expect(() => parseFigmaNodeId(value)).toThrowError(expect.objectContaining({ code: 'invalid_input' }))
    }
  })

  it('deduplicates a comma-separated selection while keeping order', () => {
    expect(parseFigmaNodeIds('3-4, 1-2,3:4')).toEqual(['3:4', '1:2'])
  })

  it('requires at least one node id', () => {
    expect(() => parseFigmaNodeIds(' , ')).toThrowError(expect.objectContaining({ code: 'invalid_input' }))
    expect(() => parseFigmaNodeIds([])).toThrowError(expect.objectContaining({ code: 'invalid_input' }))
  })

  it('accepts exactly fifty ids and rejects fifty-one', () => {
    const ids = Array.from({ length: 50 }, (_, index) => `${index + 1}:1`)
    expect(parseFigmaNodeIds(ids)).toHaveLength(50)
    expect(() => parseFigmaNodeIds([...ids, '99:1']))
      .toThrowError(expect.objectContaining({ code: 'invalid_input' }))
  })
})
