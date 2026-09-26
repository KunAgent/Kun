import { describe, expect, it } from 'vitest'
import { splitTitleMath } from './PaperTitleText'

describe('splitTitleMath', () => {
  it('keeps plain titles as one text part', () => {
    expect(splitTitleMath('Attention Is All You Need')).toEqual([
      { math: false, text: 'Attention Is All You Need' }
    ])
  })

  it('extracts dollar and paren inline math', () => {
    expect(splitTitleMath('$\\pi$-Flow and \\(O(n)\\) attention')).toEqual([
      { math: true, tex: '\\pi' },
      { math: false, text: '-Flow and ' },
      { math: true, tex: 'O(n)' },
      { math: false, text: ' attention' }
    ])
  })
})
