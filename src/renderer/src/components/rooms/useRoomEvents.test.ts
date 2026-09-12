import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { useRoomEvents } from './useRoomEvents'
import {
  integrationRoomNotice,
  taskRoomNotice,
  type RoomIntegrationSnapshot
} from './room-notifications'
import type { RoomTaskDetail } from './rooms-client'

const harness = vi.hoisted(() => ({
  event: null as null | ((payload: unknown) => void),
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  task: vi.fn(),
  request: vi.fn(),
  notify: vi.fn(async () => ({ ok: true })),
  state: { route: 'chat' },
  focus: vi.fn(() => false)
}))
vi.mock('../../agent/runtime-client', () => ({
  rendererRuntimeClient: {
    startSse: harness.start,
    stopSse: harness.stop,
    onSseEvent: (listener: (payload: unknown) => void) => {
      harness.event = listener
      return () => {
        harness.event = null
      }
    },
    onSseOpen: () => () => undefined,
    onSseError: () => () => undefined,
    onSseEnd: () => () => undefined
  }
}))
vi.mock('../../store/chat-store', () => ({
  useChatStore: { getState: () => harness.state }
}))
vi.mock('./rooms-client', async (original) => ({
  ...(await original<typeof import('./rooms-client')>()),
  roomsRequest: harness.request,
  roomsClient: { task: harness.task }
}))

const detail: RoomTaskDetail = {
  task: {
    id: 'task',
    roomId: 'room',
    title: 'Task',
    status: 'awaiting_acceptance',
    latestDeliveryId: 'delivery',
    latestProgress: 'Ready',
    executionThreadId: 'developer',
    requestId: 'request',
    sourceMessageId: 'message',
    ownerMemberId: 'developer',
    memberSnapshot: {
      id: 'developer',
      displayName: 'Developer',
      presetId: 'developer',
      role: 'developer',
      roleNotes: '',
      enabled: true,
      allowedRepositoryIds: ['repo'],
      revision: 0
    },
    repositoryId: 'repo',
    workspaceId: 'workspace',
    stage: 'review',
    requirementRevision: 0,
    revision: 1,
    verificationStatus: 'not_run',
    applicationStatus: 'not_applied',
    updatedAt: '2026-09-12T00:00:00Z'
  },
  reviews: []
}
const integration: RoomIntegrationSnapshot = {
  id: 'integration',
  roomId: 'room',
  taskId: 'task',
  status: 'validating' as const,
  threadId: 'integration-thread',
  turnId: 'integration-turn',
  candidateSha: 'candidate',
  sourceSha: 'source',
  deliveryId: 'delivery',
  targetSha: 'target',
  path: '/tmp/integration',
  branch: 'integration',
  conflicts: [],
  diff: '',
  validation: [],
  createdAt: '2026-09-12T00:00:00Z',
  approvals: [{ id: 'approval-1', toolName: 'bash', summary: 'Run check' }],
  userInputs: []
}

describe('Room integration notifications', () => {
  let renderer: ReactTestRenderer
  const storage = new Map<string, string>()
  let rows: unknown[]
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    vi.useFakeTimers()
    storage.clear()
    harness.start.mockClear()
    harness.stop.mockClear()
    harness.notify.mockClear()
    harness.state.route = 'chat'
    harness.focus.mockReturnValue(false)
    harness.task.mockReset().mockResolvedValue(detail)
    rows = [integration]
    harness.request
      .mockReset()
      .mockImplementation(async (path: string) =>
        path.includes('/integrations')
          ? { integrations: rows }
          : path.includes('latest=true')
            ? { cursor: 1 }
            : { attentionCount: 0 }
      )
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value)
      },
      kunGui: {
        startSse: harness.start,
        showTurnCompleteNotification: harness.notify
      }
    })
    vi.stubGlobal('document', { hasFocus: harness.focus })
  })
  afterEach(() => {
    if (renderer) act(() => renderer.unmount())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  const mount = async () => {
    function Harness() {
      useRoomEvents()
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
  }
  const event = async (seq: number, roomId = 'room') => {
    await act(async () =>
      harness.event?.({
        streamId: (harness.start.mock.calls[0] as unknown[])[2],
        events: [
          {
            seq,
            roomId,
            kind: 'integration.updated',
            payload: { id: 'integration', taskId: 'task' }
          }
        ]
      })
    )
  }
  it('notifies the actual integration approval and deduplicates repeated updates by gate identity', async () => {
    await mount()
    await event(2)
    expect(harness.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room',
        threadId: 'integration-thread',
        body: 'Task: Code integration · Needs approval'
      })
    )
    await event(3)
    expect(harness.notify).toHaveBeenCalledTimes(1)
    rows = [
      {
        ...integration,
        approvals: [
          { id: 'approval-2', toolName: 'bash', summary: 'Next check' }
        ]
      }
    ]
    await event(4)
    expect(harness.notify).toHaveBeenCalledTimes(2)
  })
  it('suppresses an already visible room gate but not a background room gate', async () => {
    await mount()
    harness.state.route = 'rooms'
    harness.focus.mockReturnValue(true)
    storage.set('kun.rooms.selected', 'room')
    await event(2)
    expect(harness.notify).not.toHaveBeenCalled()
    harness.focus.mockReturnValue(false)
    await event(3)
    expect(harness.notify).not.toHaveBeenCalled()
    rows = [{ ...integration, approvals: [], userInputs: [{ id: 'input-2' }] }]
    await event(4)
    expect(harness.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Task: Code integration · Needs your input'
      })
    )
    rows = [{ ...integration, approvals: [{ id: 'approval-3' }] }]
    harness.focus.mockReturnValue(true)
    storage.set('kun.rooms.selected', 'another-room')
    await event(5)
    expect(harness.notify).toHaveBeenCalledTimes(2)
  })
  it('does not notify ordinary integration progress, then notifies readiness once', async () => {
    rows = [{ ...integration, approvals: [] }]
    await mount()
    await event(2)
    expect(harness.notify).not.toHaveBeenCalled()
    rows = [{ ...integration, status: 'ready', approvals: [] }]
    await event(3)
    await event(4)
    expect(harness.notify).toHaveBeenCalledTimes(1)
    expect(harness.notify).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Task: Code integration · Ready' })
    )
  })
  it('uses changed gate IDs for new task approvals rather than suppressing every approval in a delivery', () => {
    const first = taskRoomNotice({
      ...detail,
      task: { ...detail.task, status: 'needs_approval' },
      approvals: [{ id: 'a', toolName: 'write', summary: '' }]
    })
    const second = taskRoomNotice({
      ...detail,
      task: { ...detail.task, status: 'needs_approval' },
      approvals: [{ id: 'b', toolName: 'write', summary: '' }]
    })
    expect(first?.key).not.toBe(second?.key)
    expect(
      integrationRoomNotice(
        detail,
        { ...integration, approvals: [], status: 'applied' },
        (key) => key
      )
    ).toBeNull()
  })
})
