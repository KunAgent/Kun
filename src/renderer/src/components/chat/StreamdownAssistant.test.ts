import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  StreamdownAssistant,
  visibleTextForTypewriter
} from './StreamdownAssistant'

describe('visibleTextForTypewriter', () => {
  it('does not split decomposed Vietnamese accents mid-stream', () => {
    const text = `Pha\u0302n ti\u0301ch`

    expect(visibleTextForTypewriter(text, 3)).toBe(`Pha\u0302`)
    expect(visibleTextForTypewriter(text, 8)).toBe(`Pha\u0302n ti\u0301`)
  })

  it('keeps joined emoji intact', () => {
    const text = '👩‍💻 demo'

    expect(visibleTextForTypewriter(text, 1)).toBe('👩‍💻')
    expect(visibleTextForTypewriter(text, 2)).toBe('👩‍💻')
  })
})

describe('file link hardening', () => {
  function renderMarkdown(text: string): string {
    return renderToStaticMarkup(createElement(StreamdownAssistant, {
      text,
      streaming: false
    }))
  }

  it('keeps model-authored relative file links readable without a [blocked] marker', () => {
    const html = renderMarkdown([
      '- [.mcp.json](.mcp.json)',
      '- [.claude/settings.json](.claude/settings.json)',
      '- [.codegraph/codegraph.db](.codegraph/codegraph.db)'
    ].join('\n'))

    expect(html).toContain('.mcp.json')
    expect(html).toContain('.claude/settings.json')
    expect(html).toContain('.codegraph/codegraph.db')
    expect(html).not.toContain('[blocked]')
    expect(html).not.toContain('Blocked URL')
  })

  it('lets auto-detected workspace path references pass through harden for validation', () => {
    const html = renderMarkdown('See src/renderer/src/main.tsx for the renderer entry.')

    expect(html).toContain('src/renderer/src/main.tsx')
    expect(html).not.toContain('[blocked]')
    expect(html).not.toContain('Blocked URL')
    // The internal deepseek-file: href must survive harden; without workspace
    // validation available in static rendering the component degrades it to
    // plain text, which is exactly the intended fallback path.
    expect(html).not.toContain('href="javascript:')
  })

  it('still neutralizes dangerous protocols while hiding the block indicator', () => {
    const html = renderMarkdown('[click me](javascript:alert(1))')

    expect(html).toContain('click me')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('[blocked]')
  })
})

describe('reasoning HTML comment presentation', () => {
  function renderReasoning(text: string, streaming = false): string {
    return renderToStaticMarkup(createElement(StreamdownAssistant, {
      text,
      streaming,
      hideHtmlComments: true
    }))
  }

  it('hides a completed comment from settled reasoning without changing surrounding Markdown', () => {
    const source = '**Clarifying model identity as Kun**\n\n<!-- -->'
    const html = renderReasoning(source)

    expect(source).toContain('<!-- -->')
    expect(html).toContain('Clarifying model identity as Kun')
    expect(html).not.toContain('&lt;!-- --&gt;')
    expect(html).not.toContain('<!-- -->')
  })

  it('hides both halves of a comment split across accumulated streaming states', () => {
    const firstFrame = renderReasoning('**Thinking**\n\n<!--', true)
    const completedFrame = renderReasoning('**Thinking**\n\n<!-- -->', true)

    expect(firstFrame).toContain('Thinking')
    expect(firstFrame).not.toContain('&lt;!--')
    expect(completedFrame).toContain('Thinking')
    expect(completedFrame).not.toContain('&lt;!-- --&gt;')
  })

  it('preserves HTML comment syntax inside inline and fenced code', () => {
    const html = renderReasoning([
      'Inline: `<!-- -->`',
      '',
      '```html',
      '<!-- -->',
      '```'
    ].join('\n'))

    expect(html).toContain('data-streamdown="inline-code"')
    expect(html).toContain('data-streamdown="code-block"')
    expect((html.match(/&lt;!-- --&gt;/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('keeps escaped HTML comments visible when reasoning cleanup is not requested', () => {
    const html = renderToStaticMarkup(createElement(StreamdownAssistant, {
      text: '<!-- -->',
      streaming: false
    }))

    expect(html).toContain('&lt;!-- --&gt;')
  })
})
