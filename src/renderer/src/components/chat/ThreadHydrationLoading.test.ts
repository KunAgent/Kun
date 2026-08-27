// @vitest-environment jsdom

import { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { useChatStore } from '../../store/chat-store'
import {
  THREAD_HYDRATION_SLOW_MS,
  ThreadHydrationGate,
  ThreadHydrationLoading
} from './ThreadHydrationLoading'

const defaultRecoverActiveTurn = useChatStore.getState().recoverActiveTurn

describe('ThreadHydrationLoading', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
    vi.useRealTimers()
    useChatStore.setState({ activeThreadId: null, recoverActiveTurn: defaultRecoverActiveTurn })
    vi.restoreAllMocks()
  })

  it('renders an accessible full-area loading status', async () => {
    await i18n.changeLanguage('en')
    const html = renderToStaticMarkup(createElement(ThreadHydrationLoading))

    expect(html).toContain('data-testid="thread-hydration-loading"')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('absolute inset-0')
    expect(html).toContain('Loading conversation…')
    expect(html).toContain('Reading messages and restoring the latest conversation state.')
  })

  it('uses the Chinese loading copy', async () => {
    await i18n.changeLanguage('zh')
    const html = renderToStaticMarkup(createElement(ThreadHydrationLoading))

    expect(html).toContain('正在加载会话…')
    expect(html).toContain('正在读取消息并恢复最新会话状态，请稍候。')
  })

  it('offers a retry when replay synchronization takes too long', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    await i18n.changeLanguage('en')
    const recoverActiveTurn = vi.fn(async () => true)
    useChatStore.setState({ activeThreadId: 'thread-slow', recoverActiveTurn })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => root.render(createElement(ThreadHydrationLoading)))
    expect(container.querySelector('[data-testid="thread-hydration-retry"]')).toBeNull()
    await act(async () => vi.advanceTimersByTimeAsync(THREAD_HYDRATION_SLOW_MS))

    const retry = container.querySelector<HTMLButtonElement>('[data-testid="thread-hydration-retry"]')
    expect(container.textContent).toContain('Conversation recovery is taking longer')
    expect(retry).not.toBeNull()
    await act(async () => retry?.click())
    expect(recoverActiveTurn).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Loading conversation…')

    await act(async () => root.unmount())
    container.remove()
  })

  it('reveals a restored thread only after its committed content has painted', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const gate = (loading: boolean, presentationKey = 'thread-restored') => createElement(ThreadHydrationGate, {
      loading,
      presentationKey,
      children: createElement('div', { 'data-testid': 'restored-content' }, 'Fully rendered')
    })

    await act(async () => root.render(gate(true)))
    expect(container.querySelector('[data-testid="thread-hydration-loading"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="restored-content"]')?.parentElement
      ?.getAttribute('aria-hidden')).toBe('true')

    await act(async () => root.render(gate(false)))
    expect(container.querySelector('[data-testid="thread-hydration-loading"]')).not.toBeNull()

    await act(async () => frames.shift()?.(0))
    expect(container.querySelector('[data-testid="thread-hydration-loading"]')).not.toBeNull()

    await act(async () => frames.shift()?.(16))
    expect(container.querySelector('[data-testid="thread-hydration-loading"]')).toBeNull()
    expect(container.querySelector('[data-testid="restored-content"]')?.parentElement
      ?.hasAttribute('aria-hidden')).toBe(false)

    await act(async () => root.render(gate(false, 'thread-cached')))
    expect(container.querySelector('[data-testid="thread-hydration-loading"]')).not.toBeNull()
    await act(async () => frames.shift()?.(32))
    await act(async () => frames.shift()?.(48))
    expect(container.querySelector('[data-testid="thread-hydration-loading"]')).toBeNull()

    await act(async () => root.unmount())
    container.remove()
  })
})
