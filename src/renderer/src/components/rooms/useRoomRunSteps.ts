import { useEffect, useState } from 'react'
import type { RoomRunSteps } from '@shared/rooms-api'
import { roomPath, roomsRequest } from './rooms-client'
import { isLiveRun } from './room-turn-steps'

// Several rows of one turn read the same run, so reads are shared. A finished
// run never changes and is read once; a live one refreshes while it is shown.
const LIVE_REFRESH_MS = 2000
const MAX_IDLE_ENTRIES = 300
// Opening a long chat shows many turns at once; each read scans that turn's history.
const MAX_CONCURRENT_READS = 4

let reading = 0
const queued: Array<() => void> = []
function withReadSlot<T>(read: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      reading++
      read().then(resolve, reject).finally(() => {
        reading--
        queued.shift()?.()
      })
    }
    if (reading < MAX_CONCURRENT_READS) start()
    else queued.push(start)
  })
}

type Entry = {
  data?: RoomRunSteps
  error?: string
  listeners: Set<() => void>
  timer?: ReturnType<typeof setTimeout>
  loading?: boolean
}
const entries = new Map<string, Entry>()

function load(key: string, roomId: string, runId: string): void {
  const entry = entries.get(key)
  if (!entry || entry.loading) return
  entry.loading = true
  entry.timer = undefined
  void withReadSlot(() => roomsRequest<RoomRunSteps>(`${roomPath(roomId)}/runs/${encodeURIComponent(runId)}/steps`))
    .then((data) => { entry.data = data; entry.error = undefined })
    .catch((cause) => { entry.error = String(cause) })
    .finally(() => {
      entry.loading = false
      for (const listener of entry.listeners) listener()
      if (entry.listeners.size && !entry.error && isLiveRun(entry.data)) {
        entry.timer = setTimeout(() => load(key, roomId, runId), LIVE_REFRESH_MS)
      }
    })
}

function prune(): void {
  if (entries.size <= MAX_IDLE_ENTRIES) return
  for (const [key, entry] of entries) {
    if (entries.size <= MAX_IDLE_ENTRIES) break
    if (!entry.listeners.size && !entry.loading) entries.delete(key)
  }
}

export function useRoomRunSteps(roomId: string, runId: string | undefined): { data?: RoomRunSteps; error?: string } {
  const key = runId ? `${roomId}\u0000${runId}` : ''
  const [, setVersion] = useState(0)
  useEffect(() => {
    if (!runId) return undefined
    let entry = entries.get(key)
    if (!entry) {
      entry = { listeners: new Set() }
      entries.set(key, entry)
      prune()
    }
    const current = entry
    const listener = () => setVersion((version) => version + 1)
    current.listeners.add(listener)
    if ((!current.data || isLiveRun(current.data)) && !current.timer) load(key, roomId, runId)
    return () => {
      current.listeners.delete(listener)
      if (!current.listeners.size && current.timer) {
        clearTimeout(current.timer)
        current.timer = undefined
      }
    }
  }, [key, roomId, runId])
  const entry = key ? entries.get(key) : undefined
  return { data: entry?.data, error: entry?.error }
}
