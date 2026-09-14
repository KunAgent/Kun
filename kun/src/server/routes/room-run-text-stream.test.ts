import { expect, it } from 'vitest'
import type { RuntimeEvent } from '../../contracts/events.js'
import { applyRunText } from './room-run-text-stream.js'
const delta = (text: string, offset?: number, id = 'one') => ({ kind: 'assistant_text_delta', deltaOffset: offset,
  item: { id, kind: 'assistant_text', text } } as RuntimeEvent)
it('merges hydrated UTF-16 deltas without duplicating replayed fragments', () => {
  const parts = new Map([['one', '你好🙂']])
  expect(applyRunText(parts, delta('好🙂', 1))).toBe(false)
  applyRunText(parts, delta('🙂 world', 2))
  expect(parts.get('one')).toBe('你好🙂 world')
  expect(applyRunText(parts, delta('gap', 100))).toBe(false)
  expect(applyRunText(parts, delta('legacy'))).toBe(false)
})
it('keeps independent assistant parts in order and accepts a completed snapshot', () => {
  const parts = new Map<string, string>()
  applyRunText(parts, delta('first', 0)); applyRunText(parts, delta('second', 0, 'two'))
  applyRunText(parts, { kind: 'item_completed', item: { kind: 'assistant_text', id: 'one', text: 'First.' } } as RuntimeEvent)
  expect([...parts.values()].join('\n\n')).toBe('First.\n\nsecond')
})
it('bounds streamed item count and individual text size', () => {
  const parts = new Map<string, string>()
  for (let i = 0; i < 1000; i++) applyRunText(parts, delta('x', 0, String(i)))
  expect(parts.size).toBe(128)
  applyRunText(parts, delta('x'.repeat(100000), 1, '0'))
  expect(parts.get('0')!.length).toBe(64000)
})

it('repairs a checkpoint behind the subscription boundary before applying live offsets', () => {
  const parts = new Map([['one', 'word0 word1 ']])
  expect(applyRunText(parts, delta('word3 ', 18))).toBe(false)
  for (const event of [delta('word0 ', 0), delta('word1 ', 6), delta('word2 ', 12), delta('word3 ', 18)]) applyRunText(parts, event)
  applyRunText(parts, delta('word3 ', 18))
  expect(parts.get('one')).toBe('word0 word1 word2 word3 ')
})
