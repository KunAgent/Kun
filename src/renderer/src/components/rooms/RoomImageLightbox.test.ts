// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RoomImageLightbox } from './RoomImageLightbox'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
let root: Root, host: HTMLDivElement
const image = { dataBase64: 'YQ==', mimeType: 'image/png', width: 1600, height: 1200 }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  URL.createObjectURL = vi.fn(() => 'blob:preview'); URL.revokeObjectURL = vi.fn()
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!

it('offers fit/original/zoom, keyboard gallery navigation and focus restoration', () => {
  const previous = document.createElement('button'); document.body.append(previous); previous.focus()
  const close = vi.fn(), next = vi.fn(), prior = vi.fn()
  act(() => root.render(createElement(RoomImageLightbox, { title: 'Diagram', image, onClose: close, onNext: next, onPrevious: prior })))
  expect(document.activeElement).toBe(button('roomsClose'))
  act(() => button('roomsImageOriginal').click())
  expect(document.querySelector('output')?.textContent).toBe('100%')
  act(() => button('roomsImageZoomIn').click())
  expect(document.querySelector('output')?.textContent).toBe('125%')
  act(() => button('roomsImageZoomOut').click())
  expect(document.querySelector('output')?.textContent).toBe('100%')
  act(() => button('roomsImageNext').click()); expect(next).toHaveBeenCalledTimes(1)
  act(() => document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
  expect(prior).toHaveBeenCalledTimes(1)
  act(() => document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(close).toHaveBeenCalledTimes(1)
  act(() => root.render(null)); expect(document.activeElement).toBe(previous)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview'); previous.remove()
})

it('disables repeated gallery actions while loading and keeps a recoverable error visible', () => {
  const next = vi.fn()
  act(() => root.render(createElement(RoomImageLightbox, { title: 'Photo', image, onClose: vi.fn(), onNext: next,
    navigationBusy: true, error: 'Image unavailable; try the next image' })))
  expect(button('roomsImageNext').disabled).toBe(true)
  act(() => document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
  expect(next).not.toHaveBeenCalled()
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Image unavailable')
})
