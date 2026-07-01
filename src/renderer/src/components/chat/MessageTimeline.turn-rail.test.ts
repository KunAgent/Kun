import { describe, expect, it } from 'vitest'
import { activeTimelineTurnKey } from './MessageTimeline'

describe('activeTimelineTurnKey', () => {
  const positions = [
    { key: 'turn-1', top: -220 },
    { key: 'turn-2', top: 40 },
    { key: 'turn-3', top: 280 }
  ]

  it('keeps the latest turn that crossed the viewport threshold active', () => {
    expect(activeTimelineTurnKey(positions)).toBe('turn-2')
  })

  it('uses the first turn before any later turn crosses the threshold', () => {
    expect(activeTimelineTurnKey([
      { key: 'turn-1', top: 180 },
      { key: 'turn-2', top: 420 }
    ])).toBe('turn-1')
  })

  it('returns null for an empty timeline', () => {
    expect(activeTimelineTurnKey([])).toBeNull()
  })
})
