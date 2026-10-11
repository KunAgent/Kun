import { describe, expect, it } from 'vitest'
import { SteeringQueue } from './steering-queue.js'

describe('SteeringQueue', () => {
  it('keeps concurrent turn buffers isolated', () => {
    const queue = new SteeringQueue()
    queue.enqueue('turn_a', { text: 'private instruction for A' })
    queue.enqueue('turn_b', { text: 'private instruction for B' })

    expect(queue.drain('turn_b')).toEqual([{ text: 'private instruction for B' }])
    expect(queue.drain('turn_a')).toEqual([{ text: 'private instruction for A' }])
  })

  it('clearing one turn does not discard another turn steering', () => {
    const queue = new SteeringQueue()
    queue.enqueue('turn_a', { text: 'A' })
    queue.enqueue('turn_b', { text: 'B' })

    queue.clear('turn_a')

    expect(queue.drain('turn_a')).toEqual([])
    expect(queue.drain('turn_b')).toEqual([{ text: 'B' }])
  })

  it('rejects entries that exceed a turn buffer entry or byte budget', () => {
    const queue = new SteeringQueue({ maxEntriesPerTurn: 2, maxBytesPerTurn: 6 })

    expect(queue.enqueue('turn_a', { text: 'abc' })).toBe(true)
    expect(queue.enqueue('turn_a', { text: 'de' })).toBe(true)
    expect(queue.enqueue('turn_a', { text: 'f' })).toBe(false)
    expect(queue.enqueue('turn_b', { text: '1234567' })).toBe(false)

    expect(queue.drain('turn_a')).toEqual([{ text: 'abc' }, { text: 'de' }])
    expect(queue.drain('turn_b')).toEqual([])
  })

  it('seals only an empty turn and rejects guidance after terminal ownership transfers', () => {
    const queue = new SteeringQueue()
    expect(queue.enqueue('turn_a', { text: 'arrived before completion' })).toBe(true)

    expect(queue.sealIfEmpty('turn_a')).toBe(false)
    expect(queue.isSealed('turn_a')).toBe(false)
    expect(queue.drain('turn_a')).toEqual([{ text: 'arrived before completion' }])

    expect(queue.sealIfEmpty('turn_a')).toBe(true)
    expect(queue.isSealed('turn_a')).toBe(true)
    expect(queue.enqueue('turn_a', { text: 'too late' })).toBe(false)
  })

  it('clearing terminal state also clears the turn seal', () => {
    const queue = new SteeringQueue()
    expect(queue.sealIfEmpty('turn_a')).toBe(true)

    queue.clear('turn_a')

    expect(queue.isSealed('turn_a')).toBe(false)
    expect(queue.enqueue('turn_a', { text: 'new lifecycle' })).toBe(true)
  })

  it('atomically replaces a pending queue and rejects invalid replacements', () => {
    const queue = new SteeringQueue({ maxEntriesPerTurn: 2, maxBytesPerTurn: 8 })
    queue.enqueue('turn_a', { text: 'old' })

    expect(queue.replace('turn_a', [{ text: 'new' }, { text: 'next' }])).toBe(true)
    expect(queue.peek('turn_a')).toEqual([{ text: 'new' }, { text: 'next' }])
    expect(queue.replace('turn_a', [{ text: 'too-long!' }])).toBe(false)
    expect(queue.peek('turn_a')).toEqual([{ text: 'new' }, { text: 'next' }])
  })

  it('notifies subscribers when guidance may have become pending', () => {
    const queue = new SteeringQueue()
    const seen: string[] = []
    const unsubscribe = queue.subscribe('turn_a', () => seen.push('a'))
    queue.subscribe('turn_b', () => seen.push('b'))

    queue.enqueue('turn_a', { text: 'look here' })
    queue.enqueue('turn_a', { text: '   ' })
    queue.holdAdmission('turn_a')()
    queue.replace('turn_a', [{ text: 'replaced' }])
    expect(seen).toEqual(['a', 'a', 'a'])

    unsubscribe()
    queue.enqueue('turn_a', { text: 'later' })
    queue.enqueue('turn_b', { text: 'other turn' })
    expect(seen).toEqual(['a', 'a', 'a', 'b'])
    queue.clear('turn_b')
    queue.enqueue('turn_b', { text: 'after clear' })
    expect(seen).toEqual(['a', 'a', 'a', 'b'])
  })

  it('preserves attachment ids by value and includes them in byte accounting', () => {
    const attachmentIds = ['att_0123456789abcdef01234567']
    const queue = new SteeringQueue({ maxBytesPerTurn: 128 })

    expect(queue.enqueue('turn_image', { text: 'inspect', attachmentIds })).toBe(true)
    attachmentIds[0] = 'mutated'
    const peeked = queue.peek('turn_image')
    peeked[0]!.attachmentIds![0] = 'also-mutated'

    expect(queue.drain('turn_image')).toEqual([{
      text: 'inspect',
      attachmentIds: ['att_0123456789abcdef01234567']
    }])
    expect(queue.drainedAttachmentIds('turn_image')).toEqual([
      'att_0123456789abcdef01234567'
    ])
    queue.clear('turn_image')
    expect(queue.drainedAttachmentIds('turn_image')).toEqual([])
    expect(new SteeringQueue({ maxBytesPerTurn: 8 }).enqueue('turn_small', {
      text: 'x',
      attachmentIds: ['att_0123456789abcdef01234567']
    })).toBe(false)
  })
})
