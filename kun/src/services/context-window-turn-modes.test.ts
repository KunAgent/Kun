import { describe, expect, it } from 'vitest'
import { ContextWindowTurnModes } from './context-window-turn-modes.js'
import type { ContextWindowMode } from '../contracts/context-windows.js'

describe('ContextWindowTurnModes', () => {
  function makeModes(initial: ContextWindowMode = 'summary') {
    let live = initial
    const modes = new ContextWindowTurnModes(() => live)
    return {
      modes,
      setLive: (mode: ContextWindowMode) => { live = mode }
    }
  }

  it('freezes the mode at turn acceptance and ignores hot config updates', () => {
    const { modes, setLive } = makeModes('summary')
    modes.freeze({ threadId: 't1', turnId: 'turn-a' })
    expect(modes.modeFor('t1', 'turn-a')).toBe('summary')

    // Hot update lands while turn-a is still active.
    setLive('windows')
    expect(modes.modeFor('t1', 'turn-a')).toBe('summary')
    // The NEXT turn picks the new setting up.
    modes.freeze({ threadId: 't1', turnId: 'turn-b' })
    expect(modes.modeFor('t1', 'turn-b')).toBe('windows')
  })

  it('lets child threads inherit the parent accepted mode with independent window state', () => {
    const { modes, setLive } = makeModes('summary')
    modes.freeze({ threadId: 'parent', turnId: 'turn-1' })
    setLive('windows')
    // The parent accepted summary before the toggle; the child inherits the
    // originating turn's mode even though live config now says windows.
    const childMode = modes.resolveForNewTurn('parent')
    expect(childMode).toBe('summary')
    modes.freeze({ threadId: 'child', turnId: 'turn-c', parentThreadId: 'parent' })
    expect(modes.modeFor('child', 'turn-c')).toBe('summary')

    // Each thread carries its own window identity.
    modes.setWindow('parent', { windowId: 'win-1', windowSeq: 1 })
    expect(modes.windowFor('parent')).toEqual({ windowId: 'win-1', windowSeq: 1 })
    expect(modes.windowFor('child')).toBeUndefined()
    expect(modes.snapshot('parent', 'turn-1')).toEqual({
      mode: 'summary',
      windowId: 'win-1',
      windowSeq: 1
    })
    expect(modes.snapshot('child', 'turn-c')).toEqual({
      mode: 'summary',
      windowId: null,
      windowSeq: null
    })
  })

  it('falls back to live config for unknown threads and turns', () => {
    const { modes, setLive } = makeModes('summary')
    expect(modes.modeFor('unknown', 'turn-x')).toBe('summary')
    setLive('windows')
    expect(modes.modeFor('unknown', 'turn-x')).toBe('windows')
    modes.freeze({ threadId: 't1', turnId: 'turn-a' })
    // Unknown turn of a known thread inherits the thread's last accepted mode.
    expect(modes.modeFor('t1', 'turn-later')).toBe('windows')
  })
})
