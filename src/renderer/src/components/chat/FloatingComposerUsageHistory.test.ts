import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  calculateUsageHistoryPopoverPlacement,
  FloatingComposerUsageHistory
} from './FloatingComposerUsageHistory'

vi.mock('react-dom', () => ({
  createPortal: (children: unknown) => children
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('./InitialSessionUsageHeatmap', () => ({
  InitialSessionUsageHeatmap: () => createElement('div', { 'data-usage-content': true })
}))

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('window', {
    innerWidth: 1280,
    innerHeight: 800,
    requestAnimationFrame: vi.fn(() => 1),
    cancelAnimationFrame: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })
  vi.stubGlobal('document', { body: {} })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FloatingComposerUsageHistory', () => {
  it('clamps a large popover to the viewport and prefers space above the composer', () => {
    expect(calculateUsageHistoryPopoverPlacement({
      anchorRect: { left: 1000, right: 1120, top: 740, bottom: 768 },
      contentRect: { left: 280, right: 1280 },
      popoverHeight: 640,
      viewportHeight: 800,
      viewportWidth: 1280
    })).toEqual({
      left: 314,
      top: 92,
      width: 920,
      maxHeight: 720
    })

    const narrow = calculateUsageHistoryPopoverPlacement({
      anchorRect: { left: 120, right: 220, top: 500, bottom: 528 },
      popoverHeight: 700,
      viewportHeight: 600,
      viewportWidth: 360
    })
    expect(narrow.width).toBe(336)
    expect(narrow.left).toBe(12)
    expect(narrow.top).toBe(12)
    expect(narrow.maxHeight).toBe(480)
  })

  it('centers the popover in the chat content instead of over the sidebar', () => {
    expect(calculateUsageHistoryPopoverPlacement({
      anchorRect: { left: 320, right: 440, top: 700, bottom: 728 },
      contentRect: { left: 280, right: 1280 },
      popoverHeight: 500,
      viewportHeight: 800,
      viewportWidth: 1280
    })).toEqual({
      left: 314,
      top: 192,
      width: 920,
      maxHeight: 680
    })
  })

  it('keeps the popover above its trigger on a short Windows viewport', () => {
    const placement = calculateUsageHistoryPopoverPlacement({
      anchorRect: { left: 300, right: 420, top: 430, bottom: 458 },
      contentRect: { left: 240, right: 1024 },
      popoverHeight: 640,
      viewportHeight: 486,
      viewportWidth: 1024
    })

    expect(placement).toEqual({
      left: 240,
      top: 12,
      width: 772,
      maxHeight: 410
    })
    expect(placement.top + placement.maxHeight + 8).toBe(430)
  })

  it('keeps positioning in sync with the app UI scale used on Windows', () => {
    const uiScale = 0.82
    const anchorRect = { left: 379, right: 456, top: 601, bottom: 624 }
    const contentRect = { left: 237, right: 1198 }
    const placement = calculateUsageHistoryPopoverPlacement({
      anchorRect,
      contentRect,
      popoverHeight: 640,
      uiScale,
      viewportHeight: 640,
      viewportWidth: 1237
    })

    const visualLeft = placement.left * uiScale
    const visualRight = (placement.left + placement.width) * uiScale
    const visualBottom = (placement.top + Math.min(640, placement.maxHeight)) * uiScale
    expect(placement.width).toBe(920)
    expect(visualLeft).toBeCloseTo(340.5, 0)
    expect(visualRight).toBeCloseTo(1094.9, 0)
    expect(visualLeft).toBeGreaterThan(contentRect.left)
    expect(visualRight).toBeLessThan(contentRect.right)
    expect(visualBottom + 8 * uiScale).toBeCloseTo(anchorRect.top, 5)
  })

  it('exposes an accessible trigger and mounts history only while open', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(FloatingComposerUsageHistory, {
        title: 'Current usage',
        children: createElement('span', null, '12k tokens')
      }))
    })
    const trigger = renderer.root.findByProps({ 'aria-haspopup': 'dialog' })
    expect(trigger.props.className).toContain('flex-nowrap')
    expect(trigger.props.className).toContain('overflow-hidden')
    expect(trigger.props.className).toContain('whitespace-nowrap')
    expect(trigger.props.className).not.toContain('flex-wrap ')
    expect(trigger.props['aria-expanded']).toBe(false)
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)

    await act(async () => trigger.props.onClick())
    expect(renderer.root.findByProps({ role: 'dialog' }).props['aria-modal']).toBe('false')
    expect(renderer.root.findAllByProps({ 'data-usage-content': true })).toHaveLength(1)

    await act(async () => renderer.root.findByProps({ 'aria-label': 'close' }).props.onClick())
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
    await act(async () => renderer.unmount())
  })
})
