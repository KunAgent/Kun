import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../../store/chat-store'

const instances = vi.hoisted(() => ({ next: 0, mounted: [] as number[], unmounted: [] as number[] }))

vi.mock('./MessageTimeline', async () => {
  const React = await import('react')
  return {
    MessageTimeline: ({ activeThreadId }: { activeThreadId: string | null }) => {
      const [instanceId] = React.useState(() => ++instances.next)
      React.useEffect(() => {
        instances.mounted.push(instanceId)
        return () => { instances.unmounted.push(instanceId) }
      }, [instanceId])
      return React.createElement('div', {
        'data-testid': 'timeline-instance',
        'data-instance-id': instanceId,
        'data-thread-id': activeThreadId
      })
    }
  }
})

import { LazyMessageTimeline } from './LazyMessageTimeline'

function timeline(threadId: string) {
  return createElement(LazyMessageTimeline, {
    blocks: [],
    liveReasoning: '',
    live: '',
    activeThreadId: threadId,
    runtimeConnection: 'ready',
    onRetryConnection: () => undefined,
    onOpenSettings: () => undefined
  })
}

describe('LazyMessageTimeline thread scope', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    instances.next = 0
    instances.mounted = []
    instances.unmounted = []
    useChatStore.setState({ threadLoadingId: null })
  })

  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount())
    renderer = null
    useChatStore.setState({ threadLoadingId: null })
  })

  it('recreates local state only when the thread identity changes', async () => {
    await act(async () => { renderer = create(timeline('thread-a')) })
    expect(renderer!.root.findByProps({ 'data-testid': 'timeline-instance' }).props['data-instance-id']).toBe(1)

    await act(async () => { renderer!.update(timeline('thread-b')) })
    expect(renderer!.root.findByProps({ 'data-testid': 'timeline-instance' }).props['data-instance-id']).toBe(2)

    await act(async () => { useChatStore.setState({ threadLoadingId: 'thread-b' }) })
    expect(renderer!.root.findByProps({ 'data-testid': 'timeline-instance' }).props['data-instance-id']).toBe(2)

    await act(async () => { useChatStore.setState({ threadLoadingId: null }) })
    expect(renderer!.root.findByProps({ 'data-testid': 'timeline-instance' }).props['data-instance-id']).toBe(2)

    await act(async () => { useChatStore.setState({ threadLoadingId: 'thread-c' }) })
    expect(renderer!.root.findByProps({ 'data-testid': 'timeline-instance' }).props['data-instance-id']).toBe(2)
    expect(instances.unmounted).toEqual([1])
  })
})
