// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { MessageTimeline } from './MessageTimeline'
import '../../i18n'

// Keep the timeline's real turn grouping, store selectors and live clock;
// omit unrelated message cards and animations from this timing regression.
vi.mock('./message-timeline-conversation-turn', async () => {
  const { LiveTurnProgressRow } = await import('./message-timeline-live-progress')
  return {
    MemoMessageTurn: (props: { isProcessing: boolean; durationMs?: number; liveStartedAtMs?: number }) =>
      props.isProcessing
        ? createElement(LiveTurnProgressRow, { ...props, thinking: false })
        : createElement('span', { 'data-settled-duration': true }, props.durationMs)
  }
})
vi.mock('./AnimatedWorkLogo', () => ({
  AnimatedWorkLogo: () => null,
  useWorkLogoSwimMode: () => 'cruise',
  useIkunWorkLogoVariant: () => 'default',
  WORK_LOGO_SWIM_MODE_LABEL_KEYS: { cruise: 'thinkingNow' },
  IKUN_WORK_LOGO_VARIANT_LABEL_KEYS: { default: 'thinkingNow' }
}))

const now = Date.parse('2026-10-25T08:00:00.000Z')
const startedAt = now - 233_000
const user: ChatBlock = { kind: 'user', id: 'original-user', turnId: 'original-turn', text: 'Run checks' }

describe('MessageTimeline live elapsed time', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    Element.prototype.scrollIntoView = vi.fn()
    container = document.createElement('div')
    root = createRoot(container)
    useChatStore.setState({
      activeThreadId: 'thread', threads: [], route: 'chat', workspaceRoot: '/tmp/project',
      busy: true, busyUnconfirmed: false, threadLoadingId: null,
      currentTurnId: 'original-turn', currentTurnUserId: 'original-user',
      currentTurnStartedAtMs: startedAt,
      turnStartedAtByUserId: {}, turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {}, turnReasoningLastAtByUserId: {},
      threadHasMoreHistory: false, threadHistoryLoading: false
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function render(blocks: ChatBlock[], live = ''): Promise<void> {
    await act(async () => root.render(createElement(MessageTimeline, {
      blocks, live, liveReasoning: '', activeThreadId: 'thread',
      runtimeConnection: 'ready', onRetryConnection: () => {}, onOpenSettings: () => {}
    })))
  }

  const elapsed = (): string | null | undefined =>
    container.querySelector('[data-turn-live-status-owner] .tabular-nums .tabular-nums')?.textContent

  it.each(['background_shell', 'background_subagent', 'worker_update'])(
    'ticks a %s continuation instead of showing the original completed duration', async (source) => {
      useChatStore.setState({
        currentTurnId: 'continuation', currentTurnUserId: 'notice',
        turnStartedAtByUserId: { notice: startedAt },
        turnDurationByUserId: { 'original-user': 233_000 }
      })
      await render([user, {
        kind: 'user', id: 'notice', turnId: 'continuation', text: 'Checks finished',
        meta: { messageSource: source }
      }, { kind: 'assistant', id: 'followup', turnId: 'continuation', text: 'Continuing work' }])

      expect(elapsed()).toBe('3m 53s')
      await act(async () => { vi.advanceTimersByTime(2000) })
      expect(elapsed()).toBe('3m 55s')
    }
  )

  it('uses the restored runtime start when the per-user timing map is empty', async () => {
    await render([user])
    expect(elapsed()).toBe('3m 53s')
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(elapsed()).toBe('3m 54s')
  })

  it('uses the restored start while a running turn has only streaming content', async () => {
    useChatStore.setState({ currentTurnUserId: null })
    await render([], 'Working')
    expect(elapsed()).toBe('3m 53s')
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(elapsed()).toBe('3m 54s')
  })

  it('keeps the live per-user fallback and removes the clock after completion', async () => {
    useChatStore.setState({
      currentTurnStartedAtMs: null, turnStartedAtByUserId: { 'original-user': startedAt }
    })
    await render([user])
    expect(elapsed()).toBe('3m 53s')
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(elapsed()).toBe('3m 54s')
    await act(async () => useChatStore.setState({
      busy: false, currentTurnId: null, currentTurnUserId: null,
      turnDurationByUserId: { 'original-user': 234_000 }
    }))
    expect(container.querySelector('[data-turn-live-status-owner]')).toBeNull()
    expect(container.querySelector('[data-settled-duration]')?.textContent).toBe('234000')
  })
})
