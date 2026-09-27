// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileMode } from './navigation/mobile-page'
import { MobileModeNav } from './MobileModeNav'

const LABELS: Record<MobileMode, string> = {
  code: 'Code', rooms: 'Rooms', work: 'Work', agents: 'Agents'
}

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
  it('renders the given visible modes and reports selection', () => {
    const onSelect = vi.fn()
    act(() => root.render(createElement(MobileModeNav, {
      active: 'rooms', modes: ['code', 'rooms', 'work'],
      attention: { rooms: 3 }, labels: LABELS, onSelect
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
      active: 'code', modes: ['code', 'rooms', 'work'],
      attention: { rooms: 123 }, labels: LABELS, onSelect: vi.fn()
    })))
    expect(host.querySelector('.kun-mobile-mode-badge')?.textContent).toBe('99')
    expect(host.querySelector('.kun-mobile-mode-badge')?.getAttribute('aria-label')).toBe('123 Rooms')
  })

  it('shows the agents mode with its own badge when ADE is enabled', () => {
    const onSelect = vi.fn()
    act(() => root.render(createElement(MobileModeNav, {
      active: 'agents', modes: ['code', 'rooms', 'work', 'agents'],
      attention: { rooms: 1, agents: 2 }, labels: LABELS, onSelect
    })))
    const buttons = [...host.querySelectorAll('button')]
    expect(buttons.map((button) => button.textContent)).toEqual(
      ['Code', '1Rooms', 'Work', '2Agents'])
    expect(host.querySelector('[aria-current="page"]')?.textContent).toContain('Agents')
    const badges = [...host.querySelectorAll('.kun-mobile-mode-badge')]
    expect(badges[0].getAttribute('aria-label')).toBe('1 Rooms')
    expect(badges[1].getAttribute('aria-label')).toBe('2 Agents')
    act(() => buttons[0].click())
    expect(onSelect).toHaveBeenCalledWith('code')
  })
})
