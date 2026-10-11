// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { assistantExportMarkdown } from '../../renderer/src/lib/conversation-export-markdown'

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindow {}, clipboard: {}, nativeImage: {}, dialog: {}
}))

import { buildWriteClipboardHtmlFragment, buildWriteExportHtmlDocument } from './write-export-service'

const literal = '\n  PLAIN ORIGINAL CONTENT\n$$\n![private](https://untrusted.test/plain)\n'
const safeCode = 'SAFE ORIGINAL CODE\n<img src="https://untrusted.test/safe">\n$$'
const content = [
  assistantExportMarkdown(literal, 'plain-text'),
  '```js\nconst first = 1\n```',
  '$$\nx^2\n$$',
  assistantExportMarkdown('```html\n' + safeCode + '\n```', 'safe-markdown'),
  '```js\nconst second = 2\n```'
].join('\n\n---\n\n')

function assertReplyOrder(html: string, latex: boolean): void {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const body = document.querySelector('.markdown-body')!
  const blocks = [...body.querySelectorAll('pre code')]
  expect(blocks.map(block => block.textContent)).toEqual([
    literal, 'const first = 1', ...(latex ? ['x^2'] : []), safeCode, 'const second = 2'
  ])
  expect(blocks[1].querySelector('.line')).not.toBeNull()
  expect(blocks.at(-1)?.querySelector('.line')).not.toBeNull()
  expect(body.querySelector('a,img,iframe,object,embed,script,style,link')).toBeNull()
}

describe('production highlighting preserves constrained assistant exports', () => {
  it.each(['pdf', 'html', 'docx'] as const)('keeps literal/safe replies before and between ordinary fences in %s', async format => {
    const html = await buildWriteExportHtmlDocument({ sourcePath: '/tmp/assistant-policy-export.md', content, format })
    assertReplyOrder(html, format === 'docx')
  })

  it('keeps the same reply order and literal whitespace in rich clipboard HTML', async () => {
    const html = await buildWriteClipboardHtmlFragment({ sourcePath: '/tmp/assistant-policy-export.md', content })
    assertReplyOrder(html, false)
  })
})
