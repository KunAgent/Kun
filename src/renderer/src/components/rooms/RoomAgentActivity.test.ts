// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Room } from '@shared/rooms-api'
import i18n from '../../i18n'
import { RoomAgentActivity, groupActivity } from './RoomAgentActivity'

vi.mock('./RoomAvatar', () => ({ RoomAvatar: () => null }))

const room = { members: [{ id: 'm1', displayName: 'Kun' }] } as unknown as Room
let root: Root
let host: HTMLDivElement
const render = (props: Partial<Parameters<typeof RoomAgentActivity>[0]> = {}) =>
  act(() => root.render(createElement(RoomAgentActivity, { room, label: 'Waiting for the model…', ...props })))
const sessionButton = () => host.querySelector<HTMLButtonElement>('.rooms-agent-activity-session')

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  await i18n.changeLanguage('en')
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

it('offers no session button before a run exists', () => {
  render()
  expect(sessionButton()).toBeNull()
})

it('lets the Agent session be opened while the run is still waiting on the model', () => {
  const onSession = vi.fn()
  render({ onSession })
  const button = sessionButton()
  expect(button?.textContent).toBe('View Agent session')
  expect(button?.getAttribute('aria-pressed')).toBe('false')
  act(() => button?.click())
  expect(onSession).toHaveBeenCalledOnce()
})

it('marks the button pressed while that session is open', () => {
  render({ onSession: vi.fn(), sessionOpen: true })
  expect(sessionButton()?.getAttribute('aria-pressed')).toBe('true')
  expect(sessionButton()?.className).toContain('is-active')
})

it('names a group of responders with a plural verb and counts only unnamed waiters', () => {
  const group = { members: ['a', 'b', 'c', 'd'].map((id) => ({ id, displayName: id.toUpperCase() })) } as unknown as Room
  const t = i18n.getFixedT('en', 'common')
  expect(groupActivity(group, ['a'], [], true, t)?.label).toBe('A is responding…')
  expect(groupActivity(group, ['a', 'b', 'c'], [], true, t)?.label).toBe('A, B and 1 more are responding…')
  expect(groupActivity(group, [], ['a', 'b', 'c', 'd'], true, t)?.label).toBe('Delivered · waiting for A, B and 2 more…')
})
