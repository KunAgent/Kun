/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RoomWardrobeGuestDrop } from './RoomWardrobeGuestDrop'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./RoomWardrobeBottle', () => ({ WardrobeBottleIcon: () => null }))
let root: ReturnType<typeof createRoot>, container: HTMLDivElement
const login = vi.fn(async () => ({}))
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(window, 'kunGui', { configurable: true, value: { kunAccount: { login } } })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container); login.mockClear()
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
it('shows a scoped login invitation, never an open-bottle action, and can be dismissed', async () => {
  const hints = [{ id: 'guest-one', createdAt: new Date().toISOString(), threadId: 'thread-one' }]
  await act(async () => root.render(createElement(RoomWardrobeGuestDrop, { hints, scope: { threadId: 'thread-one' } })))
  expect(container.textContent).toContain('wardrobeGuestDropBody')
  expect(container.querySelector('[data-drop-open]')).toBeNull()
  const buttons = container.querySelectorAll('button')
  await act(async () => buttons[1].click()); expect(login).toHaveBeenCalledOnce()
  await act(async () => buttons[0].click()); expect(container.textContent).toBe('')
})
it('does not display another conversation or expired guest hints', async () => {
  const hints = [{ id: 'old', createdAt: '2020-01-01T00:00:00Z', threadId: 'one' }, { id: 'other', createdAt: new Date().toISOString(), threadId: 'two' }]
  await act(async () => root.render(createElement(RoomWardrobeGuestDrop, { hints, scope: { threadId: 'one' } })))
  expect(container.textContent).toBe('')
})
