import { describe, expect, it } from 'vitest'
import { annotationProposal } from './annotation-proposal'

describe('Markdown annotation review', () => {
  it('inserts after the closing math delimiter, preserving CRLF and the following paragraph', () => {
    const source = '$$\r\ny=f(x)+x\r\n$$\r\n\r\nNext.'
    const start = source.indexOf('+x')
    expect(annotationProposal(source, { from: start, to: start + 2, blockEnd: source.lastIndexOf('$$') + 2 },
      { kind: 'insertAfter', text: 'The input is added back.' }))
      .toBe('$$\r\ny=f(x)+x\r\n$$\r\n\r\nThe input is added back.\r\n\r\nNext.')
  })
  it('replaces the target only and rejects invalid and unchanged proposals', () => {
    const target = { from: 2, to: 5, blockEnd: 5 }
    expect(annotationProposal('**old** old', target, { kind: 'replace', text: 'new' })).toBe('**new** old')
    expect(annotationProposal('**old** old', target, { kind: 'replace', text: 'old' })).toBeNull()
    expect(annotationProposal('', target, { kind: 'replace', text: 'new' })).toBeNull()
  })
})
