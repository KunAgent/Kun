import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Room, RoomContentReference, RoomContentResult } from '@shared/rooms-api'
import { RoomContentPreview } from './RoomContentPreview'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./rooms-client', () => ({ roomsRequest: mocks.request }))
vi.mock('./useRoomEvents', () => ({ subscribeRoomEvents: () => () => {} }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../chat/AssistantMarkdown', () => ({ AssistantMarkdown: () => null }))
vi.mock('./RoomImageLightbox', () => ({ RoomImageLightbox: () => null }))
vi.mock('./RoomArtifactExport', () => ({ RoomArtifactExport: () => null }))
vi.mock('./RoomArtifactVersions', () => ({ RoomArtifactVersions: ({ onVersion }: { onVersion: (version: number) => void }) =>
  createElement('button', { 'data-testid': 'version', onClick: () => onVersion(1) }, 'Version 1') }))

const room = { id: 'private-room', revision: 0, conversationKind: 'user_agent',
  members: [{ participantAgentId: 'agent-1' }] } as Room
const reference = (id = 'file-1'): RoomContentReference => ({ kind: 'agent_file', workspaceId: 'workspace', relativePath: id + '.txt',
  artifactId: id, artifactVersion: 2 })
const result = (ref = reference()): RoomContentResult => ({ reference: ref, state: 'available', title: 'Saved file',
  preview: { type: 'text', text: 'Saved contents', truncated: false }, sourceTarget: {
    roomId: room.id, participantAgentId: 'agent-1', runId: 'source-run', messageId: 'source-message' } })
let renderer: ReactTestRenderer
beforeEach(() => { vi.clearAllMocks(); mocks.request.mockResolvedValue(result()) })
afterEach(() => { if (renderer) act(() => renderer.unmount()) })
const text = () => JSON.stringify(renderer.toJSON())
const sourceButton = () => renderer.root.findAllByType('button').find((button) => button.children.includes('roomsArtifactOpenSource'))

it('opens the selected version source without using file or Code navigation', async () => {
  const onOpenSource = vi.fn(), onOpenTarget = vi.fn(), onOpenCode = vi.fn()
  await act(async () => { renderer = create(createElement(RoomContentPreview, { room, reference: reference(), onOpenSource, onOpenTarget, onOpenCode })) })
  expect(sourceButton()).toBeDefined()
  await act(async () => { sourceButton()!.props.onClick() })
  expect(onOpenSource).toHaveBeenCalledWith(result().sourceTarget)
  expect(onOpenTarget).not.toHaveBeenCalled(); expect(onOpenCode).not.toHaveBeenCalled()
})

it('clears contents and source during a file switch and ignores an older response', async () => {
  let finishOld!: (value: RoomContentResult) => void
  mocks.request.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve }))
  const props = { room, onOpenSource: vi.fn() }
  await act(async () => { renderer = create(createElement(RoomContentPreview, { ...props, reference: reference() })) })
  mocks.request.mockResolvedValueOnce({ ...result(reference('file-2')), title: 'New file', sourceTarget: undefined })
  await act(async () => { renderer.update(createElement(RoomContentPreview, { ...props, reference: reference('file-2') })) })
  await act(async () => { finishOld(result()) })
  expect(text()).toContain('New file'); expect(text()).not.toContain('Saved file'); expect(sourceButton()).toBeUndefined()
})

it('never requests a new file using the previous file selected version', async () => {
  const props = { room, onOpenSource: vi.fn() }
  await act(async () => { renderer = create(createElement(RoomContentPreview, { ...props, reference: reference() })) })
  await act(async () => { renderer.root.findByProps({ 'data-testid': 'version' }).props.onClick() })
  mocks.request.mockClear()
  await act(async () => { renderer.update(createElement(RoomContentPreview, { ...props, reference: reference('file-2') })) })
  const requested = mocks.request.mock.calls.map(([path]) => JSON.parse(new URL(path, 'http://localhost').searchParams.get('reference')!))
  expect(requested.length).toBeGreaterThan(0)
  expect(requested.every((item) => item.artifactId === 'file-2' && item.artifactVersion === 2)).toBe(true)
})

it('hides mismatched-room and mismatched-Agent source targets', async () => {
  for (const sourceTarget of [{ ...result().sourceTarget!, roomId: 'foreign-room' }, { ...result().sourceTarget!, participantAgentId: 'foreign-agent' }]) {
    mocks.request.mockResolvedValue({ ...result(), sourceTarget })
    await act(async () => { renderer = create(createElement(RoomContentPreview, { room, reference: reference(), onOpenSource: vi.fn() })) })
    expect(sourceButton()).toBeUndefined()
    act(() => renderer.unmount())
  }
})

it('does not show a late navigation error in the next file preview', async () => {
  let reject!: (error: Error) => void
  const onOpenTarget = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail }))
  mocks.request.mockResolvedValueOnce({ ...result(), openTarget: { kind: 'code_file', workspaceRoot: '/workspace', relativePath: 'one.txt' } })
  await act(async () => { renderer = create(createElement(RoomContentPreview, { room, reference: reference(), onOpenTarget })) })
  await act(async () => { renderer.root.findByProps({ className: 'rooms-content-open' }).props.onClick() })
  await act(async () => { renderer.update(createElement(RoomContentPreview, { room, reference: reference('file-2'), onOpenTarget })) })
  await act(async () => { reject(new Error('Old file navigation failed')) })
  expect(text()).not.toContain('Old file navigation failed')
})

it('changes the source with the selected version and keeps no prior source while loading', async () => {
  const onOpenSource = vi.fn()
  await act(async () => { renderer = create(createElement(RoomContentPreview, { room, reference: reference(), onOpenSource })) })
  let finish!: (value: RoomContentResult) => void
  mocks.request.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  await act(async () => { renderer.root.findByProps({ 'data-testid': 'version' }).props.onClick() })
  expect(sourceButton()).toBeUndefined(); expect(text()).not.toContain('Saved contents')
  const older = { ...result(), sourceTarget: { ...result().sourceTarget!, runId: 'older-run', messageId: 'older-message' } }
  await act(async () => { finish(older) })
  await act(async () => { sourceButton()!.props.onClick() })
  expect(onOpenSource).toHaveBeenCalledWith(older.sourceTarget)
})

it('keeps a saved snapshot usable when its source is unavailable', async () => {
  mocks.request.mockResolvedValue({ ...result(), sourceTarget: undefined })
  await act(async () => { renderer = create(createElement(RoomContentPreview, { room, reference: reference(), onOpenSource: vi.fn() })) })
  expect(text()).toContain('Saved contents'); expect(text()).toContain('roomsArtifactSourceUnavailable')
  expect(sourceButton()).toBeUndefined()
})
