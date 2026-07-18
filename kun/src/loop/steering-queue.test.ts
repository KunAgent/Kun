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
})
