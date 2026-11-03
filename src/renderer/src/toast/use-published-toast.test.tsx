import { createElement } from 'react'
import { act, create as createRenderer, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePublishedToasts } from './use-published-toast'
import { resetToasts, useToastStore } from './toast-store'
import type { ToastInput } from './toast-types'

function Publisher({ toasts }: { toasts: ToastInput[] }): null {
  usePublishedToasts(toasts)
  return null
}

const ids = (): string[] => useToastStore.getState().items.map((item) => item.id)
const card = (id: string, extra: Partial<ToastInput> = {}): ToastInput => ({ id, tone: 'info', title: id, ...extra })
const render = (toasts: ToastInput[], renderer?: ReactTestRenderer): ReactTestRenderer => {
  let next: ReactTestRenderer | undefined
  act(() => {
    if (renderer) renderer.update(createElement(Publisher, { toasts }))
    else next = createRenderer(createElement(Publisher, { toasts }))
  })
  return renderer ?? (next as ReactTestRenderer)
}

beforeEach(() => {
  vi.useFakeTimers()
  resetToasts()
})

afterEach(() => {
  resetToasts()
  vi.useRealTimers()
})

describe('usePublishedToasts', () => {
  it('publishes what a surface reports', () => {
    render([card('paper'), card('speak')])
    expect(ids()).toEqual(['paper', 'speak'])
  })

  it('does not restart the countdown of an unchanged card', () => {
    const renderer = render([card('paper')])
    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    render([card('paper')], renderer)
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(ids()).toEqual([])
  })

  it('drops a card once the surface stops reporting it', () => {
    const renderer = render([card('paper'), card('speak')])
    render([card('speak')], renderer)
    expect(ids()).toEqual(['speak'])
  })

  it('takes its cards away when the surface unmounts', () => {
    const renderer = render([card('paper')])
    act(() => {
      renderer.unmount()
    })
    expect(ids()).toEqual([])
  })

  it('reports the dismissal back to the surface', () => {
    const onDismiss = vi.fn()
    render([card('paper', { onDismiss })])
    useToastStore.getState().dismiss('paper')
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(ids()).toEqual([])
  })
})
