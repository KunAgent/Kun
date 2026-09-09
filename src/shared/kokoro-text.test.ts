import { describe, expect, it } from 'vitest'
import {
  KOKORO_FIRST_CHUNK_CHARS,
  KOKORO_MAX_CHUNK_CHARS,
  KOKORO_MIN_CHUNK_CHARS,
  normalizeSpeechText,
  speechChunksFromAnswer,
  speechTextFromAnswer,
  speechSentencesFromAnswer,
  speechTextFromMarkdown,
  splitSpeechChunks,
  takeSpeechChunk
} from './kokoro-text'

describe('speechTextFromMarkdown', () => {
  it('drops fenced code blocks entirely', () => {
    const answer = [
      'Here is the fix.',
      '',
      '```ts',
      'const x = 1',
      'console.log(x)',
      '```',
      '',
      'It compiles now.'
    ].join('\n')

    expect(speechTextFromMarkdown(answer)).toBe('Here is the fix.\nIt compiles now.')
  })

  it('drops an unterminated fence rather than reading its body', () => {
    const answer = 'Before.\n\n```js\nleaked()\nmore()'

    expect(speechTextFromMarkdown(answer)).toBe('Before.')
  })

  it('reads table rows cell by cell and skips the divider row', () => {
    const answer = [
      '| Suite | Result |',
      '| --- | --- |',
      '| Backend | 14/14 pass |'
    ].join('\n')

    expect(speechTextFromMarkdown(answer)).toBe('Suite, Result.\nBackend, 14/14 pass.')
  })

  it('keeps link text, inline code contents, and heading text', () => {
    const answer = '## Remaining work\n\nRun [the suite](https://example.com/ci) with `npm test`.'

    expect(speechTextFromMarkdown(answer)).toBe('Remaining work.\nRun the suite with npm test.')
  })

  it('strips list markers, emphasis, blockquotes, and images', () => {
    const answer = [
      '> **Scope:** only the tracking suites.',
      '',
      '- *first* item',
      '2. second item',
      '',
      '![diagram](./a.png)'
    ].join('\n')

    expect(speechTextFromMarkdown(answer)).toBe(
      'Scope: only the tracking suites.\nfirst item.\nsecond item.'
    )
  })

  it('drops bare URLs so they are not spelled out', () => {
    expect(speechTextFromMarkdown('See https://example.com/x?y=1 for details.'))
      .toBe('See for details.')
  })

  it('returns an empty string when nothing is speakable', () => {
    expect(speechTextFromMarkdown('```\nonly code\n```')).toBe('')
    expect(speechTextFromMarkdown('')).toBe('')
  })
})

describe('normalizeSpeechText', () => {
  it('expands abbreviations that would end a sentence early', () => {
    expect(normalizeSpeechText('Ask Dr. Chan, e.g. about vs. tests etc.'))
      .toBe('Ask Doctor Chan, for example about versus tests etcetera')
  })

  it('reads currency, percentages, and times as words', () => {
    expect(normalizeSpeechText('$12.50 covers 40% by 10:30.'))
      .toBe('12 dollars and 50 cents covers 40 percent by 10 30.')
  })

  it('normalizes smart punctuation and collapses whitespace', () => {
    expect(normalizeSpeechText('He said “yes” — twice…   done'))
      .toBe('He said "yes" , twice… done')
  })
})

describe('splitSpeechChunks', () => {
  it('packs short sentences together and keeps order', () => {
    const chunks = splitSpeechChunks('One. Two. Three.', 40)

    expect(chunks).toEqual(['One. Two. Three.'])
  })

  it('starts a new chunk once the limit would be exceeded', () => {
    const chunks = splitSpeechChunks('aaaaaaaaaa bbbbbbbbbb. cccccccccc dddddddddd. eeee ffff.', 45)

    expect(chunks).toEqual(['aaaaaaaaaa bbbbbbbbbb. cccccccccc dddddddddd.', 'eeee ffff.'])
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(45)
  })

  it('never drops below a floor chunk size, so audio does not turn choppy', () => {
    expect(splitSpeechChunks('One. Two. Three. Four.', 5)).toEqual(['One. Two. Three. Four.'])
  })

  it('breaks an over-long sentence at a clause boundary', () => {
    const sentence = `${'alpha '.repeat(8)}, ${'beta '.repeat(8)}`
    const chunks = splitSpeechChunks(sentence, 40)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(40)
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toContain('alpha')
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toContain('beta')
  })

  it('returns no chunks for blank input', () => {
    expect(splitSpeechChunks('   ')).toEqual([])
  })
})

