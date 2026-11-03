import { describe, expect, it, vi } from 'vitest'
import {
  advanceTextReveal,
  createTextReveal,
  retargetTextReveal,
  visibleTextForTypewriter
} from './assistant-text-reveal'

describe('Unicode text reveal', () => {
  it.each(['a\u0302', '\u{1f469}\u200d\u{1f4bb}', '\u{1f44d}\u{1f3fd}', '\u{1f1e8}\u{1f1f3}', '\u0915\u094d\u0937'])(
    'never reveals part of the cluster %s', (cluster) => {
      const prefix = 'already received '.repeat(10_000)
      const text = `${prefix}${cluster} end`
      for (let index = 1; index <= cluster.length; index += 1) {
        expect(visibleTextForTypewriter(text, prefix.length + index)).toBe(`${prefix}${cluster}`)
      }
    }
  )

  it('looks up the boundary directly rather than iterating through the historical prefix', () => {
    const original = Intl.Segmenter.prototype.segment
    let indexedLookups = 0
    const spy = vi.spyOn(Intl.Segmenter.prototype, 'segment').mockImplementation(function (this: Intl.Segmenter, input) {
      const segments = original.call(this, input)
      return {
        containing(index?: number) {
          indexedLookups += 1
          return segments.containing(index)
        },
        [Symbol.iterator]() { throw new Error('must not walk the entire preceding text') }
      }
    })
    try {
      const prefix = 'history '.repeat(20_000)
      expect(visibleTextForTypewriter(`${prefix}a\u0302 end`, prefix.length + 1)).toBe(`${prefix}a\u0302`)
      expect(indexedLookups).toBe(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('handles an appended combining mark without exposing an incomplete cluster', () => {
    let state = createTextReveal('a', true)
    state = retargetTextReveal(state, 'a\u0302 followed by more text', true, 0, false)
    expect(visibleTextForTypewriter(state.text, state.visibleLength)).toBe('a\u0302')
    state = advanceTextReveal(state, 16)
    expect(visibleTextForTypewriter(state.text, state.visibleLength).startsWith('a\u0302')).toBe(true)
  })
})
