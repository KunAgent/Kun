import { afterEach, describe, expect, it } from 'vitest'
import {
  fastContextProcessSlotSnapshot,
  resetFastContextProcessSlotsForTests,
  withFastContextProcessSlot
} from './fast-context-process-slots.js'

describe('Fast Context process slots', () => {
  afterEach(() => {
    delete process.env.KUN_FAST_CONTEXT_PROCESS_SLOTS
    resetFastContextProcessSlotsForTests()
  })

  it('caps concurrent helpers process-wide and drains in order', async () => {
    process.env.KUN_FAST_CONTEXT_PROCESS_SLOTS = '2'
    resetFastContextProcessSlotsForTests()
    const signal = new AbortController().signal
    let active = 0
    let peak = 0
    const order: number[] = []
    const work = (id: number) => withFastContextProcessSlot(signal, async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      order.push(id)
      active -= 1
    })
    await Promise.all([1, 2, 3, 4, 5].map(work))
    expect(peak).toBe(2)
    expect(order).toHaveLength(5)
    expect(fastContextProcessSlotSnapshot()).toEqual({ active: 0, waiting: 0, capacity: 2 })
  })

  it('rejects a queued helper whose signal aborts and releases nothing it never held', async () => {
    process.env.KUN_FAST_CONTEXT_PROCESS_SLOTS = '1'
    resetFastContextProcessSlotsForTests()
    let release!: () => void
    const holder = withFastContextProcessSlot(new AbortController().signal, () => new Promise<void>((resolve) => { release = resolve }))
    const controller = new AbortController()
    const queued = withFastContextProcessSlot(controller.signal, async () => 'ran')
    expect(fastContextProcessSlotSnapshot().waiting).toBe(1)
    controller.abort()
    await expect(queued).rejects.toThrow('aborted while queued')
    release()
    await holder
    expect(fastContextProcessSlotSnapshot()).toEqual({ active: 0, waiting: 0, capacity: 1 })
  })

  it('ignores an out-of-range capacity override', () => {
    process.env.KUN_FAST_CONTEXT_PROCESS_SLOTS = '500'
    resetFastContextProcessSlotsForTests()
    expect(fastContextProcessSlotSnapshot().capacity).toBe(4)
  })
})
