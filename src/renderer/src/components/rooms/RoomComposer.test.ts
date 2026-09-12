import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room, SendRoomMessage } from '@shared/rooms-api'
import i18n from '../../i18n'
import { RoomComposer } from './RoomComposer'

const upload = vi.hoisted(() => vi.fn())
vi.mock('../../lib/runtime-attachment', () => ({
  uploadRuntimeAttachment: upload
}))
const room = {
  id: 'room',
  name: 'Test room',
  collaborationMode: 'autonomous',
  members: [{ id: 'developer', displayName: 'Developer', enabled: true }],
  repositories: [{ id: 'repo', displayName: 'App' }]
} as Room

describe('RoomComposer', () => {
  let renderer: ReactTestRenderer
  const stored = new Map<string, string>()
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    stored.clear()
    upload
      .mockReset()
      .mockResolvedValue({ id: 'attachment', name: 'diagram.png' })
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value)
      },
      kunGui: { getPathForFile: () => '/tmp/design files/diagram.png' }
    })
  })
  afterEach(() => {
    if (renderer) act(() => renderer.unmount())
    vi.unstubAllGlobals()
  })
  const render = async (
    send: (message: SendRoomMessage) => Promise<void>
  ): Promise<void> => {
    await act(async () => {
      renderer = create(
        createElement(RoomComposer, { room, tasks: [], onSend: send })
      )
    })
  }
  const input = (body: string): void => {
    act(() =>
      renderer.root
        .findByType('textarea')
        .props.onChange({ target: { value: body } })
    )
  }
  const submit = async (): Promise<void> => {
    await act(async () =>
      renderer.root
        .findByType('form')
        .props.onSubmit({ preventDefault: () => undefined })
    )
  }

  it('retains a failed send and reuses its request ID until content changes', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Connection lost'))
    await render(send)
    input('Implement the feature')
    await submit()
    const first = send.mock.calls[0][0]
    expect(first.executionIntent).toBe('auto')
    expect(renderer.root.findByType('textarea').props.value).toBe(
      'Implement the feature'
    )
    await submit()
    expect(send.mock.calls[1][0].clientRequestId).toBe(first.clientRequestId)
    input('Implement the corrected feature')
    await submit()
    expect(send.mock.calls[2][0].clientRequestId).not.toBe(
      first.clientRequestId
    )
    expect(JSON.parse(stored.get('kun.rooms.draft.room')!).body).toBe(
      'Implement the corrected feature'
    )
  })
  it('sends mentions as stable IDs and honors explicit discussion intent', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    await render(send)
    act(() =>
      renderer.root
        .findByProps({ 'aria-label': 'Mention member' })
        .props.onChange({ target: { value: 'developer' } })
    )
    act(() =>
      renderer.root
        .findByProps({ 'aria-label': 'Automatic intent' })
        .props.onChange({ target: { value: 'discussion' } })
    )
    input('What are our options?')
    await submit()
    expect(send.mock.calls[0][0]).toMatchObject({
      mentionMemberIds: ['developer'],
      executionIntent: 'discussion'
    })
    expect(renderer.root.findByType('textarea').props.value).toBe('')
  })
  it('uploads through the local-file contract and sends attachment IDs', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    await render(send)
    await act(async () =>
      renderer.root.findByProps({ type: 'file' }).props.onChange({
        target: { files: [{ name: 'diagram.png', type: 'image/png' }] }
      })
    )
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({
        localFilePath: '/tmp/design files/diagram.png',
        dataBase64: '',
        mimeType: 'image/png'
      })
    )
    await submit()
    expect(send.mock.calls[0][0].attachmentIds).toEqual(['attachment'])
  })
})
