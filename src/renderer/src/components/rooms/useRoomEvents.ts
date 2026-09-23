import { useEffect, useSyncExternalStore } from 'react'
import { RoomNotificationQueue } from './room-notification-queue'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { useChatStore } from '../../store/chat-store'
import {
  roomsRequest,
  roomRequestId,
  roomsClient,
  roomTaskPath
} from './rooms-client'
import i18n from '../../i18n'
import type { RoomPreferenceDetail } from '@shared/rooms-api'
import { roomNotificationSuppressed, roomNotificationsMuted } from '../../../../../kun/src/contracts/room-experience'
import {
  integrationRoomNotice,
  taskRoomNotice,
  type RoomIntegrationSnapshot
} from './room-notifications'
import {
  browserStorage,
  readBrowserStorageItem,
  writeBrowserStorageItem
} from '../../lib/browser-storage'
import { registerRemoteStreamResubscriber } from '../../lib/remote-stream-resubscribers'

type Event = {
  seq: number
  roomId: string
  kind: string
  createdAt?: string
  payload?: { id?: string; taskId?: string }
}
const listeners = new Set<(event: Event) => void>()
const badgeListeners = new Set<() => void>()
const SEEN_ATTENTION_KEY = 'kun.rooms.seenAttention.v1'
let badge = 0
let attentionItems: string[] = []
let live = false
export const roomEventsLive = () => live
function readSeenAttention() {
  try {
    const parsed = JSON.parse(readBrowserStorageItem(SEEN_ATTENTION_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set<string>()
  }
}
function writeSeenAttention(items: Iterable<string>) {
  writeBrowserStorageItem(SEEN_ATTENTION_KEY, JSON.stringify([...items]))
}
function publishBadge(value: number) {
  badge = value
  badgeListeners.forEach((listener) => listener())
}
function applyAttentionResult(result: { attentionCount: number; items?: string[] }) {
  if (!Array.isArray(result.items)) {
    attentionItems = []
    publishBadge(result.attentionCount)
    return
  }
  attentionItems = result.items.filter((item): item is string => typeof item === 'string')
  const liveItems = new Set(attentionItems)
  const seen = new Set([...readSeenAttention()].filter((item) => liveItems.has(item)))
  writeSeenAttention(seen)
  publishBadge(attentionItems.filter((item) => !seen.has(item)).length)
}
export function acknowledgeRoomAttention() {
  writeSeenAttention(attentionItems)
  publishBadge(0)
}
export function subscribeRoomEvents(listener: (event: Event) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function useRoomAttentionCount() {
  return useSyncExternalStore(
    (listener) => {
      badgeListeners.add(listener)
      return () => {
        badgeListeners.delete(listener)
      }
    },
    () => badge,
    () => 0
  )
}
export function useRoomEvents() {
  useEffect(() => {
    if (!window.kunGui?.startSse) return
    const streamId = 'rooms-' + roomRequestId()
    let stopped = false
    const savedCursor = Number(readBrowserStorageItem('kun.rooms.eventCursor') ?? 0)
    let cursor = Number.isSafeInteger(savedCursor) && savedCursor >= 0 ? savedCursor : 0
    let queue: RoomNotificationQueue | undefined
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let fallback: ReturnType<typeof setInterval> | undefined
    const updateBadge = async () => {
      const result = await roomsRequest<{ attentionCount: number; items?: string[] }>(
        '/v1/rooms/attention'
      )
      if (stopped) return
      applyAttentionResult(result)
    }
    const deliver = async (event: Event, known: (key: string) => boolean): Promise<string | null> => {
      if (stopped) throw new Error('room notification subscription stopped')
      const integrationEvent = event.kind.startsWith('integration.')
      let notice: { key: string; threadId: string; body: string } | null = null
      try {
        if (event.kind.startsWith('request.')) {
          const result = await roomsRequest<{ request: { id: string; status: string; threadId: string; continuation?: number; stepAttempt?: number; clarification?: string; error?: string; message: { body: string } } }>(
            '/v1/rooms/' + encodeURIComponent(event.roomId) + '/requests/' + encodeURIComponent(event.payload!.id!))
          const request = result.request
          if (['needs_input', 'failed', 'recovery_required'].includes(request.status)) notice = {
            key: ['request', request.id, request.status, request.continuation ?? 0, request.stepAttempt ?? 0].join(':'),
            threadId: request.threadId,
            body: request.message.body.slice(0, 140) + ': ' + (request.clarification || request.error || i18n.t('roomsState_' + request.status, { ns: 'common' }))
          }
        } else {
          const taskId = integrationEvent ? event.payload?.taskId : event.payload?.id
          if (!taskId) return null
          const detail = await roomsClient.task(event.roomId, taskId)
          if (integrationEvent) {
            const result = await roomsRequest<{ integration: RoomIntegrationSnapshot }>(roomTaskPath(detail.task) + '/integrations/' + encodeURIComponent(event.payload!.id!))
            notice = integrationRoomNotice(detail, result.integration, (key) => i18n.t(key, { ns: 'common' }))
          } else notice = taskRoomNotice(detail)
        }
      } catch (error) {
        if (error instanceof Error && 'status' in error && error.status === 404) return null
        throw error
      }
      if (stopped) throw new Error('room notification subscription stopped')
      if (!notice || known(notice.key)) return notice?.key ?? null
      const { preference } = await roomsRequest<RoomPreferenceDetail>('/v1/rooms/' + encodeURIComponent(event.roomId) + '/preferences')
      if (stopped) throw new Error('room notification subscription stopped')
      if (roomNotificationSuppressed(preference, event.createdAt)) return roomNotificationsMuted(preference) ? notice.key : null
      if (useChatStore.getState().route === 'rooms' && readBrowserStorageItem('kun.rooms.selected') === event.roomId && document.hasFocus()) return notice.key
      const result = await window.kunGui.showTurnCompleteNotification({ roomId: event.roomId, threadId: notice.threadId,
        source: 'main-agent', title: 'Kun · ' + i18n.t('roomsLabel', { ns: 'common' }), body: notice.body.slice(0, 500) })
      if (!result.ok) throw new Error(result.message)
      return notice.key
    }
    const consume = async (event: Event) => {
      if (stopped || !queue || !queue.accept(event)) return
      cursor = queue.cursor
      writeBrowserStorageItem('kun.rooms.eventCursor', String(cursor))
      listeners.forEach((listener) => listener(event))
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => { void updateBadge().catch(() => undefined) }, 300)
      await queue.drain(deliver)
    }
    const notificationRetry = setInterval(() => { void queue?.drain(deliver) }, 1000)
    void queue?.drain(deliver)
    const off = rendererRuntimeClient.onSseEvent((payload) => {
      if (payload.streamId === 'rooms-navigation') {
        const event = payload.events[0] as { roomId?: string }
        if (event.roomId) {
          writeBrowserStorageItem('kun.rooms.selected', event.roomId)
          useChatStore.getState().setRoute('rooms')
          listeners.forEach((listener) =>
            listener({ seq: cursor, roomId: event.roomId!, kind: 'navigate' })
          )
        }
      } else if (payload.streamId === streamId)
        for (const event of payload.events) void consume(event as Event)
    })
    const opened = rendererRuntimeClient.onSseOpen((payload) => {
      if (payload.streamId === streamId) live = true
    })
    const restartStream = (): void => {
      // The remote hub dropped this stream's registration (sender reset) or
      // backlog (buffer overflow). Rebuild it now rather than waiting out the
      // fallback poll interval.
      if (stopped) return
      live = false
      void initialize().catch(() => undefined)
    }
    const failed = rendererRuntimeClient.onSseError((payload) => {
      if (payload.streamId !== streamId) return
      live = false
      if (payload.code === 'remote_buffer_overflow' || payload.code === 'remote_client_expired') {
        restartStream()
      }
    })
    const ended = rendererRuntimeClient.onSseEnd((payload) => {
      if (payload.streamId === streamId) live = false
    })
    const offResubscribe = registerRemoteStreamResubscriber(restartStream)
    const initialize = async () => {
      const metadata = await roomsRequest<{ cursor: number; scopeId?: string }>('/v1/rooms/events?latest=true')
      if (stopped) return
      const queueKey = 'kun.rooms.notificationQueue.v1.' + (metadata.scopeId ?? 'default')
      let saved = readBrowserStorageItem(queueKey)
      try {
        const parsed = JSON.parse(saved ?? 'null')
        if (parsed && parsed.cursor > metadata.cursor) { parsed.cursor = 0; saved = JSON.stringify(parsed) }
      } catch { saved = null }
      queue = new RoomNotificationQueue(Math.min(cursor || metadata.cursor, metadata.cursor), (value) => {
        const storage = browserStorage()
        if (!storage) throw new Error('notification persistence unavailable')
        storage.setItem(queueKey, value)
      }, saved)
      cursor = queue.cursor
      void queue.drain(deliver)
      await Promise.allSettled([
        rendererRuntimeClient.startSse('rooms', cursor, streamId, { scope: 'rooms' }), updateBadge()
      ])
      if (!stopped && useChatStore.getState().route === 'rooms') acknowledgeRoomAttention()
    }
    void initialize().catch(() => { live = false })
    const offRoute = typeof useChatStore.subscribe === 'function'
      ? useChatStore.subscribe((state, previous) => {
          if (state.route !== 'rooms' || previous.route === 'rooms') return
          acknowledgeRoomAttention()
          void updateBadge()
            .then(() => {
              if (!stopped && useChatStore.getState().route === 'rooms') acknowledgeRoomAttention()
            })
            .catch(() => undefined)
        })
      : () => undefined
    fallback = setInterval(() => {
      if (live || stopped) return
      if (!queue) { void initialize().catch(() => undefined); return }
      void updateBadge().catch(() => undefined)
      void roomsRequest<{ events: Event[] }>(
        '/v1/rooms/events?since_seq=' + cursor
      )
        .then((page) => {
          for (const event of page.events) void consume(event)
        })
        .catch(() => undefined)
    }, 10000)
    return () => {
      stopped = true
      live = false
      clearTimeout(refreshTimer)
      clearInterval(fallback)
      clearInterval(notificationRetry)
      offRoute()
      off()
      opened()
      failed()
      ended()
      offResubscribe()
      void rendererRuntimeClient.stopSse(streamId)
    }
  }, [])
}
