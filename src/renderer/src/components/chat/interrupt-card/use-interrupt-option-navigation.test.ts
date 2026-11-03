// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveInterruptNavigationKey,
  useInterruptOptionNavigation,
  type InterruptNavState,
  type InterruptOptionNavigation
} from './use-interrupt-option-navigation'

const base: InterruptNavState = {
  activeIndex: 0,
  optionCount: 3,
  hasFreeText: true,
  multiSelect: false,
  inTextField: false
}

describe('resolveInterruptNavigationKey', () => {
  it('moves with arrows, Home and End, clamped to the rows', () => {
    expect(resolveInterruptNavigationKey({ key: 'ArrowDown' }, base)).toEqual({ type: 'move', index: 1 })
    expect(resolveInterruptNavigationKey({ key: 'ArrowUp' }, base)).toEqual({ type: 'move', index: 0 })
    expect(resolveInterruptNavigationKey({ key: 'ArrowDown' }, { ...base, activeIndex: 3 })).toEqual({ type: 'move', index: 3 })
    expect(resolveInterruptNavigationKey({ key: 'End' }, base)).toEqual({ type: 'move', index: 3 })
    expect(resolveInterruptNavigationKey({ key: 'Home' }, { ...base, activeIndex: 2 })).toEqual({ type: 'move', index: 0 })
  })

  it('walks rows with Tab and lets Tab leave at the ends', () => {
    expect(resolveInterruptNavigationKey({ key: 'Tab' }, base)).toEqual({ type: 'move', index: 1 })
    expect(resolveInterruptNavigationKey({ key: 'Tab', shiftKey: true }, { ...base, activeIndex: 2 })).toEqual({ type: 'move', index: 1 })
    expect(resolveInterruptNavigationKey({ key: 'Tab' }, { ...base, activeIndex: 3 })).toBeNull()
    expect(resolveInterruptNavigationKey({ key: 'Tab', shiftKey: true }, base)).toBeNull()
  })

  it('maps digits to options and the free-text row', () => {
    expect(resolveInterruptNavigationKey({ key: '2' }, base)).toEqual({ type: 'digit', index: 1 })
    expect(resolveInterruptNavigationKey({ key: '4' }, base)).toEqual({ type: 'move', index: 3 })
    expect(resolveInterruptNavigationKey({ key: '5' }, base)).toBeNull()
    expect(resolveInterruptNavigationKey({ key: '0' }, base)).toBeNull()
  })

  it('keeps digits working from footer buttons but leaves their Enter / arrows alone', () => {
    const footer = { ...base, onOtherControl: true }
    expect(resolveInterruptNavigationKey({ key: '1' }, footer)).toEqual({ type: 'digit', index: 0 })
    expect(resolveInterruptNavigationKey({ key: 'Enter' }, footer)).toBeNull()
    expect(resolveInterruptNavigationKey({ key: 'ArrowDown' }, footer)).toBeNull()
    expect(resolveInterruptNavigationKey({ key: 'Escape' }, footer)).toEqual({ type: 'escape' })
  })

  it('confirms with Enter and toggles with Space only in multi-select', () => {
    expect(resolveInterruptNavigationKey({ key: 'Enter' }, { ...base, activeIndex: 2 })).toEqual({ type: 'confirm', index: 2 })
    expect(resolveInterruptNavigationKey({ key: ' ' }, base)).toBeNull()
    expect(resolveInterruptNavigationKey({ key: ' ' }, { ...base, multiSelect: true, activeIndex: 1 })).toEqual({ type: 'toggle', index: 1 })
    expect(resolveInterruptNavigationKey({ key: ' ' }, { ...base, multiSelect: true, activeIndex: 3 })).toBeNull()
  })

  it('never hijacks typing in the free-text field', () => {
    const typing = { ...base, activeIndex: 3, inTextField: true }
    expect(resolveInterruptNavigationKey({ key: '1' }, typing)).toBeNull()
    expect(resolveInterruptNavigationKey({ key: ' ' }, { ...typing, multiSelect: true })).toBeNull()
    expect(resolveInterruptNavigationKey({ key: 'ArrowDown' }, typing)).toBeNull()
    expect(resolveInterruptNavigationKey({ key: 'ArrowUp' }, typing)).toBeNull()
    expect(resolveInterruptNavigationKey({ key: 'ArrowUp' }, { ...typing, caretAtStart: true })).toEqual({ type: 'move', index: 2 })
    expect(resolveInterruptNavigationKey({ key: 'Enter', shiftKey: true }, typing)).toBeNull()
    expect(resolveInterruptNavigationKey({ key: 'Enter' }, typing)).toEqual({ type: 'confirm', index: 3 })
    expect(resolveInterruptNavigationKey({ key: 'Tab', shiftKey: true }, typing)).toEqual({ type: 'move', index: 2 })
    expect(resolveInterruptNavigationKey({ key: 'Tab' }, typing)).toBeNull()
  })

  it('ignores IME composition and modified shortcuts', () => {
    expect(resolveInterruptNavigationKey({ key: 'Enter', isComposing: true }, { ...base, inTextField: true })).toBeNull()
    expect(resolveInterruptNavigationKey({ key: 'Process' }, base)).toBeNull()
    expect(resolveInterruptNavigationKey({ key: '1', metaKey: true }, base)).toBeNull()
    expect(resolveInterruptNavigationKey({ key: 'ArrowDown', ctrlKey: true }, base)).toBeNull()
  })

  it('does nothing without rows', () => {
    expect(resolveInterruptNavigationKey({ key: 'ArrowDown' }, { ...base, optionCount: 0, hasFreeText: false })).toBeNull()
  })

  it('swallows decision keys that auto-repeat or arrive before the card is armed', () => {
    const ignore = { type: 'ignore' }
    for (const key of ['1', 'Enter', 'Escape']) {
      expect(resolveInterruptNavigationKey({ key, repeat: true }, base)).toEqual(ignore)
      expect(resolveInterruptNavigationKey({ key }, { ...base, armed: false })).toEqual(ignore)
    }
    expect(resolveInterruptNavigationKey({ key: ' ', repeat: true }, { ...base, multiSelect: true })).toEqual(ignore)
    expect(resolveInterruptNavigationKey({ key: 'Enter' }, { ...base, inTextField: true, armed: false })).toEqual(ignore)
    // Movement stays live, and so does the digit that only focuses free text.
    expect(resolveInterruptNavigationKey({ key: 'ArrowDown', repeat: true }, { ...base, armed: false })).toEqual({ type: 'move', index: 1 })
    expect(resolveInterruptNavigationKey({ key: '4' }, { ...base, armed: false })).toEqual({ type: 'move', index: 3 })
    // Keys the card never handles stay with the browser.
    expect(resolveInterruptNavigationKey({ key: '1', repeat: true }, { ...base, inTextField: true })).toBeNull()
  })
})

