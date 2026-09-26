import { describe, expect, it } from 'vitest'
import { maskBlockText } from './translate-mask'

describe('maskBlockText', () => {
  it('masks inline math, URLs, and bracketed citations', () => {
    const { masked, restore } = maskBlockText(
      'Attention $QK^T$ works [12], see https://arxiv.org/abs/1706.03762 and Eq. (2).'
    )
    expect(masked).toBe('Attention ⟦0⟧ works ⟦1⟧, see ⟦2⟧ and ⟦3⟧.')
    expect(restore('注意力 ⟦0⟧ 有效 ⟦1⟧，见 ⟦2⟧ 与 ⟦3⟧。')).toBe(
      '注意力 $QK^T$ 有效 [12]，见 https://arxiv.org/abs/1706.03762 与 Eq. (2)。'
    )
  })

  it('masks ranges and multi-citations', () => {
    const { masked } = maskBlockText('prior work [3, 7, 14–18] shows')
    expect(masked).toBe('prior work ⟦0⟧ shows')
  })

  it('restores placeholders even when the model adds spaces', () => {
    const { restore } = maskBlockText('see [5].')
    expect(restore('见 ⟦ 0 ⟧ 。')).toBe('见 [5] 。')
  })

  it('leaves un-emitting extra placeholders untouched', () => {
    const { restore } = maskBlockText('see [5].')
    expect(restore('⟦9⟧ stays')).toBe('⟦9⟧ stays')
  })

  it('keeps plain text unchanged', () => {
    const { masked } = maskBlockText('Nothing to mask here.')
    expect(masked).toBe('Nothing to mask here.')
  })
})
