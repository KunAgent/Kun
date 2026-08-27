// @vitest-environment jsdom

import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./StreamdownAssistant', () => ({
  StreamdownAssistant: ({ text, streaming }: { text: string; streaming: boolean }) => {
    // Mirrors the real typewriter's mount-time cursor. If AssistantMarkdown
    // fails to remount on settled -> streaming, this remains stale.
    const [mountBaseline] = useState(text)
    return createElement('div', {
      'data-testid': 'streamdown-assistant',
      'data-streaming': String(streaming),
      'data-mount-baseline': mountBaseline
    }, text)
  }
}))

import { AssistantMarkdown } from './AssistantMarkdown'
import { LiveAssistantStreamingProvider } from './live-assistant-streaming'

describe('AssistantMarkdown streaming transition', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('uses the fully caught-up text as the baseline before live typing resumes', async () => {
    const render = (text: string, allowTimelineStreaming: boolean) =>
      createElement(LiveAssistantStreamingProvider, {
        streaming: allowTimelineStreaming,
        children: createElement(LiveAssistantStreamingProvider, {
          streaming: true,
          children: createElement(AssistantMarkdown, { text, streaming: true })
        })
      })

    await act(async () => root.render(render('cached', false)))
    await act(async () => root.render(render('cached plus replay backlog', false)))

    const settled = container.querySelector('[data-testid="streamdown-assistant"]')
    expect(settled?.getAttribute('data-streaming')).toBe('false')
    expect(settled?.getAttribute('data-mount-baseline')).toBe('cached')

    await act(async () => root.render(render('cached plus replay backlog', true)))

    const live = container.querySelector('[data-testid="streamdown-assistant"]')
    expect(live?.getAttribute('data-streaming')).toBe('true')
    expect(live?.getAttribute('data-mount-baseline')).toBe('cached plus replay backlog')
  })
})
