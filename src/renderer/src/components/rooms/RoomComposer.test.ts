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
const metadataRequest = vi.hoisted(() => vi.fn())
const imagePreview = vi.hoisted(() => vi.fn())
vi.mock('../../lib/runtime-attachment', () => ({
  uploadRuntimeAttachment: upload
}))
vi.mock('./rooms-client', async (load) => ({
  ...await load<typeof import('./rooms-client')>(),
  roomsRequest: metadataRequest
}))
vi.mock('./room-composer-image-preview', () => ({
  roomComposerImagePreview: imagePreview,
  isRoomComposerImage: (name: string, mimeType?: string) =>
    Boolean(mimeType?.startsWith('image/')) || /\.(png|jpe?g|webp|gif)$/i.test(name)
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
    metadataRequest.mockReset()
    imagePreview.mockReset().mockImplementation(async (file: File) => file.type.startsWith('image/')
      ? { url: 'data:image/webp;base64,YQ==', transient: false } : undefined)
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
    vi.restoreAllMocks()
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

  it('refreshes a referenced draft in the already open conversation without affecting other rooms', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    await render(send)
    input('Existing message')
    const references = [{ kind: 'code_thread', threadId: 'task', titleSnapshot: 'Task' }]
    stored.set('kun.rooms.draft.room', JSON.stringify({ body: 'Existing message\nAdded context', references }))
    act(() => listeners.get('kun-room-draft-updated')!({ detail: { roomId: 'other' } } as unknown as Event))
    expect(renderer.root.findByType('textarea').props.value).toBe('Existing message')
    act(() => listeners.get('kun-room-draft-updated')!({ detail: { roomId: 'room' } } as unknown as Event))
    expect(renderer.root.findByType('textarea').props.value).toBe('Existing message\nAdded context')
    await submit()
    expect(send.mock.calls[0][0].references).toEqual(references)
  })

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
    expect(renderer.root.findByType('img').props.src).toBe('data:image/webp;base64,YQ==')
    expect(JSON.parse(stored.get('kun.rooms.draft.room')!).attachments[0].previewUrl)
      .toBe('data:image/webp;base64,YQ==')
    await submit()
    expect(send.mock.calls[0][0].attachmentIds).toEqual(['attachment'])
  })
  it('restores an image thumbnail after a failed send and removes only the chosen attachment', async () => {
    let id = 0
    upload.mockImplementation(async (file: { name: string }) => ({ id: String(++id), name: file.name }))
    const send = vi.fn().mockRejectedValue(new Error('Offline'))
    await render(send)
    await act(async () => renderer.root.findByProps({ type: 'file' }).props.onChange({
      target: { files: [
        { name: 'image.png', type: 'image/png' },
        { name: 'notes.txt', type: 'text/plain' }
      ] }
    }))
    await submit()
    expect(renderer.root.findByType('img').props.src).toBe('data:image/webp;base64,YQ==')
    act(() => renderer.unmount())
    await render(send)
    expect(renderer.root.findByType('img').props.src).toBe('data:image/webp;base64,YQ==')
    act(() => renderer.root.findByProps({ title: 'image.png', className: 'rooms-composer-image-attachment' })
      .findByType('button').props.onClick())
    expect(renderer.root.findAllByType('img')).toHaveLength(0)
    expect(renderer.root.findByProps({ title: 'notes.txt', className: 'rooms-composer-chip' })).toBeTruthy()
    await submit()
    expect(send.mock.calls[1][0].attachmentIds).toEqual(['2'])
  })
  it('restores a thumbnail for an image attached by an older draft', async () => {
    stored.set('kun.rooms.draft.room', JSON.stringify({ body: '', attachments: [{ id: 'legacy', name: 'image.png' }] }))
    metadataRequest.mockResolvedValue({ attachment: { textFallback: {
      dataBase64: 'YQ==', mimeType: 'image/png'
    } } })
    await render(vi.fn().mockResolvedValue(undefined))
    expect(metadataRequest).toHaveBeenCalledWith('/v1/attachments/legacy', 'GET', undefined, expect.anything())
    expect(renderer.root.findByType('img').props.src).toBe('data:image/webp;base64,YQ==')
    expect(JSON.parse(stored.get('kun.rooms.draft.room')!).attachments[0].previewUrl)
      .toBe('data:image/webp;base64,YQ==')
  })
  it('releases temporary previews when an image is removed or sent without storing blob URLs', async () => {
    let id = 0
    upload.mockImplementation(async () => ({ id: String(++id), name: `image-${id}.png` }))
    imagePreview.mockResolvedValue({ url: 'blob:preview', transient: true })
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const send = vi.fn().mockResolvedValue(undefined)
    await render(send)
    await act(async () => renderer.root.findByProps({ type: 'file' }).props.onChange({
      target: { files: [
        { name: 'one.png', type: 'image/png' },
        { name: 'two.png', type: 'image/png' }
      ] }
    }))
    act(() => renderer.root.findByProps({ title: 'image-1.png', className: 'rooms-composer-image-attachment' })
      .findByType('button').props.onClick())
    expect(revoke).toHaveBeenCalledTimes(1)
    expect(stored.get('kun.rooms.draft.room')).not.toContain('blob:preview')
    await submit()
    expect(revoke).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0][0].attachmentIds).toEqual(['2'])
  })
  it('keeps typing enabled during uploads, supports per-file cancellation, and ignores late responses', async () => {
    let finish!: (value: { id: string; name: string }) => void
    upload.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const send = vi.fn().mockResolvedValue(undefined)
    await render(send)
    await act(async () => renderer.root.findByProps({ type: 'file' }).props.onChange({
      target: { files: [{ name: 'slow.png', type: 'image/png' }] }
    }))
    expect(renderer.root.findByType('fieldset').props.disabled).toBe(false)
    input('Continue typing while upload runs')
    await submit()
    expect(send).not.toHaveBeenCalled()
    act(() => renderer.root.findByProps({ 'aria-label': 'Cancel slow.png' }).props.onClick())
    await act(async () => finish({ id: 'late', name: 'slow.png' }))
    expect(JSON.parse(stored.get('kun.rooms.draft.room')!).attachments).toEqual([])
    await submit()
    expect(send.mock.calls[0][0]).toMatchObject({ body: 'Continue typing while upload runs', attachmentIds: [] })
  })

  it('keeps Workbench file references and typed text when a concurrent upload completes', async () => {
    let finish!: (value: { id: string; name: string }) => void
    upload.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const send = vi.fn().mockResolvedValue(undefined)
    await render(send, { room: { ...room, repositories: [{ ...room.repositories[0], canonicalRoot: '/workspace/App' }] } })
    await act(async () => renderer.root.findByProps({ type: 'file' }).props.onChange({
      target: { files: [{ name: 'slow.txt', type: 'text/plain' }] }
    }))
    input('Compare the two files')
    act(() => listeners.get('kun-room-file-reference')!(new CustomEvent('kun-room-file-reference', { detail: {
      roomId: room.id, reference: { type: 'file', path: '/workspace/App/readme.md', name: 'readme.md' }
    } })))
    await act(async () => finish({ id: 'uploaded', name: 'slow.txt' }))
    await submit()
    expect(send.mock.calls[0][0]).toMatchObject({ body: 'Compare the two files', attachmentIds: ['uploaded'],
      references: [{ kind: 'repository_file', repositoryId: 'repo', relativePath: 'readme.md', titleSnapshot: 'readme.md' }] })
  })

  it('keeps successful files when another upload fails and retries only the failed file', async () => {
    upload.mockImplementation(async (file: { name: string }) => {
      if (file.name === 'bad.txt') throw new Error('Offline')
      return { id: 'good', name: file.name }
    })
    const send = vi.fn().mockResolvedValue(undefined)
    await render(send)
    await act(async () => renderer.root.findByProps({ type: 'file' }).props.onChange({
      target: { files: [{ name: 'good.txt', type: 'text/plain' }, { name: 'bad.txt', type: 'text/plain' }] }
    }))
    expect(JSON.parse(stored.get('kun.rooms.draft.room')!).attachments).toHaveLength(1)
    expect(JSON.stringify(renderer.toJSON())).toContain('Offline')
    upload.mockResolvedValue({ id: 'retried', name: 'bad.txt' })
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Retry bad.txt' }).props.onClick())
    await submit()
    expect(send.mock.calls[0][0].attachmentIds).toEqual(['good', 'retried'])
    expect(send.mock.calls[0][1]).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'good', name: 'good.txt' })]))
  })

  it('discards in-flight uploads when leaving the room and keeps mention IDs unique', async () => {
    let finish!: (value: { id: string; name: string }) => void
    upload.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const send = vi.fn().mockResolvedValue(undefined)
    await render(send)
    await act(async () => renderer.root.findByProps({ type: 'file' }).props.onChange({
      target: { files: [{ name: 'slow.txt', type: 'text/plain' }] }
    }))
    act(() => renderer.unmount())
    await act(async () => finish({ id: 'late', name: 'slow.txt' }))
    await render(send)
    act(() => renderer.root.findByProps({ 'data-room-rich-input': true }).props.onChange({ body: 'hello', mentions: ['developer', 'developer'] }))
    expect(JSON.parse(stored.get('kun.rooms.draft.room')!).attachments).toEqual([])
    await submit()
    expect(send.mock.calls[0][0].mentionMemberIds).toEqual(['developer'])
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
    act(() => renderer.root.findByProps({ title: 'image-1.png', className: 'rooms-composer-image-attachment' })
      .findByType('button').props.onClick())
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

  it('adopts proposal drafts into the composer with mentions, repository and intent', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    await render(send)
    act(() =>
      listeners.get('kun-room-proposal-draft')!({
        detail: {
          roomId: 'room',
          body: '[@Developer](#kun-room-developer)\nPort the importer',
          mentions: ['developer'],
          repositoryId: 'repo',
          rootRequestId: 'topic-1',
          intent: 'execute'
        }
      } as unknown as Event)
    )
    expect(renderer.root.findByType('textarea').props.value).toContain('Port the importer')
    await submit()
    expect(send.mock.calls[0][0]).toMatchObject({
      mentionMemberIds: ['developer'],
      repositoryId: 'repo',
      rootRequestId: 'topic-1',
      executionIntent: 'execute'
    })
    // A proposal draft for another room never enters this composer.
    await render(send, { room: { ...room, id: 'other' } })
    act(() =>
      listeners.get('kun-room-proposal-draft')!({
        detail: { roomId: 'room', body: 'Ignore me' }
      } as unknown as Event)
    )
    expect(renderer.root.findByType('textarea').props.value).toBe('')
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
