import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  RoomRunAvailability,
  RoomRunDetail,
  RoomRunEvent,
  RoomRunItemsPage
} from '@shared/rooms-api'
import type { CoreTurnItemJson } from '../../agent/kun-contract'
import { mergeRoomRunCursors } from '@shared/room-run-cursor'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { registerRemoteStreamResubscriber } from '../../lib/remote-stream-resubscribers'
import { roomPath, roomRequestId, roomsRequest } from './rooms-client'

export function mergeRunItems(
  current: CoreTurnItemJson[],
  incoming: CoreTurnItemJson[]
): CoreTurnItemJson[] {
  return [
    ...new Map(
      [...current, ...incoming].map((item) => [item.id, item])
    ).values()
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function useRoomRun(roomId: string, runId: string, active = true) {
  const [detail, setDetail] = useState<RoomRunDetail | null>(null)
  const [items, setItems] = useState<CoreTurnItemJson[]>([])
  const [itemsAvailability, setItemsAvailability] =
    useState<RoomRunAvailability | null>(null)
  const [earlierCursor, setEarlierCursor] = useState<string>()
  const [gapCursors, setGapCursors] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [moreBusy, setMoreBusy] = useState(false)
  const [error, setError] = useState('')
  const [streamError, setStreamError] = useState('')
  const [revision, setRevision] = useState(0)
  const [loadedRevision, setLoadedRevision] = useState(-1)
  const cursor = useRef('')
  const lifecycle = useRef<AbortController | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const base = `${roomPath(roomId)}/runs/${encodeURIComponent(runId)}`
  const read = useCallback(
    <T>(suffix: string, signal: AbortSignal) =>
      roomsRequest<T>(base + suffix, 'GET', undefined, signal),
    [base]
  )
  useEffect(() => {
    const controller = new AbortController()
    lifecycle.current = controller
    setDetail(null)
    setItems([])
    setItemsAvailability(null)
    setEarlierCursor(undefined)
    setGapCursors([])
    setLoading(true)
    setError('')
    setStreamError('')
    setMoreBusy(false)
    void Promise.allSettled([
      read<RoomRunDetail>('', controller.signal),
      read<RoomRunItemsPage>('/items', controller.signal)
    ])
      .then(([nextResult, pageResult]) => {
        if (controller.signal.aborted) return
        if (nextResult.status === 'rejected') throw nextResult.reason
        const next = nextResult.value
        if (next.run.id !== runId || next.run.roomId !== roomId)
          throw new Error('Run scope mismatch')
        cursor.current = mergeRoomRunCursors(runId,
          pageResult.status === 'fulfilled' ? pageResult.value.eventsCursor : undefined,
          next.eventsCursor)
        setDetail(next)
        setLoadedRevision(revision)
        if (pageResult.status === 'fulfilled') {
          setItems(pageResult.value.items)
          setItemsAvailability(pageResult.value.availability)
          setEarlierCursor(pageResult.value.nextCursor)
        } else setError(String(pageResult.reason))
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(String(cause))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [read, revision, roomId, runId])
  const currentDetail =
    loadedRevision === revision &&
    detail?.run.id === runId &&
    detail.run.roomId === roomId
      ? detail
      : null
  const ready = Boolean(currentDetail)
  useEffect(() => {
    if (!active || !ready || !window.kunGui?.startSse) return
    const controller = new AbortController()
    const streamId = 'room-run-' + roomRequestId()
    let timer: ReturnType<typeof setTimeout> | undefined
    let refreshing = false
    let refreshDetail = false
    let refreshItems = false
    const refresh = async () => {
      if (refreshing || controller.signal.aborted) return
      refreshing = true
      const fetchDetail = refreshDetail,
        fetchItems = refreshItems
      refreshDetail = false
      refreshItems = false
      const results = await Promise.allSettled([
        fetchDetail
          ? read<RoomRunDetail>('', controller.signal)
          : Promise.resolve(null),
        fetchItems
          ? read<RoomRunItemsPage>('/items', controller.signal)
          : Promise.resolve(null)
      ])
      if (controller.signal.aborted) return
      const [next, page] = results
      if (next.status === 'fulfilled' && next.value) setDetail(next.value)
      if (page.status === 'fulfilled' && page.value) {
        setItemsAvailability(page.value.availability)
        const incoming = page.value.items
        const existing = itemsRef.current
        if (
          existing.length &&
          incoming.length &&
          !incoming.some((item) => existing.some((old) => old.id === item.id))
        ) {
          const gap = page.value.nextCursor
          if (gap) setGapCursors((current) => current.includes(gap) ? current : [gap, ...current])
        }
        setItems((current) => mergeRunItems(current, incoming))
      }
      const failure = results.find((result) => result.status === 'rejected')
      if (failure?.status === 'rejected') setStreamError(String(failure.reason))
      else setStreamError('')
      refreshing = false
      if (refreshDetail || refreshItems)
        timer = setTimeout(() => void refresh(), 250)
    }
    const off = rendererRuntimeClient.onSseEvent((payload) => {
      if (payload.streamId !== streamId) return
      for (const event of payload.events as RoomRunEvent[]) {
        if (event.runId !== runId || event.roomId !== roomId) continue
        cursor.current = event.cursor
        if (event.kind === 'run.reset') {
          setRevision((value) => value + 1)
          continue
        }
        if (event.kind === 'run.updated') refreshDetail = true
        if (event.kind === 'run.items_changed') refreshItems = true
      }
      if (refreshDetail || refreshItems) {
        clearTimeout(timer)
        timer = setTimeout(() => void refresh(), 250)
      }
    })
    const restartStream = (): void => {
      // The remote hub dropped this stream's registration (sender reset) or
      // backlog (buffer overflow) — rebuild it and refetch the run snapshot.
      if (controller.signal.aborted) return
      setStreamError('')
      refreshDetail = true
      refreshItems = true
      void rendererRuntimeClient
        .startSse(runId, 0, streamId, {
          scope: 'room-run',
          roomId,
          runId,
          cursor: cursor.current
        })
        .then(() => refresh())
        .catch((cause) => {
          if (!controller.signal.aborted) setStreamError(String(cause))
        })
    }
    const failed = rendererRuntimeClient.onSseError((payload) => {
      if (payload.streamId !== streamId) return
      if (payload.code === 'remote_buffer_overflow' || payload.code === 'remote_client_expired') {
        restartStream()
        return
      }
      setStreamError(payload.message ?? 'Run updates disconnected')
    })
    const opened = rendererRuntimeClient.onSseOpen((payload) => {
      if (payload.streamId === streamId) setStreamError('')
    })
    const offResubscribe = registerRemoteStreamResubscriber(restartStream)
    void rendererRuntimeClient
      .startSse(runId, 0, streamId, {
        scope: 'room-run',
        roomId,
        runId,
        cursor: cursor.current
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setStreamError(String(cause))
      })
    return () => {
      controller.abort()
      clearTimeout(timer)
      off()
      failed()
      opened()
      offResubscribe()
      void rendererRuntimeClient.stopSse(streamId).catch(() => undefined)
    }
  }, [active, read, ready, revision, roomId, runId])
  const loadEarlier = async () => {
    const gapCursor = gapCursors[0]
    const pageCursor = gapCursor ?? earlierCursor
    const signal = lifecycle.current?.signal
    if (!pageCursor || !signal || moreBusy) return
    setMoreBusy(true)
    setError('')
    try {
      const page = await read<RoomRunItemsPage>(
        `/items?cursor=${encodeURIComponent(pageCursor)}`,
        signal
      )
      if (signal.aborted) return
      setItemsAvailability(page.availability)
      if (gapCursor) {
        const overlaps = page.items.some((item) =>
          itemsRef.current.some((old) => old.id === item.id)
        )
        setGapCursors((current) => current.flatMap((value) => value === gapCursor
          ? overlaps || !page.nextCursor ? [] : [page.nextCursor]
          : [value]))
      } else setEarlierCursor(page.nextCursor)
      setItems((current) => mergeRunItems(page.items, current))
    } catch (cause) {
      if (!signal.aborted) setError(String(cause))
    } finally {
      if (!signal.aborted) setMoreBusy(false)
    }
  }
  return {
    detail: currentDetail,
    items: currentDetail ? items : [],
    itemsAvailability,
    loading,
    moreBusy,
    error,
    streamError,
    hasEarlier: Boolean(gapCursors.length || earlierCursor),
    hasGap: Boolean(gapCursors.length),
    loadEarlier,
    refresh: () => setRevision((value) => value + 1)
  }
}
