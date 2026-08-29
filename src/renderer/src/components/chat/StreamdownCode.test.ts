import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import '../../i18n'
import { StreamdownCode } from './StreamdownCode'

describe('StreamdownCode plain text fences', () => {
  it('renders text fenced blocks with plain text code block chrome', () => {
    const html = renderToStaticMarkup(
      createElement(
        StreamdownCode,
        { className: 'language-text', 'data-block': true },
        'refactor(chat): simplify composer\n\n- Keep only Stop\n'
      )
    )

    expect(html).toContain('ds-code-block-header')
    expect(html).toContain('plain text')
    expect(html).toContain('refactor(chat): simplify composer')
    expect(html).toContain('- Keep only Stop')
    expect(html).toContain('Download code')
    expect(html).toContain('Copy code')
  })

  it('renders language-less fenced blocks with plain text code block chrome', () => {
    const html = renderToStaticMarkup(
      createElement(
        StreamdownCode,
        { 'data-block': true },
        'echo hello\n'
      )
    )

    expect(html).toContain('data-language="plain text"')
    expect(html).toContain('plain text')
    expect(html).toContain('echo hello')
    expect(html).toContain('Copy code')
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

  it('renders design_canvas fenced blocks as compact chips', () => {
    const html = renderToStaticMarkup(
      createElement(
        StreamdownCode,
        { className: 'language-design_canvas', 'data-block': true },
        '{ "action": "add_screen", "name": "Home" }'
      )
    )

    expect(html).toContain('Canvas ops')
    expect(html).not.toContain('add_screen')
  })

  it('renders recognized design canvas json fenced blocks as compact chips', () => {
    const html = renderToStaticMarkup(
      createElement(
        StreamdownCode,
        { className: 'language-json', 'data-block': true },
        '{ "action": "add_screen", "name": "Home" }'
      )
    )

    expect(html).toContain('Canvas ops')
    expect(html).not.toContain('add_screen')
  })

  it('keeps unrelated json fenced blocks as normal code', () => {
    const html = renderToStaticMarkup(
      createElement(
        StreamdownCode,
        { className: 'language-json', 'data-block': true },
        '{ "name": "Home" }'
      )
    )

    expect(html).toContain('ds-code-block-header')
    expect(html).toContain('json')
    expect(html).toContain('Home')
  })
})
