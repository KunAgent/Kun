// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderWorkMarkdownToHtml } from '@shared/markdown/render-html'
import { assistantExportMarkdown } from './conversation-export-markdown'
import { buildConversationExportDocument } from './conversation-export'

const hostile = [
  '# Readable answer', '', '**Important** and *emphasis*', '',
  '- [x] Checked', '- [ ] Pending', '',
  '| Claim | Evidence |', '| --- | --- |', '| Yes | Quote |', '',
  '[Link](https://attacker.invalid/link) ![Pixel](https://attacker.invalid/pixel)',
  '<https://attacker.invalid/auto> https://attacker.invalid/bare',
  '[Ref][target] ![Image ref][target]', '', '[target]: https://attacker.invalid/definition', '',
  '[Open reference][other-message]', '',
  '<img src="https://attacker.invalid/html"><iframe src="https://attacker.invalid/frame"></iframe>',
  '<style>body{background:url(https://attacker.invalid/css)}</style>', '',
  '![local](file:///private/source) ![custom](deepseek-file:///private/source)',
  '![data](data:image/svg+xml,attack) [execute](javascript:alert(1))', '',
  'Note[^note]', '', '[^note]: [Note link](https://attacker.invalid/note)', '',
  '$$\\frac{1}{2}$$', '',
  '$$\\includegraphics{https://attacker.invalid/math-image}$$', '',
  '$$\\href{https://attacker.invalid/math-link}{remote}$$', '',
  '```mermaid', 'graph LR; secret --> remote', '```', '',
  '```html', '<img src="https://attacker.invalid/code">', '```', '',
  'Literal `<!-- intact -->` and prices $5 and $10.'
].join('\n')

function render(markdown: string): HTMLDivElement {
  const container = document.createElement('div')
  container.innerHTML = renderWorkMarkdownToHtml(markdown, { math: 'mathmlDual' })
  return container
}

function expectPassive(container: HTMLDivElement): void {
  expect(container.querySelector('a,img,iframe,object,embed,script,style,link,button,form,video,audio,source')).toBeNull()
  for (const element of container.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      expect(attribute.name).not.toMatch(/^on|^(?:href|src|srcset|poster|xlink:href)$/i)
      expect(attribute.value).not.toMatch(/url\s*\(/i)
    }
  }
}

describe('bounded assistant conversation exports', () => {
  it('keeps GFM and local math without reactivating source resources in the PDF renderer', () => {
    const markdown = assistantExportMarkdown(hostile, 'safe-markdown')
    const container = render(markdown)
    expect(container.querySelector('h1')?.textContent).toBe('Readable answer')
    expect(container.querySelector('strong')?.textContent).toBe('Important')
    expect(container.querySelectorAll('input[type="checkbox"][disabled]')).toHaveLength(2)
    expect(container.querySelector('table tbody td')?.textContent).toBe('Yes')
    expect(container.querySelector('.katex')).not.toBeNull()
    expect(container.querySelectorAll('pre code')).toHaveLength(2)
    expect(container.textContent).toContain('<img src="https://attacker.invalid/code">')
    expect(container.textContent).toContain('Literal <!-- intact --> and prices $5 and $10.')
    expect(container.textContent).toContain('Note link')
    expect(markdown).not.toContain('```mermaid')
    expect(markdown).not.toContain('[target]:')
    expectPassive(container)
  })

  it('preserves literal plain-text syntax, unclosed math and boundary whitespace', () => {
    const source = '\n$$\n  # Literal\n![pixel](https://attacker.invalid/plain)\n```\n<img src="file:///private">\n````\n'
    const markdown = assistantExportMarkdown(source, 'plain-text')
    const container = render(markdown)
    expect(container.querySelectorAll('pre code')).toHaveLength(1)
    expect(container.querySelector('pre code')?.textContent).toBe(source)
    expect(container.querySelector('h1')).toBeNull()
    expectPassive(container)
  })

  it('sanitizes only constrained blocks in a mixed transcript and prevents cross-message reference activation', () => {
    const document = buildConversationExportDocument({
      title: 'Mixed thread', locale: 'en', exportedAt: new Date('2026-07-19T02:00:00.000Z'), busy: false,
      labels: { exportedAt: 'Exported', user: 'You', assistant: 'Kun', attachments: 'Attachments',
        referencedFiles: 'References', generatedFiles: 'Generated', sources: 'Sources', attachment: 'Attachment' },
      blocks: [
        { kind: 'assistant', id: 'safe', text: hostile, renderMode: 'safe-markdown' },
        { kind: 'assistant', id: 'normal', text: '[Normal](https://normal.invalid/link) ![Normal](https://normal.invalid/image)\n\n[other-message]: https://attacker.invalid/cross-message' },
        { kind: 'assistant', id: 'plain', text: '# Literal\n![plain](https://attacker.invalid/plain)', renderMode: 'plain-text' }
      ]
    })
    expect(document.messageCount).toBe(3)
    const container = render(document.markdown)
    expect([...container.querySelectorAll('a')].map((element) => element.getAttribute('href')))
      .toEqual(['https://normal.invalid/link'])
    expect([...container.querySelectorAll('img')].map((element) => element.getAttribute('src')))
      .toEqual(['https://normal.invalid/image'])
    expect(container.textContent).toContain('[Open reference][other-message]')
    expect(container.textContent).toContain('# Literal\n![plain](https://attacker.invalid/plain)')
  })

  it('keeps unconstrained Markdown byte-for-byte', () => {
    const markdown = '  # Normal\n\n[link](https://example.com) ![image](./image.png)  '
    expect(assistantExportMarkdown(markdown)).toBe(markdown)
  })
})
