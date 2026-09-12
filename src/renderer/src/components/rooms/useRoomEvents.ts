import { useEffect, useSyncExternalStore } from 'react'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { useChatStore } from '../../store/chat-store'
import {
  roomsRequest,
  roomRequestId,
  roomsClient,
  roomTaskPath
} from './rooms-client'
import i18n from '../../i18n'
import {
  integrationRoomNotice,
  taskRoomNotice,
  type RoomIntegrationSnapshot
} from './room-notifications'
import {
  readBrowserStorageItem,
  writeBrowserStorageItem
} from '../../lib/browser-storage'

type Event = {
  seq: number
  roomId: string
  kind: string
  payload?: { id?: string; taskId?: string }
}
const listeners = new Set<(event: Event) => void>()
const badgeListeners = new Set<() => void>()
let badge = 0
let live = false
export const roomEventsLive = () => live
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
    let cursor = Number(readBrowserStorageItem('kun.rooms.eventCursor') ?? 0)
    const notified = new Set<string>()
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let fallback: ReturnType<typeof setInterval> | undefined
    const updateBadge = async () => {
      const result = await roomsRequest<{ attentionCount: number }>(
        '/v1/rooms/attention'
      )
      if (stopped) return
      badge = result.attentionCount
      badgeListeners.forEach((listener) => listener())
    }
    const consume = async (event: Event) => {
      if (stopped || !Number.isSafeInteger(event.seq) || event.seq <= cursor)
        return
      cursor = event.seq
      writeBrowserStorageItem('kun.rooms.eventCursor', String(cursor))
      listeners.forEach((listener) => listener(event))
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        void updateBadge().catch(() => undefined)
      }, 300)
      const integrationEvent = event.kind.startsWith('integration.')
      if (
        (!event.kind.startsWith('task.') && !integrationEvent) ||
        !event.payload?.id
      )
        return
      const taskId = integrationEvent ? event.payload.taskId : event.payload.id
      if (!taskId) return
      try {
        const detail = await roomsClient.task(event.roomId, taskId)
        let notice = integrationEvent ? null : taskRoomNotice(detail)
        if (integrationEvent) {
          const result = await roomsRequest<{
            integrations: RoomIntegrationSnapshot[]
          }>(roomTaskPath(detail.task) + '/integrations')
          const integration = result.integrations.find(
            (item) => item.id === event.payload!.id
          )
          if (integration)
            notice = integrationRoomNotice(detail, integration, (key) =>
              i18n.t(key, { ns: 'common' })
            )
        }
        if (stopped || !notice || notified.has(notice.key)) return
        notified.add(notice.key)
        if (notified.size > 500)
          notified.delete(notified.values().next().value!)
        if (
          useChatStore.getState().route === 'rooms' &&
          readBrowserStorageItem('kun.rooms.selected') === event.roomId &&
          document.hasFocus()
        )
          return
        await window.kunGui.showTurnCompleteNotification({
          roomId: event.roomId,
          threadId: notice.threadId,
          source: 'main-agent',
          title: 'Kun · ' + i18n.t('roomsLabel', { ns: 'common' }),
          body: notice.body
        })
      } catch {
        /* The next event refreshes the authoritative gate snapshot. */
      }
    }
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
    const failed = rendererRuntimeClient.onSseError((payload) => {
      if (payload.streamId === streamId) live = false
    })
    const ended = rendererRuntimeClient.onSseEnd((payload) => {
      if (payload.streamId === streamId) live = false
    })
    void (async () => {
      if (!cursor)
        cursor = (
          await roomsRequest<{ cursor: number }>('/v1/rooms/events?latest=true')
        ).cursor
      if (stopped) return
      await rendererRuntimeClient.startSse('rooms', cursor, streamId, {
        scope: 'rooms'
      })
      await updateBadge()
    })().catch(() => {
      live = false
    })
    fallback = setInterval(() => {
      if (live || stopped) return
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
      off()
      opened()
      failed()
      ended()
      void rendererRuntimeClient.stopSse(streamId)
    }
  }, [])
}