describe('useInterruptOptionNavigation', () => {
  let host: HTMLDivElement
  let root: Root
  let nav: InterruptOptionNavigation
  const onDigit = vi.fn()
  const onConfirm = vi.fn()
  const onEscape = vi.fn()

  function Harness({ resetKey, armDelayMs = 0 }: { resetKey: string; armDelayMs?: number }): ReactElement {
    nav = useInterruptOptionNavigation({
      optionCount: 2, hasFreeText: true, resetKey, armDelayMs, onDigit, onConfirm, onEscape
    })
    return createElement('section', { onKeyDown: nav.onKeyDown, 'data-card': true },
      createElement('div', { ref: nav.listboxRef, tabIndex: 0, role: 'listbox', 'data-list': true }),
      createElement('textarea', { ref: nav.freeTextRef, 'data-free': true }),
      createElement('button', { type: 'button', 'data-footer': true }, 'Skip'))
  }

  beforeEach(async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    onDigit.mockReset(); onConfirm.mockReset(); onEscape.mockReset()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root.render(createElement(Harness, { resetKey: 'q1' })))
  })

  afterEach(async () => {
    vi.useRealTimers()
    await act(async () => root.unmount())
    host.remove()
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  async function press(selector: string, init: KeyboardEventInit): Promise<KeyboardEvent> {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    await act(async () => { host.querySelector(selector)!.dispatchEvent(event) })
    return event
  }

  it('moves focus into the free-text row and back to the list', async () => {
    host.querySelector<HTMLElement>('[data-list]')!.focus()
    await press('[data-list]', { key: 'End' })
    expect(nav.activeIndex).toBe(2)
    expect(nav.isFreeTextActive).toBe(true)
    expect(document.activeElement).toBe(host.querySelector('[data-free]'))
    await press('[data-free]', { key: 'ArrowUp' })
    expect(nav.activeIndex).toBe(1)
    expect(document.activeElement).toBe(host.querySelector('[data-list]'))
  })

  it('focuses the list when an option becomes active from elsewhere in the card', async () => {
    host.querySelector<HTMLElement>('[data-footer]')!.focus()
    await act(async () => nav.setActiveIndex(1))
    expect(document.activeElement).toBe(host.querySelector('[data-list]'))
    await act(async () => nav.setActiveIndex(0, { focus: false }))
    expect(document.activeElement).toBe(host.querySelector('[data-list]'))
  })

  it('dispatches digits, Enter and Esc with their keydown, then resets on a new question', async () => {
    const digit = await press('[data-list]', { key: '2' })
    expect(digit.defaultPrevented).toBe(true)
    expect(onDigit).toHaveBeenCalledWith(1, expect.objectContaining({ key: '2', type: 'keydown' }))
    expect(nav.activeIndex).toBe(1)
    await press('[data-list]', { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledWith(1, expect.objectContaining({ key: 'Enter' }))
    await press('[data-footer]', { key: 'Escape' })
    expect(onEscape).toHaveBeenCalledOnce()
    expect(onEscape.mock.calls[0][0]).toMatchObject({ key: 'Escape' })
    const typed = await press('[data-free]', { key: '3' })
    expect(typed.defaultPrevented).toBe(false)
    await act(async () => root.render(createElement(Harness, { resetKey: 'q2' })))
    expect(nav.activeIndex).toBe(0)
  })

  it('ignores decision keys until armed, auto-repeats, and re-arms on a new request', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(10_000)
    await act(async () => root.render(createElement(Harness, { resetKey: 'q1', armDelayMs: 500 })))
    await act(async () => root.render(createElement(Harness, { resetKey: 'q2', armDelayMs: 500 })))
    const early = await press('[data-list]', { key: 'Enter' })
    expect(early.defaultPrevented).toBe(true)
    await press('[data-list]', { key: '1' })
    const typedEnter = await press('[data-free]', { key: 'Enter' })
    expect(typedEnter.defaultPrevented).toBe(true)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onDigit).not.toHaveBeenCalled()
    await press('[data-list]', { key: 'ArrowDown' })
    expect(nav.activeIndex).toBe(1)

    vi.setSystemTime(10_600)
    await press('[data-list]', { key: 'Enter', repeat: true })
    expect(onConfirm).not.toHaveBeenCalled()
    await press('[data-list]', { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledWith(1, expect.anything())

    await act(async () => root.render(createElement(Harness, { resetKey: 'q3', armDelayMs: 500 })))
    await press('[data-list]', { key: '2' })
    expect(onDigit).not.toHaveBeenCalled()
    vi.setSystemTime(11_200)
    await press('[data-list]', { key: '2' })
    expect(onDigit).toHaveBeenCalledOnce()
  })

  it('skips keys another layer already handled', async () => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    event.preventDefault()
    await act(async () => { host.querySelector('[data-list]')!.dispatchEvent(event) })
    expect(onEscape).not.toHaveBeenCalled()
  })
})
