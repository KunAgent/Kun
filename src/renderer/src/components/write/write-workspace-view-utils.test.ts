import { describe, expect, it } from 'vitest'
import {
  computeWriteDocumentStats,
  inlineAgentPlacement,
  type WriteInlineAgentPosition
} from './write-workspace-view-utils'

describe('computeWriteDocumentStats', () => {
  it('counts visible markdown text instead of syntax markers', () => {
    const stats = computeWriteDocumentStats('# 标题\n\n- 第一项\n- 第二项 **加粗**\n', true)

    expect(stats).toEqual({ characterCount: 10 })
  })

  it('counts non-whitespace characters for plain text files', () => {
    const stats = computeWriteDocumentStats('Hello world\n  2026  ', false)

    expect(stats).toEqual({ characterCount: 14 })
  })
})

const action: WriteInlineAgentPosition = {
  left: 320,
  width: 300,
  anchorLeft: 400,
  anchorRight: 600,
  anchorTop: 300,
  anchorBottom: 340
}

describe('inlineAgentPlacement', () => {
  it('places the menu below a selection when it fits', () => {
    expect(inlineAgentPlacement(action, {
      menuHeight: 200,
      viewportWidth: 1000,
      viewportHeight: 800
    })).toMatchObject({
      left: 320,
      top: 348,
      maxHeight: 200,
      origin: 'top-center'
    })
  })

  it('flips above without overlapping the selection', () => {
    expect(inlineAgentPlacement(
      { ...action, anchorTop: 600, anchorBottom: 640 },
      { menuHeight: 200, viewportWidth: 1000, viewportHeight: 800 }
    )).toMatchObject({
      top: 392,
      origin: 'bottom-center'
    })
  })

  it('moves beside a tall selection when neither vertical side fits', () => {
    expect(inlineAgentPlacement(
      { ...action, anchorLeft: 250, anchorRight: 450, anchorTop: 180, anchorBottom: 620 },
      { menuHeight: 260, viewportWidth: 1000, viewportHeight: 800 }
    )).toMatchObject({
      left: 458,
      top: 270,
      origin: 'center-left'
    })
  })

  it('constrains the menu to the larger vertical gap when no side fits', () => {
    const placement = inlineAgentPlacement(
      { ...action, anchorLeft: 180, anchorRight: 820, anchorTop: 260, anchorBottom: 500 },
      { menuHeight: 420, viewportWidth: 1000, viewportHeight: 800 }
    )

    expect(placement).toMatchObject({
      top: 508,
      maxHeight: 276,
      origin: 'top-center'
    })
    expect(placement.top).toBeGreaterThan(500)
  })
})
