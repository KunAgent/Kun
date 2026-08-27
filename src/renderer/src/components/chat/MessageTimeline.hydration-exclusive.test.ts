// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { MessageTimeline } from './MessageTimeline'
import { ThreadHydrationGate } from './ThreadHydrationLoading'

const activeThread: NormalizedThread = {
  id: 'thread-target',
  title: 'Target',
  updatedAt: '2026-08-23T00:00:00.000Z',
  model: 'deepseek-v4-pro',
  mode: 'agent',
  workspace: '/workspace/deepseek-gui',
  status: 'idle'
}

describe('MessageTimeline hydration presentation', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      disconnect(): void {}
    })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    })
    useChatStore.setState({
      route: 'chat',
      workspaceRoot: '/workspace/deepseek-gui',
      activeThreadId: activeThread.id,
      threadLoadingId: activeThread.id,
      threads: [activeThread],
      busy: false,
      busyUnconfirmed: false,
      currentTurnId: null,
      currentTurnUserId: null,
      turnStartedAtByUserId: {},
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {},
      clawChannels: [],
      activeClawChannelId: ''
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    root = null
    container.remove()
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders only loading until the target projection is ready', async () => {
    const runtimeRequest = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: JSON.stringify({ group_by: 'turn', thread_id: activeThread.id, buckets: [] })
    })
    Object.defineProperty(window, 'kunGui', { configurable: true, value: { runtimeRequest } })
    const element = (loading: boolean) => createElement(ThreadHydrationGate, {
      loading,
      presentationKey: activeThread.id,
      children: createElement(MessageTimeline, {
        blocks: [{ kind: 'assistant', id: 'target-answer', text: 'target-ready-content' }],
        liveReasoning: '',
        live: '',
        activeThreadId: activeThread.id,
        runtimeConnection: 'ready',
        onRetryConnection: () => undefined,
        onOpenSettings: () => undefined
      })
    })
    await act(async () => root!.render(element(true)))

    const messageNode = [...container.querySelectorAll('*')]
      .find((node) => node.textContent === 'target-ready-content')
    expect(container.querySelector('[data-testid="thread-hydration-loading"]')).not.toBeNull()
    expect(messageNode?.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(runtimeRequest).not.toHaveBeenCalled()

    await act(async () => {
      useChatStore.setState({ threadLoadingId: null })
      root!.render(element(false))
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="thread-hydration-loading"]')).toBeNull()
    expect(container.textContent, container.innerHTML).toContain('target-ready-content')
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/usage?group_by=turn&thread_id=thread-target',
      'GET'
    )
  })

  it('keeps the earlier-history control visible while the active turn is busy', async () => {
    const loadEarlierThreadHistory = vi.fn(async () => true)
    useChatStore.setState({
      busy: true,
      threadHasMoreHistory: true,
      threadHistoryLoading: false,
      loadEarlierThreadHistory
    })
    await act(async () => root!.render(createElement(MessageTimeline, {
      blocks: [{ kind: 'assistant', id: 'target-answer', text: 'target-ready-content' }],
      liveReasoning: '',
      live: '',
      activeThreadId: activeThread.id,
      runtimeConnection: 'ready',
      onRetryConnection: () => undefined,
      onOpenSettings: () => undefined
    })))

    const button = container.querySelector<HTMLButtonElement>('button.ds-chip')
    expect(button).not.toBeNull()
    expect(button?.disabled).toBe(false)
    await act(async () => button?.click())
    expect(loadEarlierThreadHistory).toHaveBeenCalledOnce()
  })
})
