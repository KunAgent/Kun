import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room, RoomTask, SendRoomMessage } from '@shared/rooms-api'
import i18n from '../../i18n'
import { RoomComposer } from './RoomComposer'

vi.mock('./RoomRichInput', async () => {
  const React = await import('react')
  return { RoomRichInput: React.forwardRef((props: { value: string; mentions: string[];
    onChange: (value: { body: string; mentions: string[] }) => void; onSubmit: () => void }, ref) => {
    React.useImperativeHandle(ref, () => ({ focus() {}, insertText(text: string) {
      props.onChange({ body: props.value + text, mentions: props.mentions })
    } }))
    return React.createElement('room-rich-input', { ...props, 'data-room-rich-input': true }, React.createElement('textarea', { value: props.value,
      onChange: (event: { target: { value: string } }) => props.onChange({ body: event.target.value, mentions: props.mentions }) }))
  }) }
})

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
  const listeners = new Map<string, (event: Event) => void>()
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    await i18n.changeLanguage('en')
    stored.clear()
    listeners.clear()
    upload
      .mockReset()
      .mockResolvedValue({ id: 'attachment', name: 'diagram.png' })
    vi.stubGlobal('window', {
      addEventListener: (name: string, fn: (event: Event) => void) =>
        listeners.set(name, fn),
      removeEventListener: (name: string) => listeners.delete(name),
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
    send: (message: SendRoomMessage) => Promise<void>,
    overrides: Partial<Parameters<typeof RoomComposer>[0]> = {}
  ): Promise<void> => {
    await act(async () => {
      renderer = create(
        createElement(RoomComposer, { room, tasks: [], onSend: send, ...overrides })
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
  it('sends mentions as stable IDs and preserves an existing discussion draft', async () => {
    stored.set('kun.rooms.draft.room', JSON.stringify({ body: '', intent: 'discussion' }))
    const send = vi.fn().mockResolvedValue(undefined)
    await render(send)
    act(() => renderer.root.findByProps({ 'data-room-rich-input': true }).props.onChange({ body: '', mentions: ['developer'] }))
    input('What are our options?')
    await submit()
    expect(send.mock.calls[0][0]).toMatchObject({
      mentionMemberIds: ['developer'],
      executionIntent: 'discussion'
    })
    expect(renderer.root.findByType('textarea').props.value).toBe('')
  })

  it('preserves serialized inline mention chips and expands all enabled members at send', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    await render(send)
    act(() => renderer.root.findByProps({ 'data-room-rich-input': true }).props.onChange({
      body: 'Ask [@all](#kun-room-all) about tests', mentions: ['*']
    }))
    await submit()
    expect(send.mock.calls[0][0]).toMatchObject({ body: 'Ask [@all](#kun-room-all) about tests', mentionMemberIds: ['developer'] })
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
  it('continues a selected topic explicitly and starts a new topic after a successful send', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    await render(send)
    act(() =>
      listeners.get('kun-room-continue-topic')!({
        detail: { roomId: 'room', rootRequestId: 'topic' }
      } as unknown as Event)
    )
    input('Continue the architecture discussion')
    await submit()
    expect(send.mock.calls[0][0].rootRequestId).toBe('topic')
    input('An unrelated question')
    await submit()
    expect(send.mock.calls[1][0].rootRequestId).toBeUndefined()
  })
  it('preserves reply topic identity on failure and lets new topic clear the quote without discarding content', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Connection lost'))
    await render(send)
    act(() =>
      listeners.get('kun-room-reply')!({
        detail: {
          roomId: 'room',
          messageId: 'message',
          rootRequestId: 'topic',
          body: 'Prior conclusion'
        }
      } as unknown as Event)
    )
    input('Follow up')
    await submit()
    expect(send.mock.calls[0][0]).toMatchObject({
      rootRequestId: 'topic',
      replyToMessageId: 'message'
    })
    await submit()
    expect(send.mock.calls[1][0].clientRequestId).toBe(
      send.mock.calls[0][0].clientRequestId
    )
    act(() => renderer.root.findByProps({ 'aria-label': i18n.t('roomsAddContext') }).props.onClick())
    act(() =>
      renderer.root
        .findByProps({ 'aria-label': 'Topic' })
        .props.onChange({ target: { value: '' } })
    )
    await submit()
    expect(send.mock.calls[2][0]).toMatchObject({ body: 'Follow up' })
    expect(send.mock.calls[2][0].rootRequestId).toBeUndefined()
    expect(send.mock.calls[2][0].replyToMessageId).toBeUndefined()
    expect(send.mock.calls[2][0].clientRequestId).not.toBe(
      send.mock.calls[0][0].clientRequestId
    )
  })
  it('ignores topic continuation actions from a different room', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    await render(send)
    act(() =>
      listeners.get('kun-room-continue-topic')!({
        detail: { roomId: 'other-room', rootRequestId: 'topic' }
      } as unknown as Event)
    )
    input('New question')
    await submit()
    expect(send.mock.calls[0][0].rootRequestId).toBeUndefined()
  })

  it('selects task and repository from the context menu and removes their chips', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    await render(send, { tasks: [{ id: 'task', title: 'Fix checkout' } as RoomTask] })
    const openContext = (): void => {
      act(() => renderer.root.findByProps({ 'aria-label': i18n.t('roomsAddContext') }).props.onClick())
    }
    expect(renderer.root.findAllByProps({ 'aria-label': i18n.t('roomsTaskReference') })).toHaveLength(0)
    openContext()
    act(() => renderer.root.findByProps({ 'aria-label': i18n.t('roomsTaskReference') }).props.onChange({ target: { value: 'task' } }))
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
    openContext()
    act(() => renderer.root.findByProps({ 'aria-label': i18n.t('roomsDefaultRepository') })
      .props.onChange({ target: { value: 'repo' } }))
    input('Use these sources')
    act(() => renderer.root.findByProps({ title: 'Fix checkout', className: 'rooms-composer-chip' })
      .props.onClick())
    await submit()
    expect(send.mock.calls[0][0]).toMatchObject({ repositoryId: 'repo', body: 'Use these sources' })
    expect(send.mock.calls[0][0].taskId).toBeUndefined()
  })

  it('uses the rich editor submit callback and keeps reference-only sends valid', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    await render(send)
    act(() => renderer.root.findByProps({ 'aria-label': i18n.t('roomsAddContext') }).props.onClick())
    const picker = renderer.root.findAll((node) => typeof node.type === 'function' && node.type.name === 'RoomContentReferencePicker')[0]
    act(() => picker.props.onChange([{ kind: 'task', taskId: 'task', titleSnapshot: 'Read the task' }]))
    await act(async () => renderer.root.findByProps({ 'data-room-rich-input': true }).props.onSubmit())
    expect(send.mock.calls[0][0]).toMatchObject({ body: '', references: [{ kind: 'task', taskId: 'task' }] })
  })

  it('preserves draft-specific scope and shows the actual continued topic title', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    await render(send, {
      room: { ...room, collaborationMode: 'peer' },
      topicChoices: [{ rootRequestId: 'topic', title: 'Resolve rendering performance' }]
    })
    act(() => renderer.root.findByProps({ 'aria-label': i18n.t('roomsAddContext') }).props.onClick())
    act(() => renderer.root.findByProps({ 'aria-label': 'Topic' })
      .props.onChange({ target: { value: 'topic' } }))
    expect(JSON.parse(stored.get('kun.rooms.draft.room')!).rootRequestId).toBe('topic')
    expect(renderer.root.findAllByProps({ 'aria-label': 'Topic' })).toHaveLength(0)
    input('Keep this draft')
    act(() => renderer.unmount())
    await render(send, { draftId: 'request-task' })
    expect(renderer.root.findByType('textarea').props.value).toBe('')
    expect(renderer.root.findAllByProps({ 'aria-label': 'Topic' })).toHaveLength(0)
    expect(listeners.has('kun-room-continue-topic')).toBe(false)
    input('Independent continuation')
    expect(JSON.parse(stored.get('kun.rooms.draft.request-task')!).body).toBe('Independent continuation')
    act(() => renderer.unmount())
    await render(send)
    expect(renderer.root.findByType('textarea').props.value).toBe('Keep this draft')
  })

  it('limits uploads to twenty attachments and keeps them removable before sending', async () => {
    let id = 0
    upload.mockImplementation(async () => ({ id: String(++id), name: `image-${id}.png` }))
    const send = vi.fn().mockResolvedValue(undefined)
    await render(send)
    await act(async () => renderer.root.findByProps({ type: 'file' }).props.onChange({
      target: { files: Array.from({ length: 22 }, () => ({ name: 'image.png', type: 'image/png' })) }
    }))
    expect(upload).toHaveBeenCalledTimes(20)
    act(() => renderer.root.findByProps({ 'aria-label': i18n.t('roomsAddContext') }).props.onClick())
    expect(renderer.root.findByProps({ 'aria-label': i18n.t('roomsAttach') }).props.disabled).toBe(true)
    act(() => renderer.root.findByProps({ title: 'image-1.png', className: 'rooms-composer-chip' })
      .props.onClick())
    await submit()
    expect(send.mock.calls[0][0].attachmentIds).toHaveLength(19)
    expect(send.mock.calls[0][0].attachmentIds).not.toContain('1')
  })

  it('keeps reply drawer drafts separate and supplies its explicit reply target', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    await render(send, { draftId: 'reply:room:root', replyTarget: { messageId: 'root', body: 'Root message', rootRequestId: 'topic' } })
    input('Drawer reply')
    await submit()
    expect(send.mock.calls[0][0]).toMatchObject({ body: 'Drawer reply', replyToMessageId: 'root', rootRequestId: 'topic' })
    expect(stored.has('kun.rooms.draft.room')).toBe(false)
  })

  it('hints that group rooms without repositories can discuss but cannot create tasks', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    await render(send, { room: { ...room, repositories: [] } })
    expect(renderer.root.findByProps({ className: 'rooms-run-note' }).children.join(''))
      .toBe(i18n.t('roomsRepositoryRequiredHint'))
    input('Keep discussing')
    await submit()
    expect(send).toHaveBeenCalledTimes(1)
  })
})
