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

  it('keeps vertical columns, exact ink levels, and accessibility media rules wired in CSS', async () => {
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    const css = await readFile(new URL('../styles/base-shell.css', import.meta.url), 'utf8')

    const scriptRule = readCssRule(css, '.shuimo-yijing-script')
    expect(scriptRule).toContain('flex-direction: column;')
    expect(scriptRule).toContain('writing-mode: vertical-rl;')

    expect(readCssRule(css, '.shuimo-yijing-backdrop')).toContain(
      'color: rgba(39, 48, 44, 0.065);'
    )
    expect(readCssRule(css, "[data-theme='dark'] .shuimo-yijing-backdrop")).toContain(
      'color: rgba(228, 226, 217, 0.05);'
    )
    expect(css).toMatch(
      /@media \(max-width: 900px\) \{[\s\S]*?\.shuimo-yijing-script p:nth-child\(3\) \{[^}]*display: none;/
    )
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.shuimo-yijing-backdrop \{[^}]*animation: none;[^}]*opacity: 1;/
    )
  })
})

function readCssRule(css: string, selector: string): string {
  const selectorStart = css.indexOf(`${selector} {`)
  expect(selectorStart).toBeGreaterThanOrEqual(0)
  const bodyStart = css.indexOf('{', selectorStart) + 1
  const bodyEnd = css.indexOf('}', bodyStart)
  return css.slice(bodyStart, bodyEnd)
}
