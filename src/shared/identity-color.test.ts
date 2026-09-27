import { describe, expect, it } from 'vitest'
import { IDENTITY_COLORS, identityColor } from './identity-color'

describe('identityColor', () => {
  it('is deterministic and always returns a palette entry', () => {
    for (const key of ['thr_1', 'thr_2', 'codex', 'claude-code', '']) {
      expect(IDENTITY_COLORS).toContain(identityColor(key))
      expect(identityColor(key)).toBe(identityColor(key))
    }
  })

  it('does not collide for a small worker set', () => {
    const colors = new Set(['w1', 'w2', 'w3', 'w4'].map(identityColor))
    // Not guaranteed unique, but a stable spread is expected.
    expect(colors.size).toBeGreaterThan(1)
  })
})
