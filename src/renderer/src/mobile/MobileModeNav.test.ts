// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileModeNav } from './MobileModeNav'

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('mobile mode navigation', () => {
  it('renders three visible first-class modes and reports selection', () => {
    const onSelect = vi.fn()
    act(() => root.render(createElement(MobileModeNav, {
      active: 'rooms', attentionCount: 3,
      labels: { code: 'Code', rooms: 'Rooms', work: 'Work' }, onSelect
    })))
    const buttons = [...host.querySelectorAll('button')]
    expect(buttons.map((button) => button.textContent)).toEqual(['Code', '3Rooms', 'Work'])
    expect(host.querySelector('[aria-current="page"]')?.textContent).toContain('Rooms')
    expect(host.querySelector('.kun-mobile-mode-badge')?.getAttribute('aria-label')).toBe('3 Rooms')
    act(() => buttons[2].click())
    expect(onSelect).toHaveBeenCalledWith('work')
  })

  it('caps only the visual count while keeping the status meaningful', () => {
    act(() => root.render(createElement(MobileModeNav, {
      active: 'code', attentionCount: 123,
      labels: { code: 'Code', rooms: 'Rooms', work: 'Work' }, onSelect: vi.fn()
    })))
    expect(host.querySelector('.kun-mobile-mode-badge')?.textContent).toBe('99')
    expect(host.querySelector('.kun-mobile-mode-badge')?.getAttribute('aria-label')).toBe('123 Rooms')
  })
})
