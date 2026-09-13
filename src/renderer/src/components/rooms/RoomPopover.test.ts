import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { RoomPopover, roomPopoverPlacement } from './RoomPopover'

describe('room popover viewport placement', () => {
  it('keeps a composer menu above its anchor and inside a narrow viewport', () => {
    const placed = roomPopoverPlacement({ anchor: { left: 340, right: 380, top: 500, bottom: 530 },
      viewportWidth: 390, viewportHeight: 600, width: 320, height: 220, side: 'top', align: 'end' })
    expect(placed.left).toBeGreaterThanOrEqual(12)
    expect(placed.left + placed.width).toBeLessThanOrEqual(378)
    expect(placed.top + 220).toBeLessThan(500)
  })
  it('accounts for body zoom and flips a header menu when necessary', () => {
    const placed = roomPopoverPlacement({ anchor: { left: 600, right: 660, top: 525, bottom: 570 },
      viewportWidth: 900, viewportHeight: 600, width: 280, height: 240, zoom: 1.5, side: 'bottom', align: 'end' })
    expect(placed.left + placed.width).toBeLessThanOrEqual(588)
    expect(placed.top + Math.min(240, placed.maxHeight)).toBeLessThan(350)
  })
  it('moves keyboard focus after placement and restores it on Escape without stealing focus on resize', async () => {
    const focus = vi.fn(), restore = vi.fn()
    const listeners = new Map<string, () => void>()
    vi.stubGlobal('document', { body: { nodeType: 0 }, activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('window', { innerWidth: 960, innerHeight: 780, getComputedStyle: () => ({ zoom: '1' }),
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback), removeEventListener: vi.fn() })
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(createElement(RoomPopover, {
          label: 'Options', trigger: 'Open', children: () => createElement('button', { type: 'button' }, 'Choose')
        }), { createNodeMock: (element) => (element.props as { role?: string }).role === 'dialog'
          ? { scrollHeight: 100, querySelector: () => ({ focus }) }
          : { getBoundingClientRect: () => ({ left: 100, right: 132, top: 80, bottom: 112 }), focus: restore } })
      })
      act(() => renderer!.root.findByType('button').props.onClick())
      expect(renderer!.root.findByProps({ role: 'dialog' }).props.style.visibility).toBe('visible')
      expect(focus).toHaveBeenCalledTimes(1)
      act(() => listeners.get('resize')?.())
      expect(focus).toHaveBeenCalledTimes(1)
      act(() => renderer!.root.findByProps({ role: 'dialog' }).props.onKeyDown({
        key: 'Escape', stopPropagation: vi.fn(), preventDefault: vi.fn()
      }))
      expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
      expect(restore).toHaveBeenCalledTimes(1)
    } finally {
      if (renderer) act(() => renderer!.unmount())
      vi.unstubAllGlobals()
    }
  })
})
