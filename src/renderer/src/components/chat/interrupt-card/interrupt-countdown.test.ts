import { describe, expect, it } from 'vitest'
import { interruptCountdownState, interruptDeadlineMs } from './interrupt-countdown'

describe('interruptDeadlineMs', () => {
  it('adds the timeout to the creation time', () => {
    expect(interruptDeadlineMs('2026-10-23T10:00:00Z', 90)).toBe(Date.parse('2026-10-23T10:01:30Z'))
    expect(interruptDeadlineMs(1_000, 2)).toBe(3_000)
  })

  it('returns null without a usable deadline', () => {
    expect(interruptDeadlineMs(undefined, 60)).toBeNull()
    expect(interruptDeadlineMs('2026-10-23T10:00:00Z', undefined)).toBeNull()
    expect(interruptDeadlineMs('nope', 60)).toBeNull()
    expect(interruptDeadlineMs('2026-10-23T10:00:00Z', 0)).toBeNull()
  })
})

describe('interruptCountdownState', () => {
  const deadline = 100_000

  it('stays hidden until the last minute', () => {
    expect(interruptCountdownState(deadline, deadline - 61_000)).toEqual({ kind: 'hidden' })
    expect(interruptCountdownState(null, 0)).toEqual({ kind: 'hidden' })
  })

  it('counts whole seconds inside the window', () => {
    expect(interruptCountdownState(deadline, deadline - 60_000)).toEqual({ kind: 'counting', seconds: 60 })
    expect(interruptCountdownState(deadline, deadline - 41_200)).toEqual({ kind: 'counting', seconds: 42 })
    expect(interruptCountdownState(deadline, deadline - 1)).toEqual({ kind: 'counting', seconds: 1 })
  })

  it('switches to deciding once the deadline passes', () => {
    expect(interruptCountdownState(deadline, deadline)).toEqual({ kind: 'deciding' })
    expect(interruptCountdownState(deadline, deadline + 5_000)).toEqual({ kind: 'deciding' })
  })

  it('honors a custom window', () => {
    expect(interruptCountdownState(deadline, deadline - 20_000, 10)).toEqual({ kind: 'hidden' })
    expect(interruptCountdownState(deadline, deadline - 9_000, 10)).toEqual({ kind: 'counting', seconds: 9 })
  })
})
