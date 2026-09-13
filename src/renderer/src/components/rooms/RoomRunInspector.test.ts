import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  RoomMessage,
  RoomRunDetail,
  RoomRunItemsPage
} from '@shared/rooms-api'
import i18n from '../../i18n'
import { RoomRunInspector } from './RoomRunInspector'
import { RoomMessageRunButton } from './RoomMessageRunButton'
import { RoomRunItems } from './RoomRunItems'
import { RoomRunList } from './RoomRunList'

const api = vi.hoisted(() => ({
  request: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  event: null as
    null | ((value: { streamId: string; events: unknown[] }) => void),
  error: null as null | ((value: { streamId: string; message: string }) => void)
}))
vi.mock('./rooms-client', async (original) => ({
  ...(await original<typeof import('./rooms-client')>()),
  roomsRequest: api.request
}))
vi.mock('./RoomMessageBody', () => ({
  RoomMessageBody: ({ body }: { body: string }) => createElement('p', {}, body)
}))
vi.mock('./useRoomEvents', () => ({
  subscribeRoomEvents: () => () => undefined
}))
vi.mock('../../agent/runtime-client', () => ({
  rendererRuntimeClient: {
    startSse: api.start,
    stopSse: api.stop,
    onSseEvent: (fn: typeof api.event) => {
      api.event = fn
      return () => {
        if (api.event === fn) api.event = null
      }
    },
    onSseError: (fn: typeof api.error) => {
      api.error = fn
      return () => {
        if (api.error === fn) api.error = null
      }
    },
    onSseOpen: () => () => undefined
  }
}))

const runDetail = (
  id = 'run-a',
  extra: Partial<RoomRunDetail['run']> = {}
): RoomRunDetail => ({
  run: {
    id,
    roomId: 'room',
    memberId: 'member',
    memberLabel: 'Saved member',
    phase: 'discussion',
    status: 'completed',
    attempt: 1,
    clientRequestId: 'request-' + id,
    input: 'Original requirement ' + id,
    attachmentIds: [],
    threadId: 'thread-' + id,
    turnId: 'turn-' + id,
    createdAt: '2026-09-13T10:00:00Z',
    updatedAt: '2026-09-13T10:00:00Z',
    ...extra
  },
  availability: { status: 'available' },
  eventsCursor: 'cursor-' + id
})
const item = (id: string, text = id): RoomRunItemsPage['items'][number] => ({
  id,
  threadId: 'thread-run-a',
  turnId: 'turn-run-a',
  role: 'assistant',
  kind: 'assistant_text',
  status: 'completed',
  createdAt: `2026-09-13T10:00:${id.padStart(2, '0')}Z`,
  text
})
const page = (
  items: RoomRunItemsPage['items'],
  nextCursor?: string
): RoomRunItemsPage => ({
  items,
  nextCursor,
  hasMore: Boolean(nextCursor),
  itemBytes: 100,
  availability: { status: 'available' },
  eventsCursor: 'items-cursor'
})

