import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { MiniWindowOverlay } from './MiniWindowOverlay'

describe('MiniWindowOverlay', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders a dedicated toolbar with a restore button and a scoped drag hint', () => {
    const html = renderToStaticMarkup(createElement(MiniWindowOverlay))
    expect(html).toContain('data-mini-window-toolbar')
    expect(html).not.toContain('<button class="ds-mini-restore"')
    expect(html).toContain('ds-mini-restore-badge')
    expect(html).toContain('Restore window')
    expect(html).toContain('ds-mini-restore-hint')
    expect(html).toContain('Drag this bar to move')
  })
})
