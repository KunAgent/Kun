import { describe, expect, it } from 'vitest'
import { petBrand, petBrandBadgeLayout } from './pet-brand'

describe('AI companion brand badges', () => {
  it('identifies each AI with its own bundled provider mark', () => {
    const ids = ['whale-girl', 'gpt-girl', 'claude-girl', 'grok-girl', 'kimi-girl', 'gemini-girl',
      'glm-girl', 'qwen-girl', 'minimax-girl', 'seed-girl', 'llama-girl', 'mistral-girl',
      'hunyuan-girl', 'mimo-girl', 'doubao-girl']
    const icons = ids.map((id) => petBrand(`kun:${id}`)?.icon)
    expect(icons.every((icon) => Boolean(icon))).toBe(true)
    expect(new Set(icons).size).toBe(15)
    expect(petBrand('kun:gpt-girl')?.name).toContain('OpenAI')
    expect(petBrand('kun:llama-girl')?.name).toContain('Meta')
    expect(petBrand('kun:mimo-girl')?.name).toContain('Xiaomi')
    expect(petBrand('kun:xiao-kun')).toBeNull()
    expect(petBrand('kun-local:gpt-girl')).toBeNull()
    expect(petBrand(null)).toBeNull()
  })

  it('keeps badges within thumbnails and every supported desktop size', () => {
    for (const width of [42, 72, 80, 112, 224]) {
      for (let row = 0; row < 9; row++) {
        for (let column = 0; column < 8; column++) {
          const badge = petBrandBadgeLayout(width, row, column)
          expect(badge.left - badge.size / 2).toBeGreaterThanOrEqual(0)
          expect(badge.left + badge.size / 2).toBeLessThanOrEqual(width)
          expect(badge.top - badge.size / 2).toBeGreaterThanOrEqual(0)
          expect(badge.top + badge.size / 2).toBeLessThanOrEqual(width * 208 / 192)
        }
      }
    }
  })

  it('follows running direction and jump height', () => {
    const left = petBrandBadgeLayout(112, 2)
    const right = petBrandBadgeLayout(112, 1)
    expect(left.left).toBeLessThan(56)
    expect(right.left).toBeGreaterThan(56)
    expect(left.left + right.left).toBeCloseTo(112)
    const grounded = petBrandBadgeLayout(112, 4, 0)
    const airborne = petBrandBadgeLayout(112, 4, 2)
    expect(grounded.top - airborne.top).toBeCloseTo(18 * 112 / 192)
    expect(petBrandBadgeLayout(112, 4, 4)).toEqual(grounded)
  })
})
