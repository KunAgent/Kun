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

  it('renders nothing for a structurally invalid effect received at runtime', () => {
    expect(
      renderToStaticMarkup(
        createElement(ShuimoYijingBackdrop, {
          effect: { kind: 'shuimo-yijing' } as UiPluginHostEffect
        })
      )
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

    const lightThemeSelectors = [
      "html[data-ui-plugin='shuimo-yijing']",
      "html[data-ui-plugin='shuimo-yijing'] .ds-workbench-shell",
      "html[data-ui-plugin='shuimo-yijing'] .ds-settings-shell"
    ].join(',\n')
    const lightThemeRule = readCssRule(css, lightThemeSelectors)
    expect(lightThemeRule).toContain(
      '--ds-stage-gradient: linear-gradient(180deg, rgba(247, 245, 238, 0.38), rgba(232, 233, 226, 0.28));'
    )
    expect(lightThemeRule).toContain(
      '--ds-topbar-bg: linear-gradient(180deg, rgba(248, 247, 240, 0.62), rgba(242, 240, 231, 0.45));'
    )
    expect(lightThemeRule).toContain(
      '--ds-sidebar-gradient: linear-gradient(180deg, rgba(236, 237, 230, 0.56), rgba(229, 231, 223, 0.5));'
    )

    const darkThemeSelectors = [
      "[data-theme='dark'][data-ui-plugin='shuimo-yijing']",
      "[data-theme='dark'][data-ui-plugin='shuimo-yijing'] .ds-workbench-shell",
      "[data-theme='dark'][data-ui-plugin='shuimo-yijing'] .ds-settings-shell"
    ].join(',\n')
    const darkThemeRule = readCssRule(css, darkThemeSelectors)
    expect(darkThemeRule).toContain(
      '--ds-stage-gradient: linear-gradient(180deg, rgba(31, 38, 34, 0.38), rgba(20, 25, 22, 0.3));'
    )
    expect(darkThemeRule).toContain(
      '--ds-topbar-bg: linear-gradient(180deg, rgba(35, 42, 38, 0.62), rgba(24, 30, 27, 0.48));'
    )
    expect(darkThemeRule).toContain(
      '--ds-sidebar-gradient: linear-gradient(180deg, rgba(25, 31, 28, 0.58), rgba(17, 22, 19, 0.52));'
    )

    const rootSurfaceRule = readCssRule(css, [
      "html[data-ui-plugin='shuimo-yijing'] .ds-app-shell",
      "html[data-ui-plugin='shuimo-yijing'] .ds-workbench-shell",
      "html[data-ui-plugin='shuimo-yijing'] .ds-settings-shell"
    ].join(',\n'))
    expect(rootSurfaceRule).toContain('background-color: transparent;')

    const darkFigureRule = readCssRule(css, [
      "[data-theme='dark'][data-ui-plugin='shuimo-yijing'] .ds-kun-state-figure",
      "[data-theme='dark'][data-ui-plugin='shuimo-yijing'] [data-ui-plugin-id='shuimo-yijing'] img"
    ].join(',\n'))
    expect(darkFigureRule).toContain('filter: brightness(1.7) contrast(0.92);')

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
