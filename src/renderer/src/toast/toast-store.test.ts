import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetToasts, useToastStore } from './toast-store'
import type { ToastInput } from './toast-types'

const publish = (input: ToastInput): void => useToastStore.getState().publish(input)
const ids = (): string[] => useToastStore.getState().items.map((item) => item.id)
const success = (id: string, extra: Partial<ToastInput> = {}): ToastInput =>
  ({ id, tone: 'success', title: id, ...extra })

beforeEach(() => {
  vi.useFakeTimers()
  resetToasts()
})

afterEach(() => {
  resetToasts()
  vi.useRealTimers()
})

describe('toast store timing', () => {
  it('clears a plain success after four seconds', () => {
    publish(success('saved'))
    expect(ids()).toEqual(['saved'])
    vi.advanceTimersByTime(3_999)
    expect(ids()).toEqual(['saved'])
    vi.advanceTimersByTime(1)
    expect(ids()).toEqual([])
  })

  it('keeps running work and failures until they are dismissed', () => {
    publish({ id: 'restart', tone: 'running', title: 'Restarting' })
    publish({ id: 'failed', tone: 'error', title: 'Update failed' })
    vi.advanceTimersByTime(60_000)
    expect(ids()).toEqual(['restart', 'failed'])
  })

  it('does not restart the countdown when a card is republished unchanged', () => {
    publish(success('saved'))
    vi.advanceTimersByTime(3_000)
    publish(success('saved'))
    expect(ids()).toEqual(['saved'])
    vi.advanceTimersByTime(1_000)
    expect(ids()).toEqual([])
  })

  it('restarts the countdown when a phase change brings a new duration', () => {
    publish({ id: 'speak', tone: 'running', title: 'Preparing' })
    vi.advanceTimersByTime(5_000)
    publish({ id: 'speak', tone: 'success', title: 'Ready', durationMs: 8_000 })
    vi.advanceTimersByTime(7_999)
    expect(ids()).toEqual(['speak'])
    vi.advanceTimersByTime(1)
    expect(ids()).toEqual([])
  })

  it('freezes the countdown while the pointer or focus is on the card', () => {
    publish(success('saved'))
    vi.advanceTimersByTime(2_000)
    useToastStore.getState().pause('saved')
    vi.advanceTimersByTime(30_000)
    expect(ids()).toEqual(['saved'])
    useToastStore.getState().resume('saved')
    vi.advanceTimersByTime(1_999)
    expect(ids()).toEqual(['saved'])
    vi.advanceTimersByTime(1)
    expect(ids()).toEqual([])
  })

  it('reports a card leaving exactly once, whatever removed it', () => {
    const onDismiss = vi.fn()
    publish(success('saved', { onDismiss }))
    useToastStore.getState().dismiss('saved')
    useToastStore.getState().dismiss('saved')
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('toast store capacity', () => {
  it('never shows more than three cards', () => {
    for (const id of ['a', 'b', 'c', 'd']) publish(success(id))
    expect(ids()).toEqual(['b', 'c', 'd'])
    expect(useToastStore.getState().waitingItems).toEqual([])
  })

  it('keeps an important card that arrived behind three others, then shows it', () => {
    publish({ id: 'one', tone: 'running', title: 'one' })
    publish({ id: 'two', tone: 'error', title: 'two' })
    publish({ id: 'three', tone: 'running', title: 'three' })
    publish({ id: 'four', tone: 'error', title: 'four' })
    expect(ids()).toEqual(['two', 'three', 'four'])
    expect(useToastStore.getState().waitingItems.map((item) => item.id)).toEqual(['one'])

    useToastStore.getState().dismiss('two')
    expect(ids()).toEqual(['one', 'three', 'four'])
    expect(useToastStore.getState().waitingItems).toEqual([])
  })

  it('does not start the countdown of a waiting card until it is shown', () => {
    for (const id of ['a', 'b', 'c']) publish({ id, tone: 'error', title: id })
    publish(success('saved'))
    publish(success('undo', { actions: [{ label: 'Undo', run: () => {} }] }))
    expect(useToastStore.getState().waitingItems.map((item) => item.id)).toEqual(['a'])
    vi.advanceTimersByTime(12_000)
    expect(ids()).toEqual(['a', 'b', 'c'])
  })
})
