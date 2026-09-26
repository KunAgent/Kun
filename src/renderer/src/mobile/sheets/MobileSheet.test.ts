// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileSheet } from './MobileSheet'

let root: Root
let host: HTMLDivElement
let trigger: HTMLButtonElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  } })
  host = document.createElement('div')
  trigger = document.createElement('button')
  document.body.append(trigger, host)
  trigger.focus()
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  trigger.remove()
  vi.restoreAllMocks()
})

describe('mobile sheet', () => {
  it('reports native close events to the controlled owner', () => {
    const onClose = vi.fn()
    act(() => root.render(createElement(MobileSheet, {
      open: true, title: 'Models', closeLabel: 'Close', onClose, children: 'Options'
    })))
    act(() => { document.querySelector('dialog')!.dispatchEvent(new Event('close')) })
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('opens an accessible modal and restores trigger focus when dismissed', () => {
    const onClose = vi.fn()
    const props = { open: true, title: 'Models', closeLabel: 'Close', onClose, children: 'Options' }
    act(() => root.render(createElement(MobileSheet, props)))
    const dialog = document.querySelector('dialog')!
    expect(dialog.open).toBe(true)
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Models')
    const close = dialog.querySelector('button')!
    close.focus()
    act(() => close.click())
    expect(onClose).toHaveBeenCalledOnce()
    act(() => root.render(createElement(MobileSheet, { ...props, open: false })))
    expect(document.querySelector('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('uses the controlled close callback for Escape cancellation', () => {
    const onClose = vi.fn()
    act(() => root.render(createElement(MobileSheet, {
      open: true, title: 'Models', closeLabel: 'Close', onClose, children: 'Options'
    })))
    const event = new Event('cancel', { cancelable: true })
    act(() => { document.querySelector('dialog')!.dispatchEvent(event) })
    expect(onClose).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })
})
