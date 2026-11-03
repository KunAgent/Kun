import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FloatingComposerAboveInputStack } from './FloatingComposerAboveInputStack'

describe('FloatingComposerAboveInputStack', () => {
  it('keeps flow panels and the tray in normal flow, tray last', () => {
    const html = renderToStaticMarkup(createElement(FloatingComposerAboveInputStack, {
      flowPanels: createElement('div', { 'data-flow-panel': true }),
      tray: createElement('div', { 'data-composer-tray': true })
    }))

    const flowIndex = html.indexOf('data-composer-flow-panel-stack')
    const panelIndex = html.indexOf('data-flow-panel=')
    const trayIndex = html.indexOf('data-composer-tray')
    expect(flowIndex).toBeGreaterThanOrEqual(0)
    expect(panelIndex).toBeGreaterThan(flowIndex)
    expect(trayIndex).toBeGreaterThan(panelIndex)
    expect(html).not.toContain('absolute')
    expect(html).not.toContain('data-composer-floating-status-stack')
  })

  it('collapses the flow-panel stack when there is nothing to show', () => {
    const html = renderToStaticMarkup(createElement(FloatingComposerAboveInputStack, {}))
    expect(html).toContain('empty:hidden')
    expect(html).not.toContain('data-composer-tray')
  })

  it('reserves only the dock transition, since the tray now lives in flow', async () => {
    const [css, baseShell] = await Promise.all([
      readFile(new URL('../../styles/base-shell/composer-status-overlay.css', import.meta.url), 'utf8'),
      readFile(new URL('../../styles/base-shell.css', import.meta.url), 'utf8')
    ])

    expect(baseShell).toContain("@import './base-shell/composer-status-overlay.css';")
    expect(css).toContain('--ds-composer-transition-height: 2.5rem')
    expect(css).not.toContain('--ds-composer-transition-height: 4rem')
    expect(css).toMatch(/\.ds-composer-dock::before\s*\{[^}]*top:\s*0;/s)
    expect(css).not.toContain('top: calc(0px - var(--ds-composer-transition-height))')
    expect(css).not.toContain('--ds-composer-floating-status-height')
    expect(css).toMatch(/\.ds-message-timeline-content\s*\{\s*padding-bottom:\s*var\(--ds-composer-transition-height\);/s)
    expect(css).toContain('var(--bg-canvas)')
    expect(css).toContain('backdrop-filter: blur(12px)')
    expect(css).toContain('mask-image: linear-gradient')
    expect(css).toContain('pointer-events: none')
    expect(css).toMatch(/\.ds-composer-input-slot\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1;/s)
  })
})
