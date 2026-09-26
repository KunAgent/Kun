import { describe, expect, it } from 'vitest'
import { visibleFormatActionCount } from './WriteFormatToolbar'

describe('visibleFormatActionCount', () => {
  it('shows every action when the bar is wide enough', () => {
    // 13 buttons x 32px + 2 group separators x 13px
    expect(visibleFormatActionCount(13 * 32 + 2 * 13)).toBe(13)
  })

  it('reserves room for the overflow button once anything is hidden', () => {
    // One pixel short of the full row: the last action and the overflow
    // button cannot both fit, so two actions move into the menu.
    expect(visibleFormatActionCount(13 * 32 + 2 * 13 - 1)).toBe(11)
  })

  it('collapses everything into the overflow menu on a tiny bar', () => {
    expect(visibleFormatActionCount(40)).toBe(0)
  })
})
