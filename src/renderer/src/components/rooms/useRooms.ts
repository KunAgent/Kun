import { useCallback, useEffect, useRef, useState } from 'react'
import { subscribeRoomEvents, roomEventsLive } from './useRoomEvents'
import type { Room, RoomMessage, RoomTask } from '@shared/rooms-api'
import {
  readBrowserStorageItem,
  writeBrowserStorageItem
} from '../../lib/browser-storage'
import {
  mergeRoomMessages,
  roomsRequest,
  roomPath,
  roomsClient,
  type RoomRule,
  type RoomListEntry
} from './rooms-client'

export function useRooms(conversationKind: 'group' | 'agent_agent' = 'group', listEnabled = true) {
  const [rooms, setRooms] = useState<RoomListEntry[]>([])
  const [archived, setArchived] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'unread' | 'attention'>('all')
  const [repositoryRoot, setRepositoryRoot] = useState('')
  const [selectedId, setSelectedId] = useState(
    readBrowserStorageItem('kun.rooms.selected') ?? ''
  )
  const [room, setRoom] = useState<Room | null>(null)
  const [messages, setMessages] = useState<RoomMessage[]>([])
  const [tasks, setTasks] = useState<RoomTask[]>([])
  const [rules, setRules] = useState<RoomRule[]>([])
  const [roomCursor, setRoomCursor] = useState<string | null>(null)
  const [messageCursor, setMessageCursor] = useState<string | null>(null)
  const [taskCursor, setTaskCursor] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [moreBusy, setMoreBusy] = useState(false)
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId
  const roomsRef = useRef(rooms)
  roomsRef.current = rooms
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const listGenerationRef = useRef(0)
  const listScopeRef = useRef('')
  listScopeRef.current = JSON.stringify([archived, search, filter, repositoryRoot, conversationKind])
  const refreshRef = useRef<() => Promise<void>>(async () => undefined)

  const select = useCallback((id: string): void => {
    setSelectedId(id)
    writeBrowserStorageItem('kun.rooms.selected', id)
  }, [])
  const refreshList = useCallback(
    async (reset = false, changedIds?: string[]): Promise<void> => {
      if (!listEnabled) { setLoading(false); return }
      const generation = ++listGenerationRef.current
      try {
        const result = await roomsClient.list(
          archived,
          undefined,
          undefined,
          search,
          { ...(conversationKind !== 'group' ? { conversationKind } : {}), unreadOnly: filter === 'unread', attentionOnly: filter === 'attention', repositoryRoot: repositoryRoot || undefined }
        )
        if (generation !== listGenerationRef.current) return
        // Revalidate only loaded rows affected by live events; the original
        // keyset cursor and loaded tail survive an authoritative head refresh.
        const headIds = new Set(result.rooms.map((item) => item.id))
        const recheckIds = reset ? [] : roomsRef.current.filter((item) => !headIds.has(item.id) &&
          (!changedIds || changedIds.includes(item.id))).map((item) => item.id)
        const checked = new Set(recheckIds), stillVisible = new Map<string, RoomListEntry>()
        for (let offset = 0; offset < recheckIds.length; offset += 50) {
          if (generation !== listGenerationRef.current) return
          const page = await roomsClient.list(archived, undefined, undefined, search, {
            ...(conversationKind !== 'group' ? { conversationKind } : {}), unreadOnly: filter === 'unread', attentionOnly: filter === 'attention',
            repositoryRoot: repositoryRoot || undefined, ids: recheckIds.slice(offset, offset + 50)
          })
          for (const item of page.rooms) stillVisible.set(item.id, item)
        }
        if (generation !== listGenerationRef.current) return
        setRooms((current) =>
          reset
            ? result.rooms
            : [
                ...new Map(
                  [
                    ...result.rooms,
                    ...current.filter((item) => !headIds.has(item.id) && (!checked.has(item.id) || stillVisible.has(item.id)))
                      .map((item) => stillVisible.get(item.id) ?? item)
                  ].map((item) => [item.id, item])
                ).values()
              ]
        )
        if (reset) setRoomCursor(result.nextCursor ?? null)
        if (!selectedRef.current && result.rooms[0]) select(result.rooms[0].id)
        setError('')
      } catch (cause) {
        if (generation === listGenerationRef.current) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!selectedRef.current) setLoading(false)
      }
    },
    [archived, select, search, filter, repositoryRoot, conversationKind, listEnabled]
  )
  useEffect(() => {
    void refreshList(true)
    const timer = setInterval(() => {
      if (!roomEventsLive()) void refreshList()
    }, 10000)
    let eventTimer: ReturnType<typeof setTimeout> | undefined
    const changedRooms = new Set<string>()
    const unsubscribe = subscribeRoomEvents((event) => {
      if (event.kind === 'navigate') select(event.roomId)
      if (!/^(room|task|request|integration|peer)\./.test(event.kind) &&
        event.kind !== 'message.created' && event.kind !== 'message.updated' && event.kind !== 'message.presentation.created') return
      changedRooms.add(event.roomId)
      clearTimeout(eventTimer)
      eventTimer = setTimeout(() => { const ids = [...changedRooms]; changedRooms.clear(); void refreshList(false, ids) }, 150)
    })
    const listingGeneration = listGenerationRef
    return () => {
      clearInterval(timer)
      clearTimeout(eventTimer)
      unsubscribe()
      listingGeneration.current++
    }
  }, [refreshList, select])
  useEffect(() => {
    setRoom(null)
    setMessages([])
    setTasks([])
    setRules([])
    setMessageCursor(null)
    setTaskCursor(null)
    if (!selectedId) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let first = true
    let refreshVersion = 0
    const pendingReplyRoots = new Set<string>()
    setLoading(true)
    const refresh = async (parts?: Set<string>, messageIds: string[] = [], taskIds: string[] = []): Promise<void> => {
      clearTimeout(timer)
      const version = ++refreshVersion
      try {
        const needed = (kind: string) => first || !parts || parts.has(kind)
        const [detail, page, taskResult, ruleResult, changedMessages, changedTasks] = await Promise.all([
          needed('room') ? roomsClient.get(selectedId, controller.signal) : undefined,
          needed('messages') ? roomsClient.messages(selectedId, undefined, controller.signal) : undefined,
          needed('tasks') ? roomsClient.tasks(selectedId, controller.signal) : undefined,
          needed('rules') ? roomsClient.rules(selectedId, controller.signal) : undefined,
          Promise.all(messageIds.map((id) => roomsRequest<{ message: RoomMessage }>(roomPath(selectedId) + '/messages/' + encodeURIComponent(id), 'GET', undefined, controller.signal))),
          Promise.all(taskIds.map((id) => roomsClient.task(selectedId, id, controller.signal)))
        ])
        if (controller.signal.aborted) return
        if (detail) setRoom((current) => !current || detail.room.revision >= current.revision ? detail.room : current)
        const incoming = [...(page?.messages ?? []), ...changedMessages.map((value) => value.message)]
        const loaded = new Map(messagesRef.current.map((message) => [message.id, message]))
        const incomingIds = new Set(incoming.map((message) => message.id))
        for (const message of incoming) {
          const rootId = message.displayThreadRootId
          if (rootId && loaded.has(rootId) && !incomingIds.has(rootId) &&
            loaded.get(message.id)?.displayThreadRootId !== rootId) pendingReplyRoots.add(rootId)
        }
        setMessages((current) => mergeRoomMessages(current, incoming))
        setTasks((current) => {
          const merged = new Map(current.map((task) => [task.id, task]))
          for (const task of [...(taskResult?.tasks ?? []), ...changedTasks.map((value) => value.task)]) {
            if ((merged.get(task.id)?.revision ?? -1) <= task.revision)
              merged.set(task.id, task)
          }
          return [...merged.values()].sort((a, b) =>
            b.updatedAt.localeCompare(a.updatedAt)
          )
        })
        if (ruleResult) setRules((current) => ruleResult.rules.map((rule) => { const previous = current.find((item) => item.id === rule.id); return previous && (previous.revision ?? 0) > (rule.revision ?? 0) ? previous : rule }))
        if (first) {
          setMessageCursor(page?.nextCursor ?? null)
          setTaskCursor(taskResult?.nextCursor ?? null)
        }
        const replyRoots = [...pendingReplyRoots]
        for (let offset = 0; offset < replyRoots.length; offset += 50) {
          const ids = replyRoots.slice(offset, offset + 50)
          const projected = await roomsRequest<{ messages: RoomMessage[] }>(
            `${roomPath(selectedId)}/messages?message_ids=${encodeURIComponent(ids.join(','))}`,
            'GET', undefined, controller.signal)
          if (controller.signal.aborted || version !== refreshVersion) return
          setMessages((current) => mergeRoomMessages(current, projected.messages))
          for (const id of ids) pendingReplyRoots.delete(id)
        }
        setError('')
        first = false
      } catch (cause) {
        if (!controller.signal.aborted && version === refreshVersion)
          setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!controller.signal.aborted && version === refreshVersion) {
          setLoading(false)
          timer = setTimeout(
            () => void refresh(),
            roomEventsLive() ? 30000 : 2500
          )
        }
      }
    }
    refreshRef.current = refresh
    void refresh()
    let eventTimer: ReturnType<typeof setTimeout> | undefined
    const pending = new Set<string>()
    const messageIds = new Set<string>()
    const taskIds = new Set<string>()
    const unsubscribe = subscribeRoomEvents((event) => {
      if (event.roomId !== selectedId) return
      if (event.kind.startsWith('room.')) pending.add('room')
      if (event.kind.startsWith('rule.')) pending.add('rules')
      if (event.kind === 'message.created' || event.kind === 'message.presentation.created') pending.add('messages')
      if (event.kind === 'message.updated' && event.payload?.id) messageIds.add(event.payload.id)
      if (event.kind === 'task.created') pending.add('tasks')
      if (event.kind.startsWith('task.') && event.payload?.id) taskIds.add(event.payload.id)
      if (!pending.size && !messageIds.size && !taskIds.size) return
      clearTimeout(eventTimer)
      eventTimer = setTimeout(() => {
        const parts = new Set(pending), changedMessages = [...messageIds], changedTasks = [...taskIds]
        pending.clear(); messageIds.clear(); taskIds.clear()
        void refresh(parts, changedMessages, changedTasks)
      }, 150)
    })
    return () => {
      controller.abort()
      unsubscribe()
      clearTimeout(eventTimer)
      clearTimeout(timer)
      refreshRef.current = async () => undefined
    }
  }, [selectedId])

  const loadEarlier = async (): Promise<void> => {
    if (!messageCursor || moreBusy) return
    const id = selectedId
    setMoreBusy(true)
    try {
      const page = await roomsClient.messages(id, messageCursor)
      if (selectedRef.current !== id) return
      setMessages((current) => mergeRoomMessages(current, page.messages))
      setMessageCursor(page.nextCursor ?? null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setMoreBusy(false)
    }
  }
  const loadMoreRooms = async (): Promise<void> => {
    if (!roomCursor || moreBusy) return
    const generation = listGenerationRef.current
    const scope = listScopeRef.current
    setMoreBusy(true)
    try {
      const page = await roomsClient.list(
        archived,
        roomCursor,
        undefined,
        search,
        { ...(conversationKind !== 'group' ? { conversationKind } : {}), unreadOnly: filter === 'unread', attentionOnly: filter === 'attention', repositoryRoot: repositoryRoot || undefined }
      )
      if (scope !== listScopeRef.current) return
      let rows = page.rooms
      if (generation !== listGenerationRef.current && rows.length) {
        const latest = await roomsClient.list(archived, undefined, undefined, search, {
          ...(conversationKind !== 'group' ? { conversationKind } : {}), unreadOnly: filter === 'unread', attentionOnly: filter === 'attention',
          repositoryRoot: repositoryRoot || undefined, ids: rows.map((item) => item.id)
        })
        if (scope !== listScopeRef.current) return
        rows = latest.rooms
      }
      setRooms((current) => [
        ...current, ...rows.filter((item) => !current.some((old) => old.id === item.id))
      ])
      setRoomCursor(page.nextCursor ?? null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setMoreBusy(false)
    }
  }
  const loadMoreTasks = async (): Promise<void> => {
    if (!taskCursor || moreBusy) return
    const id = selectedId
    setMoreBusy(true)
    try {
      const page = await roomsClient.tasks(id, undefined, taskCursor)
      if (selectedRef.current !== id) return
      setTasks((current) => [
        ...current,
        ...page.tasks.filter(
          (task) => !current.some((value) => value.id === task.id)
        )
      ])
      setTaskCursor(page.nextCursor ?? null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setMoreBusy(false)
    }
  }
  const saved = (value: Room): void => {
    select(value.id)
    setRoom(value)
    setRooms((current) =>
      current
        .map((item) => (item.id === value.id ? value : item))
        .filter((item) => Boolean(item.archivedAt) === archived)
    )
    void refreshList()
  }
  return {
    search,
    setSearch,
    filter, setFilter, repositoryRoot, setRepositoryRoot,
    rooms,
    room,
    messages,
    tasks,
    rules,
    selectedId,
    archived,
    setArchived,
    select,
    error,
    setError,
    loading,
    taskCursor,
    loadMoreTasks,
    moreBusy,
    messageCursor,
    roomCursor,
    loadEarlier,
    loadMoreRooms,
    refreshList,
    refresh: () => refreshRef.current(),
    saved
  }
}