describe('speechChunksFromAnswer', () => {
  it('produces bounded chunks from a Markdown answer', () => {
    const answer = [
      '# Report',
      '',
      'The run finished. Every suite passed.',
      '',
      '```sh',
      'npm test',
      '```',
      '',
      '- 14/14 backend',
      '- 9/9 end to end'
    ].join('\n')

    const chunks = speechChunksFromAnswer(answer)

    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.join(' ')).not.toContain('npm test')
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(KOKORO_MAX_CHUNK_CHARS)
    }
  })

  it('normalizes before chunking', () => {
    expect(speechTextFromAnswer('Costs **$5** total.')).toBe('Costs 5 dollars total.')
  })
})

describe('first chunk sizing', () => {
  const sentences = Array.from({ length: 14 }, (_, index) =>
    `Sentence number ${index + 1} carries enough words to fill some of the budget.`
  ).join(' ')

  it('keeps the first chunk short so playback starts without a long wait', () => {
    const chunks = speechChunksFromAnswer(sentences)

    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks[0].length).toBeLessThanOrEqual(KOKORO_FIRST_CHUNK_CHARS)
  })

  it('uses the full budget for the chunks after it', () => {
    const chunks = speechChunksFromAnswer(sentences)

    expect(Math.max(...chunks.slice(1).map((chunk) => chunk.length)))
      .toBeGreaterThan(KOKORO_FIRST_CHUNK_CHARS)
    for (const chunk of chunks.slice(1)) {
      expect(chunk.length).toBeLessThanOrEqual(KOKORO_MAX_CHUNK_CHARS)
    }
  })

  // An answer that opens with one long sentence is the common case, and it used
  // to put the whole sentence in the first chunk - seconds before any audio.
  it('breaks a long opening sentence down to the first budget', () => {
    const chunks = speechChunksFromAnswer(
      'The run finished successfully and every one of the suites passed on the first attempt, '
      + 'which means the remaining limitations listed below are the only open items. Second here.'
    )

    expect(chunks[0].length).toBeLessThanOrEqual(KOKORO_FIRST_CHUNK_CHARS)
    expect(chunks.join(' ')).toContain('remaining limitations listed below')
  })

  it('never exceeds an explicit budget smaller than the first-chunk size', () => {
    for (const chunk of speechChunksFromAnswer(sentences, 60)) {
      expect(chunk.length).toBeLessThanOrEqual(60)
    }
  })

  it('leaves splitSpeechChunks on a flat budget for callers that ask for one', () => {
    const flat = splitSpeechChunks(sentences, KOKORO_MAX_CHUNK_CHARS)

    expect(flat[0].length).toBeGreaterThan(KOKORO_FIRST_CHUNK_CHARS)
  })
})

describe('takeSpeechChunk', () => {
  it('consumes the queue and packs up to the budget', () => {
    const queue = ['One short line.', 'Another short line.', 'A third short line.']

    const first = takeSpeechChunk(queue, 40)

    expect(first).toBe('One short line. Another short line.')
    expect(queue).toEqual(['A third short line.'])
  })

  it('leaves the rest of a long sentence at the head of the queue', () => {
    const queue = [
      'This single sentence is much longer than the budget, so it has to be cut at a clause, right here.'
    ]

    const first = takeSpeechChunk(queue, 45)

    expect(first.length).toBeLessThanOrEqual(45)
    expect(queue.length).toBeGreaterThan(0)
    expect([first, ...queue].join(' ')).toContain('cut at a clause')
  })

  it('honours the minimum budget rather than emitting fragments', () => {
    const queue = ['A sentence with a reasonable number of words in it here.']

    expect(takeSpeechChunk(queue, 5).length).toBeLessThanOrEqual(KOKORO_MIN_CHUNK_CHARS)
  })

  it('returns nothing for an empty queue', () => {
    expect(takeSpeechChunk([], 100)).toBe('')
  })

  it('drains everything it is given', () => {
    const queue = speechSentencesFromAnswer('First one. Second one. Third one.')
    const drained: string[] = []
    while (queue.length > 0) {
      const chunk = takeSpeechChunk(queue, 40)
      if (!chunk) break
      drained.push(chunk)
    }

    expect(drained.join(' ')).toBe('First one. Second one. Third one.')
  })
})


it('preserves inline identifiers and mathematical conditions', () => {
  expect(speechTextFromAnswer('Use `user_id` to query.')).toContain('user underscore id')
  expect(speechTextFromAnswer('Ensure x ≤ 10 and y ≠ 0.')).toBe('Ensure x less than or equal to 10 and y not equal to 0.')
})
