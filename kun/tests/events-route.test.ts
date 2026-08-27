import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RuntimeEvent } from '../src/contracts/events.js'
import { makeAssistantTextItem, makeGoalContextItem } from '../src/domain/item.js'
import { createThreadRecord } from '../src/domain/thread.js'
import { FileSessionStore } from '../src/adapters/file/file-session-store.js'
import { InMemoryEventBus } from '../src/adapters/in-memory-event-bus.js'
import { getThreadTimeline } from '../src/server/routes/threads.js'
import type { ThreadService } from '../src/services/thread-service.js'
import type { EventBus } from '../src/ports/event-bus.js'
import type { SessionStore } from '../src/ports/session-store.js'
import { ThreadEventStreamRegistry } from '../src/server/thread-event-stream-registry.js'
import {
  buildEventStreamResponse,
  HEARTBEAT_INTERVAL_MS,
  MAX_LIVE_EVENTS_DURING_REPLAY,
  parseEventCursor
} from '../src/server/routes/events.js'

describe('event stream replay', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts only non-negative safe integer cursors', () => {
    expect(parseEventCursor(new Request('http://localhost/events?since_seq=0', { headers: { 'Last-Event-ID': '9' } }))).toBe(0)
    expect(parseEventCursor(new Request('http://localhost/events?since_seq=-1'))).toBeNull()
    expect(parseEventCursor(new Request('http://localhost/events?since_seq=Infinity'))).toBeNull()
    expect(parseEventCursor(new Request('http://localhost/events?since_seq=9007199254740992'))).toBeNull()
  })

  it('delivers an event published between subscription and persisted replay', async () => {
    let subscriber: ((event: RuntimeEvent) => void) | undefined
    const live: RuntimeEvent = {
      kind: 'heartbeat', seq: 2, timestamp: '2026-07-10T00:00:02.000Z', threadId: 'thr_events'
    }
    const eventBus: EventBus = {
      publish: () => undefined,
      subscribe: (_threadId, handler) => {
        subscriber = handler
        return () => {
          subscriber = undefined
        }
      },
      snapshotSince: () => [],
      highestSeq: () => 0,
      reset: () => undefined
    }
    const sessionStore = {
      highestSeq: async () => 1,
      loadEventsSince: async () => {
        subscriber?.(live)
        return [{ kind: 'heartbeat', seq: 1, timestamp: '2026-07-10T00:00:01.000Z', threadId: 'thr_events' }]
      }
    } as unknown as SessionStore
    const response = buildEventStreamResponse({
      request: new Request('http://localhost/v1/threads/thr_events/events?since_seq=0'),
      threadId: 'thr_events',
      eventBus,
      sessionStore
    })
    const reader = response.body!.getReader()
    try {
      const decoder = new TextDecoder()
      const first = await reader.read()
      const second = await reader.read()
      const third = await reader.read()
      const text = `${decoder.decode(first.value)}${decoder.decode(second.value)}${decoder.decode(third.value)}`
      expect(text).toContain('id: 1')
      expect(text).toContain('id: 2')
      expect(text.indexOf('id: 1')).toBeLessThan(text.indexOf('event: replay_synchronized'))
      expect(text.indexOf('event: replay_synchronized')).toBeLessThan(text.indexOf('id: 2'))
    } finally {
      await reader.cancel()
    }
  })

  it('hides persisted goal contexts while carrying their cursor into heartbeats and reconnect replay', async () => {
    vi.useFakeTimers()
    try {
      const threadId = 'thr_private_goal'
      const hidden: RuntimeEvent = {
        kind: 'item_created',
        seq: 1,
        timestamp: '2026-07-11T08:00:00.000Z',
        threadId,
        turnId: 'turn_goal',
        item: makeGoalContextItem({
          id: 'goal_context_private',
          threadId,
          turnId: 'turn_goal',
          goalKey: 'goal_private',
          text: 'Internal goal context must not reach SSE',
          createdAt: '2026-07-11T08:00:00.000Z'
        })
      }
      const publicEvent: RuntimeEvent = {
        kind: 'heartbeat',
        seq: 2,
        timestamp: '2026-07-11T08:00:01.000Z',
        threadId
      }
      let persisted: RuntimeEvent[] = [hidden]
      const sessionStore = {
        highestSeq: async () => persisted.at(-1)?.seq ?? 0,
        async *iterateEventsSince(_threadId: string, sinceSeq: number): AsyncIterable<RuntimeEvent> {
          for (const event of persisted) {
            if (event.seq > sinceSeq) yield event
          }
        }
      } as unknown as SessionStore
      const eventBus: EventBus = {
        publish: () => undefined,
        subscribe: () => () => undefined,
        snapshotSince: () => [],
        highestSeq: () => 0,
        reset: () => undefined
      }

      const first = buildEventStreamResponse({
        request: new Request(`http://localhost/v1/threads/${threadId}/events?since_seq=0`),
        threadId,
        eventBus,
        sessionStore
      })
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)
      const firstReader = first.body!.getReader()
      const synchronized = await firstReader.read()
      const heartbeat = await firstReader.read()
      const heartbeatText = `${new TextDecoder().decode(synchronized.value)}${new TextDecoder().decode(heartbeat.value)}`

      expect(heartbeatText).toContain('id: 1')
      expect(heartbeatText).toContain('event: heartbeat')
      expect(heartbeatText).not.toContain('Internal goal context must not reach SSE')
      await firstReader.cancel()

      persisted = [hidden, publicEvent]
      const second = buildEventStreamResponse({
        request: new Request(`http://localhost/v1/threads/${threadId}/events?since_seq=1`),
        threadId,
        eventBus,
        sessionStore
      })
      const secondReader = second.body!.getReader()
      const replay = await secondReader.read()
      const replayText = new TextDecoder().decode(replay.value)

      expect(replayText).toContain('id: 2')
      expect(replayText).not.toContain('Internal goal context must not reach SSE')
      await secondReader.cancel()
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes an SSE stream when live events overflow a slow replay buffer', async () => {
    let subscriber: ((event: RuntimeEvent) => void) | undefined
    let releaseReplay: (() => void) | undefined
    let notifySubscribed: (() => void) | undefined
    let notifyReplayStarted: (() => void) | undefined
    const subscribed = new Promise<void>((resolve) => { notifySubscribed = resolve })
    const replayStarted = new Promise<void>((resolve) => { notifyReplayStarted = resolve })
    const eventBus: EventBus = {
      publish: () => undefined,
      subscribe: (_threadId, handler) => {
        subscriber = handler
        notifySubscribed?.()
        return () => { subscriber = undefined }
      },
      snapshotSince: () => [], highestSeq: () => 0, reset: () => undefined
    }
    const sessionStore = {
      highestSeq: async () => 1,
      loadEventsSince: async () => new Promise<RuntimeEvent[]>((resolveReplay) => {
        releaseReplay = () => resolveReplay([])
        notifyReplayStarted?.()
      })
    } as unknown as SessionStore
    const response = buildEventStreamResponse({
      request: new Request('http://localhost/v1/threads/thr_events/events?since_seq=0'),
      threadId: 'thr_events', eventBus, sessionStore
    })
    await subscribed
    await replayStarted
    for (let seq = 1; seq <= MAX_LIVE_EVENTS_DURING_REPLAY + 1; seq += 1) {
      subscriber?.({ kind: 'heartbeat', seq, timestamp: '2026-07-10T00:00:00.000Z', threadId: 'thr_events' })
    }
    releaseReplay?.()
    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain('SSE replay overflow')
    await expect(reader.read()).resolves.toMatchObject({ done: true })
  })

  it('actively closes a deleted thread\'s stream while durable replay is in flight', async () => {
    vi.useFakeTimers()
    let releaseReplay: (() => void) | undefined
    let notifySubscribed: (() => void) | undefined
    let notifyReplayStarted: (() => void) | undefined
    let unsubscribed = false
    const subscribed = new Promise<void>((resolve) => { notifySubscribed = resolve })
    const replayStarted = new Promise<void>((resolve) => { notifyReplayStarted = resolve })
    const eventBus: EventBus = {
      publish: () => undefined,
      subscribe: () => {
        notifySubscribed?.()
        return () => { unsubscribed = true }
      },
      snapshotSince: () => [], highestSeq: () => 0, reset: () => undefined
    }
    const sessionStore = {
      highestSeq: async () => 0,
      loadEventsSince: async () => new Promise<RuntimeEvent[]>((resolveReplay) => {
        releaseReplay = () => resolveReplay([])
        notifyReplayStarted?.()
      })
    } as unknown as SessionStore
    const streamRegistry = new ThreadEventStreamRegistry()
    const response = buildEventStreamResponse({
      request: new Request('http://localhost/v1/threads/thr_events/events?since_seq=0'),
      threadId: 'thr_events',
      eventBus,
      sessionStore,
      streamRegistry
    })

    await subscribed
    await replayStarted
    streamRegistry.closeThread('thr_events')
    expect(unsubscribed).toBe(true)
    releaseReplay?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)

    const reader = response.body!.getReader()
    await expect(reader.read()).resolves.toMatchObject({ done: true })
  })

  it('closes a stalled live SSE client instead of accumulating events', async () => {
    let subscriber: ((event: RuntimeEvent) => void) | undefined
    const eventBus: EventBus = {
      publish: () => undefined,
      subscribe: (_threadId, handler) => {
        subscriber = handler
        return () => { subscriber = undefined }
      },
      snapshotSince: () => [], highestSeq: () => 0, reset: () => undefined
    }
    const sessionStore = {
      highestSeq: async () => 0,
      loadEventsSince: async () => []
    } as unknown as SessionStore
    const response = buildEventStreamResponse({
      request: new Request('http://localhost/v1/threads/thr_events/events?since_seq=0'),
      threadId: 'thr_events', eventBus, sessionStore
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    subscriber?.({ kind: 'heartbeat', seq: 1, timestamp: '2026-07-10T00:00:00.000Z', threadId: 'thr_events' })
    subscriber?.({ kind: 'heartbeat', seq: 2, timestamp: '2026-07-10T00:00:01.000Z', threadId: 'thr_events' })

    const reader = response.body!.getReader()
    const first = await reader.read()
    const second = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain('event: replay_synchronized')
    expect(new TextDecoder().decode(second.value)).toContain('id: 1')
    await expect(reader.read()).resolves.toMatchObject({ done: true })
  })

  it('closes an idle SSE client once an unread heartbeat fills its queue', async () => {
    vi.useFakeTimers()
    let unsubscribed = false
    const eventBus: EventBus = {
      publish: () => undefined,
      subscribe: () => () => {
        unsubscribed = true
      },
      snapshotSince: () => [], highestSeq: () => 0, reset: () => undefined
    }
    const sessionStore = {
      highestSeq: async () => 0,
      loadEventsSince: async () => []
    } as unknown as SessionStore
    const response = buildEventStreamResponse({
      request: new Request('http://localhost/v1/threads/thr_events/events?since_seq=0'),
      threadId: 'thr_events', eventBus, sessionStore
    })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 2)

    expect(unsubscribed).toBe(true)
    const reader = response.body!.getReader()
    const first = await reader.read()
    const second = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain('event: replay_synchronized')
    expect(new TextDecoder().decode(second.value)).toContain('event: heartbeat')
    await expect(reader.read()).resolves.toMatchObject({ done: true })
  })

  it('pages durable replay through the forward-only store iterator without snapshot reset', async () => {
    const events: RuntimeEvent[] = [1, 2, 3].map((seq) => ({
      kind: 'heartbeat' as const,
      seq,
      timestamp: `2026-07-10T00:00:0${seq}.000Z`,
      threadId: 'thr_events'
    }))
    const loadEventsSince = vi.fn(async () => events)
    const highestSeq = vi.fn(async () => 3)
    const sessionStore = {
      loadEventsSince,
      highestSeq,
      async *iterateEventsSince(_threadId: string, sinceSeq: number): AsyncIterable<RuntimeEvent> {
        for (const event of events) {
          if (event.seq > sinceSeq) yield event
        }
      }
    } as unknown as SessionStore
    const eventBus: EventBus = {
      publish: () => undefined,
      subscribe: () => () => undefined,
      snapshotSince: () => [], highestSeq: () => 0, reset: () => undefined
    }

    const first = buildEventStreamResponse({
      request: new Request('http://localhost/v1/threads/thr_events/events?since_seq=0'),
      threadId: 'thr_events', eventBus, sessionStore,
      replayLimits: { maxEvents: 2, maxBytes: 10_000 }
    })
    const firstReader = first.body!.getReader()
    const firstFrames = [await firstReader.read(), await firstReader.read()]
    const firstText = firstFrames.map((frame) => new TextDecoder().decode(frame.value)).join('')
    expect(firstText).toContain('id: 1')
    expect(firstText).toContain('id: 2')
    expect(firstText).not.toContain('event: replay_synchronized')
    await expect(firstReader.read()).resolves.toMatchObject({ done: true })

    const second = buildEventStreamResponse({
      request: new Request('http://localhost/v1/threads/thr_events/events?since_seq=2'),
      threadId: 'thr_events', eventBus, sessionStore,
      replayLimits: { maxEvents: 2, maxBytes: 10_000 }
    })
    const secondReader = second.body!.getReader()
    const third = await secondReader.read()
    expect(new TextDecoder().decode(third.value)).toContain('id: 3')
    const synchronized = await secondReader.read()
    expect(new TextDecoder().decode(synchronized.value)).toContain('event: replay_synchronized')
    await secondReader.cancel()

    expect(loadEventsSince).not.toHaveBeenCalled()
    expect(highestSeq).toHaveBeenCalledTimes(2)
  })

  it('does not let an in-flight event append become the SSE snapshot cursor', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-events-snapshot-'))
    try {
      const threadId = 'thr_snapshot_race'
      const turnId = 'turn_snapshot_race'
      const store = new FileSessionStore({ dataDir })
      const first: RuntimeEvent = {
        kind: 'heartbeat',
        seq: 1,
        timestamp: '2026-08-22T00:00:00.000Z',
        threadId
      }
      await store.appendEvent(threadId, first)
      const item = makeAssistantTextItem({
        id: 'item_delta',
        threadId,
        turnId,
        text: 'delta',
        status: 'running'
      })
      const second: RuntimeEvent = {
        kind: 'assistant_text_delta',
        seq: 2,
        timestamp: '2026-08-22T00:00:01.000Z',
        threadId,
        turnId,
        itemId: item.id,
        item
      }
      const secondLine = JSON.stringify(second)
      const splitAt = secondLine.indexOf('"seq":2') + '"seq":2'.length
      await appendFile(
        join(dataDir, 'threads', threadId, 'events.jsonl'),
        secondLine.slice(0, splitAt)
      )
      const thread = createThreadRecord({
        id: threadId,
        title: 'Snapshot race',
        workspace: '/tmp',
        model: 'deepseek-chat',
        status: 'running'
      })
      const service = {
        get: vi.fn(async () => thread)
      } as unknown as ThreadService

      const timeline = await getThreadTimeline(
        service,
        threadId,
        new Request(`http://localhost/v1/threads/${threadId}/timeline`),
        store
      )
      const timelineBody = JSON.parse(timeline.body) as { latestSeq: number }
      expect(timelineBody.latestSeq).toBe(1)

      await appendFile(
        join(dataDir, 'threads', threadId, 'events.jsonl'),
        `${secondLine.slice(splitAt)}\n`
      )
      const response = buildEventStreamResponse({
        request: new Request(
          `http://localhost/v1/threads/${threadId}/events?since_seq=${timelineBody.latestSeq}`
        ),
        threadId,
        eventBus: new InMemoryEventBus(),
        sessionStore: store
      })
      const reader = response.body!.getReader()
      try {
        const frame = await reader.read()
        const text = new TextDecoder().decode(frame.value)
        expect(text).toContain('id: 2')
        expect(text).toContain('event: assistant_text_delta')
        expect(text).toContain('delta')
      } finally {
        await reader.cancel()
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})
