import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { MiniWindowOverlay } from './MiniWindowOverlay'

describe('MiniWindowOverlay', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders a draggable layer with a restore badge and a drag hint', () => {
    const html = renderToStaticMarkup(createElement(MiniWindowOverlay))
    // The root stays a plain div so it can act as a window drag region; the
    // clickable restore control is the nested badge button.
    expect(html).toContain('ds-mini-restore')
    expect(html).not.toContain('<button class="ds-mini-restore"')
    expect(html).toContain('ds-mini-restore-badge')
    expect(html).toContain('Restore window')
    expect(html).toContain('ds-mini-restore-hint')
    expect(html).toContain('Drag anywhere to move')
  })
})
