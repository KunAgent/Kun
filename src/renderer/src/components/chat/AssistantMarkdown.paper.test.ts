// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { AssistantMarkdown } from './AssistantMarkdown'
import { chatBlockFromItem } from '../../agent/kun-mapper-events'

it('renders paper output as literal text without links, remote images or HTML', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const text = '![leak](https://untrusted.test/private) <img src="https://untrusted.test/raw"> [link](https://untrusted.test)'
  const item = { id: 'paper-answer', turnId: 'paper-turn', threadId: 'paper-thread', role: 'assistant' as const,
    kind: 'assistant_text' as const, status: 'completed' as const, createdAt: '', renderMode: 'plain-text' as const, text }
  const block = chatBlockFromItem(item)
  expect(block?.renderMode).toBe('plain-text')
  const container = document.createElement('div'), root = createRoot(container)
  try {
    await act(async () => root.render(createElement(AssistantMarkdown, {
      text, streaming: true, plainText: block?.renderMode === 'plain-text'
    })))
    expect(container.textContent).toBe(text)
    expect(container.querySelector('img, a, iframe, svg, script')).toBeNull()
  } finally { await act(async () => root.unmount()) }
})
