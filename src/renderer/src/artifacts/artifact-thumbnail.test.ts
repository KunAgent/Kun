import { describe, expect, it } from 'vitest'
import { parseCsvPreview } from './artifact-thumbnail'

describe('parseCsvPreview', () => {
  it('reads quoted fields, escaped quotes and CRLF rows', () => {
    expect(parseCsvPreview('name,note\r\n"Kun, Inc.","say ""hi"""\r\nb,2')).toEqual([
      ['name', 'note'],
      ['Kun, Inc.', 'say "hi"'],
      ['b', '2']
    ])
  })

  it('caps rows and columns and skips blank lines', () => {
    const text = ['a,b,c,d', '', '1,2,3,4', '5,6,7,8', '9,10,11,12'].join('\n')
    expect(parseCsvPreview(text, 2, 3)).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })
})
