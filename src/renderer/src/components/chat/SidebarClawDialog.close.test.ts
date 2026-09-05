// @vitest-environment jsdom
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { ClawAddImDialog } from './SidebarClawDialog'

const t = (key: string, opts?: Record<string, unknown>): string => i18n.t(key, opts)

function makeProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: 'add',
    channels: [],
    onClose: vi.fn(),
    onAddProvider: vi.fn(async () => undefined),
    onDeleteChannel: vi.fn(async () => undefined),
    t,
    ...overrides,
  }
}

describe('ClawAddImDialog close behavior (body portal)', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(async () => {
    await i18n.changeLanguage('zh')
    host = document.createElement('div')
    document.body.appendChild(host)
  })

  afterEach(() => {
    act(() => root?.unmount())
    host.remove()
  })

  function mount(props: Record<string, unknown>): void {
    act(() => {
      root = createRoot(host)
      root.render(createElement(ClawAddImDialog as never, props as never))
    })
  }

  function allButtons(): HTMLButtonElement[] {
    return Array.from(document.body.querySelectorAll('button'))
  }

  function clickWithMouse(el: Element): void {
    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    for (const type of ['mousedown', 'mouseup', 'click'] as const) {
      const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy })
      act(() => {
        el.dispatchEvent(ev)
      })
    }
  }

  it('renders the dialog overlay through a portal on document.body', () => {
    mount(makeProps())
    const overlay = document.body.querySelector('.ds-no-drag.fixed.inset-0')
    expect(overlay).toBeTruthy()
    // The dialog must NOT be a descendant of the mount host (it escapes to body).
    expect(host.querySelector('.ds-no-drag.fixed.inset-0')).toBeNull()
    expect(document.body.contains(overlay)).toBe(true)
  })

  it('closes when cancel button receives a real click sequence', () => {
    const onClose = vi.fn()
    mount(makeProps({ onClose }))
    const cancel = allButtons().find((b) => (b.textContent || '').includes('取消'))
    expect(cancel).toBeTruthy()
    clickWithMouse(cancel!)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes when header X button receives a real click sequence', () => {
    const onClose = vi.fn()
    mount(makeProps({ onClose }))
    const close = allButtons().find((b) => (b.getAttribute('aria-label') || '').includes('关闭'))
    expect(close).toBeTruthy()
    clickWithMouse(close!)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes when Escape key is pressed on window', () => {
    const onClose = vi.fn()
    mount(makeProps({ onClose }))
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalled()
  })
})
