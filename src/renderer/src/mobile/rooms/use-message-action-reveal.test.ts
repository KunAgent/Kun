// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MESSAGE_ACTIONS_OPEN_ATTRIBUTE, useMessageActionReveal } from './use-message-action-reveal'

function Timeline() {
  const handlers = useMessageActionReveal()
  const message = (id: string) => createElement('article', { key: id, 'data-room-message-id': id },
    createElement('div', { className: 'rooms-message-bubble' }, `bubble ${id}`),
    createElement('div', { className: 'rooms-message-actions' }, createElement('button', { type: 'button' }, 'reply')))
  return createElement('section', handlers, message('a'), message('b'), createElement('p', { className: 'outside' }, 'x'))
}

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(createElement(Timeline)))
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
const article = (id: string) => host.querySelector(`[data-room-message-id="${id}"]`)!
const bubble = (id: string) => article(id).querySelector('.rooms-message-bubble')!
const fire = (target: Element, type: string, init: MouseEventInit = {}) =>
  act(() => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init })) })

it('reveals only the long-pressed message and hides it on a tap elsewhere', () => {
  vi.useFakeTimers()
  fire(bubble('a'), 'pointerdown', { clientX: 1, clientY: 1 })
  act(() => { vi.advanceTimersByTime(500) })
  expect(article('a').hasAttribute(MESSAGE_ACTIONS_OPEN_ATTRIBUTE)).toBe(true)
  expect(article('b').hasAttribute(MESSAGE_ACTIONS_OPEN_ATTRIBUTE)).toBe(false)
  fire(article('a').querySelector('button')!, 'pointerdown')
  expect(article('a').hasAttribute(MESSAGE_ACTIONS_OPEN_ATTRIBUTE)).toBe(true)
  fire(host.querySelector('.outside')!, 'pointerdown')
  expect(article('a').hasAttribute(MESSAGE_ACTIONS_OPEN_ATTRIBUTE)).toBe(false)
})

it('ignores a scroll that moves past the slop, and right-click reveals immediately', () => {
  vi.useFakeTimers()
  fire(bubble('a'), 'pointerdown', { clientX: 1, clientY: 1 })
  fire(bubble('a'), 'pointermove', { clientX: 1, clientY: 40 })
  act(() => { vi.advanceTimersByTime(500) })
  expect(article('a').hasAttribute(MESSAGE_ACTIONS_OPEN_ATTRIBUTE)).toBe(false)
  fire(bubble('b'), 'contextmenu')
  expect(article('b').hasAttribute(MESSAGE_ACTIONS_OPEN_ATTRIBUTE)).toBe(true)
})
