import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StreamdownAssistant } from './StreamdownAssistant'

function renderMarkdown(text: string): string {
  return renderToStaticMarkup(createElement(StreamdownAssistant, {
    text,
    streaming: false
  }))
}

describe('chat math compatibility', () => {
  it('renders display math through the production Streamdown math plugin', () => {
    const html = renderMarkdown('A formula:\n\n$$\n\\frac{a}{b} + \\sqrt{x^2}\n$$')
    expect(html).toContain('katex-html')
    expect(html).toContain('katex-base')
    expect(html).toContain('katex-strut')
    expect(html).toContain('<mfrac>')
    expect(html).not.toContain('katex-error')
  })

  it('keeps currency as literal text with single-dollar math disabled', () => {
    const html = renderMarkdown('Prices are $5 and $10.')
    expect(html).toContain('$5 and $10')
    expect(html).not.toContain('katex-html')
  })

  it('refuses external images and javascript links embedded in math', () => {
    const html = renderMarkdown([
      '$$',
      '\\includegraphics{https://math-attacker.invalid/pixel.png}',
      '\\href{javascript:alert(1)}{click}',
      '$$'
    ].join('\n'))
    expect(html).not.toMatch(/<img\b|<iframe\b|<script\b|href="javascript:|src="https:/i)
  })
})
