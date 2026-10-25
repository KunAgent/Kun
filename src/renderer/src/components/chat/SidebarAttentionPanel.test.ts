import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
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
  })

  function renderPanel(
    ids: string[],
    onSelectThread = vi.fn()
  ): ReturnType<typeof vi.fn> {
    act(() => {
      renderer = create(
        createElement(SidebarAttentionPanel, {
          threads: ids.map(thread),
          activityContext: context(ids),
          onSelectThread,
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
})
