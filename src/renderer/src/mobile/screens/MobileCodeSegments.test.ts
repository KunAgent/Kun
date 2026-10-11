/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileCodeSegments } from './MobileCodeSegments'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('MobileCodeSegments', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('switches between tasks and conversations and badges unread conversations', async () => {
    const onSelect = vi.fn()
    await act(async () => root.render(createElement(MobileCodeSegments, { active: 'tasks', chatsBadge: 120, onSelect })))
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(tabs.map((tab) => tab.dataset.codeSegment)).toEqual(['tasks', 'chats'])
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true')
    expect(host.querySelector('.kun-mobile-code-segment-badge')?.textContent).toBe('99')
    await act(async () => tabs[0]!.click())
    expect(onSelect).not.toHaveBeenCalled()
    await act(async () => tabs[1]!.click())
    expect(onSelect).toHaveBeenCalledWith('chats')
  })
})
