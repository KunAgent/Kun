import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHoverIntent } from './hover-intent'

function machine() {
  const onOpen = vi.fn()
  const onClose = vi.fn()
  const hover = createHoverIntent({ openDelay: 250, closeDelay: 200, onOpen, onClose })
  return { hover, onOpen, onClose }
}

describe('createHoverIntent', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('opens after the open delay and not before', () => {
    const { hover, onOpen } = machine()
    hover.enterTrigger()
    vi.advanceTimersByTime(249)
    expect(onOpen).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(hover.isOpen()).toBe(true)
  })

  it('cancels a pending open when the trigger is left early', () => {
    const { hover, onOpen } = machine()
    hover.enterTrigger()
    vi.advanceTimersByTime(100)
    hover.leaveTrigger()
    vi.advanceTimersByTime(500)
    expect(onOpen).not.toHaveBeenCalled()
    expect(hover.isOpen()).toBe(false)
  })

  it('stays open when the pointer moves from trigger into the menu', () => {
    const { hover, onClose } = machine()
    hover.enterTrigger()
    vi.advanceTimersByTime(250)
    hover.leaveTrigger()
    vi.advanceTimersByTime(100)
    hover.enterMenu()
    vi.advanceTimersByTime(500)
    expect(onClose).not.toHaveBeenCalled()
    expect(hover.isOpen()).toBe(true)
  })

  it('closes after the close delay once both sides are left', () => {
    const { hover, onClose } = machine()
    hover.enterTrigger()
    vi.advanceTimersByTime(250)
    hover.leaveTrigger()
    hover.enterMenu()
    hover.leaveMenu()
    vi.advanceTimersByTime(199)
    expect(onClose).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(hover.isOpen()).toBe(false)
  })

  it('never auto-closes after being pinned', () => {
    const { hover, onClose } = machine()
    hover.enterTrigger()
    vi.advanceTimersByTime(250)
    hover.pin()
    hover.leaveTrigger()
    hover.leaveMenu()
    vi.advanceTimersByTime(1000)
    expect(onClose).not.toHaveBeenCalled()
    expect(hover.isOpen()).toBe(true)
  })

  it('openNow opens pinned immediately', () => {
    const { hover, onOpen, onClose } = machine()
    hover.openNow()
    expect(onOpen).toHaveBeenCalledTimes(1)
    hover.leaveTrigger()
    vi.advanceTimersByTime(1000)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closeNow closes immediately regardless of state', () => {
    const { hover, onOpen, onClose } = machine()
    hover.enterTrigger()
    vi.advanceTimersByTime(250)
    hover.closeNow()
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(hover.isOpen()).toBe(false)
    // And from the armed-but-not-open state it just disarms.
    hover.enterTrigger()
    hover.closeNow()
    vi.advanceTimersByTime(500)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
