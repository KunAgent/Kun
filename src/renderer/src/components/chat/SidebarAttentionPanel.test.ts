import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import type { AttentionReadUndo } from '../../store/attention-read-actions'
import { resetToasts, useToastStore } from '../../toast/toast-store'
import { SidebarAttentionPanel } from './SidebarAttentionPanel'
import type { SidebarThreadActivityContext } from './sidebar-project-selectors'

const t = (key: string, options?: Record<string, unknown>): string =>
  options && typeof options.count === 'number' ? `${key}:${options.count}` : key

function thread(id: string): NormalizedThread {
  return {
    id,
    title: `Thread ${id}`,
    updatedAt: '2026-01-01T00:00:00.000Z',
    model: 'deepseek-chat',
    mode: 'agent'
  } as NormalizedThread
}

function context(ids: string[]): SidebarThreadActivityContext {
  return {
    activeThreadId: null,
    busy: false,
    watchTurnCompletion: {},
    unreadThreadIds: Object.fromEntries(ids.map((id) => [id, 'completed' as const])),
    scheduledThreadActivities: {},
    awaitingUserInputThreadIds: {},
    backgroundActivityByThread: {}
  }
}

function buttonText(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : ''))
    .join('')
}

describe('SidebarAttentionPanel', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    if (renderer) act(() => renderer!.unmount())
    renderer = null
    for (const item of [...useToastStore.getState().items, ...useToastStore.getState().waitingItems]) {
      useToastStore.getState().dismiss(item.id)
    }
    resetToasts()
    vi.useRealTimers()
  })

  function renderPanel(
    ids: string[],
    onSelectThread = vi.fn(),
    onMarkRead: (threadIds: readonly string[]) => AttentionReadUndo | null = vi.fn(() => null),
    activityContext = context(ids)
  ): ReturnType<typeof vi.fn> {
    act(() => {
      renderer = create(
        createElement(SidebarAttentionPanel, {
          threads: ids.map(thread),
          activityContext,
          onSelectThread,
          onMarkRead,
          t
        })
      )
    })
    return onSelectThread
  }

  const buttons = (): ReactTestInstance[] =>
    renderer!.root.findAll((node) => node.type === 'button')

  it('counts exactly the rows it lists', () => {
    renderPanel(['a', 'b', 'c'])
    const header = buttons()[0]!
    const count = header.children.find(
      (child): child is ReactTestInstance =>
        typeof child !== 'string' && child.type === 'span' && child.props.className.includes('tabular-nums')
    )
    expect(count?.props.children).toBe(3)
    expect(renderer!.root.findAllByProps({ title: 'Thread a' })).toHaveLength(1)
  })

  it('renders nothing when nothing needs the user', () => {
    renderPanel([])
    expect(renderer!.toJSON()).toBeNull()
  })

  it('lists six rows first and opens the rest from show-all', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    renderPanel(ids)
    expect(renderer!.root.findAllByProps({ title: 'Thread g' })).toHaveLength(0)

    const showAll = buttons().filter((button) => buttonText(button).startsWith('attentionShowAll'))
    expect(showAll).toHaveLength(1)
    expect(buttonText(showAll[0]!)).toBe('attentionShowAll:8')
    act(() => showAll[0]!.props.onClick())

    for (const id of ids) {
      expect(renderer!.root.findAllByProps({ title: `Thread ${id}` })).toHaveLength(1)
    }
    expect(
      buttons().filter((button) => buttonText(button) === 'attentionShowLess')
    ).toHaveLength(1)
  })

  it('opens the clicked row', () => {
    const onSelectThread = renderPanel(['a', 'b'])
    act(() => {
      renderer!.root.findByProps({ title: 'Thread b' }).props.onClick()
    })
    expect(onSelectThread).toHaveBeenCalledWith('b')
  })

  it('marks every unread row, including the rows beyond the initial six', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const onMarkRead = vi.fn(() => null)
    renderPanel(ids, vi.fn(), onMarkRead)
    const mark = renderer!.root.findByProps({ 'aria-label': 'attentionMarkAllReadTooltip:8' })
    act(() => mark.props.onClick())
    expect(onMarkRead).toHaveBeenCalledWith(ids)
    expect(renderer!.root.findByProps({ 'aria-label': 'attentionCollapse' }).props['aria-expanded']).toBe(true)
  })

  it('disables the action when only failures and pending questions remain', () => {
    const ids = ['failed', 'asked']
    const activityContext = context(ids)
    activityContext.unreadThreadIds = { failed: 'failed', asked: 'completed' }
    activityContext.awaitingUserInputThreadIds = { asked: true }
    renderPanel(ids, vi.fn(), vi.fn(() => null), activityContext)
    expect(renderer!.root.findByProps({ 'aria-label': 'attentionNoUnread' }).props.disabled).toBe(true)
  })

  it('keeps the undo notice available when the panel disappears or unmounts', () => {
    const batch = { count: 2, undo: vi.fn(), dispose: vi.fn() }
    const onMarkRead = vi.fn(() => batch)
    renderPanel(['a', 'b'], vi.fn(), onMarkRead)
    act(() => renderer!.root.findByProps({ 'aria-label': 'attentionMarkAllReadTooltip:2' }).props.onClick())
    act(() => renderer!.update(createElement(SidebarAttentionPanel, {
      threads: [], activityContext: context([]), onSelectThread: vi.fn(), onMarkRead, t
    })))
    expect(renderer!.toJSON()).toBeNull()
    act(() => renderer!.unmount())
    renderer = null
    const notice = useToastStore.getState().items[0]!
    expect(notice.title).toBe('attentionMarkReadDone:2')
    expect(batch.dispose).not.toHaveBeenCalled()
    act(() => {
      notice.actions![0]!.run()
      useToastStore.getState().dismiss(notice.id)
    })
    expect(batch.undo).toHaveBeenCalledOnce()
    expect(batch.dispose).toHaveBeenCalledOnce()
  })

  it('keeps consecutive batches independently undoable', () => {
    const first = { count: 1, undo: vi.fn(), dispose: vi.fn() }
    const second = { count: 1, undo: vi.fn(), dispose: vi.fn() }
    const onMarkRead = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    renderPanel(['a'], vi.fn(), onMarkRead)
    const mark = renderer!.root.findByProps({ 'aria-label': 'attentionMarkAllReadTooltip:1' })
    act(() => { mark.props.onClick(); mark.props.onClick() })
    const notices = useToastStore.getState().items
    expect(notices).toHaveLength(2)
    expect(notices[0]!.id).not.toBe(notices[1]!.id)
    expect(first.dispose).not.toHaveBeenCalled()
    act(() => {
      notices[0]!.actions![0]!.run()
      useToastStore.getState().dismiss(notices[0]!.id)
      notices[1]!.actions![0]!.run()
      useToastStore.getState().dismiss(notices[1]!.id)
    })
    expect(first.undo).toHaveBeenCalledOnce()
    expect(second.undo).toHaveBeenCalledOnce()
  })

  it('dismisses the undo notice and releases its subscription after eight seconds', () => {
    vi.useFakeTimers()
    const batch = { count: 1, undo: vi.fn(), dispose: vi.fn() }
    renderPanel(['a'], vi.fn(), vi.fn(() => batch))
    act(() => renderer!.root.findByProps({ 'aria-label': 'attentionMarkAllReadTooltip:1' }).props.onClick())
    act(() => { vi.advanceTimersByTime(8_000) })
    expect(batch.dispose).toHaveBeenCalledOnce()
    expect(useToastStore.getState().items).toHaveLength(0)
  })
})
