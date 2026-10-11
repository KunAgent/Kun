// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderWorkMarkdownToHtml } from './render-html'

function render(markdown: string, highlightedCode: Record<string, string>, math: 'html' | 'latex' = 'html'): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = renderWorkMarkdownToHtml(markdown, { math, highlightedCode })
  return root
}

const highlighted = (text: string, marker: string) => `<code data-highlight="${marker}">${text}</code>`
const texts = (root: HTMLElement) => [...root.querySelectorAll('pre code')].map(code => code.textContent)

describe('export code highlight provenance', () => {
  it('binds highlights to parsed fences instead of raw pre elements before and between them', () => {
    const root = render([
      '<pre><code>literal before</code></pre>',
      '```js\nfirst()\n```',
      '<pre data-code-index="1" data-source-offset="0"><code>literal between</code></pre>',
      '```js\nsecond()\n```'
    ].join('\n\n'), { 'first()': highlighted('first()', 'first'), 'second()': highlighted('second()', 'second') })
    expect(texts(root)).toEqual(['literal before', 'first()', 'literal between', 'second()'])
    expect([...root.querySelectorAll('[data-highlight]')].map(node => node.textContent)).toEqual(['first()', 'second()'])
  })

  it('does not highlight literal content even when it matches a real fence exactly', () => {
    const root = render('<pre><code>same()</code></pre>\n\n```js\nsame()\n```', {
      'same()': highlighted('same()', 'fence')
    })
    expect(texts(root)).toEqual(['same()', 'same()'])
    expect(root.querySelector('pre')?.querySelector('[data-highlight]')).toBeNull()
    expect(root.querySelectorAll('[data-highlight]')).toHaveLength(1)
  })

  it('preserves nested fenced blocks and source offsets after frontmatter/CRLF normalization', () => {
    const root = render([
      '---', 'title: Example', '---', '', '<pre><code>literal</code></pre>', '',
      '> ```js', '> quoted()', '> ```', '', '- List', '', '  ```', '  listed()', '  ```'
    ].join('\r\n'), { 'quoted()': highlighted('quoted()', 'quote'), 'listed()': highlighted('listed()', 'list') })
    expect(texts(root)).toEqual(['literal', 'quoted()', 'listed()'])
    expect(root.querySelector('blockquote [data-highlight="quote"]')).not.toBeNull()
    expect(root.querySelector('li [data-highlight="list"]')).not.toBeNull()
  })

  it('keeps math and Mermaid fallback pre elements outside the code highlight mapping', () => {
    const root = render('$$\nx^2\n$$\n\n```mermaid\ngraph LR; a-->b\n```\n\n```js\nlast()\n```', {
      'last()': highlighted('last()', 'last')
    }, 'latex')
    expect([...root.querySelectorAll('pre')].map(node => node.textContent)).toEqual(['x^2', 'graph LR; a-->b', 'last()'])
    expect(root.querySelectorAll('[data-highlight]')).toHaveLength(1)
    expect(root.querySelector('[data-highlight]')?.textContent).toBe('last()')
  })

  it('supports a fence at source offset zero, including an empty code value', () => {
    const root = render('```\n```', { '': highlighted('', 'empty') })
    expect(root.querySelector('[data-highlight="empty"]')).not.toBeNull()
    expect(texts(root)).toEqual([''])
  })

  it('does not treat inherited highlight-map properties as trusted rendered code', () => {
    const inherited = Object.create({ constructor: highlighted('replaced', 'inherited') }) as Record<string, string>
    const root = render('```text\nconstructor\n```', inherited)
    expect(texts(root)).toEqual(['constructor\n'])
    expect(root.querySelector('[data-highlight]')).toBeNull()
  })
})
