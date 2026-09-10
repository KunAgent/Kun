import { describe, expect, it } from 'vitest'
import { LOCAL_KOKORO_MAX_TOKENS } from './local-kokoro'
import {
  KOKORO_BOUNDARY_TOKEN,
  KOKORO_VOCAB,
  applyKokoroPhonemeRules,
  kokoroTokenSequences,
  splitKokoroSegments,
  tokenizeKokoroPhonemes
} from './kokoro-phonemes'

describe('KOKORO_VOCAB', () => {
  it('keeps the boundary token and the punctuation Kokoro uses for pauses', () => {
    expect(KOKORO_VOCAB.$).toBe(KOKORO_BOUNDARY_TOKEN)
    for (const character of [',', '.', '!', '?', ';', ':', ' ', '…']) {
      expect(KOKORO_VOCAB[character], character).toBeTypeOf('number')
    }
  })

  it('assigns every entry a distinct id', () => {
    const ids = Object.values(KOKORO_VOCAB)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('splitKokoroSegments', () => {
  it('keeps punctuation runs out of phonemization', () => {
    const segments = splitKokoroSegments('Hello, world. Fine?')

    expect(segments.filter((segment) => !segment.literal).map((segment) => segment.text))
      .toEqual(['Hello', 'world', 'Fine'])
    expect(segments.map((segment) => segment.text).join('')).toBe('Hello, world. Fine?')
  })

  it('treats bare whitespace as literal', () => {
    const segments = splitKokoroSegments('one two')

    expect(segments.map((segment) => [segment.literal, segment.text]))
      .toEqual([[false, 'one'], [true, ' '], [false, 'two']])
  })

  it('returns nothing for empty input', () => {
    expect(splitKokoroSegments('')).toEqual([])
  })
})

describe('applyKokoroPhonemeRules', () => {
  it('applies the reference pronunciation fixes', () => {
    expect(applyKokoroPhonemeRules('kəkˈoːɹoʊ', 'en-us')).toBe('kˈoʊkəɹoʊ')
    expect(applyKokoroPhonemeRules('kəkˈɔːɹəʊ', 'en-gb')).toBe('kˈəʊkəɹəʊ')
    expect(applyKokoroPhonemeRules('rat xɪp ʲes', 'en-us')).toBe('ɹat kɪp jes')
  })

  it('only softens ninety for American English', () => {
    expect(applyKokoroPhonemeRules('nˈaɪnti', 'en-us')).toBe('nˈaɪndi')
    expect(applyKokoroPhonemeRules('nˈaɪnti', 'en-gb')).toBe('nˈaɪnti')
  })
})

describe('tokenizeKokoroPhonemes', () => {
  it('maps known phonemes and drops unknown characters', () => {
    expect(tokenizeKokoroPhonemes('ab')).toEqual([KOKORO_VOCAB.a, KOKORO_VOCAB.b])
    expect(tokenizeKokoroPhonemes('a b'))
      .toEqual([KOKORO_VOCAB.a, KOKORO_VOCAB[' '], KOKORO_VOCAB.b])
    expect(tokenizeKokoroPhonemes('a@#b')).toEqual([KOKORO_VOCAB.a, KOKORO_VOCAB.b])
  })
})

describe('kokoroTokenSequences', () => {
  it('wraps a short sequence in boundary tokens', () => {
    const sequences = kokoroTokenSequences('hi')

    expect(sequences).toHaveLength(1)
    expect(sequences[0][0]).toBe(KOKORO_BOUNDARY_TOKEN)
    expect(sequences[0][sequences[0].length - 1]).toBe(KOKORO_BOUNDARY_TOKEN)
    expect(sequences[0]).toHaveLength(4)
  })

  it('splits past the voice-file token ceiling and prefers word boundaries', () => {
    const phonemes = `${'ab '.repeat(400)}`.trim()
    const sequences = kokoroTokenSequences(phonemes)

    expect(sequences.length).toBeGreaterThan(1)
    for (const sequence of sequences) {
      expect(sequence.length).toBeLessThanOrEqual(LOCAL_KOKORO_MAX_TOKENS)
      expect(sequence[0]).toBe(KOKORO_BOUNDARY_TOKEN)
      expect(sequence[sequence.length - 1]).toBe(KOKORO_BOUNDARY_TOKEN)
      // A split that lands mid-word would leave a leading space token.
      expect(sequence[1]).not.toBe(KOKORO_VOCAB[' '])
    }
  })

  it('returns nothing when no phoneme is in the vocabulary', () => {
    expect(kokoroTokenSequences('')).toEqual([])
    expect(kokoroTokenSequences('@#\u0000')).toEqual([])
  })

  it('still emits a sequence for whitespace, which the vocabulary covers', () => {
    expect(kokoroTokenSequences(' ')).toEqual([
      [KOKORO_BOUNDARY_TOKEN, KOKORO_VOCAB[' '], KOKORO_BOUNDARY_TOKEN]
    ])
  })
})


it('keeps decimal and thousands separators inside the phonemized number', () => {
  const segments = splitKokoroSegments('The value is 3.14, or 1,000.')
  expect(segments).toContainEqual({ literal: false, text: '3.14' })
  expect(segments).toContainEqual({ literal: false, text: '1,000' })
  expect(segments.at(-1)).toEqual({ literal: true, text: '.' })
})
