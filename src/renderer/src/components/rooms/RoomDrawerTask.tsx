import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomTask } from '@shared/rooms-api'
import { roomsClient } from './rooms-client'
import { RoomTaskPanel } from './RoomTaskPanel'

export function RoomDrawerTask({ roomId, taskId, tasks, onClose, onRun, onOpenThread, onUpdated }: {
  roomId: string; taskId: string; tasks: RoomTask[]; onClose: () => void; onRun: (runId: string) => void
  onOpenThread: (threadId: string, turnId?: string) => void | Promise<void>; onUpdated: () => void
}) {
  const { t } = useTranslation('common')
  const [historical, setHistorical] = useState<RoomTask | null>(null)
  const [error, setError] = useState('')
  const current = tasks.find((task) => task.id === taskId) ?? historical
  useEffect(() => {
    if (current) return
    const controller = new AbortController()
    void roomsClient.task(roomId, taskId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setHistorical(result.task) })
      .catch((cause) => { if (!controller.signal.aborted) setError(String(cause)) })
    return () => controller.abort()
  }, [current, roomId, taskId])
  return current ? <RoomTaskPanel task={current} embedded onClose={onClose} onRun={onRun} onOpenThread={onOpenThread} onUpdated={onUpdated} />
    : <p role={error ? 'alert' : undefined} className={error ? 'rooms-message-error' : 'rooms-run-note'}>{error || t('roomsLoading')}</p>
}
