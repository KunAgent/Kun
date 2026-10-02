import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentDirectActivity } from '@shared/rooms-api'
import i18n from '../../i18n'
import { RoomAgentBrowser, RoomAgentBrowserStatus } from './RoomAgentBrowser'

vi.mock('../AgentBrowserPanel', () => ({ AgentBrowserPanel: (props: Record<string, unknown>) => createElement('section', { ...props, 'data-browser-panel': true }) }))
let renderer: ReactTestRenderer | undefined
const execution = { roomId: 'room-a', requestId: 'request-a', runId: 'run-a', threadId: 'thread-a', turnId: 'turn-a' }
const activity = (patch = {}) => ({ execution, active: { id: 'request-a', runId: 'run-a', threadId: 'thread-a', turnId: 'turn-a', status: 'running' },
  requests: [], approvals: [], userInputs: [], ...patch }) as unknown as AgentDirectActivity
const props = () => ({ roomId: 'room-a', activity: activity(), active: true, onRefresh: vi.fn(), onCurrent: vi.fn() })
beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(() => { if (renderer) act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals() })
it('binds only the authoritative current execution including exact turn identity', async () => {
  await act(async () => { renderer = create(createElement(RoomAgentBrowser, props())) })
  expect(renderer!.root.findByProps({ 'data-browser-panel': true }).props).toMatchObject({ threadId: 'thread-a', expectedTurnId: 'turn-a', active: true })
  await act(async () => renderer!.update(createElement(RoomAgentBrowser, { ...props(), roomId: 'room-b' })))
  expect(renderer!.root.findAllByProps({ 'data-browser-panel': true })).toHaveLength(0)
})
it('never supervises a historical selected run or a stale current request', async () => {
  const input = { ...props(), selectedRunId: 'old-run' }
  await act(async () => { renderer = create(createElement(RoomAgentBrowser, input)) })
  expect(renderer!.root.findAllByProps({ 'data-browser-panel': true })).toHaveLength(0)
  expect(JSON.stringify(renderer!.toJSON())).toContain('Historical sessions are read-only')
  const button = renderer!.root.findAllByType('button').find((node) => node.children.includes('Show current browser'))!
  act(() => button.props.onClick()); expect(input.onCurrent).toHaveBeenCalledOnce()
  await act(async () => renderer!.update(createElement(RoomAgentBrowser, { ...props(), activity: activity({ active: { id: 'other', status: 'running' } }) })))
  expect(renderer!.root.findAllByProps({ 'data-browser-panel': true })).toHaveLength(0)
})
it.each(['stopping', 'recovery_required', 'failed', 'cancelled', 'completed'])('removes live controls while %s', async (status) => {
  await act(async () => { renderer = create(createElement(RoomAgentBrowser, { ...props(), activity: activity({ active: { ...activity().active, status } }) })) })
  expect(renderer!.root.findAllByProps({ 'data-browser-panel': true })).toHaveLength(0)
})
it('fails closed on unavailable activity and has a working retry', async () => {
  const input = { ...props(), error: 'Runtime unavailable' }
  await act(async () => { renderer = create(createElement(RoomAgentBrowser, input)) })
  expect(renderer!.root.findAllByProps({ 'data-browser-panel': true })).toHaveLength(0)
  expect(JSON.stringify(renderer!.toJSON())).toContain('Runtime unavailable')
  act(() => renderer!.root.findByType('button').props.onClick()); expect(input.onRefresh).toHaveBeenCalledOnce()
})
it('clears the browser status immediately across conversations and ignores a late read', async () => {
  let resolve!: (value: unknown) => void
  const get = vi.fn(() => new Promise((done) => { resolve = done }))
  let event!: (value: unknown) => void
  vi.stubGlobal('window', { kunGui: { getBrowserUseState: get, onBrowserUseState: (listener: typeof event) => { event = listener; return vi.fn() } } })
  await act(async () => { renderer = create(createElement(RoomAgentBrowserStatus, { roomId: 'room-a', activity: activity(), onOpen: vi.fn() })) })
  await act(async () => event({ threadId: 'thread-a', turnId: 'turn-a', sessionId: 'browser-session-a', lifecycle: 'manual-control', controlOwner: 'manual', updatedAt: '2026-10-02T00:00:01Z' }))
  expect(JSON.stringify(renderer!.toJSON())).toContain('You have browser control')
  await act(async () => resolve({ threadId: 'thread-a', turnId: 'turn-a', sessionId: 'old-session', lifecycle: 'loading', updatedAt: '2026-10-02T00:00:00Z' }))
  expect(JSON.stringify(renderer!.toJSON())).toContain('You have browser control')
  await act(async () => renderer!.update(createElement(RoomAgentBrowserStatus, { roomId: 'room-b', activity: activity(), onOpen: vi.fn() })))
  expect(renderer!.toJSON()).toBeNull()
})
