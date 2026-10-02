import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Room, RoomContentReference } from '@shared/rooms-api'
import { RoomDirectFiles } from './RoomDirectFiles'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./rooms-client', () => ({ roomsRequest: mocks.request, roomPath: (id: string) => '/v1/rooms/' + id }))
vi.mock('./useRoomEvents', () => ({ subscribeRoomEvents: () => () => {} }))
vi.mock('react-i18next', async (importOriginal) => ({ ...await importOriginal<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key }) }))
const room = { id: 'private-room', revision: 0, conversationKind: 'user_agent', members: [{ participantAgentId: 'agent-1' }] } as Room
const file = (id = 'file-1'): RoomContentReference => ({ kind: 'agent_file', workspaceId: 'workspace', relativePath: id + '.txt',
  artifactId: id, artifactVersion: 1, titleSnapshot: 'File ' + id })
let renderer: ReactTestRenderer
beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { if (renderer) act(() => renderer.unmount()) })
const text = () => JSON.stringify(renderer.toJSON())
const search = () => renderer.root.findByType('input')
const button = (label: string) => renderer.root.findAllByType('button').find((item) => item.children.includes(label) || item.props['aria-label'] === label)!

it('distinguishes loading, empty library, and no matching search results', async () => {
  let finish!: (value: { files: RoomContentReference[] }) => void
  mocks.request.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  await act(async () => { renderer = create(createElement(RoomDirectFiles, { room, onOpen: vi.fn() })) })
  expect(text()).toContain('roomsLoading'); expect(text()).not.toContain('directNoFiles')
  await act(async () => { finish({ files: [] }) })
  expect(text()).toContain('directNoFiles'); expect(text()).not.toContain('roomsLoading')
  mocks.request.mockResolvedValueOnce({ files: [] })
  await act(async () => { search().props.onChange({ target: { value: 'unmatched' } }) })
  expect(text()).toContain('roomsArtifactNoSearchResults'); expect(text()).not.toContain('directNoFiles')
})

it('shows a retryable error without claiming the library is empty', async () => {
  mocks.request.mockRejectedValueOnce(new Error('Files unavailable'))
  await act(async () => { renderer = create(createElement(RoomDirectFiles, { room, onOpen: vi.fn() })) })
  expect(text()).toContain('Files unavailable'); expect(text()).not.toContain('directNoFiles')
  mocks.request.mockResolvedValueOnce({ files: [file()] })
  await act(async () => { button('retry').props.onClick() })
  expect(text()).toContain('File file-1'); expect(text()).not.toContain('Files unavailable')
})

it('resets pagination before a new search and never opens a previous query file', async () => {
  mocks.request.mockResolvedValueOnce({ files: [file()], nextCursor: 'cursor-1' })
  const onOpen = vi.fn()
  await act(async () => { renderer = create(createElement(RoomDirectFiles, { room, onOpen })) })
  mocks.request.mockResolvedValueOnce({ files: [file('file-2')] })
  await act(async () => { button('roomsArtifactMore').props.onClick() })
  expect(text()).toContain('File file-1'); expect(text()).toContain('File file-2')
  mocks.request.mockClear(); mocks.request.mockReturnValue(new Promise(() => {}))
  await act(async () => { search().props.onChange({ target: { value: 'new search' } }) })
  expect(text()).not.toContain('File file-1'); expect(text()).not.toContain('File file-2')
  expect(mocks.request.mock.calls.every(([path]) => !new URL(path, 'http://localhost').searchParams.has('cursor'))).toBe(true)
  expect(onOpen).not.toHaveBeenCalled()
})

it('ignores a delayed previous-Agent response and opens only the current Agent file', async () => {
  let finish!: (value: { files: RoomContentReference[] }) => void
  mocks.request.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  const onOpen = vi.fn()
  await act(async () => { renderer = create(createElement(RoomDirectFiles, { room, onOpen })) })
  mocks.request.mockResolvedValueOnce({ files: [file('current')] })
  await act(async () => { renderer.update(createElement(RoomDirectFiles, { room: { ...room, id: 'other-room', members: [{ participantAgentId: 'agent-2' }] as Room['members'] }, onOpen })) })
  await act(async () => { finish({ files: [file('old')] }) })
  expect(text()).not.toContain('File old')
  await act(async () => { button('File current').props.onClick() })
  expect(onOpen).toHaveBeenCalledWith(file('current'))
})
