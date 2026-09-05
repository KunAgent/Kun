/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FloatingComposerTaskSurfacePicker,
  calculateTaskSurfaceMenuPlacement
} from './FloatingComposerTaskSurfacePicker'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('FloatingComposerTaskSurfacePicker', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.querySelector('[data-task-surface-menu]')?.remove()
    container.remove()
    vi.unstubAllGlobals()
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  async function renderPicker(overrides: Record<string, unknown> = {}) {
    const onSurfaceChange = vi.fn()
    await act(async () => root.render(createElement(FloatingComposerTaskSurfacePicker, {
      surface: 'code',
      disabled: false,
      onSurfaceChange,
      ...overrides
    })))
    return { onSurfaceChange, trigger: container.querySelector<HTMLButtonElement>('[data-task-surface-trigger]')! }
  }

  it('shows the current mode and opens two radio menu items with a check', async () => {
    const { trigger } = await renderPicker()
    expect(trigger.dataset.taskSurface).toBe('code')
    expect(trigger.textContent).toContain('taskTypeCode')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    await act(async () => trigger.click())
    const options = document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    expect(options).toHaveLength(2)
    expect(Array.from(options).map((option) => option.dataset.taskSurface)).toEqual(['code', 'design'])
    expect(options[0]?.getAttribute('aria-checked')).toBe('true')
    expect(options[0]?.querySelector('.lucide-check')).not.toBeNull()
  })

  it('selects a new mode once and does not reselect the current mode', async () => {
    const { onSurfaceChange, trigger } = await renderPicker()
    await act(async () => trigger.click())
    const options = document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    await act(async () => options[0]?.click())
    expect(onSurfaceChange).not.toHaveBeenCalled()

    await act(async () => trigger.click())
    const reopened = document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    await act(async () => reopened[1]?.click())
    expect(onSurfaceChange).toHaveBeenCalledOnce()
    expect(onSurfaceChange).toHaveBeenCalledWith('design')
    expect(document.querySelector('[data-task-surface-menu]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('opens from ArrowDown, supports Home/End, and closes on Tab', async () => {
    const { trigger } = await renderPicker()
    const preventDefault = vi.fn()
    await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown', bubbles: true
    })))
    expect(document.querySelectorAll('[role="menuitemradio"]')).toHaveLength(2)

    const options = document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    options[0]?.focus()
    await act(async () => options[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    expect(document.activeElement).toBe(options[1])
    await act(async () => options[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
    expect(document.activeElement).toBe(options[0])
    await act(async () => options[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })))
    expect(document.querySelector('[data-task-surface-menu]')).toBeNull()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('closes on Escape and outside pointer input', async () => {
    const { trigger } = await renderPicker()
    await act(async () => trigger.click())
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(document.querySelector('[data-task-surface-menu]')).toBeNull()

    await act(async () => trigger.click())
    await act(async () => window.dispatchEvent(new Event('pointerdown')))
    expect(document.querySelector('[data-task-surface-menu]')).toBeNull()
  })

  it('focuses the current option when opened with Enter', async () => {
    const { trigger } = await renderPicker({ surface: 'design' })
    trigger.focus()
    await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true
    })))
    await act(async () => trigger.click())

    const selected = document.querySelector<HTMLButtonElement>('[data-task-surface-option="design"]')
    expect(document.activeElement).toBe(selected)
  })

  it('closes and blocks stale menu actions when disabled after opening', async () => {
    const { onSurfaceChange, trigger } = await renderPicker()
    await act(async () => trigger.click())
    const staleDesignOption = document.querySelector<HTMLButtonElement>('[data-task-surface-option="design"]')!

    await act(async () => root.render(createElement(FloatingComposerTaskSurfacePicker, {
      surface: 'code', disabled: true, onSurfaceChange
    })))
    expect(document.querySelector('[data-task-surface-menu]')).toBeNull()
    await act(async () => staleDesignOption.click())
    expect(onSurfaceChange).not.toHaveBeenCalled()
  })

  it('does not open while disabled', async () => {
    const { trigger } = await renderPicker({ disabled: true })
    expect(trigger.disabled).toBe(true)
    await act(async () => trigger.click())
    expect(document.querySelector('[data-task-surface-menu]')).toBeNull()
  })
})

describe('calculateTaskSurfaceMenuPlacement', () => {
  const anchorRect = { top: 300, bottom: 332, left: 100, width: 112 }

  it('prefers above and falls below when space is insufficient', () => {
    expect(calculateTaskSurfaceMenuPlacement({
      anchorRect, menuWidth: 176, menuHeight: 104,
      viewportHeight: 700, viewportWidth: 900
    })).toMatchObject({ placement: 'top', top: 188 })
    expect(calculateTaskSurfaceMenuPlacement({
      anchorRect: { ...anchorRect, top: 60, bottom: 92 }, menuWidth: 176, menuHeight: 104,
      viewportHeight: 700, viewportWidth: 900
    })).toMatchObject({ placement: 'bottom', top: 100 })
  })

  it('clamps horizontally and accounts for body zoom', () => {
    expect(calculateTaskSurfaceMenuPlacement({
      anchorRect: { top: 300, bottom: 332, left: 4, width: 80 }, menuWidth: 176, menuHeight: 104,
      viewportHeight: 700, viewportWidth: 300
    }).left).toBe(12)
    expect(calculateTaskSurfaceMenuPlacement({
      anchorRect: { top: 600, bottom: 664, left: 200, width: 224 }, menuWidth: 176, menuHeight: 104,
      viewportHeight: 1400, viewportWidth: 1800, coordinateScale: 2
    })).toMatchObject({ top: 188, left: 100, placement: 'top' })
  })
})
