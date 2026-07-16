import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ExtensionFeaturesView } from './ExtensionFeaturesView'

describe('ExtensionFeaturesView', () => {
  it('renders every registered agent capability as a tab', () => {
    const html = renderToStaticMarkup(createElement(ExtensionFeaturesView))

    expect(html).toContain('Experts')
    expect(html).toContain('Collaboration')
    expect(html).toContain('MoA')
    expect(html).toContain('Automation')
    expect(html).toContain('Design System')
    expect(html).toContain('Experts Plaza')
  })
})
