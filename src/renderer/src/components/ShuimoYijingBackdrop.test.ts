import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { UiPluginHostEffect } from '@shared/ui-plugin'
import { ShuimoYijingBackdrop } from './ShuimoYijingBackdrop'

const effect: UiPluginHostEffect = {
  kind: 'shuimo-yijing',
  hexagram: {
    ordinal: 1,
    glyph: '䷀',
    name: '乾',
    statement: '元亨利貞',
    statementCommentary: '六畫者伏羲所畫之卦也',
    movingLine: 1,
    movingLineLabel: '初九',
    movingLineText: '潛龍勿用',
    movingLineCommentary: '初陽在下未可施用'
  }
}

describe('ShuimoYijingBackdrop', () => {
  it('renders every approved text field as inert plain content', () => {
    const html = renderToStaticMarkup(createElement(ShuimoYijingBackdrop, { effect }))

    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('pointer-events-none')
    expect(html).toContain('䷀')
    expect(html).toContain('乾')
    expect(html).toContain('元亨利貞')
    expect(html).toContain('六畫者伏羲所畫之卦也')
    expect(html).toContain('初九')
    expect(html).toContain('潛龍勿用')
    expect(html).toContain('初陽在下未可施用')
    expect(html).not.toContain('dangerouslySetInnerHTML')
  })

  it('escapes effect text instead of interpreting it as markup', () => {
    const unsafeEffect: UiPluginHostEffect = {
      ...effect,
      hexagram: { ...effect.hexagram, statementCommentary: '<script>alert(1)</script>' }
    }

    const html = renderToStaticMarkup(createElement(ShuimoYijingBackdrop, { effect: unsafeEffect }))

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('renders nothing without the trusted effect', () => {
    expect(
      renderToStaticMarkup(createElement(ShuimoYijingBackdrop, { effect: undefined }))
    ).toBe('')
  })
})
