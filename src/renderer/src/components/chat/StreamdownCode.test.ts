import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StreamdownCode } from './StreamdownCode'

describe('StreamdownCode plain text fences', () => {
  it('renders text fenced blocks without code block chrome', () => {
    const html = renderToStaticMarkup(
      createElement(
        StreamdownCode,
        { className: 'language-text', 'data-block': true },
        'refactor(chat): simplify composer\n\n- Keep only Stop\n'
      )
    )

    expect(html).toContain('ds-plain-text-block')
    expect(html).toContain('refactor(chat): simplify composer')
    expect(html).toContain('- Keep only Stop')
    expect(html).not.toContain('ds-code-block-header')
    expect(html).not.toContain('Download code')
    expect(html).not.toContain('Copy code')
  })

  it('hides empty plain text fenced blocks', () => {
    const html = renderToStaticMarkup(
      createElement(
        StreamdownCode,
        { className: 'language-text', 'data-block': true },
        '\n'
      )
    )

    expect(html).toBe('')
  })
})

describe('StreamdownCode HTML preview', () => {
  it('renders html fenced blocks as an inline sandboxed preview by default', () => {
    const html = renderToStaticMarkup(
      createElement(
        StreamdownCode,
        { className: 'language-html', 'data-block': true },
        '<style>body{color:red}</style><h1>Hello</h1>\n'
      )
    )

    expect(html).toContain('data-streamdown="html-preview"')
    expect(html).toContain('class="ds-code-block-preview-frame"')
    expect(html).toContain('sandbox="allow-forms allow-modals allow-popups allow-scripts"')
    expect(html).toContain('Show HTML source')
    expect(html).toContain('&lt;h1&gt;Hello&lt;/h1&gt;')
    expect(html).toContain('<iframe')
    expect(html).not.toContain('ds-code-block-html')
  })

  it('does not render previews or preview toggles for non-html fenced blocks', () => {
    const html = renderToStaticMarkup(
      createElement(
        StreamdownCode,
        { className: 'language-ts', 'data-block': true },
        'const value = 1\n'
      )
    )

    expect(html).not.toContain('data-streamdown="html-preview"')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('Show HTML source')
    expect(html).not.toContain('Show HTML preview')
  })
})