describe('Rooms run inspector', () => {
  let renderer: ReactTestRenderer | undefined
  const onOpenThread = vi.fn()
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    api.request
      .mockReset()
      .mockImplementation(async (path: string) =>
        path.endsWith('/items')
          ? page([item('20', 'Recorded response')], 'older')
          : runDetail(path.includes('run-b') ? 'run-b' : 'run-a')
      )
    api.start.mockReset().mockResolvedValue({ streamId: 'stream' })
    api.stop.mockReset().mockResolvedValue(true)
    api.event = null
    api.error = null
    onOpenThread.mockReset().mockResolvedValue(undefined)
    vi.stubGlobal('window', { kunGui: { startSse: vi.fn() } })
  })
  afterEach(() => {
    if (renderer) act(() => renderer!.unmount())
    renderer = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  const render = async (runId = 'run-a') => {
    await act(async () => {
      if (renderer)
        renderer.update(
          createElement(RoomRunInspector, {
            roomId: 'room',
            runId,
            onOpenThread
          })
        )
      else
        renderer = create(
          createElement(RoomRunInspector, {
            roomId: 'room',
            runId,
            onOpenThread
          })
        )
    })
  }
  const button = (text: string) =>
    renderer!.root
      .findAllByType('button')
      .find((value) => value.children.includes(text))!
  const texts = () => JSON.stringify(renderer!.toJSON())
  const emit = async (kind: string, runId = 'run-a') => {
    const streamId = api.start.mock.calls.at(-1)![2]
    act(() =>
      api.event?.({
        streamId,
        events: [{ kind, roomId: 'room', runId, cursor: 'next' }]
      })
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
  }

  it('opens only the exact recorded turn and shows a rejected Code navigation locally', async () => {
    await render()
    onOpenThread.mockRejectedValue(new Error('Original turn unavailable'))
    await act(async () => button('Open this run in Code').props.onClick())
    expect(onOpenThread).toHaveBeenCalledWith('thread-run-a', 'turn-run-a')
    expect(texts()).toContain('Original turn unavailable')
    expect(api.request.mock.calls.every((call) => call[1] === 'GET')).toBe(true)
  })

  it('keeps triage outcomes and unavailable usage visible without inventing a Code target', async () => {
    api.request.mockImplementation(async (path: string) =>
      path.endsWith('/items')
        ? page([])
        : {
            ...runDetail('run-a', {
              phase: 'triage',
              outcome: 'skipped',
              threadId: undefined,
              turnId: undefined
            }),
            availability: { status: 'no_session' }
          }
    )
    await render()
    expect(button('Open this run in Code')).toBeUndefined()
    expect(texts()).toContain('No response needed')
    expect(texts()).toContain('Unavailable')
    expect(texts()).toContain('Original requirement run-a')
  })

  it('ignores late replies and tears down the previous scoped subscription when the selection changes', async () => {
    await render()
    const oldStreamId = api.start.mock.calls[0][2]
    let resolveOld!: (value: RoomRunDetail) => void
    api.request.mockImplementation((path: string) =>
      path.endsWith('/items')
        ? Promise.resolve(page([item('20')]))
        : path.endsWith('/run-b')
          ? new Promise((resolve) => {
              resolveOld = resolve
            })
          : Promise.resolve(runDetail('run-a'))
    )
    await render('run-b')
    expect(api.stop).toHaveBeenCalledWith(oldStreamId)
    expect(api.start).toHaveBeenCalledTimes(1)
    await render('run-a')
    await act(async () => resolveOld(runDetail('run-b')))
    expect(texts()).toContain('Original requirement run-a')
    expect(texts()).not.toContain('Original requirement run-b')
    expect(api.start.mock.calls.at(-1)![3]).toMatchObject({
      scope: 'room-run',
      roomId: 'room',
      runId: 'run-a'
    })
  })

  it('merges live latest-page updates with loaded history and never responds to another run or cursor-only event', async () => {
    await render()
    api.request.mockImplementation(async (path: string) =>
      path.includes('cursor=older')
        ? page([item('10', 'Earlier output')])
        : path.endsWith('/items')
          ? page([item('20', 'Updated response'), item('30', 'New output')])
          : runDetail()
    )
    await act(async () => button('Load earlier process').props.onClick())
    vi.useFakeTimers()
    api.request.mockClear()
    await emit('run.cursor')
    await emit('run.items_changed', 'different-run')
    expect(api.request).not.toHaveBeenCalled()
    await emit('run.items_changed')
    expect(texts()).toContain('Earlier output')
    expect(texts()).toContain('Updated response')
    expect(texts()).toContain('New output')
    expect(
      renderer!.root
        .findByType(RoomRunItems)
        .props.items.map((value: { id: string }) => value.id)
    ).toEqual(['10', '20', '30'])
  })

  it('retains every missing interval when multiple live pages have no overlap with retained items', async () => {
    await render()
    vi.useFakeTimers()
    api.request.mockResolvedValue(page([item('50')], 'middle'))
    await emit('run.items_changed')
    expect(button('Load missing process')).toBeDefined()
    api.request.mockResolvedValue(page([item('80')], 'newer-middle'))
    await emit('run.items_changed')
    api.request.mockResolvedValue(page([item('50'), item('60'), item('70')], 'middle'))
    await act(async () => button('Load missing process').props.onClick())
    expect(button('Load missing process')).toBeDefined()
    api.request.mockResolvedValue(
      page([item('20'), item('30'), item('40')], 'older')
    )
    await act(async () => button('Load missing process').props.onClick())
    expect(
      renderer!.root
        .findByType(RoomRunItems)
        .props.items.map((value: { id: string }) => value.id)
    ).toEqual(['20', '30', '40', '50', '60', '70', '80'])
    expect(button('Load missing process')).toBeUndefined()
  })

  it('retains original input when process loading fails instead of treating it as empty success', async () => {
    api.request.mockImplementation(async (path: string) => {
      if (path.endsWith('/items')) throw new Error('Process store unavailable')
      return runDetail()
    })
    await render()
    expect(texts()).toContain('Original requirement run-a')
    expect(texts()).toContain('Process store unavailable')
    expect(button('Refresh')).toBeDefined()
  })
  it('shows item-history unavailability and merges crossed detail/item snapshot cursors without skipping either replay gap', async () => {
    const encode = (revision: number, seq: number) => btoa(JSON.stringify({ v: 1, id: 'run-a', revision, seq, availability: 'available' }))
    api.request.mockImplementation(async (path: string) =>
      path.endsWith('/items')
        ? {
            ...page([]),
            availability: {
              status: 'history_unavailable',
              reason: 'Recorded items removed'
            },
            eventsCursor: encode(9, 20)
          }
        : { ...runDetail(), eventsCursor: encode(3, 50) }
    )
    await render()
    expect(texts()).toContain('Recorded items removed')
    expect(texts()).not.toContain('No retained process items.')
    expect(JSON.parse(atob(api.start.mock.calls[0][3].cursor))).toMatchObject({ revision: 3, seq: 20, id: 'run-a' })
  })
  it('replaces cached pages and explicitly resubscribes after a server replay reset', async () => {
    await render()
    vi.useFakeTimers()
    const originalStream = api.start.mock.calls[0][2]
    api.request.mockImplementation(async (path: string) =>
      path.endsWith('/items')
        ? page([item('10', 'Rebuilt output')])
        : runDetail()
    )
    await emit('run.reset')
    expect(api.stop).toHaveBeenCalledWith(originalStream)
    expect(api.start).toHaveBeenCalledTimes(2)
    expect(texts()).toContain('Rebuilt output')
    expect(texts()).not.toContain('Recorded response')
  })

  it('renders approval and input records without action controls and excludes private model-context items', async () => {
    const base = item('20')
    const items = [
      {
        ...base,
        id: 'approval',
        kind: 'approval',
        approvalId: 'approval',
        toolName: 'exec',
        summary: 'Run tests',
        status: 'pending'
      },
      {
        ...base,
        id: 'input',
        kind: 'user_input',
        inputId: 'input',
        prompt: 'Choose target',
        questions: [],
        status: 'pending'
      },
      {
        ...base,
        id: 'private',
        kind: 'model_context',
        text: 'Private context must be excluded'
      }
    ] as RoomRunItemsPage['items']
    api.request.mockImplementation(async (path: string) =>
      path.endsWith('/items') ? page(items) : runDetail()
    )
    await render()
    expect(texts()).toContain('Approval record')
    expect(texts()).toContain('Choose target')
    expect(texts()).not.toContain('Private context must be excluded')
    expect(button('Allow')).toBeUndefined()
    expect(button('Deny')).toBeUndefined()
    expect(button('Submit answers')).toBeUndefined()
    expect(renderer!.root.findAllByType('form')).toHaveLength(0)
  })

  it('loads long content only on request and follows bounded continuation offsets', async () => {
    await render()
    api.request.mockResolvedValue({
      ...page([]),
      content: {
        itemId: '20',
        field: 'text',
        text: 'first ',
        offset: 0,
        nextOffset: 6,
        totalChars: 10
      }
    })
    await act(async () => button('Read full recorded content').props.onClick())
    expect(api.request).toHaveBeenLastCalledWith(
      '/v1/rooms/room/runs/run-a/items?item_id=20&content_offset=0',
      'GET',
      undefined,
      expect.any(AbortSignal)
    )
    api.request.mockResolvedValue({
      ...page([]),
      content: {
        itemId: '20',
        field: 'text',
        text: 'last',
        offset: 6,
        totalChars: 10
      }
    })
    await act(async () => button('Load more').props.onClick())
    expect(texts()).toContain('first last')
    expect(button('Load more')).toBeUndefined()
  })

  it('uses originRunId directly and never guesses a historical run from member identity', async () => {
    const onRun = vi.fn()
    const message = {
      id: 'message',
      roomId: 'room',
      originRunId: 'original'
    } as RoomMessage
    await act(async () => {
      renderer = create(createElement(RoomMessageRunButton, { message, onRun }))
    })
    act(() => button('View this run').props.onClick())
    expect(onRun).toHaveBeenCalledWith('original')
    expect(api.request).not.toHaveBeenCalled()
    onRun.mockClear()
    api.request.mockResolvedValue({ unavailableReason: 'Original run missing' })
    act(() =>
      renderer!.update(
        createElement(RoomMessageRunButton, {
          message: { ...message, originRunId: undefined },
          onRun
        })
      )
    )
    await act(async () => button('View this run').props.onClick())
    expect(api.request).toHaveBeenCalledWith(
      '/v1/rooms/room/messages/message/run',
      'GET',
      undefined,
      expect.any(AbortSignal)
    )
    expect(onRun).not.toHaveBeenCalled()
    expect(texts()).toContain('Original run missing')
  })

  it('scopes member history to the selected topic and lists skipped, stale and failed attempts', async () => {
    api.request.mockResolvedValue({
      runs: [
        runDetail('skip', { outcome: 'skipped' }).run,
        runDetail('stale', { outcome: 'stale' }).run,
        runDetail('failed', { status: 'failed', error: 'Failed check' }).run
      ]
    })
    await act(async () => {
      renderer = create(
        createElement(RoomRunList, {
          roomId: 'room',
          memberId: 'member',
          rootRequestId: 'topic',
          onOpenRun: vi.fn()
        })
      )
    })
    expect(api.request).toHaveBeenCalledWith(
      '/v1/rooms/room/runs?limit=30&member_id=member&root_request_id=topic',
      'GET',
      undefined,
      expect.any(AbortSignal)
    )
    expect(texts()).toContain('No response needed')
    expect(texts()).toContain('Context changed')
    expect(texts()).toContain('Failed check')
  })
})
