import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { RoomChoiceCard } from './RoomChoiceCard'
import type { RoomUserInput } from './rooms-client'

const api = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./rooms-client', async (original) => ({
  ...(await original<typeof import('./rooms-client')>()), roomsRequest: api.request
}))

const input: RoomUserInput = { id: 'input-1', prompt: 'Choose an account and scope', questions: [
  { id: 'account', question: 'Which accounts?', selectionMode: 'multiple', minSelections: 1,
    options: [{ label: 'Work', description: '' }, { label: 'Personal', description: '' }] },
  { id: 'scope', question: 'Which scope?', options: [{ label: 'Unread', description: '' }, { label: 'All', description: '' }] }
] }

describe('RoomChoiceCard', () => {
  let renderer: ReactTestRenderer | undefined
  beforeEach(async () => { await i18n.changeLanguage('en'); api.request.mockReset().mockResolvedValue({}) })
  afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined })

  it('submits every question with the correct single and multiple answer shapes', async () => {
    const onUpdated = vi.fn().mockResolvedValue(undefined)
    await act(async () => { renderer = create(createElement(RoomChoiceCard, { input, onUpdated })) })
    const option = (label: string) => renderer!.root.findAllByProps({ className: 'direct-choice-option' })
      .find((button) => button.findAllByType('b').some((node) => node.props.children === label))!
    act(() => option('Work').props.onClick())
    act(() => option('Unread').props.onClick())
    expect(api.request).not.toHaveBeenCalled()
    await act(async () => renderer!.root.findByProps({ className: 'direct-choice-submit' }).props.onClick())
    expect(api.request).toHaveBeenCalledWith('/v1/user-inputs/input-1', 'POST', { answers: [
      { id: 'account', label: 'Work', value: 'Work', labels: ['Work'], values: ['Work'] },
      { id: 'scope', label: 'Unread', value: 'Unread' }
    ] })
    expect(onUpdated).toHaveBeenCalledTimes(1)
    expect(renderer!.root.findByProps({ className: 'direct-choice-card is-answered' }).findByType('small').props.children)
      .toBe('Work · Unread')
  })

  it('keeps a failed answer available for retry', async () => {
    api.request.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({})
    await act(async () => { renderer = create(createElement(RoomChoiceCard, { input, onUpdated: vi.fn() })) })
    const buttons = renderer!.root.findAllByProps({ className: 'direct-choice-option' })
    act(() => buttons[0].props.onClick())
    act(() => buttons[2].props.onClick())
    await act(async () => renderer!.root.findByProps({ className: 'direct-choice-submit' }).props.onClick())
    expect(renderer!.root.findByProps({ role: 'alert' }).props.children).toBe('Offline')
    await act(async () => renderer!.root.findByProps({ className: 'direct-choice-submit' }).props.onClick())
    expect(api.request).toHaveBeenCalledTimes(2)
  })
})
